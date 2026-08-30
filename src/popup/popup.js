'use strict';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

let S = null;
let HOST = null;
let SITE = null;
let TAB_ID = null;

function toast(text) {
  $('toast').textContent = text || '';
  if (text) setTimeout(() => ($('toast').textContent = ''), 2500);
}

function render(state) {
  S = state.settings;
  HOST = state.host;
  SITE = state.site;
  TAB_ID = state.tabId;

  $('enabled').checked = !!S.enabled;
  $('enabledLabel').textContent = S.enabled ? 'Açık' : 'Kapalı';
  $('host').textContent = HOST || 'tarayıcı sayfası';
  $('scope').textContent = SITE
    ? `Eylem kapsamı: ${SITE} ve tüm alt alan adları (adres yolu önemsiz)`
    : '';
  $('tabActions').textContent = String(state.tabActions || 0);
  $('cookieCount').textContent = state.cookieCount == null ? '—' : String(state.cookieCount);

  for (const el of document.querySelectorAll('input[name="mode"]')) {
    el.checked = el.value === S.cookieMode;
  }

  const scope = SITE || 'bu site';
  const allow = $('allow');
  allow.textContent = state.allowlisted
    ? `Çerez izni açık (${scope}) — kaldır`
    : `${scope} için çerezlere izin ver`;
  allow.classList.toggle('on', !!state.allowlisted);

  const dis = $('disable');
  dis.textContent = state.siteDisabled
    ? `Eklenti kapalı (${scope}) — tekrar aç`
    : `${scope} için eklentiyi kapat`;
  dis.classList.toggle('on', !!state.siteDisabled);

  const st = S.stats || {};
  $('stats').textContent =
    `${st.rejected || 0} reddedildi · ${st.hidden || 0} gizlendi · ${st.cookiesRemoved || 0} çerez silindi`;

  $('note').textContent =
    S.cookieMode === 'blockAll'
      ? 'Katı mod: giriş yaptığın siteler için "çerezlere izin ver" kullan.'
      : '';

  const noHost = !SITE;
  for (const id of ['allow', 'disable', 'clear', 'scan']) $(id).disabled = noHost;
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
