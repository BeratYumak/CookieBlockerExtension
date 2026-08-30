/**
 * Cookie Shield - gerçek Brave üzerinde uçtan uca test.
 * Eklentiyi yükler, yerel bir test sunucusu açar ve şunları doğrular:
 *  1) Bilinen CMP'nin "Reddet" butonuna otomatik basılır (kabul edilmez)
 *  2) CMP JS API'si (OneTrust.RejectAll) çağrılır
 *  3) Sunucunun Set-Cookie'si engellenir, sonraki istekte çerez gitmez
 *  4) document.cookie sanal kavanozda kalır (sayfa çalışır, sunucuya gitmez)
 *  5) Çerez duvarı: kaydırma kilidi açılır, banner gizlenir
 *  6) İzin listesindeki site için çerezler yeniden çalışır
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
      res.end(JSON.stringify({ cookie: req.headers.cookie || null }));
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
  const { server, port, seen } = await startServer();
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
        '--host-resolver-rules=MAP localhost 127.0.0.1'
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
    const DEBUG = !!process.env.CS_DEBUG;
    if (worker && DEBUG) {
      await worker.evaluate(async () => {
        await chrome.storage.local.set({ debug: true });
      });
      await sleep(300);
    }
    const hookConsole = (p) => {
      if (DEBUG) p.on('console', (m) => console.log('   [sayfa]', m.text()));
      return p;
    };

    if (worker) {
      const state = await worker.evaluate(async () => {
        const s = await chrome.storage.local.get(null);
        const sets = await chrome.declarativeNetRequest.getEnabledRulesets();
        return { mode: s.cookieMode, enabled: s.enabled, sets };
      });
      check(
        'varsayılan mod ve kural setleri aktif',
        state.enabled === true && state.mode === 'blockAll' && state.sets.includes('block-all-cookies'),
        `mod=${state.mode} setler=${state.sets.join(',')}`
      );
    }

    // 1) DOM üzerinden gerçek reddet tıklaması
    let page = hookConsole(await browser.newPage());
    await page.goto(base + '/consent-dom', { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    const domRes = await page.evaluate(() => ({
      result: window.__result || null,
      bannerVisible: (() => {
        const el = document.getElementById('onetrust-banner-sdk');
        if (!el) return false;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
      })()
    }));
    check('DOM: "Reject All" otomatik tıklandı (kabul edilmedi)', domRes.result === 'reject', `sonuç=${domRes.result}`);
    await page.close();

    // 2) CMP JS API ile reddetme
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

    // 3) Sunucu çerezi engellendi mi?
    page = hookConsole(await browser.newPage());
    await page.goto(base + '/setcookie', { waitUntil: 'domcontentloaded' });
    await sleep(500);
    const echo1 = await page.evaluate(async (b) => {
      const r = await fetch(b + '/echo?first', { cache: 'no-store' });
      return r.json();
    }, base);
    const cookiesInStore = worker
      ? await worker.evaluate(async () => (await chrome.cookies.getAll({})).map((c) => c.name + '@' + c.domain))
      : [];
    check('Set-Cookie engellendi (sonraki istekte çerez yok)', !echo1.cookie, `cookie=${echo1.cookie}`);
    check('çerez deposu temiz', cookiesInStore.length === 0, cookiesInStore.join(', ') || 'boş');
    await page.close();

    // 4) document.cookie sanal kavanoz
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

    // 5) Çerez duvarı
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

    // 6) İzin listesi: çerezler geri çalışmalı
    if (worker) {
      await worker.evaluate(async () => {
        await chrome.storage.local.set({ allowlist: ['localhost'] });
      });
      await sleep(1500);
      const dyn = await worker.evaluate(async () => {
        const rules = await chrome.declarativeNetRequest.getDynamicRules();
        return rules.map((r) => `${r.id}:${JSON.stringify(r.condition.requestDomains || r.condition.initiatorDomains)}`);
      });
      check('izin listesi için dinamik allow kuralı yazıldı', dyn.length >= 2, dyn.join(' '));
      page = hookConsole(await browser.newPage());
      await page.goto(base + '/setcookie', { waitUntil: 'domcontentloaded' });
      await sleep(400);
      const echo2 = await page.evaluate(async (b) => {
        const r = await fetch(b + '/echo?allow', { cache: 'no-store' });
        return r.json();
      }, base);
      check('izin listesindeki sitede çerez çalışıyor', /srv=1/.test(echo2.cookie || ''), `cookie=${echo2.cookie}`);
      await page.close();
      await worker.evaluate(async () => {
        await chrome.storage.local.set({ allowlist: [] });
      });
    }

    // 7) Eklenti arayüzleri hatasız açılıyor mu?
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

    // 8) İstatistikler
    if (worker) {
      const stats = await worker.evaluate(async () => (await chrome.storage.local.get('stats')).stats);
      check('istatistikler kaydedildi', (stats.rejected || 0) + (stats.hidden || 0) > 0, JSON.stringify(stats));
    }
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
