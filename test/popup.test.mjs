/**
 * Popup arayüzü: kullanıcı hangi kapsamda izin verdiğini metinden görebilmeli.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { ROOT } from './helper.mjs';

const HTML = readFileSync(join(ROOT, 'src/popup/popup.html'), 'utf8');
const POPUP_JS = readFileSync(join(ROOT, 'src/popup/popup.js'), 'utf8');

const SETTINGS = {
  enabled: true,
  cookieMode: 'blockAll',
  stats: { rejected: 1, hidden: 2, cookiesRemoved: 3 }
};

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

const stateFor = (host, site, extra = {}) =>
  Object.assign(
    {
      ok: true,
      settings: SETTINGS,
      host,
      site,
      tabId: 7,
      cookieCount: 0,
      tabActions: 0,
      allowlisted: false,
      siteDisabled: false
    },
    extra
  );

test('popup, derin bir repo adresinde site kapsamını gösterir', async () => {
  const { $ } = await mountPopup(stateFor('github.com', 'github.com'));
  assert.equal($('host').textContent, 'github.com');
  assert.match($('scope').textContent, /github\.com ve tüm alt alan adları/);
  assert.match($('allow').textContent, /^github\.com için çerezlere izin ver$/);
  assert.match($('disable').textContent, /^github\.com için eklentiyi kapat$/);
});

test('alt alan adında bile izin site kapsamına yazılır', async () => {
  const { $ } = await mountPopup(stateFor('gist.github.com', 'github.com'));
  assert.equal($('host').textContent, 'gist.github.com');
  assert.match($('scope').textContent, /github\.com ve tüm alt alan adları/);
  assert.match($('allow').textContent, /^github\.com için çerezlere izin ver$/);
});

test('izin düğmesi site kapsamını gönderir ve durumu günceller', async () => {
  const { dom, sent, $ } = await mountPopup(stateFor('gist.github.com', 'github.com'));
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

test('çerez silme düğmesi de site kapsamını kullanır', async () => {
  const { dom, sent, $ } = await mountPopup(stateFor('gist.github.com', 'github.com'));
  $('clear').dispatchEvent(new dom.window.MouseEvent('click'));
  await new Promise((r) => setTimeout(r, 10));
  const clear = sent.find((m) => m.type === 'cs:clear-cookies');
  assert.equal(clear.host, 'github.com');
});

test('tarayıcı sayfasında eylemler kapalı kalır', async () => {
  const { $ } = await mountPopup(stateFor(null, null));
  assert.equal($('host').textContent, 'tarayıcı sayfası');
  assert.equal($('scope').textContent, '');
  for (const id of ['allow', 'disable', 'clear', 'scan']) {
    assert.equal($(id).disabled, true, id + ' devre dışı olmalı');
  }
});
