/**
 * A/B saha testi: aynı siteyi önce eklentisiz, sonra eklentili aç.
 * Her tur için ekran görüntüsü + çerez sayısı + kalan onay banner'ı raporlar.
 *
 * Kullanım: node test/ab-milliyet.mjs [url]
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(EXT, 'docs');
mkdirSync(OUT, { recursive: true });
const BRAVE = process.env.BRAVE_BIN || '/usr/bin/brave-browser';
const URL_ = process.argv[2] || 'https://www.milliyet.com.tr';
const HOST = new URL(URL_).hostname.replace(/^www\./, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sayfada kalan, görünür çerez onay perdesi/banner'ı var mı?
const BANNER_PROBE = () => {
  const words = /(cookie|çerez|cerez|consent|gdpr|kvkk|izin ver|kabul et)/i;
  const out = [];
  for (const el of document.querySelectorAll('div,section,aside,dialog,form,iframe')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 150 || r.height < 40) continue;
    if (el.querySelector('main,[role="main"]')) continue;
    const t = (el.innerText || el.getAttribute('title') || el.id || '').slice(0, 400);
    const isIframe = el.tagName === 'IFRAME';
    if (!words.test(t) && !(isIframe && /consent|cmp|sourcepoint|onetrust/i.test(el.src || ''))) continue;
    out.push({
      tag: el.tagName,
      id: el.id || null,
      area: Math.round(r.width * r.height),
      text: (el.innerText || el.src || '').replace(/\s+/g, ' ').slice(0, 120)
    });
  }
  out.sort((a, b) => b.area - a.area);
  return out;
};

const PAGE_PROBE = () => ({
  cookieHeaderJar: document.cookie,
  metin: document.body.innerText.replace(/\s+/g, ' ').trim().length,
  link: document.querySelectorAll('a[href]').length,
  gorsel: document.querySelectorAll('img').length,
  baslik: document.title
});

async function run(withExt) {
  const label = withExt ? 'acik' : 'kapali';
  const args = [
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-brave-update',
    '--window-size=1366,900'
  ];
  if (withExt) args.unshift(`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`);

  const browser = await puppeteer.launch({
    executablePath: BRAVE,
    headless: true,
    userDataDir: mkdtempSync(join(tmpdir(), `cs-ab-${label}-`)),
    args
  });

  let worker = null;
  if (withExt) {
    let t = null;
    for (let i = 0; i < 40 && !t; i++) {
      t = browser.targets().find((x) => x.type() === 'service_worker' && x.url().startsWith('chrome-extension://'));
      if (!t) await sleep(250);
    }
    if (!t) throw new Error('eklenti service worker yüklenmedi');
    worker = await t.worker();
    await sleep(1500); // kurallar devreye girsin
  }

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const sentCookieHeaders = [];
  const setCookieResponses = [];
  page.on('request', (r) => {
    const h = r.headers();
    if (h.cookie) sentCookieHeaders.push(`${new URL(r.url()).hostname}: ${h.cookie.slice(0, 60)}`);
  });
  page.on('response', (r) => {
    const h = r.headers();
    if (h['set-cookie']) setCookieResponses.push(`${new URL(r.url()).hostname}: ${h['set-cookie'].slice(0, 60)}`);
  });

  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(9000); // CMP yüklensin + eklenti reddetsin

  const shotEarly = join(OUT, `ab-${HOST}-${label}.png`);
  await page.screenshot({ path: shotEarly });

  const banners = await page.evaluate(BANNER_PROBE);
  const pageInfo = await page.evaluate(PAGE_PROBE);
  const cdpCookies = (await page.cookies()).length;
  let extCookies = null;
  let stats = null;
  if (worker) {
    extCookies = await worker.evaluate(async () => (await chrome.cookies.getAll({})).length);
    stats = await worker.evaluate(async () => (await chrome.storage.local.get('stats')).stats);
  }

  const res = {
    label,
    shot: shotEarly,
    banners,
    pageInfo,
    cdpCookies,
    extCookies,
    stats,
    sentCookieHeaders: sentCookieHeaders.length,
    setCookieResponses: setCookieResponses.length,
    ornekSetCookie: setCookieResponses.slice(0, 3)
  };
  await browser.close();
  return res;
}

console.log(`site: ${URL_}\n`);
const kapali = await run(false);
const acik = await run(true);

for (const r of [kapali, acik]) {
  console.log(`=== eklenti ${r.label.toUpperCase()} ===`);
  console.log(`  banner  : ${r.banners.length ? 'KALDI -> ' + JSON.stringify(r.banners[0]) : 'temiz'}`);
  if (r.banners.length > 1) console.log(`            (+${r.banners.length - 1} aday daha)`);
  console.log(`  çerez   : cdp=${r.cdpCookies}${r.extCookies !== null ? ` ext=${r.extCookies}` : ''}`);
  console.log(`  giden Cookie başlığı : ${r.sentCookieHeaders}`);
  console.log(`  gelen Set-Cookie     : ${r.setCookieResponses} ${JSON.stringify(r.ornekSetCookie)}`);
  console.log(`  document.cookie uzunluk: ${r.pageInfo.cookieHeaderJar.length}`);
  console.log(`  içerik  : ${r.pageInfo.metin} karakter, ${r.pageInfo.link} link, ${r.pageInfo.gorsel} görsel`);
  console.log(`  başlık  : ${r.pageInfo.baslik}`);
  if (r.stats) console.log(`  istatistik: ${JSON.stringify(r.stats)}`);
  console.log(`  görüntü : ${r.shot}\n`);
}

const bozulma = ['link', 'gorsel'].map((k) => {
  const a = kapali.pageInfo[k];
  const b = acik.pageInfo[k];
  const fark = a ? Math.round((Math.abs(a - b) / a) * 100) : 0;
  return `${k}: ${a} -> ${b} (%${fark})`;
});
console.log('site bozulma kıyası:', bozulma.join(' | '));
console.log('SONUÇ banner:', kapali.banners.length > 0 && acik.banners.length === 0 ? 'GEÇTI (kapalıyken var, açıkken yok)' : 'İNCELE');
console.log('SONUÇ çerez :', acik.cdpCookies < kapali.cdpCookies ? `GEÇTI (${kapali.cdpCookies} -> ${acik.cdpCookies})` : 'İNCELE');
