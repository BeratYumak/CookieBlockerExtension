/**
 * Popup arayüzü: varsayılan durumda "bu sitede kapalı" görünmeli, etkinleştirme
 * düğmesi site kapsamını (eTLD+1) göndermeli, "tüm siteler" kapsamında ise
 * eski istisna düğmeleri ortaya çıkmalı.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { ROOT } from './helper.mjs';

const HTML = readFileSync(join(ROOT, 'src/popup/popup.html'), 'utf8');
const POPUP_JS = readFileSync(join(ROOT, 'src/popup/popup.js'), 'utf8');

const settings = (patch = {}) =>
  Object.assign(
    {
      enabled: true,
      scopeMode: 'sites',
      enabledSites: [],
      cookieMode: 'blockAll',
      stats: { rejected: 1, hidden: 2, cookiesRemoved: 3 }
    },
    patch
  );

/** popup.js'i sahte chrome API'siyle çalıştırır, gönderilen mesajları biriktirir. */
async function mountPopup(state) {
  const dom = new JSDOM(HTML.replace('<script src="popup.js"></script>', ''), {
    runScripts: 'dangerously',
    url: 'chrome-extension://test/src/popup/popup.html'
  });
  const sent = [];
  let current = state;
  dom.window.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        sent.push(msg);
        if (msg.type === 'cs:get-state') return current;
        if (msg.type === 'cs:set-site-active') {
          current = Object.assign({}, current, { siteActive: !!msg.on });
          return { ok: true, site: msg.host, on: !!msg.on, removed: 4, reloaded: true };
        }
        if (msg.type === 'cs:toggle-list') {
          current = Object.assign({}, current, {
            [msg.list === 'allowlist' ? 'allowlisted' : 'siteDisabled']: !!msg.on
          });
          return { ok: true };
        }
        return { ok: true };
      },
      openOptionsPage: () => {}
    },
    tabs: { sendMessage: async () => ({ ok: true }) }
  };
  dom.window.eval(POPUP_JS);
  await new Promise((r) => setTimeout(r, 0));
  const $ = (id) => dom.window.document.getElementById(id);
  return { dom, sent, $ };
}

const stateFor = (host, site, extra = {}) => {
  const state = Object.assign(
    {
      ok: true,
      host,
      site,
      tabId: 7,
      cookieCount: 0,
      tabActions: 0,
      scopeMode: 'sites',
      siteActive: false,
      effectiveCookieMode: 'off',
      allowlisted: false,
      siteDisabled: false
    },
    extra
  );
  state.settings = settings(extra.settings);
  return state;
};

test('varsayılan: site kapalı görünür, açma düğmesi site kapsamını yazar', async () => {
  const { $ } = await mountPopup(stateFor('www.milliyet.com.tr', 'milliyet.com.tr'));
  assert.equal($('host').textContent, 'www.milliyet.com.tr');
  assert.equal($('status').textContent, 'Koruma bu sitede kapalı');
  assert.match($('activate').textContent, /^milliyet\.com\.tr için korumayı aç$/);
  assert.equal($('activate').hidden, false);
  assert.match($('scope').textContent, /milliyet\.com\.tr ve tüm alt alan adları/);
  // Site kapsamında izin/kapat düğmeleri anlamsız: görünmemeli
  assert.equal($('allow').hidden, true);
  assert.equal($('disable').hidden, true);
});

test('etkinleştirme düğmesi site kapsamını ve sekmeyi gönderir', async () => {
  const { dom, sent, $ } = await mountPopup(stateFor('gist.github.com', 'github.com'));
  $('activate').dispatchEvent(new dom.window.MouseEvent('click'));
  await new Promise((r) => setTimeout(r, 10));
  const msg = sent.find((m) => m.type === 'cs:set-site-active');
  assert.deepEqual({ host: msg.host, on: msg.on, tabId: msg.tabId }, {
    host: 'github.com',
    on: true,
    tabId: 7
  });
  assert.match($('status').textContent, /^Koruma açık: github\.com$/);
  assert.match($('activate').textContent, /^Korumayı kapat \(github\.com\)$/);
});

