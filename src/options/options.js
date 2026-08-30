'use strict';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

function toast(t) {
  $('toast').textContent = t || '';
  if (t) setTimeout(() => ($('toast').textContent = ''), 2500);
}

function renderStats(s) {
  const st = s.stats || {};
  $('stats').textContent =
    `Reddedilen pop-up: ${st.rejected || 0} · Gizlenen katman: ${st.hidden || 0} · Silinen çerez: ${st.cookiesRemoved || 0}`;
}

function fill(s) {
  for (const el of document.querySelectorAll('input[data-key]')) {
    el.checked = !!s[el.dataset.key];
  }
  for (const el of document.querySelectorAll('input[name="mode"]')) {
    el.checked = el.value === s.cookieMode;
  }
  for (const ta of document.querySelectorAll('textarea[data-list]')) {
    ta.value = (s[ta.dataset.list] || []).join('\n');
  }
  renderStats(s);
}

async function load() {
  const state = await send({ type: 'cs:get-state' });
  if (state && state.ok) fill(state.settings);
}

function parseList(text) {
  return Array.from(
    new Set(
      String(text || '')
        .split(/[\s,;]+/)
        .map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''))
        .filter(Boolean)
    )
  );
}

async function save() {
  const patch = {};
  for (const el of document.querySelectorAll('input[data-key]')) patch[el.dataset.key] = el.checked;
  const mode = document.querySelector('input[name="mode"]:checked');
  if (mode) patch.cookieMode = mode.value;
  for (const ta of document.querySelectorAll('textarea[data-list]')) {
    patch[ta.dataset.list] = parseList(ta.value);
  }
  await send({ type: 'cs:set', patch });
  await load();
  toast('Kaydedildi. Açık sekmelerde etkili olması için sayfayı yenile.');
}

$('save').addEventListener('click', save);

// Anahtarlar anında uygulanır (kaydet'e basmak zorunlu olmasın)
for (const el of document.querySelectorAll('input[data-key], input[name="mode"]')) {
  el.addEventListener('change', save);
}

$('clearAll').addEventListener('click', async () => {
  const res = await send({ type: 'cs:clear-cookies' });
  toast(`${(res && res.removed) || 0} çerez silindi (izin listesi korundu)`);
  await load();
});

$('sweep').addEventListener('click', async () => {
  await send({ type: 'cs:sweep-now' });
  toast('Süpürme yapıldı');
  await load();
});

$('reset').addEventListener('click', async () => {
  await send({ type: 'cs:set', patch: { stats: { rejected: 0, hidden: 0, cookiesRemoved: 0 } } });
  toast('İstatistikler sıfırlandı');
  await load();
});

load();
