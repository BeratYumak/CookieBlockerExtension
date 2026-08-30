/**
 * Cookie Shield - gerçek Brave üzerinde uçtan uca test.
 * Eklentiyi yükler, yerel bir test sunucusu açar ve şunları doğrular:
 *  A) Varsayılan durumda hiçbir müdahale yok (banner tıklanmaz, çerez çalışır)
 *  B) Sayfa açıkken siteyi etkinleştirmek reddetmeyi anında tetikler
 *  C) Etkin sitede: CMP API reddi, Set-Cookie engeli, sanal kavanoz, çerez duvarı
 *  D) Siteyi kapatınca çerezler yeniden çalışır
 *  E) Etkinleştirme kapsamı site geneli (eTLD+1 + alt alan adları), sızmaz
 *  F) "Tüm siteler" kapsamı ve izin listesi (eski davranış) hâlâ çalışır
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRAVE = process.env.BRAVE_BIN || '/usr/bin/brave-browser';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = {
  '/consent-dom': `<!DOCTYPE html><html lang="tr"><body>
    <script>window.__marker = 'ilk-yukleme';</script>
    <main><h1>DOM testi</h1><p>Sayfa içeriği.</p></main>
    <div id="onetrust-consent-sdk">
      <div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#eee;padding:20px">
        <p>We use cookies to improve your experience. Çerez kullanıyoruz.</p>
        <button id="onetrust-accept-btn-handler" onclick="window.__result='accept'">Accept All Cookies</button>
        <button id="onetrust-reject-all-handler" onclick="window.__result='reject'">Reject All</button>
      </div>
    </div></body></html>`,

  '/consent-api': `<!DOCTYPE html><html lang="tr"><body>
    <script>
      window.__api = null;
      window.OneTrust = { RejectAll: function () { window.__api = 'rejected'; } };
    </script>
    <main><h1>API testi</h1></main>
    <div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk" style="position:fixed;z-index:9999">
      <p>This site uses cookies for consent purposes.</p>
      <button id="onetrust-accept-btn-handler" onclick="window.__api='accept'">Accept All</button>
    </div></div></body></html>`,

  '/jar': `<!DOCTYPE html><html><body><main><h1>Kavanoz</h1></main>
    <script>
      document.cookie = 'jstest=1; path=/';
      window.__readBack = document.cookie;
    </script></body></html>`,

  '/wall': `<!DOCTYPE html><html><body style="overflow:hidden;filter:blur(4px)">
    <main><h1>İçerik kilitli</h1></main>
    <div class="cookie-wall-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998"></div>
    <div id="wall" class="cookie-consent-wall" style="position:fixed;top:20%;left:10%;z-index:9999;background:#fff;padding:30px">
      <h2>Devam etmek için çerezleri kabul edin</h2>
      <p>Bu sitede cookie consent vermeden içeriği göremezsiniz.</p>
      <button onclick="window.__result='accept'">Kabul Et ve Devam Et</button>
    </div></body></html>`,

  '/plain': `<!DOCTYPE html><html><body><main><h1>Düz sayfa</h1></main></body></html>`
};

function startServer() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, cookie: req.headers.cookie || null });
    if (req.url.startsWith('/echo')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ cookie: req.headers.cookie || null, gpc: req.headers['sec-gpc'] || null }));
      return;
    }
    if (req.url.startsWith('/setcookie')) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'set-cookie': 'srv=1; Path=/; Max-Age=3600'
      });
      res.end('<!DOCTYPE html><html><body><main>Sunucu çerezi denendi</main></body></html>');
      return;
    }
    const body = PAGES[req.url.split('?')[0]];
    if (body) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('yok');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, seen }));
  });
}

async function main() {
  const { server, port } = await startServer();
  const base = `http://localhost:${port}`;
  const profile = mkdtempSync(join(tmpdir(), 'cs-e2e-'));
  let browser;

  try {
    browser = await puppeteer.launch({
      executablePath: BRAVE,
      headless: true,
      userDataDir: profile,
      args: [
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
        '--no-sandbox',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-brave-update',
        '--disable-sync',
        '--host-resolver-rules=MAP * 127.0.0.1'
      ]
    });

    // Eklentinin servis çalışanını bekle
    let swTarget = null;
    for (let i = 0; i < 40 && !swTarget; i++) {
      swTarget = browser.targets().find(
        (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://')
      );
      if (!swTarget) await sleep(250);
    }
    check('eklenti servis çalışanı yüklendi', !!swTarget, swTarget ? swTarget.url().slice(0, 45) + '…' : 'bulunamadı');
    const worker = swTarget ? await swTarget.worker() : null;
    if (!worker) throw new Error('servis çalışanı yok, devam edilemiyor');

    const DEBUG = !!process.env.CS_DEBUG;
    if (DEBUG) {
      await worker.evaluate(async () => {
        await chrome.storage.local.set({ debug: true });
      });
      await sleep(300);
    }
    const hookConsole = (p) => {
      if (DEBUG) p.on('console', (m) => console.log('   [sayfa]', m.text()));
      return p;
    };

    /** Siteyi aç/kapat (tabId verilmezse sekme yenilenmez). */
    const setSite = (host, on, tabId) =>
      worker.evaluate(
        async (h, o, t) => {
          const r = await self.CookieShieldSW.setSiteActive(h, o, t);
          return { ok: r.ok, site: r.site, removed: r.removed, reloaded: r.reloaded };
        },
        host,
        on,
        tabId == null ? null : tabId
      );

    const ruleSummary = () =>
      worker.evaluate(async () => {
        const s = await chrome.storage.local.get(null);
        return {
          scopeMode: s.scopeMode,
          enabled: s.enabled,
          enabledSites: s.enabledSites,
          cookieMode: s.cookieMode,
          sets: await chrome.declarativeNetRequest.getEnabledRulesets(),
          dynamic: (await chrome.declarativeNetRequest.getDynamicRules()).length
        };
      });

    const cookieOn = async (host, tag) => {
      const p = hookConsole(await browser.newPage());
      await p.goto(`http://${host}:${port}/setcookie`, { waitUntil: 'domcontentloaded' });
      await sleep(400);
      const echo = await p.evaluate(async (u) => {
        const r = await fetch(u, { cache: 'no-store' });
        return r.json();
      }, `http://${host}:${port}/echo?${tag}`);
      await p.close();
      return echo;
    };

    // ------------------------------------------------- A) varsayılan: hiç müdahale yok
    const fresh = await ruleSummary();
    check(
      'varsayılan kapsam site bazlı ve hiç kural yazılmamış',
      fresh.scopeMode === 'sites' &&
        Array.isArray(fresh.enabledSites) && fresh.enabledSites.length === 0 &&
        fresh.sets.length === 0 && fresh.dynamic === 0,
      `kapsam=${fresh.scopeMode} setler=[${fresh.sets.join(',')}] dinamik=${fresh.dynamic}`
    );

    let page = hookConsole(await browser.newPage());
    await page.goto(base + '/consent-dom', { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    const passive = await page.evaluate(() => ({
      result: window.__result || null,
      bannerVisible: getComputedStyle(document.getElementById('onetrust-banner-sdk')).display !== 'none'
    }));
    check(
      'varsayılanda banner\'a dokunulmuyor (ne reddet ne gizle)',
      passive.result === null && passive.bannerVisible === true,
      `sonuç=${passive.result} banner=${passive.bannerVisible}`
    );

    // Tarayıcının kendi davranışı: Brave zaten Sec-GPC gönderebilir; kıyas için ölç.
    const baseline = await cookieOn('localhost', 'baseline');
    check(
      'varsayılanda çerezler normal çalışıyor (müdahale yok)',
      /srv=1/.test(baseline.cookie || ''),
      `cookie=${baseline.cookie} sec-gpc=${baseline.gpc}`
    );

    // B) Sayfa açıkken siteyi etkinleştir -> reddetme anında tetiklenmeli
    const act = await setSite('localhost', true);
    check('site etkinleştirildi', act.ok && act.site === 'localhost', `site=${act.site}`);
    await sleep(2500);
    const live = await page.evaluate(() => ({
      result: window.__result || null,
      marker: window.__marker || null
    }));
    check(
      'etkinleştirme açık sayfada reddetmeyi tetikledi (yenilemeye gerek yok)',
      live.result === 'reject' && live.marker === 'ilk-yukleme',
      `sonuç=${live.result}`
    );
    await page.close();

    const afterActivate = await ruleSummary();
    check(
      'sadece bu site için dinamik kural yazıldı, global set açılmadı',
      afterActivate.sets.length === 0 && afterActivate.dynamic >= 6,
      `setler=[${afterActivate.sets.join(',')}] dinamik=${afterActivate.dynamic}`
    );

    // ---------------------------------------- C) etkin sitede tüm koruma katmanları
    page = hookConsole(await browser.newPage());
    await page.goto(base + '/consent-dom', { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    const domRes = await page.evaluate(() => window.__result || null);
    check('DOM: "Reject All" otomatik tıklandı (kabul edilmedi)', domRes === 'reject', `sonuç=${domRes}`);
    await page.close();

    page = hookConsole(await browser.newPage());
    await page.goto(base + '/consent-api', { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    const apiRes = await page.evaluate(() => ({
      api: window.__api,
      gpc: navigator.globalPrivacyControl === true,
      dnt: navigator.doNotTrack
    }));
    check('API: OneTrust.RejectAll() çağrıldı', apiRes.api === 'rejected', `değer=${apiRes.api}`);
    check('GPC sinyali sayfaya enjekte edildi', apiRes.gpc === true && apiRes.dnt === '1', `gpc=${apiRes.gpc} dnt=${apiRes.dnt}`);
    await page.close();

    const echoActive = await cookieOn('localhost', 'active');
    const cookiesInStore = await worker.evaluate(async () =>
      (await chrome.cookies.getAll({})).map((c) => c.name + '@' + c.domain)
    );
    check('Set-Cookie engellendi (sonraki istekte çerez yok)', !echoActive.cookie, `cookie=${echoActive.cookie}`);
    check('istekte Sec-GPC gönderildi', echoActive.gpc === '1', `sec-gpc=${echoActive.gpc}`);
    check('çerez deposu temiz', cookiesInStore.length === 0, cookiesInStore.join(', ') || 'boş');

    page = hookConsole(await browser.newPage());
    await page.goto(base + '/jar', { waitUntil: 'domcontentloaded' });
    await sleep(400);
    const jar = await page.evaluate(async (b) => {
      const r = await fetch(b + '/echo?jar', { cache: 'no-store' });
      const j = await r.json();
      return { readBack: window.__readBack, now: document.cookie, sent: j.cookie };
    }, base);
    check(
      'document.cookie sayfa içinde çalışır (özellik bozulmaz)',
      /jstest=1/.test(jar.readBack || '') && /jstest=1/.test(jar.now || ''),
      `okunan="${jar.now}"`
    );
    check('sanal çerez sunucuya gönderilmez', !jar.sent, `gönderilen=${jar.sent}`);
    await page.close();

    page = hookConsole(await browser.newPage());
    await page.goto(base + '/wall', { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    const wall = await page.evaluate(() => {
      const w = document.getElementById('wall');
      const bd = document.querySelector('.cookie-wall-backdrop');
      const cs = getComputedStyle(document.body);
      return {
        wallHidden: getComputedStyle(w).display === 'none',
        backdropHidden: bd ? getComputedStyle(bd).display === 'none' : true,
        overflow: cs.overflow,
        filter: cs.filter,
        clicked: window.__result || null
      };
    });
    check('çerez duvarı gizlendi', wall.wallHidden, `display=${wall.wallHidden}`);
    check('örtü katmanı gizlendi', wall.backdropHidden);
    check('kaydırma kilidi ve bulanıklık kaldırıldı', wall.overflow !== 'hidden' && wall.filter === 'none', `overflow=${wall.overflow} filter=${wall.filter}`);
    check('kabul butonuna basılmadı', wall.clicked === null, `tıklanan=${wall.clicked}`);
    await page.close();

    // Etkinleştirmede sekme yenileme (reloadOnActivate)
    await setSite('localhost', false);
    await sleep(800);
    page = hookConsole(await browser.newPage());
    await page.goto(base + '/consent-dom', { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await sleep(600);
    const tabId = await worker.evaluate(async () => (await self.CookieShieldSW.buildState()).tabId);
    const reload = await setSite('localhost', true, tabId);
    await sleep(2500);
    const afterReload = await page.evaluate(() => ({
      marker: window.__marker || null,
      result: window.__result || null
    }));
    check(
      'sekme yenilendi ve yeniden yüklenen sayfada da reddedildi',
      reload.reloaded === true && afterReload.result === 'reject',
      `yenilendi=${reload.reloaded} sonuç=${afterReload.result} marker=${afterReload.marker}`
    );
    await page.close();

    // -------------------------------------------- D) siteyi kapatınca engel kalkmalı
    const off = await setSite('localhost', false);
    await sleep(1200);
    const afterOff = await ruleSummary();
    const echoOff = await cookieOn('localhost', 'off');
    check(
      'site kapatılınca dinamik kurallar silindi',
      afterOff.dynamic === 0 && afterOff.enabledSites.length === 0,
      `dinamik=${afterOff.dynamic} liste=${JSON.stringify(afterOff.enabledSites)}`
    );
    check('kapalı sitede çerezler yeniden çalışıyor', /srv=1/.test(echoOff.cookie || ''), `cookie=${echoOff.cookie}`);
    check(
      'kapalı sitede GPC tarayıcı varsayılanına döndü',
      (echoOff.gpc || null) === (baseline.gpc || null),
      `kapalı=${echoOff.gpc} varsayılan=${baseline.gpc}`
    );
    void off;

    // --------------------------------- E) kapsam: alt alan adında açmak siteyi kapsar
    const deep = hookConsole(await browser.newPage());
    await deep.goto(`http://gist.cs-test.com:${port}/plain?a/b/c`, { waitUntil: 'domcontentloaded' });
    await deep.bringToFront();
    await sleep(500);
    const st = await worker.evaluate(async () => {
      const s = await self.CookieShieldSW.buildState();
      return { host: s.host, site: s.site, siteActive: s.siteActive };
    });
    check(
      'derin adreste eylem kapsamı site geneli (yol değil)',
      st.host === 'gist.cs-test.com' && st.site === 'cs-test.com' && st.siteActive === false,
      `host=${st.host} site=${st.site} aktif=${st.siteActive}`
    );

    const deepAct = await setSite(st.host, true);
    await sleep(1200);
    const listed = await worker.evaluate(async () => (await chrome.storage.local.get('enabledSites')).enabledSites);
    check('etkinleştirme kaydı site olarak yazıldı', listed.length === 1 && listed[0] === 'cs-test.com', listed.join(','));
    void deepAct;

    const cSub = await cookieOn('gist.cs-test.com', 'sub');
    const cRoot = await cookieOn('cs-test.com', 'root');
    const cWww = await cookieOn('www.cs-test.com', 'www');
    const cOther = await cookieOn('baska-cs-test.com', 'other');
    check('engel alt alan adında çalışıyor (gist.cs-test.com)', !cSub.cookie, `cookie=${cSub.cookie}`);
    check('engel ana alan adında da çalışıyor (cs-test.com)', !cRoot.cookie, `cookie=${cRoot.cookie}`);
    check('engel www alt alan adında da çalışıyor', !cWww.cookie, `cookie=${cWww.cookie}`);
    check('engel başka siteye sızmıyor', /srv=1/.test(cOther.cookie || ''), `cookie=${cOther.cookie}`);

    // Kapatma: dar kayıtlar da temizlenir
    await worker.evaluate(async () => {
      const cur = (await chrome.storage.local.get('enabledSites')).enabledSites || [];
      await chrome.storage.local.set({ enabledSites: cur.concat(['gist.cs-test.com']) });
    });
    await setSite('cs-test.com', false);
    await sleep(1200);
    const after = await worker.evaluate(async () => (await chrome.storage.local.get('enabledSites')).enabledSites);
    check('kapatınca alt alan kayıtları da silindi', after.length === 0, JSON.stringify(after));
    const cBack = await cookieOn('gist.cs-test.com', 'back');
    check('kapatıldıktan sonra çerez yeniden çalışıyor', /srv=1/.test(cBack.cookie || ''), `cookie=${cBack.cookie}`);
    await deep.close();

    // ------------------------------- F) "tüm siteler" kapsamı + izin listesi (eski mod)
    await worker.evaluate(async () => {
      for (const c of await chrome.cookies.getAll({})) {
        const d = String(c.domain || '').replace(/^\./, '');
        await chrome.cookies
          .remove({
            url: (c.secure ? 'https://' : 'http://') + d + (c.path || '/'),
            name: c.name,
            storeId: c.storeId,
            partitionKey: c.partitionKey
          })
          .catch(() => {});
      }
      await chrome.storage.local.set({ scopeMode: 'all', allowlist: [] });
    });
    await sleep(1500);
    const allMode = await ruleSummary();
    const echoAll = await cookieOn('baska-cs-test.com', 'allmode');
    check(
      '"tüm siteler" kapsamında global kural setleri açıldı',
      allMode.sets.includes('block-all-cookies') && allMode.sets.includes('privacy-signals'),
      `setler=[${allMode.sets.join(',')}]`
    );
    check('"tüm siteler" kapsamında her sitede çerez engelli', !echoAll.cookie, `cookie=${echoAll.cookie}`);

    await worker.evaluate(async () => {
      await chrome.storage.local.set({ allowlist: ['cs-test.com'] });
    });
    await sleep(1500);
    const echoAllow = await cookieOn('gist.cs-test.com', 'allow');
    check('izin listesindeki sitede çerez çalışıyor', /srv=1/.test(echoAllow.cookie || ''), `cookie=${echoAllow.cookie}`);

    await worker.evaluate(async () => {
      await chrome.storage.local.set({ scopeMode: 'sites', allowlist: [], enabledSites: [] });
    });
    await sleep(1200);
    const backToSites = await ruleSummary();
    check(
      'site kapsamına dönünce global kurallar kapandı',
      backToSites.sets.length === 0 && backToSites.dynamic === 0,
      `setler=[${backToSites.sets.join(',')}] dinamik=${backToSites.dynamic}`
    );

    // ------------------------------------------------- G) arayüzler hatasız açılıyor mu
    if (swTarget) {
      const extId = new URL(swTarget.url()).host;
      for (const [label, path] of [
        ['popup', 'src/popup/popup.html'],
        ['ayarlar', 'src/options/options.html']
      ]) {
        const p = await browser.newPage();
        const errs = [];
        p.on('pageerror', (e) => errs.push(String(e.message)));
        await p.goto(`chrome-extension://${extId}/${path}`, { waitUntil: 'domcontentloaded' });
        await sleep(1200);
        const filled = await p.evaluate(() => {
          const el = document.getElementById('stats');
          return el ? el.textContent.trim() : '';
        });
        check(
          `${label} sayfası hatasız açıldı ve durum yüklendi`,
          errs.length === 0 && filled.length > 3,
          errs.join(' | ') || filled.slice(0, 70)
        );
        await p.close();
      }
    }

    // H) İstatistikler
    const stats = await worker.evaluate(async () => (await chrome.storage.local.get('stats')).stats);
    check('istatistikler kaydedildi', (stats.rejected || 0) + (stats.hidden || 0) > 0, JSON.stringify(stats));
  } catch (e) {
    check('beklenmeyen hata', false, String(e && e.stack ? e.stack.split('\n')[0] : e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} kontrol geçti`);
  if (failed.length) {
    console.log('Başarısız:', failed.map((f) => f.name).join(' | '));
    process.exit(1);
  }
}

main();
