import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helper.mjs';

const PAGE = (extra, bodyStyle = '') => `<!DOCTYPE html><html><body style="${bodyStyle}">
  <header><nav><a href="/">Ana Sayfa</a><a href="/urunler">Ürünler</a></nav></header>
  <main><h1>Örnek Site</h1><p>Bu sitenin gerçek içeriği burada.</p></main>
  <footer><a href="/cerez-politikasi">Çerez Politikası</a><a href="/gizlilik">Gizlilik</a></footer>
  ${extra}
</body></html>`;

test('OneTrust banner: adaptör gerçek reddet butonuna basar', () => {
  const { CS, AD, window, document } = setup(
    PAGE(`<div id="onetrust-consent-sdk">
      <div id="onetrust-banner-sdk" style="position:fixed;z-index:9999">
        <p>Bu site çerezler kullanır. We use cookies to improve your experience.</p>
        <button id="onetrust-accept-btn-handler">Tümünü Kabul Et</button>
        <button id="onetrust-reject-all-handler">Tümünü Reddet</button>
        <button id="onetrust-pc-btn-handler">Çerez Ayarları</button>
      </div>
      <div class="onetrust-pc-dark-filter" style="position:fixed"></div>
    </div>`)
  );
  window.__clicked = null;
  document.getElementById('onetrust-reject-all-handler').addEventListener('click', () => {
    window.__clicked = 'reject';
  });
  document.getElementById('onetrust-accept-btn-handler').addEventListener('click', () => {
    window.__clicked = 'accept';
  });

  const roots = AD.collectRoots(document);
  const found = AD.detectAdapters(roots);
  assert.equal(found.length >= 1, true, 'onetrust adaptörü bulunmalı');
  assert.equal(found[0].name, 'onetrust');

  const res = AD.tryAdapter(found[0], roots);
  assert.equal(res.step, 'reject');
  assert.equal(window.__clicked, 'reject', 'kabul yerine reddet tıklanmalı');
  assert.ok(CS);
});

test('Cookiebot: reddet butonu tıklanır, kabul edilmez', () => {
  const { AD, window, document } = setup(
    PAGE(`<div id="CybotCookiebotDialog" style="position:fixed;z-index:1000">
      <p>This website uses cookies / consent</p>
      <button id="CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll">Allow all</button>
      <button id="CybotCookiebotDialogBodyButtonDecline">Decline</button>
    </div>`)
  );
  window.__clicked = null;
  document.getElementById('CybotCookiebotDialogBodyButtonDecline').addEventListener('click', () => {
    window.__clicked = 'decline';
  });
  const roots = AD.collectRoots(document);
  const res = AD.tryAdapter(AD.byName('cookiebot'), roots);
  assert.equal(res.step, 'reject');
  assert.equal(window.__clicked, 'decline');
});

