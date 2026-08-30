/**
 * Tek seferlik: README için popup + ayarlar ekran görüntüsü üretir.
 * Kullanım: node test/shots.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(EXT, 'docs');
const BRAVE = process.env.BRAVE_BIN || '/usr/bin/brave-browser';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: BRAVE,
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), 'cs-shot-')),
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-brave-update'
  ]
});

let t = null;
for (let i = 0; i < 40 && !t; i++) {
  t = browser.targets().find((x) => x.type() === 'service_worker' && x.url().startsWith('chrome-extension://'));
  if (!t) await sleep(250);
}
const worker = await t.worker();
const extId = new URL(t.url()).host;

// Örnek durum: milliyet.com.tr için koruma açık, istatistik dolu
await worker.evaluate(async () => {
  await chrome.storage.local.set({
    enabled: true,
    scopeMode: 'sites',
    enabledSites: ['milliyet.com.tr'],
    cookieMode: 'blockAll',
    stats: { rejected: 42, hidden: 7, cookiesRemoved: 128 }
  });
});

// Popup'ın "bu site" bölümünün dolu görünmesi için aktif sekme bir site olsun
const site = await browser.newPage();
await site.goto('https://www.milliyet.com.tr', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await site.bringToFront();
await sleep(4000);

const popupUrl = `chrome-extension://${extId}/src/popup/popup.html`;
// Popup arka planda açılır: böylece "aktif sekme" gerçek site kalır ve popup
// durumu o siteye göre render eder. Sonra öne alıp fotoğrafını çekeriz.
await worker.evaluate(async (u) => {
  await chrome.tabs.create({ url: u, active: false });
}, popupUrl);
const popupTarget = await browser.waitForTarget((t2) => t2.url() === popupUrl, { timeout: 15000 });
const popup = await popupTarget.page();
await popup.setViewport({ width: 340, height: 900, deviceScaleFactor: 2 });
await sleep(1500);
await popup.bringToFront();
await sleep(300);
await popup.screenshot({ path: join(OUT, 'popup.png'), fullPage: true });

const options = await browser.newPage();
await options.setViewport({ width: 980, height: 1200, deviceScaleFactor: 1.5 });
await options.goto(`chrome-extension://${extId}/src/options/options.html`, { waitUntil: 'domcontentloaded' });
await sleep(1200);
await options.screenshot({ path: join(OUT, 'options.png'), fullPage: true });

console.log('yazıldı:', join(OUT, 'popup.png'), join(OUT, 'options.png'));
await browser.close();
