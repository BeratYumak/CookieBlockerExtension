/**
 * Cookie Shield - core.js
 * Saf (DOM'a bağımlı ama chrome.* API'sine bağımsız) yardımcılar.
 * Hem içerik betiği olarak hem de node:vm içinde test edilebilir olsun diye
 * her şeyi globalThis.CookieShield üzerine asıyoruz.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- ayarlar
  const DEFAULTS = {
    enabled: true,
    // 'blockAll' | 'thirdParty' | 'sessionOnly' | 'off'
    cookieMode: 'blockAll',
    autoReject: true, // CMP pop-up'larını otomatik reddet
    hideAsLastResort: true, // reddet butonu yoksa banner'ı gizle
    bypassCookieWalls: true, // scroll kilidi / blur / overlay temizliği
    hardBlockDocumentCookie: true, // document.cookie yazımını da engelle
    clearCookiesOnStartup: false,
    allowlist: [], // bu hostlarda çerez engelleme uygulanmaz
    disabledSites: [], // bu hostlarda eklenti tamamen pasif
    stats: { rejected: 0, hidden: 0, cookiesRemoved: 0 },
    debug: false
  };

  // ------------------------------------------------------------- normalizasyon
  const DIACRITICS = {
    ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u',
    á: 'a', à: 'a', â: 'a', ä: 'a', å: 'a', ã: 'a',
    é: 'e', è: 'e', ê: 'e', ë: 'e',
    í: 'i', ì: 'i', î: 'i', ï: 'i',
    ó: 'o', ò: 'o', ô: 'o', õ: 'o',
    ú: 'u', ù: 'u', û: 'u',
    ñ: 'n', ý: 'y', ÿ: 'y', ß: 'ss', œ: 'oe', æ: 'ae'
  };

  function norm(str) {
    if (!str) return '';
    // Türkçe 'İ'.toLowerCase() = 'i' + U+0307 birleşik noktası üretir;
    // NFD ayrıştırıp birleşik işaretleri atmak tüm dilleri tek seferde çözer.
    let s = String(str).toLowerCase();
    try {
      s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (_) { /* normalize yoksa aşağıdaki eşleme yeter */ }
    s = s.replace(/[çğıİöşüáàâäåãéèêëíìîïóòôõúùûñýÿßœæ]/g, (c) => DIACRITICS[c] || c);
    return s.replace(/\s+/g, ' ').trim();
  }

  // ------------------------------------------------------------------ desenler
  // Metnin gerçekten çerez/onay bağlamında olup olmadığı
  const CONSENT_TEXT =
    /(cookie|cookies|cerez|kurabiye|consent|gdpr|ccpa|kvkk|tcf|privacy|gizlilik|veri politikas|tracker|tracking|izleme|datenschutz|einwilligung|zustimmung|consentement|consentimiento|consenso|privacidad|privacidade|cookiebeleid|toestemming|zgoda|souhlas|politique de confidentialite)/;

  // "Reddet" grubu - kabul kalıplarından ÖNCE denenir
  const REJECT =
    /(reject|decline|refuse|deny|disagree|dismiss all|no,? thanks|no thank you|not now|do not (accept|consent|agree|sell|share)|don'?t accept|without accepting|continue without|carry on without|opt.?out|reddet|kabul etmiyorum|kabul etme(den|m|yin)|izin verme|onaylamiyorum|hayir|vazgec|ablehnen|alles ablehnen|nicht (akzeptieren|einverstanden)|verweigern|refuser|tout refuser|continuer sans|rechazar|rechazar todo|no acepto|rifiuta|rifiuta tutto|non accetto|weigeren|alles weigeren|niet akkoord|recusar|nao aceito|odrucit|odrzuc|nie akceptuje|otkloni|otkazi|otklonit)/;

  // "Sadece gerekli olanlar" da reddetme sayılır
  const NECESSARY_ONLY =
    /((only|just|solely|sadece|yalnizca|nur|seulement|uniquement|solo|solamente|alleen|apenas)[^.!?]{0,24}(necessary|essential|required|mandatory|functional|technical|zorunlu|gerekli|temel|teknik|islevsel|notwendig|erforderlich|technisch|necessaire|essentiel|necesari|esencial|essenzial|tecnic|noodzakelijk|functionele|essenciais)|(zorunlu|gerekli|temel)\s*(cerez|olanlar)|(necessary|essential|required)\s*(cookies)?\s*only|(notwendige|erforderliche)\s*(cookies)?\s*(nur|only)?)/;

  // "Hepsini kabul et" - save/settings'ten önce yakalanmalı
  const ACCEPT_ALL =
    /((accept|allow|agree|enable|kabul|onayla|izin ver|akzeptieren|annehmen|zustimmen|accepter|aceptar|accetta|aceitar|accepteren|toestaan)[^.!?]{0,24}(all|everything|tum|tumu|hepsi|alle|tout|toutes|todo|todas|tutti|tutte|allemaal|todos)|(all|tumunu|tumu|hepsini|alle|tout|todas|tutti|allemaal)[^.!?]{0,24}(accept|allow|agree|kabul|onayla|izin|akzeptieren|annehmen|accepter|aceptar|accetta|accepteren))/;

  const SAVE =
    /(save|confirm|submit|apply|done|finish|kaydet|onayla|uygula|tamamla|gonder|bitir|speichern|bestatigen|ubernehmen|fertig|enregistrer|valider|confirmer|terminer|guardar|confirmar|aplicar|salva|conferma|applica|opslaan|bevestigen|toepassen)/;

  const SETTINGS =
    /(manage|settings|preferences|customi[sz]e|customise|options|choices|purposes|configure|details|more info|learn more|ayarlar|tercihler|ozelles|yonet|secenekler|detaylar|daha fazla|amaclar|einstellungen|verwalten|anpassen|zwecke|details|parametre|parametres|gerer|personnaliser|configurar|preferencias|gestionar|opciones|impostazioni|gestisci|personalizza|instellingen|beheren|aanpassen|voorkeuren)/;

  const ACCEPT =
    /(accept|agree|allow|consent|got it|i understand|understood|okay|\bok\b|continue|kabul|onayla|izin ver|anladim|tamam|devam|akzeptieren|zustimmen|einverstanden|annehmen|verstanden|accepter|j'?accepte|d'?accord|compris|aceptar|acepto|entendido|accetta|accetto|ho capito|accepteren|akkoord|begrepen|aceitar|aceito|entendi)/;

  const CLASS_HINT =
    /(cookie|cerez|consent|gdpr|ccpa|cmp|privacy|gizlilik|onetrust|optanon|cookiebot|didomi|usercentrics|osano|iubenda|klaro|termly|cookieyes|complianz|borlabs|sourcepoint|quantcast|trustarc|axeptio|tarteaucitron|sirdata|banner|notice|disclaimer)/;

  // Bunlar asla banner sayılmaz
  const NEVER_BANNER = new Set(['HTML', 'BODY', 'HEAD', 'MAIN', 'SCRIPT', 'STYLE', 'LINK', 'META']);

  const SCROLL_LOCK_CLASS =
    /(no-?scroll|noscroll|scroll-?lock|scroll-?disabled|overflow-?hidden|modal-?open|cmp-?open|consent-?open|cookie-?open|has-?overlay|body-?fixed|onetrust-?pc-?dark-?filter|didomi-?popup-?open|klaro-?open)/i;

  // ------------------------------------------------------------ DOM yardımcıları
  function win(node) {
    const doc = node && (node.ownerDocument || node);
    return (doc && doc.defaultView) || null;
  }

  function styleOf(el) {
    const w = win(el);
    try {
      return (w && w.getComputedStyle(el)) || null;
    } catch (_) {
      return null;
    }
  }

  function textOf(el, max) {
    if (!el) return '';
    let t = '';
    try {
      t = el.innerText || el.textContent || '';
    } catch (_) {
      t = el.textContent || '';
    }
    if (max && t.length > max) t = t.slice(0, max);
    return t;
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const cs = styleOf(el);
    if (cs) {
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      if (cs.opacity !== '' && parseFloat(cs.opacity) < 0.05) return false;
    }
    if (el.hasAttribute && el.hasAttribute('hidden')) return false;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    return true;
  }

  function rectOf(el) {
    try {
      const r = el.getBoundingClientRect();
      return { w: r.width || 0, h: r.height || 0, top: r.top || 0, left: r.left || 0 };
    } catch (_) {
      return { w: 0, h: 0, top: 0, left: 0 };
    }
  }

  const ACTIONABLE_SELECTOR = [
    'button',
    '[role="button"]',
    'a[href]',
    'a[onclick]',
    'input[type="button"]',
    'input[type="submit"]',
    'input[type="reset"]',
    '[onclick]',
    '[class*="btn" i]',
    '[class*="button" i]',
    '[data-action]',
    '[tabindex]'
  ].join(',');

  function labelOf(el) {
    if (!el) return '';
    const parts = [
      el.getAttribute && el.getAttribute('aria-label'),
      el.getAttribute && el.getAttribute('title'),
      el.getAttribute && el.getAttribute('value'),
      el.getAttribute && el.getAttribute('data-label'),
      el.getAttribute && el.getAttribute('data-testid'),
      el.getAttribute && el.getAttribute('id'),
      textOf(el, 160)
    ];
    return norm(parts.filter(Boolean).join(' '));
  }

  /**
   * Buton etiketini sınıflandır.
   * Sıra kritik: reddet > hepsini kabul > kaydet > ayarlar > kabul
   */
  function classify(label) {
    const s = norm(label);
    if (!s) return null;
    if (REJECT.test(s) || NECESSARY_ONLY.test(s)) return 'reject';
    if (ACCEPT_ALL.test(s)) return 'accept';
    if (SAVE.test(s)) return 'save';
    if (SETTINGS.test(s)) return 'settings';
    if (ACCEPT.test(s)) return 'accept';
    return null;
  }

  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true;
    return false;
  }

  function actionables(root) {
    if (!root || !root.querySelectorAll) return [];
    let list;
    try {
      list = root.querySelectorAll(ACTIONABLE_SELECTOR);
    } catch (_) {
      list = root.querySelectorAll('button,a[href],input,[role="button"]');
    }
    const out = [];
    const seen = new Set();
    for (const el of list) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (isDisabled(el) || !isVisible(el)) continue;
      out.push(el);
    }
    return out;
  }

  /** Banner içinde belirli türde buton bul (en kısa etiketli = en spesifik). */
  function findButton(root, kind) {
    const hits = [];
    for (const el of actionables(root)) {
      const label = labelOf(el);
      if (!label || label.length > 120) continue;
      if (classify(label) === kind) hits.push({ el, label });
    }
    hits.sort((a, b) => a.label.length - b.label.length);
    return hits.length ? hits[0].el : null;
  }

  function buttonKinds(root) {
    const kinds = new Set();
    for (const el of actionables(root)) {
      const k = classify(labelOf(el));
      if (k) kinds.add(k);
    }
    return kinds;
  }

  const BANNER_SELECTOR = [
    '[id*="cookie" i]', '[class*="cookie" i]',
    '[id*="consent" i]', '[class*="consent" i]',
    '[id*="cerez" i]', '[class*="cerez" i]',
    '[id*="gdpr" i]', '[class*="gdpr" i]',
    '[id*="cmp" i]', '[class*="cmp" i]',
    '[id*="privacy" i]', '[class*="privacy" i]',
    '[aria-label*="cookie" i]', '[aria-label*="consent" i]', '[aria-label*="cerez" i]',
    '[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]',
    'dialog', '.modal', '[class*="banner" i]', '[class*="notice" i]', '[class*="overlay" i]',
    '[data-nosnippet]'
  ].join(',');

  function score(el) {
    if (!el || el.nodeType !== 1) return 0;
    if (NEVER_BANNER.has(el.tagName)) return 0;
    if (!isVisible(el)) return 0;

    const text = textOf(el, 4000);
    const nt = norm(text);
    if (!CONSENT_TEXT.test(nt)) return 0;

    let s = 1;
    const cs = styleOf(el);
    if (cs) {
      if (cs.position === 'fixed') s += 3;
      else if (cs.position === 'sticky') s += 2;
      else if (cs.position === 'absolute') s += 1;
      const z = parseInt(cs.zIndex, 10);
      if (!isNaN(z)) {
        if (z >= 1000) s += 3;
        else if (z >= 100) s += 2;
        else if (z >= 10) s += 1;
      }
    }
    if (el.tagName === 'DIALOG') s += 3;
    const role = el.getAttribute('role');
    if (role === 'dialog' || role === 'alertdialog') s += 2;
    if (el.getAttribute('aria-modal') === 'true') s += 2;

    const idcls = norm(
      (el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '')
    );
    if (CLASS_HINT.test(idcls)) s += 3;

    const kinds = buttonKinds(el);
    if (kinds.has('reject')) s += 4;
    if (kinds.has('accept')) s += 3;
    if (kinds.has('settings')) s += 1;
    if (kinds.size === 0) s -= 3;

    // Sayfanın kendi içeriğini banner sanmayı engelleyen cezalar
    try {
      if (el.querySelector('main, [role="main"], article')) s -= 7;
      const links = el.querySelectorAll('a[href]').length;
      if (links > 40) s -= 5;
      else if (links > 20) s -= 2;
      if (el.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="hidden"])').length > 3) s -= 3;
    } catch (_) { /* yoksay */ }

    if (nt.length > 4000) s -= 3;
    else if (nt.length > 2000) s -= 1;

    return s;
  }

  /** En dar ama hâlâ tüm onay butonlarını içeren düğüme in. */
  function narrow(el) {
    let cur = el;
    for (let depth = 0; depth < 6; depth++) {
      const kids = Array.from(cur.children || []).filter(isVisible);
      const best = kids.filter((k) => score(k) >= score(cur));
      if (best.length === 1) cur = best[0];
      else break;
    }
    return cur;
  }

  function findBanner(root) {
    const doc = root && root.querySelectorAll ? root : null;
    if (!doc) return null;
    let nodes;
    try {
      nodes = doc.querySelectorAll(BANNER_SELECTOR);
    } catch (_) {
      nodes = doc.querySelectorAll('div,section,aside,dialog');
    }
    let best = null;
    let bestScore = 0;
    for (const el of nodes) {
      const s = score(el);
      if (s > bestScore) {
        bestScore = s;
        best = el;
      }
    }
    if (!best || bestScore < 6) return null;
    return { el: narrow(best), score: bestScore };
  }

  function findAllBanners(root, limit) {
    const out = [];
    let nodes;
    try {
      nodes = root.querySelectorAll(BANNER_SELECTOR);
    } catch (_) {
      return out;
    }
    for (const el of nodes) {
      const s = score(el);
      if (s >= 6) out.push({ el, score: s });
    }
    out.sort((a, b) => b.score - a.score);
    // iç içe olanları at
    const kept = [];
    for (const cand of out) {
      if (kept.some((k) => k.el.contains(cand.el) || cand.el.contains(k.el))) continue;
      kept.push(cand);
      if (limit && kept.length >= limit) break;
    }
    return kept.map((k) => ({ el: narrow(k.el), score: k.score }));
  }

  // --------------------------------------------------------------- eylemler
  function realClick(el) {
    if (!el) return false;
    const w = win(el);
    try {
      if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    } catch (_) { /* yoksay */ }
    try {
      const opts = { bubbles: true, cancelable: true, composed: true, view: w || undefined };
      if (w && w.PointerEvent) {
        el.dispatchEvent(new w.PointerEvent('pointerdown', opts));
        el.dispatchEvent(new w.PointerEvent('pointerup', opts));
      }
      if (w && w.MouseEvent) {
        el.dispatchEvent(new w.MouseEvent('mousedown', opts));
        el.dispatchEvent(new w.MouseEvent('mouseup', opts));
        el.dispatchEvent(new w.MouseEvent('click', opts));
      } else if (el.click) {
        el.click();
      }
      if (el.click && !(w && w.MouseEvent)) el.click();
      return true;
    } catch (_) {
      try {
        el.click();
        return true;
      } catch (_e) {
        return false;
      }
    }
  }

  /** Tercih panelindeki opsiyonel onay kutularını kapat. */
  function uncheckAll(root) {
    let changed = 0;
    let boxes = [];
    try {
      boxes = Array.from(root.querySelectorAll('input[type="checkbox"], [role="switch"], [role="checkbox"]'));
    } catch (_) {
      return 0;
    }
    for (const box of boxes) {
      if (isDisabled(box)) continue;
      const ctx = norm(
        (box.id || '') + ' ' + (box.name || '') + ' ' +
        (box.getAttribute('aria-label') || '') + ' ' +
        textOf(box.parentElement, 200)
      );
      // zorunlu/temel grupları zaten kapatılamaz, dokunma
      if (/(strictly|necessary|essential|required|zorunlu|gerekli|notwendig|erforderlich|necessaire|necesari|essenzial|noodzakelijk)/.test(ctx)) continue;
      const isOn =
        box.checked === true ||
        box.getAttribute('aria-checked') === 'true' ||
        box.getAttribute('data-checked') === 'true';
      if (!isOn) continue;
      if ('checked' in box) box.checked = false;
      try {
        const w = win(box);
        box.dispatchEvent(new w.Event('input', { bubbles: true }));
        box.dispatchEvent(new w.Event('change', { bubbles: true }));
      } catch (_) { /* yoksay */ }
      if (box.getAttribute('aria-checked') === 'true') realClick(box);
      changed++;
    }
    return changed;
  }

  function hideElement(el) {
    if (!el || !el.style) return false;
    if (el.getAttribute('data-cookie-shield') === 'hidden') return false;
    el.setAttribute('data-cookie-shield', 'hidden');
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    return true;
  }

  /**
   * Bir öğe "perde" (veil/backdrop) mi?
   * Boyut ölçmek yeterli değil: ata öğedeki filter/transform sabit konumlu
   * çocuklar için yeni kapsayıcı blok oluşturur ve dikdörtgen küçük ölçülür.
   * Bu yüzden inset:0 imzasına ve metinsizliğe de bakıyoruz.
   */
  function looksLikeVeil(el, doc) {
    const cs = styleOf(el);
    if (!cs) return false;
    if (cs.position !== 'fixed' && cs.position !== 'absolute') return false;
    if (!isVisible(el)) return false;
    if (norm(textOf(el, 200)).length > 40) return false; // içerik varsa dokunma
    const insetFull =
      cs.top === '0px' && cs.left === '0px' && cs.right === '0px' && cs.bottom === '0px';
    const w = doc && doc.defaultView;
    const vw = (w && w.innerWidth) || 0;
    const vh = (w && w.innerHeight) || 0;
    const r = rectOf(el);
    const covers = vw && vh ? r.w >= vw * 0.6 && r.h >= vh * 0.6 : false;
    return insetFull || covers;
  }

  /** Banner'ı saran, viewport'u kaplayan boş overlay'leri de gizle. */
  function hideBackdrops(el, doc) {
    let hidden = 0;
    let cur = el && el.parentElement;
    for (let i = 0; cur && i < 4; i++) {
      if (NEVER_BANNER.has(cur.tagName)) break;
      const idcls = norm((cur.id || '') + ' ' + (typeof cur.className === 'string' ? cur.className : ''));
      const named = /(overlay|backdrop|modal|dark-?filter|scrim|mask|veil|popup|dialog|cookie|consent|cmp|gdpr)/.test(idcls);
      const cs = styleOf(cur);
      const fixed = cs && (cs.position === 'fixed' || cs.position === 'absolute');
      // Sarmalayıcı: ya perde imzası taşıyor ya da adı overlay/cookie içeriyor
      if ((fixed && named) || looksLikeVeil(cur, doc)) {
        if (hideElement(cur)) hidden++;
        cur = cur.parentElement;
        continue;
      }
      break;
    }
    // banner ile kardeş olan bağımsız perdeler
    try {
      const sel =
        '[class*="backdrop" i],[class*="overlay" i],[class*="dark-filter" i],[class*="scrim" i],[class*="modal-bg" i],[class*="veil" i],[id*="backdrop" i],[id*="overlay" i]';
      for (const bd of doc.querySelectorAll(sel)) {
        if (bd === el || bd.contains(el)) continue;
        if (!looksLikeVeil(bd, doc)) continue;
        if (hideElement(bd)) hidden++;
      }
    } catch (_) { /* yoksay */ }
    return hidden;
  }

  /**
   * Çerez duvarı / kaydırma kilidi çözümü.
   * Sitenin işlevini bozmamak için sadece kilit belirtilerini geri alır.
   */
  function unlockPage(doc) {
    if (!doc) return 0;
    let fixes = 0;
    const targets = [doc.documentElement, doc.body].filter(Boolean);
    for (const t of targets) {
      const cs = styleOf(t);
      if (cs) {
        if (/hidden|clip/.test(cs.overflow) || /hidden|clip/.test(cs.overflowY)) {
          t.style.setProperty('overflow', 'auto', 'important');
          t.style.setProperty('overflow-y', 'auto', 'important');
          fixes++;
        }
        if (cs.position === 'fixed') {
          t.style.setProperty('position', 'static', 'important');
          t.style.setProperty('top', 'auto', 'important');
          fixes++;
        }
        if (cs.height === '100%' && cs.position === 'fixed') {
          t.style.setProperty('height', 'auto', 'important');
          fixes++;
        }
        if (cs.filter && cs.filter !== 'none') {
          t.style.setProperty('filter', 'none', 'important');
          fixes++;
        }
        if (cs.pointerEvents === 'none') {
          t.style.setProperty('pointer-events', 'auto', 'important');
          fixes++;
        }
        if (cs.userSelect === 'none') {
          t.style.setProperty('user-select', 'auto', 'important');
          fixes++;
        }
      }
      if (t.classList && t.classList.length) {
        for (const cls of Array.from(t.classList)) {
          if (SCROLL_LOCK_CLASS.test(cls)) {
            t.classList.remove(cls);
            fixes++;
          }
        }
      }
    }
    // içeriğe uygulanmış blur/opaklık filtreleri
    try {
      const kids = doc.body ? Array.from(doc.body.children) : [];
      for (const k of kids) {
        if (k.getAttribute && k.getAttribute('data-cookie-shield') === 'hidden') continue;
        const cs = styleOf(k);
        if (cs && cs.filter && /blur|grayscale|opacity/.test(cs.filter)) {
          k.style.setProperty('filter', 'none', 'important');
          fixes++;
        }
      }
    } catch (_) { /* yoksay */ }
    return fixes;
  }

  function normHost(host) {
    return String(host || '')
      .toLowerCase()
      .trim()
      .replace(/^\.+/, '')
      .replace(/\.+$/, '')
      .replace(/^www\./, '');
  }

  function hostMatches(list, host) {
    if (!Array.isArray(list)) return false;
    const h = normHost(host);
    if (!h) return false;
    return list.some((raw) => {
      const p = normHost(raw);
      if (!p) return false;
      return h === p || h.endsWith('.' + p);
    });
  }

  // ------------------------------------------------------------- site kapsamı
  // "Bu sitede izin ver" gibi eylemler tek bir alt alan adına değil, sitenin
  // tamamına uygulanmalı: gist.github.com'da izin verildiğinde github.com'daki
  // oturum çerezi de korunmalı. Bunun için kayıtlanabilir alan adını (eTLD+1)
  // buluruz. Tam bir Public Suffix List taşımak yerine iki katmanlı sezgi:
  // 2 harfli ülke TLD'leri altındaki bilinen ikinci seviye etiketler + yaygın
  // barındırma sonekleri.
  const SLD_LABELS = new Set([
    'com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'biz', 'info', 'name', 'pro',
    'co', 'ac', 'or', 'ne', 'go', 'lg', 're', 'pe', 'gen', 'web', 'sch', 'k12',
    'firm', 'res', 'govt', 'bel', 'av', 'tsk', 'pol', 'tv', 'nom', 'in', 'id',
    'me', 'ltd', 'plc', 'asn', 'org', 'gob', 'gouv', 'priv'
  ]);

  // Alt alan adları farklı sahiplere ait olan sonekler: bunları site sınırı say.
  const PUBLIC_HOSTING_SUFFIXES = new Set([
    'github.io', 'gitlab.io', 'blogspot.com', 'wordpress.com', 'pages.dev',
    'workers.dev', 'vercel.app', 'netlify.app', 'herokuapp.com', 'firebaseapp.com',
    'web.app', 'appspot.com', 'glitch.me', 'surge.sh', 'onrender.com', 'fly.dev',
    'azurewebsites.net', 'cloudfront.net', 's3.amazonaws.com', 'amazonaws.com',
    'sharepoint.com', 'myshopify.com', 'notion.site', 'replit.dev', 'ngrok.io',
    'ngrok-free.app', 'trycloudflare.com', 'localhost'
  ]);

  /** ornek: gist.github.com -> github.com, a.b.sirket.com.tr -> sirket.com.tr */
  function registrableDomain(host) {
    const h = normHost(host);
    if (!h) return '';
    // IPv4 / IPv6 / tek etiketli host (localhost gibi): olduğu gibi kalsın
    if (h.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return h;
    const parts = h.split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');

    const take = (n) => parts.slice(-n).join('.');
    const tld = parts[parts.length - 1];
    const sld = parts[parts.length - 2];

    if (parts.length >= 4 && PUBLIC_HOSTING_SUFFIXES.has(take(3))) return take(4);
    if (PUBLIC_HOSTING_SUFFIXES.has(take(2))) return take(3);
    if (tld.length === 2 && SLD_LABELS.has(sld)) return take(3);
    return take(2);
  }

  /**
   * İzin/kapatma listelerinde ekleme-çıkarma. Çıkarırken verilen kapsamın
   * altındaki daha dar kayıtları da temizler; yoksa eski sürümden kalan
   * "gist.github.com" gibi bir kayıt yüzünden düğme kapanmıyor gibi görünür.
   */
  function toggleHostList(list, host, on) {
    const h = normHost(host);
    const current = (Array.isArray(list) ? list : []).map(normHost).filter(Boolean);
    if (!h) return Array.from(new Set(current));
    if (on) return Array.from(new Set(current.concat([h])));
    return current.filter((p) => p !== h && !p.endsWith('.' + h));
  }

  globalThis.CookieShield = {
    DEFAULTS,
    norm,
    normHost,
    hostMatches,
    registrableDomain,
    toggleHostList,
    classify,
    labelOf,
    isVisible,
    actionables,
    findButton,
    buttonKinds,
    score,
    findBanner,
    findAllBanners,
    realClick,
    uncheckAll,
    hideElement,
    hideBackdrops,
    looksLikeVeil,
    unlockPage,
    textOf,
    patterns: { CONSENT_TEXT, REJECT, NECESSARY_ONLY, ACCEPT_ALL, SAVE, SETTINGS, ACCEPT, SCROLL_LOCK_CLASS }
  };
})();