test('aktif sitede düğme kapatmaya döner', async () => {
  const { dom, sent, $ } = await mountPopup(
    stateFor('milliyet.com.tr', 'milliyet.com.tr', {
      siteActive: true,
      effectiveCookieMode: 'blockAll',
      settings: { enabledSites: ['milliyet.com.tr'] }
    })
  );
  assert.match($('activate').textContent, /^Korumayı kapat \(milliyet\.com\.tr\)$/);
  $('activate').dispatchEvent(new dom.window.MouseEvent('click'));
  await new Promise((r) => setTimeout(r, 10));
  const msg = sent.find((m) => m.type === 'cs:set-site-active');
  assert.equal(msg.on, false);
  assert.equal($('status').textContent, 'Koruma bu sitede kapalı');
});

test('ana anahtar kapalıysa durum bunu söyler', async () => {
  const { $ } = await mountPopup(
    stateFor('milliyet.com.tr', 'milliyet.com.tr', { settings: { enabled: false } })
  );
  assert.equal($('status').textContent, 'Eklenti tamamen kapalı');
});

test('kapsam anahtarı ayarı gönderir', async () => {
  const { dom, sent } = await mountPopup(stateFor('github.com', 'github.com'));
  const radio = dom.window.document.querySelector('input[name="scope"][value="all"]');
  radio.checked = true;
  radio.dispatchEvent(new dom.window.Event('change'));
  await new Promise((r) => setTimeout(r, 10));
  const msg = sent.find((m) => m.type === 'cs:set' && m.patch && m.patch.scopeMode);
  assert.equal(msg.patch.scopeMode, 'all');
});

test('"tüm siteler" kapsamında istisna düğmeleri görünür', async () => {
  const { $ } = await mountPopup(
    stateFor('gist.github.com', 'github.com', {
      scopeMode: 'all',
      siteActive: true,
      effectiveCookieMode: 'blockAll',
      settings: { scopeMode: 'all' }
    })
  );
  assert.equal($('activate').hidden, true);
  assert.equal($('allow').hidden, false);
  assert.match($('allow').textContent, /^github\.com için çerezlere izin ver$/);
  assert.match($('disable').textContent, /^github\.com için eklentiyi kapat$/);
  assert.match($('status').textContent, /tüm siteler kapsamı/);
});

test('izin düğmesi site kapsamını gönderir ("tüm siteler")', async () => {
  const { dom, sent, $ } = await mountPopup(
    stateFor('gist.github.com', 'github.com', { scopeMode: 'all', settings: { scopeMode: 'all' } })
  );
  $('allow').dispatchEvent(new dom.window.MouseEvent('click'));
  await new Promise((r) => setTimeout(r, 10));
  const toggle = sent.find((m) => m.type === 'cs:toggle-list');
  assert.deepEqual({ list: toggle.list, host: toggle.host, on: toggle.on }, {
    list: 'allowlist',
    host: 'github.com',
    on: true
  });
  assert.match($('allow').textContent, /Çerez izni açık \(github\.com\) — kaldır/);
});

test('çerez silme düğmesi site kapsamını kullanır', async () => {
  const { dom, sent } = await mountPopup(stateFor('gist.github.com', 'github.com'));
  dom.window.document.getElementById('clear').dispatchEvent(new dom.window.MouseEvent('click'));
  await new Promise((r) => setTimeout(r, 10));
  const clear = sent.find((m) => m.type === 'cs:clear-cookies');
  assert.equal(clear.host, 'github.com');
});

test('tarayıcı sayfasında eylemler kapalı kalır', async () => {
  const { $ } = await mountPopup(stateFor(null, null));
  assert.equal($('host').textContent, 'tarayıcı sayfası');
  assert.equal($('scope').textContent, '');
  assert.equal($('activate').hidden, true);
  for (const id of ['allow', 'disable', 'clear', 'scan', 'activate']) {
    assert.equal($(id).disabled, true, id + ' devre dışı olmalı');
  }
});
