/**
 * Cookie Shield - adapters.js
 * Bilinen CMP (Consent Management Platform) sağlayıcıları için DOM adaptörleri.
 * Amaç: banner'ı gizlemek değil, sitenin KENDİ "reddet" akışını tetiklemek.
 * Böylece site rızayı "red" olarak kaydeder ve işlevleri bozulmaz.
 */
(function () {
  'use strict';

  const CS = globalThis.CookieShield;

  /** Shadow DOM dahil tüm arama köklerini topla. */
  function collectRoots(doc, maxNodes) {
    const roots = [doc];
    const limit = maxNodes || 4000;
    let count = 0;
    const walk = (root) => {
      let nodes;
      try {
        nodes = root.querySelectorAll('*');
      } catch (_) {
        return;
      }
      for (const el of nodes) {
        if (++count > limit) return;
        if (el.shadowRoot) {
          roots.push(el.shadowRoot);
          walk(el.shadowRoot);
        }
      }
    };
    walk(doc);
    return roots;
  }

  function q(root, selector) {
    try {
      return root.querySelector(selector);
    } catch (_) {
      return null;
    }
  }

  function firstVisible(roots, selectors) {
    for (const sel of selectors) {
      for (const root of roots) {
        let els;
        try {
          els = root.querySelectorAll(sel);
        } catch (_) {
          continue;
        }
        for (const el of els) {
          if (CS.isVisible(el)) return el;
        }
      }
    }
    return null;
  }

  function anyPresent(roots, selectors) {
    for (const sel of selectors) {
      for (const root of roots) {
        const el = q(root, sel);
        if (el && CS.isVisible(el)) return el;
      }
    }
    return null;
  }

  /**
   * name      : CMP adı
   * banner    : varlığını gösteren seçiciler
   * reject    : doğrudan "tümünü reddet" butonları
   * settings  : tercih paneli açan butonlar (reddet yoksa)
   * save      : panelde kaydet butonları
   * cleanup   : akış sonrası kalan overlay/backdrop artıkları
   */
  const ADAPTERS = [
    {
      name: 'onetrust',
      banner: ['#onetrust-banner-sdk', '#onetrust-consent-sdk', '.optanon-alert-box-wrapper'],
      reject: [
        '#onetrust-reject-all-handler',
        '.ot-pc-refuse-all-handler',
        '.onetrust-close-btn-handler.banner-close-button',
        'button.ot-pc-refuse-all-handler',
        '.optanon-allow-all + button'
      ],
      settings: ['#onetrust-pc-btn-handler', '.ot-sdk-show-settings', '.optanon-show-settings'],
      save: ['.save-preference-btn-handler', '.ot-pc-refuse-all-handler'],
      cleanup: ['.onetrust-pc-dark-filter', '.ot-fade-in', '#onetrust-consent-sdk']
    },
    {
      name: 'cookiebot',
      banner: ['#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay'],
      reject: [
        '#CybotCookiebotDialogBodyButtonDecline',
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
        '#CybotCookiebotDialogBodyLevelButtonDecline',
        '#CybotCookiebotDialogBodyButtonAcceptSelected'
      ],
      settings: ['#CybotCookiebotDialogBodyLevelButtonCustomize'],
      save: ['#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection'],
      cleanup: ['#CybotCookiebotDialogBodyUnderlay', '#CybotCookiebotDialog']
    },
    {
      name: 'quantcast',
      banner: ['.qc-cmp2-container', '.qc-cmp-cleanslate', '#qc-cmp2-container'],
      reject: [
        'button[mode="secondary"].css-47sehv',
        '.qc-cmp2-summary-buttons > button[mode="secondary"]',
        'button.qc-cmp2-hide-desktop[mode="secondary"]'
      ],
      settings: ['.qc-cmp2-summary-buttons > button[mode="link"]', 'button.qc-cmp2-link-inline'],
      save: ['.qc-cmp2-footer button[mode="primary"]'],
      cleanup: ['.qc-cmp2-container', '.qc-cmp-cleanslate']
    },
    {
      name: 'didomi',
      banner: ['#didomi-notice', '#didomi-popup', '.didomi-popup-container'],
      reject: [
        '#didomi-notice-disagree-button',
        '.didomi-continue-without-agreeing',
        'button[aria-label="Disagree and close"]',
        '.didomi-components-button--decline'
      ],
      settings: ['#didomi-notice-learn-more-button'],
      save: ['.didomi-consent-popup-actions button:last-child'],
      cleanup: ['#didomi-host', '.didomi-popup-backdrop', '.didomi-popup-open']
    },
    {
      name: 'usercentrics',
      banner: ['#usercentrics-root', '#usercentrics-cmp-ui', '.uc-banner-content', '#uc-center-container'],
      reject: [
        'button[data-testid="uc-deny-all-button"]',
        '#uc-btn-deny-banner',
        'button.uc-deny-button',
        'button[data-testid="uc-reject-all-button"]'
      ],
      settings: ['button[data-testid="uc-more-button"]', '#uc-btn-more-info-banner'],
      save: ['button[data-testid="uc-save-button"]', '#uc-btn-save-banner'],
      cleanup: ['#usercentrics-root', '#uc-center-container', '.uc-overlay']
    },
    {
      name: 'osano',
      banner: ['.osano-cm-dialog', '.osano-cm-window'],
      reject: ['.osano-cm-denyAll', '.osano-cm-deny', 'button.osano-cm-button--type_denyAll'],
      settings: ['.osano-cm-manage'],
      save: ['.osano-cm-save'],
      cleanup: ['.osano-cm-dialog', '.osano-cm-window']
    },
    {
      name: 'iubenda',
      banner: ['#iubenda-cs-banner', '.iubenda-cs-container'],
      reject: ['.iubenda-cs-reject-btn', '.iub-cmp-reject-btn', 'button.iubenda-cs-reject-btn'],
      settings: ['.iubenda-cs-customize-btn'],
      save: ['#iubFooterBtnIab', '.iub-btn-save'],
      cleanup: ['#iubenda-cs-banner', '.iubenda-cs-overlay', '#iubenda-iframe']
    },
    {
      name: 'klaro',
      banner: ['.klaro .cookie-notice', '.klaro .cm-modal', '#klaro'],
      reject: ['.cn-decline', '.cm-btn-decline', 'button.cm-btn-danger'],
      settings: ['.cn-learn-more', '.cm-link'],
      save: ['.cm-btn-success'],
      cleanup: ['.klaro .cookie-modal', '.cm-modal-backdrop']
    },
    {
      name: 'termly',
      banner: ['#termly-code-snippet-support', '.termly-styles-root', '.t-consentPrompt'],
      reject: ['.t-declineAllButton', 'button[data-tid="banner-decline-all"]', '.t-declineButton'],
      settings: ['.t-preference-button'],
      save: ['.t-saveButton'],
      cleanup: ['#termly-code-snippet-support', '.t-consentPromptOverlay']
    },
    {
      name: 'cookieyes',
      banner: ['.cky-consent-container', '.cky-modal'],
      reject: ['.cky-btn-reject', 'button[data-cky-tag="reject-button"]'],
      settings: ['.cky-btn-customize'],
      save: ['.cky-btn-preferences'],
      cleanup: ['.cky-overlay', '.cky-modal']
    },
    {
      name: 'complianz',
      banner: ['#cmplz-cookiebanner-container', '.cmplz-cookiebanner'],
      reject: ['.cmplz-deny', 'button.cmplz-deny'],
      settings: ['.cmplz-manage-options'],
      save: ['.cmplz-save-preferences'],
      cleanup: ['#cmplz-cookiebanner-container', '.cmplz-blocked-content-container']
    },
    {
      name: 'borlabs',
      banner: ['#BorlabsCookieBox', '.borlabs-cookie-box', '#brlbs-cmpnt-cb-wrap'],
      reject: [
        '._brlbs-btn-cookie-refuse',
        'a[data-cookie-refuse]',
        'button[data-borlabs-cookie-refuse]',
        '.brlbs-cmpnt-cb-btn-refuse'
      ],
      settings: ['a[data-cookie-individual]', '.brlbs-cmpnt-cb-btn-pref'],
      save: ['a[data-cookie-accept-all="false"]'],
      cleanup: ['#BorlabsCookieBox', '.borlabs-cookie-modal']
    },
    {
      name: 'sourcepoint',
      banner: ['.message-container', '.sp_message_container', '[id^="sp_message_container"]'],
      reject: [
        'button.sp_choice_type_REJECT_ALL',
        'button.sp_choice_type_13',
        'button[title*="Reject" i]',
        '.message-button.reject-all'
      ],
      settings: ['button.sp_choice_type_12'],
      save: ['.sp_choice_type_SAVE_AND_EXIT'],
      cleanup: ['[id^="sp_message_container"]', '.sp_veil']
    },
    {
      name: 'trustarc',
      banner: ['#truste-consent-track', '.truste_box_overlay', '#consent_blackbar'],
      reject: ['#truste-consent-required', '.trustarc-reject-all', '.call'],
      settings: ['#truste-show-consent'],
      save: ['.submit'],
      cleanup: ['#truste-consent-track', '.truste_overlay', '.truste_box_overlay', '#consent_blackbar']
    },
    {
      name: 'axeptio',
      banner: ['#axeptio_overlay', '.axeptio_widget', '#axeptio_main_button'],
      reject: ['button#axeptio_btn_dismiss', '.axeptio_btn_dismiss', 'button[aria-label="Refuser"]'],
      settings: ['#axeptio_btn_configure'],
      save: ['#axeptio_btn_acceptSelected'],
      cleanup: ['#axeptio_overlay', '.axeptio_mount']
    },
    {
      name: 'tarteaucitron',
      banner: ['#tarteaucitronAlertBig', '#tarteaucitronRoot'],
      reject: ['#tarteaucitronAllDenied2', '#tarteaucitronAllDenied'],
      settings: ['#tarteaucitronPersonalize2'],
      save: ['#tarteaucitronSave'],
      cleanup: ['#tarteaucitronAlertBig', '#tarteaucitronBack']
    },
    {
      name: 'fundingchoices',
      banner: ['.fc-consent-root', '.fc-dialog-container'],
      reject: ['.fc-cta-do-not-consent', 'button.fc-secondary-button'],
      settings: ['.fc-cta-manage-options'],
      save: ['.fc-confirm-choices'],
      cleanup: ['.fc-consent-root', '.fc-dialog-overlay']
    },
    {
      name: 'hubspot',
      banner: ['#hs-eu-cookie-confirmation'],
      reject: ['#hs-eu-decline-button'],
      settings: [],
      save: [],
      cleanup: ['#hs-eu-cookie-confirmation']
    },
    {
      name: 'cookie-script',
      banner: ['#cookiescript_injected', '#cookiescript_wrapper'],
      reject: ['#cookiescript_reject', '.cookiescript_reject'],
      settings: ['#cookiescript_manage_wrap'],
      save: ['#cookiescript_save'],
      cleanup: ['#cookiescript_injected', '#cookiescript_injected_wrapper']
    },
    {
      name: 'wp-cookie-law-info',
      banner: ['#cookie-law-info-bar', '.cli-modal'],
      reject: ['#wt-cli-reject-btn', '.cli_action_button[data-cli_action="reject"]', '.cookie_action_close_header_reject'],
      settings: ['#wt-cli-settings-btn'],
      save: ['.cli_setting_save_button'],
      cleanup: ['#cookie-law-info-bar', '.cli-modal-backdrop', '#cookie-law-info-again']
    },
    {
      name: 'wp-cookie-notice',
      banner: ['#cn-notice-text', '#cookie-notice'],
      reject: ['#cn-refuse-cookie'],
      settings: ['#cn-more-info'],
      save: [],
      cleanup: ['#cookie-notice']
    },
    {
      name: 'moove-gdpr',
      banner: ['#moove_gdpr_cookie_info_bar', '.moove-gdpr-info-bar-container'],
      reject: ['.moove-gdpr-infobar-reject-btn', 'button.mgbutton.moove-gdpr-infobar-reject-btn'],
      settings: ['.change-settings-button'],
      save: ['.moove-gdpr-modal-save-settings'],
      cleanup: ['#moove_gdpr_cookie_info_bar', '.moove_gdpr_cookie_modal']
    },
    {
      name: 'piwik-pro',
      banner: ['.ppms_cm_popup_overlay', '#ppms_cm_popup_overlay'],
      reject: ['.ppms_cm_reject-all', '#ppms_cm_reject-all', '.ppms_cm_agree-to-none'],
      settings: ['.ppms_cm_privacy-settings-widget'],
      save: ['.ppms_cm_agree-to-selected'],
      cleanup: ['.ppms_cm_popup_overlay']
    },
    {
      name: 'sirdata',
      banner: ['#sd-cmp', '.sd-cmp-wrapper'],
      reject: ['.sd-cmp-3cJlB', 'button[title*="Refuser" i]', '.sd-cmp-refuse'],
      settings: ['.sd-cmp-2NBFn'],
      save: ['.sd-cmp-1MctN'],
      cleanup: ['#sd-cmp']
    },
    {
      name: 'ketch',
      banner: ['#lanyard_root', '.ketch-banner'],
      reject: ['button[data-testid="banner-button-secondary"]', '.ketch-reject-all'],
      settings: ['button[data-testid="banner-button-primary"]'],
      save: ['button[data-testid="modal-button-submit"]'],
      cleanup: ['#lanyard_root']
    }
  ];

  /** Adaptörü bir kez dene. Dönüş: null | {name, action, step} */
  function tryAdapter(adapter, roots) {
    const banner = anyPresent(roots, adapter.banner);
    if (!banner) return null;

    const rejectBtn = firstVisible(roots, adapter.reject || []);
    if (rejectBtn) {
      CS.realClick(rejectBtn);
      return { name: adapter.name, action: 'reject-click', step: 'reject' };
    }

    const settingsBtn = firstVisible(roots, adapter.settings || []);
    if (settingsBtn) {
      CS.realClick(settingsBtn);
      return { name: adapter.name, action: 'open-settings', step: 'settings' };
    }
    return { name: adapter.name, action: 'detected-only', step: 'none' };
  }

  /** Tercih paneli açıldıktan sonraki ikinci aşama: kutuları kapat + kaydet. */
  function finishAdapter(adapter, roots) {
    let changed = 0;
    for (const root of roots) changed += CS.uncheckAll(root);
    const saveBtn = firstVisible(roots, (adapter.reject || []).concat(adapter.save || []));
    if (saveBtn) {
      CS.realClick(saveBtn);
      return { name: adapter.name, action: 'save-preferences', unchecked: changed };
    }
    return null;
  }

  function cleanupAdapter(adapter, roots) {
    let hidden = 0;
    for (const sel of adapter.cleanup || []) {
      for (const root of roots) {
        let els;
        try {
          els = root.querySelectorAll(sel);
        } catch (_) {
          continue;
        }
        for (const el of els) {
          if (CS.isVisible(el) && CS.hideElement(el)) hidden++;
        }
      }
    }
    return hidden;
  }

  function detectAdapters(roots) {
    const found = [];
    for (const a of ADAPTERS) {
      if (anyPresent(roots, a.banner)) found.push(a);
    }
    return found;
  }

  globalThis.CookieShieldAdapters = {
    ADAPTERS,
    collectRoots,
    firstVisible,
    anyPresent,
    tryAdapter,
    finishAdapter,
    cleanupAdapter,
    detectAdapters,
    byName: (n) => ADAPTERS.find((a) => a.name === n) || null
  };
})();
