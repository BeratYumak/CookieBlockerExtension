/**
 * Cookie Shield - service-worker.js
 * - Çerez modunu (blockAll / thirdParty / sessionOnly / off) uygular
 * - DNR kural setlerini ve izin listesi istisnalarını yönetir
 * - JS ile yazılan çerezleri anında siler (DNR'ın göremediği kısım)
 * - İstatistik, rozet ve popup/options mesajlarını yönetir
 */
'use strict';

importScripts('/src/content/core.js');

const CS = self.CookieShield;
const DEFAULTS = CS.DEFAULTS;

const RULESET_ALL = 'block-all-cookies';
const RULESET_3P = 'block-third-party-cookies';
const ALLOW_RULE_BASE = 1000;

let cache = null;

async function getSettings(force) {
  if (cache && !force) return cache;
  const stored = await chrome.storage.local.get(null);
  cache = Object.assign({}, DEFAULTS, stored || {});
  cache.stats = Object.assign({}, DEFAULTS.stats, stored && stored.stats);
  return cache;
}

async function setSettings(patch) {
  const next = Object.assign({}, await getSettings(), patch);
  cache = next;
  await chrome.storage.local.set(patch);
  return next;
}

// ------------------------------------------------------------------- kural seti
async function applyRulesets(s) {
  const enable = [];
  const disable = [];
  const on = s.enabled && s.cookieMode === 'blockAll';
  const on3p = s.enabled && (s.cookieMode === 'thirdParty' || s.cookieMode === 'sessionOnly');
  (on ? enable : disable).push(RULESET_ALL);
  (on3p ? enable : disable).push(RULESET_3P);
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enable,
      disableRulesetIds: disable.filter((id) => !enable.includes(id))
    });
  } catch (e) {
    console.warn('[CookieShield] kural seti güncellenemedi', e);
  }
}

/** İzin listesindeki hostlar için yüksek öncelikli "allow" istisnaları. */
async function applyAllowRules(s) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);
  const hosts = (s.allowlist || []).map((h) => CS.normHost(h)).filter(Boolean);
  const addRules = [];
  let id = ALLOW_RULE_BASE;
  const types = [
    'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font',
    'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other'
  ];
  for (const host of hosts) {
    addRules.push({
      id: id++,
      priority: 100,
      action: { type: 'allow' },
      condition: { requestDomains: [host], resourceTypes: types }
    });
    addRules.push({
      id: id++,
      priority: 100,
      action: { type: 'allow' },
      condition: { initiatorDomains: [host], resourceTypes: types }
    });
  }
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  } catch (e) {
    console.warn('[CookieShield] izin kuralları yazılamadı', e);
  }
}

async function applyPrivacyApi(s) {
  const block = s.enabled && (s.cookieMode === 'blockAll' || s.cookieMode === 'thirdParty');
  try {
    await chrome.privacy.websites.thirdPartyCookiesAllowed.set({ value: !block });
  } catch (e) {
    // Brave bu ayarı yönetmiyor olabilir; DNR kuralları yine devrede.
  }
}

async function applyAll() {
  const s = await getSettings(true);
  await applyRulesets(s);
  await applyAllowRules(s);
  await applyPrivacyApi(s);
  return s;
}

// ------------------------------------------------------- çerez silme mekanizması
function cookieUrl(c) {
  const domain = String(c.domain || '').replace(/^\./, '');
  return (c.secure ? 'https://' : 'http://') + domain + (c.path || '/');
}

let removedCount = 0;
let flushTimer = null;

function scheduleStatsFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (!removedCount) return;
    const s = await getSettings();
    const stats = Object.assign({}, s.stats);
    stats.cookiesRemoved = (stats.cookiesRemoved || 0) + removedCount;
    removedCount = 0;
    await setSettings({ stats });
  }, 3000);
}

async function removeCookie(c) {
  try {
    await chrome.cookies.remove({
      url: cookieUrl(c),
      name: c.name,
      storeId: c.storeId,
      partitionKey: c.partitionKey
    });
    removedCount++;
    scheduleStatsFlush();
    return true;
  } catch (_) {
    return false;
  }
}

chrome.cookies.onChanged.addListener(async ({ cookie, removed, cause }) => {
  if (removed) return;
  if (cause === 'evicted' || cause === 'expired') return;
  const s = await getSettings();
  if (!s.enabled || s.cookieMode === 'off' || s.cookieMode === 'sessionOnly') return;
  const domain = String(cookie.domain || '').replace(/^\./, '');
  if (CS.hostMatches(s.allowlist, domain)) return;
  if (s.cookieMode === 'thirdParty') {
    // Birinci taraf çerezler kalsın: açık sekmelerden biriyle eşleşiyorsa dokunma
    const hosts = await openHosts();
    if (hosts.some((h) => h === domain || h.endsWith('.' + domain))) return;
  }
  await removeCookie(cookie);
});

async function openHosts() {
  const tabs = await chrome.tabs.query({});
  const out = new Set();
  for (const t of tabs) {
    if (!t.url) continue;
    try {
      const u = new URL(t.url);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.add(u.hostname.replace(/^www\./, ''));
    } catch (_) { /* yoksay */ }
  }
  return Array.from(out);
}

/** sessionOnly: sekmesi kapanan sitenin çerezlerini sil. */
let sweepTimer = null;
function scheduleSweep(delay) {
  if (sweepTimer) clearTimeout(sweepTimer);
  sweepTimer = setTimeout(() => {
    sweepTimer = null;
    sweepClosedSites();
  }, delay || 4000);
}

