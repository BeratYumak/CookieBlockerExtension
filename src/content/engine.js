/**
 * Cookie Shield - engine.js (izole dünya / isolated world)
 * Akış:
 *  1) Ayarları oku, site pasifse hiç dokunma.
 *  2) MAIN dünyadaki ajana konfigürasyonu gönder (CMP JS API'leriyle reddet).
 *  3) Bilinen CMP adaptörlerini dene -> gerçek "Reddet" tıklaması.
 *  4) Adaptör yoksa sezgisel tarama -> reddet / tercih paneli / son çare gizleme.
 *  5) Çerez duvarı kilitlerini (scroll, blur, overlay) çöz.
 */
(function () {
  'use strict';

  const CS = globalThis.CookieShield;
  const AD = globalThis.CookieShieldAdapters;
  if (!CS || !AD) return;

  const IS_TOP = window === window.top;
  const HOST = location.hostname;

  const state = {
    settings: null,
    active: false,
    handled: new Map(), // adapter adı -> aşama
    genericTried: new WeakSet(),
    rejected: 0,
    hidden: 0,
    lastCmp: null,
    passes: 0,
    stopped: false
  };

  const log = (...args) => {
    if (state.settings && state.settings.debug) console.log('[CookieShield]', ...args);
  };

  // ------------------------------------------------------------ host eşleşmesi
  function hostMatches(list, host) {
    if (!Array.isArray(list)) return false;
    const h = String(host || '').toLowerCase().replace(/^www\./, '');
    return list.some((raw) => {
      const p = String(raw || '').toLowerCase().trim().replace(/^www\./, '');
      if (!p) return false;
      return h === p || h.endsWith('.' + p);
    });
  }

  // --------------------------------------------------------- MAIN dünya köprüsü
  function toPage(msg) {
    try {
      window.postMessage(Object.assign({ __cookieShield: 1, dir: 'to-page' }, msg), '*');
    } catch (_) { /* yoksay */ }
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__cookieShield !== 1 || d.dir !== 'to-content') return;
    if (d.type === 'cmp-api-result' && d.acted) {
      state.lastCmp = d.cmp || 'js-api';
      state.rejected++;
      report({ rejected: 1, cmp: state.lastCmp, via: 'js-api' });
      log('CMP JS API ile reddedildi:', d.cmp);
      setTimeout(() => pass('after-api'), 500);
    }
  });

  // ------------------------------------------------------------------ raporlama
  let reportQueue = null;
  function report(delta) {
    reportQueue = reportQueue || { rejected: 0, hidden: 0, cmp: null, via: null };
    reportQueue.rejected += delta.rejected || 0;
    reportQueue.hidden += delta.hidden || 0;
    if (delta.cmp) reportQueue.cmp = delta.cmp;
    if (delta.via) reportQueue.via = delta.via;
    if (reportQueue.timer) return;
    reportQueue.timer = setTimeout(() => {
      const payload = reportQueue;
      reportQueue = null;
      try {
        chrome.runtime.sendMessage({
          type: 'cs:action',
          host: HOST,
          rejected: payload.rejected,
          hidden: payload.hidden,
          cmp: payload.cmp,
          via: payload.via
        });
      } catch (_) { /* SW uykuda olabilir */ }
    }, 400);
  }

  // ------------------------------------------------------------- ana tarama turu
  function pass(reason) {
    if (state.stopped || !state.active || !document.body) return;
    state.passes++;
    const roots = AD.collectRoots(document);

    // 1) Bilinen CMP'ler
    const found = AD.detectAdapters(roots);
    for (const adapter of found) {
      const stage = state.handled.get(adapter.name);
      if (stage === 'done') continue;

      if (!stage) {
        const res = AD.tryAdapter(adapter, roots);
        if (!res) continue;
        log('adaptör', adapter.name, res.action, '(', reason, ')');
        if (res.step === 'reject') {
          state.handled.set(adapter.name, 'clicked');
          state.rejected++;
          state.lastCmp = adapter.name;
          report({ rejected: 1, cmp: adapter.name, via: 'dom-click' });
          setTimeout(() => verifyGone(adapter), 1200);
        } else if (res.step === 'settings') {
          state.handled.set(adapter.name, 'settings');
          setTimeout(() => {
            const r2 = AD.finishAdapter(adapter, AD.collectRoots(document));
            if (r2) {
              state.handled.set(adapter.name, 'clicked');
              state.rejected++;
              state.lastCmp = adapter.name;
              report({ rejected: 1, cmp: adapter.name, via: 'preferences' });
            }
            setTimeout(() => verifyGone(adapter), 1200);
          }, 700);
        } else {
          // sadece tespit: sezgisel yola bırak
          state.handled.set(adapter.name, 'fallback');
        }
      }
    }

    // 2) Sezgisel tarama (adaptör başarısız / bilinmeyen CMP)
    const pending = found.filter((a) => {
      const st = state.handled.get(a.name);
      return !st || st === 'fallback';
    });
    if (found.length === 0 || pending.length > 0) genericPass(reason);

    // 3) Kilit çözümü
    if (state.settings.bypassCookieWalls) maybeUnlock();
  }

  function verifyGone(adapter) {
    const roots = AD.collectRoots(document);
    const still = AD.anyPresent(roots, adapter.banner);
    if (!still) {
      state.handled.set(adapter.name, 'done');
      if (state.settings.bypassCookieWalls) CS.unlockPage(document);
      return;
    }
    // Reddet tıklandı ama katman kaldı -> artıkları temizle
    if (state.settings.hideAsLastResort) {
      const n = AD.cleanupAdapter(adapter, roots);
      if (n) {
        state.hidden += n;
        report({ hidden: n, cmp: adapter.name, via: 'cleanup' });
        log('artık katman temizlendi:', adapter.name, n);
      }
    }
    state.handled.set(adapter.name, 'done');
    if (state.settings.bypassCookieWalls) CS.unlockPage(document);
  }

  function genericPass(reason) {
    const banners = CS.findAllBanners(document, 3);
    for (const { el, score } of banners) {
      if (!el || state.genericTried.has(el)) continue;

      const reject = CS.findButton(el, 'reject');
      if (reject) {
        state.genericTried.add(el);
        CS.realClick(reject);
        state.rejected++;
        report({ rejected: 1, via: 'heuristic-reject' });
        log('sezgisel reddet tıklandı (skor', score, ',', reason, ')', CS.labelOf(reject));
        setTimeout(() => afterGeneric(el), 1300);
        continue;
      }

      const settings = CS.findButton(el, 'settings');
      if (settings) {
        state.genericTried.add(el);
        log('sezgisel tercih paneli açılıyor');
        CS.realClick(settings);
        setTimeout(() => {
          const panel = CS.findBanner(document);
          const target = (panel && panel.el) || el;
          const unchecked = CS.uncheckAll(target);
          const rejectNow = CS.findButton(target, 'reject');
          const save = rejectNow || CS.findButton(target, 'save');
          if (save) {
            CS.realClick(save);
            state.rejected++;
            report({ rejected: 1, via: 'heuristic-preferences' });
            log('tercihler reddedilerek kaydedildi, kapatılan kutu:', unchecked);
          }
          setTimeout(() => afterGeneric(target), 1300);
        }, 800);
        continue;
      }

      // Reddetmeye izin vermeyen banner (sadece "Kabul" var)
      state.genericTried.add(el);
      log('reddet seçeneği yok -> son çare');
      afterGeneric(el, true);
    }
  }

  function afterGeneric(el, immediate) {
    if (!el) return;
    const stillVisible = el.isConnected && CS.isVisible(el);
    if (stillVisible && state.settings.hideAsLastResort) {
      let n = 0;
      if (CS.hideElement(el)) n++;
      n += CS.hideBackdrops(el, document);
      if (n) {
        state.hidden += n;
        report({ hidden: n, via: immediate ? 'no-reject-option' : 'leftover' });
        log('banner gizlendi, katman sayısı:', n);
      }
    }
    if (state.settings.bypassCookieWalls) CS.unlockPage(document);
  }

  /** Banner bulunamasa bile sayfa kilitliyse ve çerez bağlamı varsa aç. */
  function maybeUnlock() {
    const de = document.documentElement;
    const body = document.body;
    if (!de || !body) return;
    const cs1 = getComputedStyle(de);
    const cs2 = getComputedStyle(body);
    const locked =
      /hidden|clip/.test(cs1.overflow + cs1.overflowY) ||
      /hidden|clip/.test(cs2.overflow + cs2.overflowY) ||
      cs2.position === 'fixed' ||
      (cs2.filter && cs2.filter !== 'none');
    if (!locked) return;
    // Yalnızca gerçekten onay/çerez bağlamı varsa müdahale et
    const ctx = CS.norm(CS.textOf(body, 6000));
    const cls = CS.norm((de.className || '') + ' ' + (body.className || ''));
    if (!CS.patterns.CONSENT_TEXT.test(ctx) && !CS.patterns.SCROLL_LOCK_CLASS.test(cls)) return;
    const fixes = CS.unlockPage(document);
    if (fixes) log('sayfa kilidi açıldı, düzeltme:', fixes);
  }

  // ------------------------------------------------------------------ zamanlama
  const SCHEDULE = [0, 120, 350, 700, 1200, 2000, 3000, 4500, 6500, 9000, 12000, 16000, 21000, 27000];
  let observer = null;
  let debounceTimer = null;

  function scheduleAll() {
    for (const t of SCHEDULE) setTimeout(() => pass('schedule:' + t), t);
    // Geç yüklenen CMP'ler için DOM izleme
    observer = new MutationObserver(() => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        pass('mutation');
      }, 250);
    });
    const startObserving = () => {
      if (!document.documentElement) return;
      observer.observe(document.documentElement, { childList: true, subtree: true });
    };
    startObserving();
    document.addEventListener('DOMContentLoaded', () => {
      startObserving();
      pass('domcontentloaded');
    });
    window.addEventListener('load', () => pass('load'));
    // 90 saniye sonra izlemeyi kapat (performans)
    setTimeout(() => {
      if (observer) observer.disconnect();
      log('izleme durduruldu, tur sayısı:', state.passes);
    }, 90000);
  }

  // ---------------------------------------------------------------------- başlat
  function start(settings) {
    state.settings = Object.assign({}, CS.DEFAULTS, settings || {});
    if (!state.settings.enabled) return;
    if (hostMatches(state.settings.disabledSites, HOST)) {
      log('bu sitede pasif:', HOST);
      return;
    }

    // MAIN dünya ajanına konfigürasyon
    const allowlisted = hostMatches(state.settings.allowlist, HOST);
    toPage({
      type: 'config',
      blockCookies:
        state.settings.hardBlockDocumentCookie &&
        state.settings.cookieMode === 'blockAll' &&
        !allowlisted,
      autoReject: state.settings.autoReject,
      gpc: true,
      debug: state.settings.debug
    });

    if (!state.settings.autoReject) return;
    state.active = true;
    scheduleAll();
    // CMP JS API'lerini de birkaç kez dene (geç yüklenirler)
    for (const t of [0, 600, 1500, 3000, 6000, 10000]) {
      setTimeout(() => toPage({ type: 'try-api-optout' }), t);
    }
  }

  try {
    chrome.storage.local.get(null, (stored) => {
      start(stored || {});
    });
  } catch (_) {
    start({});
  }

  // Ayar değişince davranışı güncelle
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !state.settings) return;
      for (const [k, v] of Object.entries(changes)) state.settings[k] = v.newValue;
      if (hostMatches(state.settings.disabledSites, HOST)) state.stopped = true;
    });
  } catch (_) { /* yoksay */ }

  // Popup'tan gelen "şimdi tara" isteği
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
      if (!msg || msg.type !== 'cs:scan-now') return;
      state.stopped = false;
      state.active = true;
      state.handled.clear();
      pass('manual');
      respond({
        ok: true,
        top: IS_TOP,
        rejected: state.rejected,
        hidden: state.hidden,
        cmp: state.lastCmp
      });
      return true;
    });
  } catch (_) { /* yoksay */ }
})();
