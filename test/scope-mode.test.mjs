/**
 * Varsayılan duruş: eklenti hiçbir sitede kendiliğinden iş yapmaz.
 * Koruma yalnızca kullanıcının açtığı sitelerde (eTLD+1 + alt alan adları) devreye girer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helper.mjs';

const { CS } = setup(null, { url: 'https://ornek.com/' });

const defaults = (patch = {}) => Object.assign({}, CS.DEFAULTS, patch);

test('varsayılan ayarlar site kapsamlı ve liste boş', () => {
  assert.equal(CS.DEFAULTS.scopeMode, 'sites');
  assert.deepEqual([...CS.DEFAULTS.enabledSites], []);
  assert.equal(CS.DEFAULTS.enabled, true);
});

test('varsayılanda hiçbir sitede aktif değil', () => {
  const s = defaults();
  for (const h of ['milliyet.com.tr', 'github.com', 'localhost', 'bank.example.org']) {
    assert.equal(CS.isActiveHost(s, h), false, h + ' pasif olmalı');
    assert.equal(CS.cookieModeFor(s, h), 'off', h + ' çerezlerine dokunulmamalı');
    assert.equal(CS.isHardBlockedHost(s, h), false);
  }
});

test('bir site açılınca sadece o site ve alt alan adları etkilenir', () => {
  const site = CS.registrableDomain(new URL('https://www.milliyet.com.tr/haber/x').hostname);
  const s = defaults({ enabledSites: CS.toggleHostList([], site, true) });
  assert.deepEqual([...s.enabledSites], ['milliyet.com.tr']);
  for (const h of ['milliyet.com.tr', 'www.milliyet.com.tr', 'cdn.milliyet.com.tr']) {
    assert.equal(CS.isActiveHost(s, h), true, h + ' aktif olmalı');
    assert.equal(CS.cookieModeFor(s, h), 'blockAll');
    assert.equal(CS.isHardBlockedHost(s, h), true);
  }
  for (const h of ['hurriyet.com.tr', 'milliyet.com', 'notmilliyet.com.tr', 'github.com']) {
    assert.equal(CS.isActiveHost(s, h), false, h + ' etkilenmemeli');
    assert.equal(CS.cookieModeFor(s, h), 'off');
  }
});

test('ana anahtar kapalıysa açık siteler de çalışmaz', () => {
  const s = defaults({ enabled: false, enabledSites: ['milliyet.com.tr'] });
  assert.equal(CS.isActiveHost(s, 'milliyet.com.tr'), false);
  assert.equal(CS.cookieModeFor(s, 'milliyet.com.tr'), 'off');
});

test('çerez modu "off" iken site aktiftir ama çereze dokunulmaz', () => {
  const s = defaults({ enabledSites: ['zeit.de'], cookieMode: 'off' });
  assert.equal(CS.isActiveHost(s, 'zeit.de'), true); // pop-up reddi çalışır
  assert.equal(CS.cookieModeFor(s, 'zeit.de'), 'off');
  assert.equal(CS.isHardBlockedHost(s, 'zeit.de'), false);
});

test('oturum boyu / 3. taraf modlarında sanal kavanoz kurulmaz', () => {
  for (const mode of ['sessionOnly', 'thirdParty']) {
    const s = defaults({ enabledSites: ['zeit.de'], cookieMode: mode });
    assert.equal(CS.cookieModeFor(s, 'zeit.de'), mode);
    assert.equal(CS.isHardBlockedHost(s, 'zeit.de'), false);
  }
});

test('site kapsamında allowlist ve disabledSites yok sayılır', () => {
  const s = defaults({
    enabledSites: ['zeit.de'],
    allowlist: ['zeit.de'],
    disabledSites: ['zeit.de']
  });
  assert.equal(CS.isActiveHost(s, 'zeit.de'), true);
  assert.equal(CS.cookieModeFor(s, 'zeit.de'), 'blockAll');
});

test('"tüm siteler" kapsamı eski davranışı korur', () => {
  const s = defaults({ scopeMode: 'all' });
  assert.equal(CS.isActiveHost(s, 'herhangi.com'), true);
  assert.equal(CS.cookieModeFor(s, 'herhangi.com'), 'blockAll');

  const withAllow = defaults({ scopeMode: 'all', allowlist: ['banka.com.tr'] });
  assert.equal(CS.isActiveHost(withAllow, 'internet.banka.com.tr'), true); // pop-up reddi sürer
  assert.equal(CS.cookieModeFor(withAllow, 'internet.banka.com.tr'), 'off');
  assert.equal(CS.cookieModeFor(withAllow, 'baska.com'), 'blockAll');

  const withDisabled = defaults({ scopeMode: 'all', disabledSites: ['sorunlu.com'] });
  assert.equal(CS.isActiveHost(withDisabled, 'app.sorunlu.com'), false);
  assert.equal(CS.cookieModeFor(withDisabled, 'app.sorunlu.com'), 'off');
});

test('geçersiz host hiçbir zaman aktif sayılmaz', () => {
  const s = defaults({ enabledSites: ['zeit.de'] });
  for (const h of ['', null, undefined]) {
    assert.equal(CS.isActiveHost(s, h), false);
    assert.equal(CS.cookieModeFor(s, h), 'off');
  }
});

test('korumayı kapatmak listeden dar kayıtları da temizler', () => {
  let list = CS.toggleHostList([], 'gist.github.com', true);
  list = CS.toggleHostList(list, 'github.com', true);
  let s = defaults({ enabledSites: list });
  assert.equal(CS.isActiveHost(s, 'api.github.com'), true);
  s = defaults({ enabledSites: CS.toggleHostList(list, 'github.com', false) });
  assert.deepEqual([...s.enabledSites], []);
  assert.equal(CS.isActiveHost(s, 'gist.github.com'), false);
});