test('Shadow DOM içindeki Usercentrics reddet butonu bulunur', () => {
  const { AD, window, document } = setup(PAGE('<div id="host-el"></div>'));
  const host = document.getElementById('host-el');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<div id="usercentrics-root" style="position:fixed;z-index:2000">
      <p>We use cookies and consent</p>
      <button data-testid="uc-accept-all-button">Accept All</button>
      <button data-testid="uc-deny-all-button">Deny All</button>
    </div>`;
  window.__clicked = null;
  shadow.querySelector('[data-testid="uc-deny-all-button"]').addEventListener('click', () => {
    window.__clicked = 'deny';
  });

  const roots = AD.collectRoots(document);
  assert.ok(roots.length > 1, 'shadow root toplanmalı');
  const res = AD.tryAdapter(AD.byName('usercentrics'), roots);
  assert.equal(res.step, 'reject');
  assert.equal(window.__clicked, 'deny');
});

test('Bilinmeyen CMP: sezgisel tarama Türkçe banner ve reddet butonunu bulur', () => {
  const { CS, window, document } = setup(
    PAGE(`<div class="cerez-uyari-kutusu" style="position:fixed;z-index:9999;bottom:0">
      <h3>Çerez Tercihleri</h3>
      <p>Deneyiminizi iyileştirmek için çerezler ve benzeri teknolojiler kullanıyoruz.</p>
      <button class="btn btn-primary">Tümünü Kabul Et</button>
      <button class="btn btn-link">Sadece Zorunlu Çerezler</button>
      <a href="/cerez" class="btn">Ayarları Yönet</a>
    </div>`)
  );
  const found = CS.findBanner(document);
  assert.ok(found, 'banner bulunmalı');
  assert.equal(found.el.className.includes('cerez-uyari-kutusu'), true);

  const reject = CS.findButton(found.el, 'reject');
  assert.ok(reject, 'reddet butonu bulunmalı');
  assert.equal(CS.norm(reject.textContent), 'sadece zorunlu cerezler');

  window.__clicked = null;
  reject.addEventListener('click', () => (window.__clicked = 'reject'));
  CS.realClick(reject);
  assert.equal(window.__clicked, 'reject');
});

test('Yanlış pozitif yok: normal sayfa banner sayılmaz', () => {
  const { CS, document } = setup(PAGE(''));
  assert.equal(CS.findBanner(document), null);
});

test('Yanlış pozitif yok: çerezle ilgisi olmayan modal gizlenmez', () => {
  const { CS, document } = setup(
    PAGE(`<div role="dialog" style="position:fixed;z-index:9999">
      <h2>Giriş Yap</h2>
      <input type="email" /><input type="password" />
      <button>Giriş</button>
    </div>`)
  );
  assert.equal(CS.findBanner(document), null);
});

test('Tercih paneli: zorunlu kutular korunur, isteğe bağlı olanlar kapatılır', () => {
  const { CS, document } = setup(
    PAGE(`<div id="prefs" style="position:fixed;z-index:9999">
      <p>Cookie consent tercihleri</p>
      <label>Zorunlu çerezler <input type="checkbox" id="c1" checked disabled /></label>
      <label>Analitik çerezler <input type="checkbox" id="c2" checked /></label>
      <label>Reklam çerezleri <input type="checkbox" id="c3" checked /></label>
      <button>Tercihleri Kaydet</button>
    </div>`)
  );
  const panel = document.getElementById('prefs');
  const changed = CS.uncheckAll(panel);
  assert.equal(changed, 2, 'iki isteğe bağlı kutu kapatılmalı');
  assert.equal(document.getElementById('c1').checked, true, 'zorunlu kutu korunmalı');
  assert.equal(document.getElementById('c2').checked, false);
  assert.equal(document.getElementById('c3').checked, false);
  assert.equal(CS.classify(CS.labelOf(panel.querySelector('button'))), 'save');
});

test('Çerez duvarı: reddet seçeneği olmayan banner gizlenir ve kaydırma kilidi açılır', () => {
  const { CS, document } = setup(
    PAGE(`<div class="cookie-wall-backdrop" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:9998">
      <div id="wall" class="cookie-wall" style="position:fixed;z-index:9999">
        <h2>Devam etmek için çerezleri kabul edin</h2>
        <p>Bu siteyi kullanmak için cookie consent vermeniz gerekir.</p>
        <button id="onlyAccept">Kabul Et ve Devam Et</button>
      </div>
    </div>`, 'overflow:hidden;position:fixed;filter:blur(4px)')
  );
  const wall = document.getElementById('wall');
  assert.equal(CS.findButton(wall, 'reject'), null, 'reddet butonu yok');

  assert.equal(CS.hideElement(wall), true);
  assert.equal(wall.style.display, 'none');

  const fixes = CS.unlockPage(document);
  assert.ok(fixes >= 2, 'kilit düzeltmeleri uygulanmalı');
  const body = document.body;
  assert.equal(body.style.getPropertyValue('overflow'), 'auto');
  assert.equal(body.style.getPropertyValue('position'), 'static');
  assert.equal(body.style.getPropertyValue('filter'), 'none');
});

test('Örtü katmanı (backdrop) da gizlenir, sayfa içeriği gizlenmez', () => {
  const { CS, document } = setup(
    PAGE(`<div class="modal-backdrop" style="position:fixed;top:0;left:0;width:100%;height:100%">
      <div id="b" class="cookie-consent-banner" style="position:fixed;z-index:9999">
        <p>Çerez kullanımı / cookie consent</p>
        <button>Tümünü Reddet</button>
      </div>
    </div>`)
  );
  const banner = document.getElementById('b');
  CS.hideElement(banner);
  const n = CS.hideBackdrops(banner, document);
  assert.ok(n >= 1, 'sarmalayıcı backdrop gizlenmeli');
  assert.equal(document.querySelector('main').style.display, '', 'sayfa içeriği gizlenmemeli');
});

test('Perde algılama: inset:0 imzası boyut ölçümünden bağımsız çalışır', () => {
  // Gerçek dünyada body'deki filter/transform, sabit konumlu perdenin
  // ölçülen dikdörtgenini küçültür; bu yüzden inset imzasına bakılır.
  const { CS, document } = setup(
    PAGE(`<div id="veil" class="cookie-wall-backdrop" style="position:fixed;top:0;left:0;right:0;bottom:0"></div>
      <div id="b" class="cookie-consent-banner" style="position:fixed;z-index:9999">
        <p>cookie consent metni</p><button>Kabul Et</button>
      </div>`, 'filter:blur(4px)')
  );
  const veil = document.getElementById('veil');
  assert.equal(CS.looksLikeVeil(veil, document), true, 'inset:0 + metinsiz = perde');
  const n = CS.hideBackdrops(document.getElementById('b'), document);
  assert.ok(n >= 1);
  assert.equal(veil.style.display, 'none');
});

test('Perde algılama: içerikli sabit öğe perde sayılmaz', () => {
  const { CS, document } = setup(
    PAGE(`<div id="chat" class="support-overlay" style="position:fixed;top:0;left:0;right:0;bottom:0">
      Canlı destek: size nasıl yardımcı olabiliriz? Mesajınızı yazın ve temsilcimiz yanıtlasın.
    </div>`)
  );
  assert.equal(CS.looksLikeVeil(document.getElementById('chat'), document), false);
});

test('findAllBanners iç içe adayları tekilleştirir', () => {
  const { CS, document } = setup(
    PAGE(`<div class="cookie-outer" style="position:fixed;z-index:5000">
      <div class="cookie-inner">
        <p>cookie consent metni</p>
        <button>Reject all</button>
        <button>Accept all</button>
      </div>
    </div>`)
  );
  const list = CS.findAllBanners(document, 5);
  assert.equal(list.length, 1, 'iç içe olanlar tek adaya indirilmeli');
});
