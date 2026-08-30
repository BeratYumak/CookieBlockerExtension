/**
 * Cookie Shield - page-agent.js (MAIN dünya / sayfa bağlamı)
 * Görevleri:
 *  1) CMP'lerin kendi JS API'lerini çağırarak rızayı "RED" olarak kaydettirmek.
 *  2) Google Consent Mode / dataLayer üzerinden depolamayı reddetmek.
 *  3) document.cookie yazımını engellemek. Varsayılan: "sanal kavanoz" -
 *     çerez sayfa içinde çalışır gibi görünür ama diske yazılmaz, sunucuya
 *     gitmez, sekme kapanınca yok olur. Böylece sitenin JS'i patlamaz.
 *  4) navigator.globalPrivacyControl = true (yasal reddetme sinyali).
 */
(function () {
  'use strict';

  const cfg = { blockCookies: false, virtualJar: true, gpc: true, debug: false, ready: false };

  const log = (...a) => {
    if (cfg.debug) console.log('[CookieShield/page]', ...a);
  };

  // --------------------------------------------------------- GPC / DNT sinyali
  function installPrivacySignals() {
    try {
      if (navigator.globalPrivacyControl !== true) {
        Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', {
          get: () => true,
          configurable: true
        });
      }
    } catch (_) { /* yoksay */ }
    try {
      Object.defineProperty(Navigator.prototype, 'doNotTrack', {
        get: () => '1',
        configurable: true
      });
    } catch (_) { /* yoksay */ }
  }

  // ------------------------------------------------------- sanal çerez kavanozu
  const jar = new Map();
  const buffered = []; // config gelmeden önceki yazımlar
  let cookieGuardInstalled = false;
  let nativeDesc = null;
  // 'pending' : ayarlar henüz gelmedi, yazımlar tamponlanır
  // 'block'   : sanal kavanoz aktif
  // 'pass'    : engelleme yok, yerel davranış
  let mode = 'pending';

  function serializeJar() {
    const out = [];
    for (const [k, v] of jar) out.push(k + '=' + v);
    return out.join('; ');
  }

  function nativeGet() {
    try {
      return nativeDesc && nativeDesc.get ? nativeDesc.get.call(document) : '';
    } catch (_) {
      return '';
    }
  }

  function handleWrite(raw) {
    const str = String(raw == null ? '' : raw);
    const firstSep = str.indexOf(';');
    const pair = (firstSep === -1 ? str : str.slice(0, firstSep)).trim();
    const attrs = firstSep === -1 ? '' : str.slice(firstSep + 1).toLowerCase();
    const eq = pair.indexOf('=');
    if (eq <= 0) return;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1);
    if (!name) return;

    // Silme talebi mi?
    let expired = false;
    const maxAge = /max-age\s*=\s*(-?\d+)/.exec(attrs);
    if (maxAge && Number(maxAge[1]) <= 0) expired = true;
    const exp = /expires\s*=\s*([^;]+)/.exec(attrs);
    if (exp) {
      const t = Date.parse(exp[1]);
      if (!isNaN(t) && t <= Date.now()) expired = true;
    }
    if (expired) jar.delete(name);
    else if (cfg.virtualJar) jar.set(name, value);
    log('çerez yazımı hafızada tutuldu:', name, expired ? '(silme)' : '');
  }

  /**
   * Korumayı document_start'ta HEMEN kur. Ayarlar henüz bilinmediği için
   * yazımlar tamponlanır; engelleme kapalıysa config gelince gerçek
   * document.cookie'ye aktarılır. Böylece hiçbir çerez kaybolmaz.
   */
  function installCookieGuard() {
    if (cookieGuardInstalled) return;
    try {
      nativeDesc =
        Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
        Object.getOwnPropertyDescriptor(document, 'cookie');
      if (!nativeDesc || !nativeDesc.get) return;
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        enumerable: true,
        get() {
          if (mode === 'block') return serializeJar();
          if (mode === 'pending') {
            const virt = serializeJar();
            const real = nativeGet();
            return [real, virt].filter(Boolean).join('; ');
          }
          return nativeGet();
        },
        set(v) {
          if (mode === 'pass') {
            try {
              nativeDesc.set.call(document, v);
            } catch (_) { /* yoksay */ }
            return;
          }
          if (mode === 'pending') buffered.push(v);
          handleWrite(v);
        }
      });
      cookieGuardInstalled = true;
      log('document.cookie koruması kuruldu (mod:', mode, ')');
    } catch (e) {
      log('document.cookie koruması kurulamadı', e);
    }
  }

  /** Engelleme kapalıysa tamponlanan yazımları gerçek çerezlere aktar. */
  function releaseBuffered() {
    mode = 'pass';
    for (const raw of buffered.splice(0)) {
      try {
        if (nativeDesc && nativeDesc.set) nativeDesc.set.call(document, raw);
      } catch (_) { /* yoksay */ }
    }
    jar.clear();
    log('çerez engelleme bu sitede kapalı, tamponlanan yazımlar aktarıldı');
  }

  // ------------------------------------------------- CMP JS API ile reddetme
  const call = (fn) => {
    try {
      const r = fn();
      return r !== false;
    } catch (_) {
      return false;
    }
  };

  const API_OPT_OUTS = [
    {
      name: 'onetrust',
      test: () => window.OneTrust && typeof window.OneTrust.RejectAll === 'function',
      run: () => call(() => window.OneTrust.RejectAll())
    },
    {
      name: 'optanon',
      test: () => window.Optanon && typeof window.Optanon.RejectAll === 'function',
      run: () => call(() => window.Optanon.RejectAll())
    },
    {
      name: 'cookiebot',
      test: () =>
        window.Cookiebot &&
        (typeof window.Cookiebot.decline === 'function' ||
          typeof window.Cookiebot.submitCustomConsent === 'function'),
      run: () => {
        if (typeof window.Cookiebot.submitCustomConsent === 'function') {
          return call(() => window.Cookiebot.submitCustomConsent(false, false, false));
        }
        return call(() => window.Cookiebot.decline());
      }
    },
    {
      name: 'cookieconsent',
      test: () => window.CookieConsent && typeof window.CookieConsent.decline === 'function',
      run: () => call(() => window.CookieConsent.decline())
    },
    {
      name: 'didomi',
      test: () => window.Didomi && typeof window.Didomi.setUserDisagreeToAll === 'function',
      run: () => call(() => window.Didomi.setUserDisagreeToAll())
    },
    {
      name: 'usercentrics',
      test: () => window.UC_UI && typeof window.UC_UI.denyAllConsents === 'function',
      run: () => call(() => window.UC_UI.denyAllConsents())
    },
    {
      name: 'osano',
      test: () => window.Osano && window.Osano.cm && typeof window.Osano.cm.denyAll === 'function',
      run: () => call(() => window.Osano.cm.denyAll())
    },
    {
      name: 'klaro',
      test: () => window.klaro && typeof window.klaro.getManager === 'function',
      run: () =>
        call(() => {
          const m = window.klaro.getManager();
          m.changeAll(false);
          if (typeof m.saveAndApplyConsents === 'function') m.saveAndApplyConsents();
        })
    },
    {
      name: 'iubenda',
      test: () => window._iub && window._iub.cs && window._iub.cs.api,
      run: () =>
        call(() => {
          const api = window._iub.cs.api;
          if (typeof api.reject === 'function') return api.reject();
          if (typeof api.rejectAll === 'function') return api.rejectAll();
          return false;
        })
    },
    {
      name: 'complianz',
      test: () => typeof window.cmplz_deny_all === 'function',
      run: () => call(() => window.cmplz_deny_all())
    },
    {
      name: 'tarteaucitron',
      test: () =>
        window.tarteaucitron &&
        window.tarteaucitron.userInterface &&
        typeof window.tarteaucitron.userInterface.respondAll === 'function',
      run: () => call(() => window.tarteaucitron.userInterface.respondAll(false))
    },
    {
      name: 'consentmanager',
      test: () => typeof window.__cmp === 'function',
      run: () => {
        let ok = call(() => window.__cmp('rejectAll'));
        if (!ok) ok = call(() => window.__cmp('setConsent', 0));
        return ok;
      }
    },
    {
      name: 'piwik-pro',
      test: () => window.ppms && window.ppms.cm && typeof window.ppms.cm.api === 'function',
      run: () => call(() => window.ppms.cm.api('rejectAllConsents'))
    },
    {
      name: 'cookieyes',
      test: () => window.cookieyes && typeof window.cookieyes.rejectAll === 'function',
      run: () => call(() => window.cookieyes.rejectAll())
    },
    {
      name: 'tcf-custom',
      test: () => typeof window.__tcfapi === 'function',
      run: () => {
        // Bazı CMP'ler standart dışı "rejectAll" komutunu destekler.
        let ok = false;
        call(() => window.__tcfapi('rejectAll', 2, (_d, success) => { ok = !!success; }));
        return ok;
      }
    }
  ];

  /** Google Consent Mode: reddet ama güvenlik/işlevsellik depolamasını koru. */
  function denyGoogleConsent() {
    const params = {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied',
      personalization_storage: 'denied',
      functionality_storage: 'granted',
      security_storage: 'granted'
    };
    let acted = false;
    if (typeof window.gtag === 'function') {
      acted = call(() => window.gtag('consent', 'update', params)) || acted;
    }
    if (Array.isArray(window.dataLayer)) {
      acted =
        call(() => {
          window.dataLayer.push(['consent', 'update', params]);
          window.dataLayer.push({ event: 'cookie_shield_reject_all' });
        }) || acted;
    }
    return acted;
  }

  function tryApiOptOut() {
    const results = [];
    for (const api of API_OPT_OUTS) {
      let present = false;
      try {
        present = !!api.test();
      } catch (_) {
        present = false;
      }
      if (!present) continue;
      const ok = api.run();
      results.push({ cmp: api.name, ok });
      log('API reddetme:', api.name, ok);
      if (ok) return { acted: true, cmp: api.name, results };
    }
    const g = denyGoogleConsent();
    if (g) return { acted: true, cmp: 'google-consent-mode', results };
    return { acted: false, cmp: null, results };
  }

  // ----------------------------------------------------------------- köprü
  function reply(msg) {
    try {
      window.postMessage(Object.assign({ __cookieShield: 1, dir: 'to-content' }, msg), '*');
    } catch (_) { /* yoksay */ }
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__cookieShield !== 1 || d.dir !== 'to-page') return;

    if (d.type === 'config') {
      cfg.blockCookies = !!d.blockCookies;
      if (typeof d.virtualJar === 'boolean') cfg.virtualJar = d.virtualJar;
      cfg.debug = !!d.debug;
      cfg.ready = true;
      if (d.gpc) installPrivacySignals();
      if (cfg.blockCookies) {
        mode = 'block';
        installCookieGuard();
      } else {
        releaseBuffered();
      }
      return;
    }
    if (d.type === 'try-api-optout') {
      const r = tryApiOptOut();
      reply({ type: 'cmp-api-result', acted: r.acted, cmp: r.cmp });
    }
  });

  // Konfigürasyon gelmeden önce de sinyalleri ve çerez tamponunu kur:
  // sayfa betikleri document_start'tan hemen sonra çerez yazmaya başlayabilir.
  installPrivacySignals();
  installCookieGuard();
})();
