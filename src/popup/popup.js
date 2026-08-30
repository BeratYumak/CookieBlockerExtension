'use strict';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

let S = null;
let HOST = null;
let SITE = null;
let TAB_ID = null;
let ACTIVE = false;

function toast(text) {
  $('toast').textContent = text || '';
  if (text) setTimeout(() => ($('toast').textContent = ''), 2500);
}

function render(state) {
  S = state.settings;
  HOST = state.host;
  SITE = state.site;
  TAB_ID = state.tabId;
  ACTIVE = !!state.siteActive;
  const siteScoped = (state.scopeMode || S.scopeMode) === 'sites';

  $('enabled').checked = !!S.enabled;
  $('enabledLabel').textContent = S.enabled ? 'Açık' : 'Kapalı';
  $('host').textContent = HOST || 'tarayıcı sayfası';
  $('tabActions').textContent = String(state.tabActions || 0);
  $('cookieCount').textContent = state.cookieCount == null ? '—' : String(state.cookieCount);

  for (const el of document.querySelectorAll('input[name="mode"]')) {
    el.checked = el.value === S.cookieMode;
  }
  for (const el of document.querySelectorAll('input[name="scope"]')) {
    el.checked = el.value === (state.scopeMode || S.scopeMode);
  }

  const scope = SITE || 'bu site';
  const act = $('activate');
  if (!S.enabled) {
    $('status').textContent = 'Eklenti tamamen kapalı';
    $('status').className = 'status off';
  } else if (ACTIVE) {
    $('status').textContent = siteScoped ? `Koruma açık: ${scope}` : 'Koruma açık (tüm siteler kapsamı)';
    $('status').className = 'status on';
  } else {
    $('status').textContent = 'Koruma bu sitede kapalı';
    $('status').className = 'status off';
  }

  act.hidden = !siteScoped || !SITE;
  act.textContent = ACTIVE ? `Korumayı kapat (${scope})` : `${scope} için korumayı aç`;
  act.classList.toggle('primary', !ACTIVE);
  act.classList.toggle('on', ACTIVE);

  $('scope').textContent = SITE
    ? siteScoped
      ? `Kapsam: ${SITE} ve tüm alt alan adları (adres yolu önemsiz)`
      : `Eylem kapsamı: ${SITE} ve tüm alt alan adları`
    : '';

  // 'all' kapsamına özgü istisna düğmeleri
  const allow = $('allow');
  const dis = $('disable');
  allow.hidden = siteScoped;
  dis.hidden = siteScoped;
  allow.textContent = state.allowlisted
    ? `Çerez izni açık (${scope}) — kaldır`
    : `${scope} için çerezlere izin ver`;
  allow.classList.toggle('on', !!state.allowlisted);
  dis.textContent = state.siteDisabled
    ? `Eklenti kapalı (${scope}) — tekrar aç`
    : `${scope} için eklentiyi kapat`;
  dis.classList.toggle('on', !!state.siteDisabled);

  const st = S.stats || {};
  $('stats').textContent =
    `${st.rejected || 0} reddedildi · ${st.hidden || 0} gizlendi · ${st.cookiesRemoved || 0} çerez silindi`;

  if (siteScoped) {
    $('note').textContent = ACTIVE
      ? 'Site listeden çıkarılınca çerezler yeniden normal çalışır.'
      : 'Çerez uyarısı seni zorluyorsa yukarıdaki düğmeyle bu siteyi aç.';
  } else {
    $('note').textContent =
      S.cookieMode === 'blockAll'
        ? 'Katı mod: giriş yaptığın siteler için "çerezlere izin ver" kullan.'
        : '';
  }

  const noHost = !SITE;
  for (const id of ['allow', 'disable', 'clear', 'scan', 'activate']) $(id).disabled = noHost;
}

async function refresh() {
  const state = await send({ type: 'cs:get-state' });
  if (state && state.ok) render(state);
}

$('enabled').addEventListener('change', async (e) => {
  await send({ type: 'cs:set', patch: { enabled: e.target.checked } });
  await refresh();
  toast(e.target.checked ? 'Koruma açıldı' : 'Koruma kapatıldı');
});

$('activate').addEventListener('click', async () => {
  const on = !ACTIVE;
  const res = await send({ type: 'cs:set-site-active', host: SITE, on, tabId: TAB_ID });
  await refresh();
  if (!res || !res.ok) return toast('Bu sayfada uygulanamadı');
  if (on) {
    toast(
      `${SITE} için koruma açıldı` +
        (res.removed ? ` · ${res.removed} çerez silindi` : '') +
        (res.reloaded ? ' · sayfa yenilendi' : ' · sayfayı yenile')
    );
  } else {
    toast(`${SITE} için koruma kapatıldı` + (res.reloaded ? ' · sayfa yenilendi' : ''));
  }
});

for (const el of document.querySelectorAll('input[name="scope"]')) {
  el.addEventListener('change', async () => {
    await send({ type: 'cs:set', patch: { scopeMode: el.value } });
    await refresh();
    toast(el.value === 'sites' ? 'Kapsam: sadece açtığım siteler' : 'Kapsam: tüm siteler');
  });
}

for (const el of document.querySelectorAll('input[name="mode"]')) {
  el.addEventListener('change', async () => {
    await send({ type: 'cs:set', patch: { cookieMode: el.value } });
    await refresh();
    toast('Mod: ' + el.parentElement.querySelector('b').textContent);
  });
}

$('allow').addEventListener('click', async () => {
  const state = await send({ type: 'cs:get-state' });
  await send({ type: 'cs:toggle-list', list: 'allowlist', host: SITE, on: !state.allowlisted });
  await refresh();
  toast(`${SITE} güncellendi. Sayfayı yenile.`);
});

$('disable').addEventListener('click', async () => {
  const state = await send({ type: 'cs:get-state' });
  await send({ type: 'cs:toggle-list', list: 'disabledSites', host: SITE, on: !state.siteDisabled });
  await refresh();
  toast(`${SITE} güncellendi. Sayfayı yenile.`);
});

$('clear').addEventListener('click', async () => {
  const res = await send({ type: 'cs:clear-cookies', host: SITE });
  await refresh();
  toast(`${(res && res.removed) || 0} çerez silindi`);
});

$('scan').addEventListener('click', async () => {
  if (TAB_ID == null) return;
  try {
    const res = await chrome.tabs.sendMessage(TAB_ID, { type: 'cs:scan-now' });
    toast(res && res.ok ? 'Tarama yapıldı' : 'Bu sayfada içerik betiği yok');
  } catch (_) {
    toast('Bu sayfada çalışamıyor (tarayıcı sayfası olabilir)');
  }
  setTimeout(refresh, 800);
});

$('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

refresh();