async function sweepClosedSites() {
  const s = await getSettings();
  if (!s.enabled || s.cookieMode !== 'sessionOnly') return;
  const hosts = await openHosts();
  const all = await chrome.cookies.getAll({});
  let n = 0;
  for (const c of all) {
    const domain = String(c.domain || '').replace(/^\./, '');
    if (CS.hostMatches(s.allowlist, domain)) continue;
    const stillOpen = hosts.some((h) => h === domain || h.endsWith('.' + domain) || domain.endsWith('.' + h));
    if (stillOpen) continue;
    if (await removeCookie(c)) n++;
    if (n > 400) break; // tek turda aşırı yüklenme koruması
  }
  if (n) console.log('[CookieShield] kapanan sitelerin çerezleri silindi:', n);
}

async function clearCookies(host) {
  const s = await getSettings();
  // Verilen host site kapsamıdır (eTLD+1); Chrome `domain` filtresi alt alan
  // adlarını da kapsar.
  const site = host ? CS.normHost(host) : null;
  const all = await chrome.cookies.getAll(site ? { domain: site } : {});
  let n = 0;
  for (const c of all) {
    const domain = String(c.domain || '').replace(/^\./, '');
    if (!site && CS.hostMatches(s.allowlist, domain)) continue;
    if (await removeCookie(c)) n++;
  }
  return n;
}

// ------------------------------------------------------------------- olay bağları
chrome.runtime.onInstalled.addListener(async (details) => {
  const stored = await chrome.storage.local.get(null);
  const patch = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (!(k in stored)) patch[k] = v;
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  await applyAll();
  try {
    await chrome.alarms.create('cs:sweep', { periodInMinutes: 15 });
  } catch (_) { /* yoksay */ }
  if (details.reason === 'install') {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') });
    } catch (_) { /* yoksay */ }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const s = await applyAll();
  if (s.clearCookiesOnStartup) {
    const n = await clearCookies(null);
    console.log('[CookieShield] açılışta silinen çerez:', n);
  }
  scheduleSweep(8000);
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'cs:sweep') scheduleSweep(100);
});

chrome.tabs.onRemoved.addListener(() => scheduleSweep());

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(changes);
  if (keys.length === 1 && keys[0] === 'stats') {
    cache = null;
    return;
  }
  await applyAll();
});

// ------------------------------------------------------------------- mesajlaşma
const tabCounters = new Map();

/** Popup durumu: aktif sekmenin hostu + eylemlerin uygulanacağı site kapsamı. */
async function buildState() {
  const s = await getSettings(true);
  let host = null;
  let tabId = null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    tabId = tab.id;
    try {
      host = new URL(tab.url).hostname;
    } catch (_) { /* yoksay */ }
  }
  // Eylemler (izin/kapat/temizle) sitenin tamamına uygulanır, tek alt alan
  // adına değil: gist.github.com -> github.com
  const site = host ? CS.registrableDomain(host) : null;
  let cookieCount = null;
  if (site) {
    try {
      cookieCount = (await chrome.cookies.getAll({ domain: site })).length;
    } catch (_) { /* yoksay */ }
  }
  return {
    ok: true,
    settings: s,
    host,
    site,
    tabId,
    cookieCount,
    tabActions: tabId ? tabCounters.get(tabId) || 0 : 0,
    allowlisted: host ? CS.hostMatches(s.allowlist, host) : false,
    siteDisabled: host ? CS.hostMatches(s.disabledSites, host) : false
  };
}

// e2e testlerinin servis çalışanı içinden çağırabilmesi için
self.CookieShieldSW = { buildState };

async function bumpBadge(tabId, n) {
  if (!tabId) return;
  const cur = (tabCounters.get(tabId) || 0) + n;
  tabCounters.set(tabId, cur);
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#1f8a4c', tabId });
    await chrome.action.setBadgeText({ text: cur > 0 ? String(cur) : '', tabId });
  } catch (_) { /* yoksay */ }
}

chrome.tabs.onRemoved.addListener((tabId) => tabCounters.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && info.url) {
    tabCounters.delete(tabId);
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  (async () => {
    if (!msg || typeof msg.type !== 'string') return respond({ ok: false });

    switch (msg.type) {
      case 'cs:action': {
        const s = await getSettings();
        const stats = Object.assign({}, s.stats);
        stats.rejected = (stats.rejected || 0) + (msg.rejected || 0);
        stats.hidden = (stats.hidden || 0) + (msg.hidden || 0);
        await setSettings({ stats });
        if (sender.tab && sender.tab.id) {
          await bumpBadge(sender.tab.id, (msg.rejected || 0) + (msg.hidden || 0));
        }
        return respond({ ok: true });
      }
      case 'cs:get-state': {
        return respond(await buildState());
      }
      case 'cs:set': {
        const s = await setSettings(msg.patch || {});
        await applyAll();
        return respond({ ok: true, settings: s });
      }
      case 'cs:toggle-list': {
        // msg.list: 'allowlist' | 'disabledSites'
        const s = await getSettings();
        const key = msg.list === 'disabledSites' ? 'disabledSites' : 'allowlist';
        const host = CS.normHost(msg.host);
        if (!host) return respond({ ok: false });
        await setSettings({ [key]: CS.toggleHostList(s[key], host, !!msg.on) });
        await applyAll();
        return respond({ ok: true, settings: await getSettings(true) });
      }
      case 'cs:clear-cookies': {
        const n = await clearCookies(msg.host || null);
        return respond({ ok: true, removed: n });
      }
      case 'cs:sweep-now': {
        await sweepClosedSites();
        return respond({ ok: true });
      }
      default:
        return respond({ ok: false, error: 'bilinmeyen mesaj' });
    }
  })();
  return true; // asenkron yanıt
});

// Servis çalışanı her uyandığında kuralları doğrula
applyAll().catch((e) => console.warn('[CookieShield] applyAll hatası', e));
