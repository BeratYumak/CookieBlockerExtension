/**
 * Gerçek sitelerde saha kontrolü (ağ gerektirir, sonuçlar siteye göre değişebilir).
 * Kullanım: node test/real-sites.mjs [url ...]
 * Her site için: kalan görünür onay banner'ı, depolanan çerez sayısı, tespit edilen CMP.
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRAVE = process.env.BRAVE_BIN || '/usr/bin/brave-browser';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SITES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'https://www.bbc.com/news',
      'https://www.hepsiburada.com',
      'https://www.milliyet.com.tr',
      'https://www.zeit.de',
      'https://www.theguardian.com/international'
    ];

const browser = await puppeteer.launch({
  executablePath: BRAVE,
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), 'cs-real-')),
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-brave-update'
  ]
});

let swTarget = null;
for (let i = 0; i < 40 && !swTarget; i++) {
  swTarget = browser.targets().find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
  if (!swTarget) await sleep(250);
}
const worker = swTarget ? await swTarget.worker() : null;
console.log('eklenti:', swTarget ? 'yüklü' : 'YÜKLENEMEDİ');

// Eklenti varsayılan olarak hiçbir sitede çalışmaz: ölçülecek siteleri aç.
if (worker) {
  const hosts = SITES.map((u) => new URL(u).hostname);
  const active = await worker.evaluate(async (hs) => {
    const sites = Array.from(new Set(hs.map((h) => self.CookieShield.registrableDomain(h))));
    await chrome.storage.local.set({ enabledSites: sites, enabled: true, scopeMode: 'sites' });
    return sites;
  }, hosts);
  await sleep(1500); // kurallar devreye girsin
  console.log('etkinleştirilen siteler:', active.join(', '));
}

for (const url of SITES) {
  const page = await browser.newPage();
  let row = { url, banner: '?', cookies: '?', hata: null };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(7000);
    row.banner = await page.evaluate(() => {
      const words = /(cookie|çerez|cerez|consent|gdpr|einwilligung|zustimmung)/i;
      const nodes = document.querySelectorAll('div,section,aside,dialog,form');
      let worst = null;
      for (const el of nodes) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
        const t = (el.innerText || '').slice(0, 300);
        if (!words.test(t)) continue;
        if (el.querySelector('main,[role="main"]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 120 || r.height < 40) continue;
        if (!worst || r.width * r.height > worst.area) {
          worst = { area: r.width * r.height, text: t.replace(/\s+/g, ' ').slice(0, 90) };
        }
      }
      return worst ? 'KALDI: ' + worst.text : 'temiz';
    });
    const host = new URL(url).hostname;
    if (worker) {
      row.cookies = await worker.evaluate(async (h) => {
        const all = await chrome.cookies.getAll({});
        return all.length + ' (bu site: ' + all.filter((c) => c.domain.includes(h.replace(/^www\./, ''))).length + ')';
      }, host);
    }
  } catch (e) {
    row.hata = String(e.message || e).slice(0, 80);
  }
  console.log(`\n${row.url}\n  banner : ${row.banner}\n  çerez  : ${row.cookies}${row.hata ? '\n  hata   : ' + row.hata : ''}`);
  await page.close();
}

if (worker) {
  const stats = await worker.evaluate(async () => (await chrome.storage.local.get('stats')).stats);
  console.log('\nistatistik:', JSON.stringify(stats));
}
await browser.close();
