import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helper.mjs';

const { CS } = setup();

test('reddet etiketleri doğru sınıflanır', () => {
  const rejects = [
    'Reject all',
    'Reject All Cookies',
    'Decline',
    'Refuse all',
    'Deny',
    'Disagree and close',
    'Continue without accepting',
    'Do not accept',
    'No, thanks',
    'Opt out',
    'Tümünü Reddet',
    'Reddet',
    'Kabul Etmiyorum',
    'Kabul etmeden devam et',
    'Sadece Zorunlu Çerezler',
    'Yalnızca gerekli çerezleri kullan',
    'Alle ablehnen',
    'Nur notwendige Cookies',
    'Tout refuser',
    'Continuer sans accepter',
    'Rechazar todo',
    'Solo las necesarias',
    'Rifiuta tutto',
    'Alles weigeren'
  ];
  for (const label of rejects) {
    assert.equal(CS.classify(label), 'reject', `reddet beklendi: ${label}`);
  }
});

test('kabul etiketleri reddet ile karışmaz', () => {
  const accepts = [
    'Accept all',
    'Accept All Cookies',
    'I agree',
    'Allow all',
    'Got it',
    'OK',
    'Tümünü Kabul Et',
    'Kabul Et',
    'Hepsini kabul ediyorum',
    'Anladım',
    'Alle akzeptieren',
    'Tout accepter',
    'Aceptar todo',
    'Accetta tutti'
  ];
  for (const label of accepts) {
    assert.equal(CS.classify(label), 'accept', `kabul beklendi: ${label}`);
  }
});

test('ayar ve kaydet etiketleri ayrışır', () => {
  assert.equal(CS.classify('Manage preferences'), 'settings');
  assert.equal(CS.classify('Tercihleri Yönet'), 'settings');
  assert.equal(CS.classify('Çerez Ayarları'), 'settings');
  assert.equal(CS.classify('Einstellungen verwalten'), 'settings');
  assert.equal(CS.classify('Save preferences'), 'save');
  assert.equal(CS.classify('Seçimleri Kaydet'), 'save');
  assert.equal(CS.classify('Bestätigen'), 'save');
});

test('alakasız etiketler null döner', () => {
  for (const label of ['Ana Sayfa', 'Sepete ekle', 'Search', 'Giriş yap', 'Ürünler', '']) {
    assert.equal(CS.classify(label), null, `null beklendi: ${label}`);
  }
});

test('türkçe normalizasyon çalışır', () => {
  assert.equal(CS.norm('TÜMÜNÜ REDDET'), 'tumunu reddet');
  assert.equal(CS.norm('Çerez  Ayarları\n'), 'cerez ayarlari');
  assert.equal(CS.norm('İzin Ver'), 'izin ver');
});

test('varsayılan ayarlar beklenen modda', () => {
  assert.equal(CS.DEFAULTS.cookieMode, 'blockAll');
  assert.equal(CS.DEFAULTS.enabled, true);
  assert.equal(CS.DEFAULTS.autoReject, true);
});

test('hostMatches alt alan adlarını kapsar', () => {
  assert.equal(CS.hostMatches(['ornek.com'], 'www.ornek.com'), true);
  assert.equal(CS.hostMatches(['ornek.com'], 'panel.ornek.com'), true);
  assert.equal(CS.hostMatches(['ornek.com'], 'ornekcom.net'), false);
  assert.equal(CS.hostMatches([], 'ornek.com'), false);
});
