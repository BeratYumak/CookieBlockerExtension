/**
 * Kanıt turu: eklenti açıkken pop-up'a GERÇEKTEN "Tümünü Reddet" tıklanıyor mu?
 * - debug modu açılır, content script logları toplanır
 * - sayfa dünyasında capture-phase click dinleyicisi kurulur (kim tıklandı?)
 * - OneTrust API çağrıları sarılır
 * Kullanım: node test/ab-proof.mjs [url]
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(EXT, 'docs');
const BRAVE = process.env.BRAVE_BIN || '/usr/bin/brave-browser';
const URL_ = process.argv[2] || 'https://www.milliyet.com.tr';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BRAVE,
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), 'cs-proof-')),
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-brave-update',
    '--window-size=1366,900'
  ]
});

let t = null;
for (let i = 0; i < 40 && !t; i++) {
  t = browser.targets().find((x) => x.type() === 'service_worker' && x.url().startsWith('chrome-extension://'));
  if (!t) await sleep(250);
}
const worker = await t.worker();
// debug loglarını aç
await worker.evaluate(async () => {
  const cur = (await chrome.storage.local.get('settings')).settings || {};
  cur.debug = true;
  await chrome.storage.local.set({ settings: cur });
});
await sleep(1200);

const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 900 });

const csLogs = [];
page.on('console', (m) => {
  const s = m.text();
  if (s.includes('[CookieShield]')) csLogs.push(s.replace('[CookieShield]', '').trim());
});

// Sayfa dünyası: hangi öğelere tıklandığını ve OneTrust API çağrılarını kaydet
await page.evaluateOnNewDocument(() => {
  window.__csClicks = [];
  window.__csApi = [];
  window.addEventListener(
    'click',
    (e) => {
      const el = e.target;
      if (!el || !el.tagName) return;
      window.__csClicks.push({
        tag: el.tagName,
        id: el.id || null,
        cls: (el.className && String(el.className).slice(0, 60)) || null,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        trusted: e.isTrusted
      });
    },
    true
  );
  // OneTrust yüklendiğinde API'lerini sar
  let ot;
  Object.defineProperty(window, 'OneTrust', {
    configurable: true,
    get: () => ot,
    set: (v) => {
      ot = v;
      for (const fn of ['RejectAll', 'AllowAll', 'ToggleInfoDisplay']) {
        if (typeof v?.[fn] === 'function') {
          const orig = v[fn].bind(v);
          v[fn] = (...a) => {
            window.__csApi.push(fn);
            return orig(...a);
          };
        }
      }
    }
  });
});

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(10000);

const clicks = await page.evaluate(() => window.__csClicks);
const api = await page.evaluate(() => window.__csApi);
const otState = await page.evaluate(() => {
  const g = window.OnetrustActiveGroups || window.OptanonActiveGroups || null;
  return { activeGroups: g, alertBoxClosed: !!(window.OneTrust && window.OneTrust.IsAlertBoxClosed && window.OneTrust.IsAlertBoxClosed()) };
});
const shot = join(OUT, 'proof-milliyet-acik.png');
await page.screenshot({ path: shot });

console.log('--- content script debug logları ---');
console.log(csLogs.length ? csLogs.map((l) => '  ' + l).join('\n') : '  (log yok)');
console.log('\n--- sayfa dünyasında görülen click olayları ---');
console.log(clicks.length ? clicks.map((c) => '  ' + JSON.stringify(c)).join('\n') : '  (tıklama yok)');
console.log('\n--- sarılan OneTrust API çağrıları ---', JSON.stringify(api));
console.log('--- OneTrust rıza durumu ---', JSON.stringify(otState));
console.log('görüntü:', shot);

await browser.close();
