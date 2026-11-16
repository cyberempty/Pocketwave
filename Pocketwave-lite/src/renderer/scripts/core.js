'use strict';

/* ===== utils ===== */
/* Small helpers shared by all renderer scripts */
const $ = s => document.querySelector(s);
const ROW_H = 56;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const fmt = s => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
const base = p => String(p).split(/[\\/]/).pop();
const stem = p => base(p).replace(/\.[^.]+$/, '');
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function toFileUrl(p) {
  const s = String(p).replace(/\\/g, '/').replace(/%/g, '%25');
  const enc = encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return enc.startsWith('//') ? 'file:' + enc : 'file:///' + enc;
}
function longDur(sec) {
  if (sec < 60) return `${Math.round(sec)} sec`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr ${String(m % 60).padStart(2, '0')} min`;
}
function shuf(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmtBytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';

/* ===== icons ===== */
/* Inline SVG icon paths (Material-style, 24x24) */
const P = {
  ffwd: 'M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z', rewind: 'M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z',
  expand: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  collapse: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
  play: 'M8 5v14l11-7z', pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  prev: 'M6 6h2v12H6zM9.5 12L18 18V6z', next: 'M16 6h2v12h-2zM6 18l8.5-6L6 6z',
  shuffle: 'M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  repeat1: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z',
  heart: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
  heartOn: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  vol: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  volLow: 'M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z',
  mute: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
  search: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  note: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
  queue: 'M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z',
  folder: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  refresh: 'M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  settings: 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  more: 'M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  panel: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14h-5V6h5v12z',
  camera: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  warn: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
  pin: 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z'
};
const ic = k => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${P[k]}"/></svg>`;

/* ===== theme ===== */
/* Theme (dark / light / system) and accent color */
const ACCENT_DEFAULT = '#1ed760';
// Accent colors: bright, saturated and clearly different from each other
const PALETTE = [['Green', '#1ed760'], ['Emerald', '#00c853'], ['Cyan', '#00e5ff'], ['Blue', '#2196f3'], ['Indigo', '#536dfe'], ['Violet', '#7c4dff'], ['Magenta', '#e040fb'], ['Pink', '#ff4081'],
                 ['Red', '#ff1744'], ['Coral', '#ff6e40'], ['Orange', '#ff9100'], ['Amber', '#ffc400'], ['Yellow', '#ffea00'], ['Lime', '#c6ff00'], ['White', '#ffffff'], ['Grey', '#9e9e9e']];
const hexOk = h => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(h).trim());
function normHex(h) {
  h = String(h).trim().toLowerCase();
  if (h[0] !== '#') h = '#' + h;
  if (/^#[0-9a-f]{3}$/.test(h)) h = '#' + [...h.slice(1)].map(c => c + c).join('');
  return h;
}
const hexToRgb = h => { h = normHex(h); return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; };
const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function lum([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const BASE_VARS = ['--bg', '--panel', '--panel2', '--hover', '--line', '--tx', '--tx2', '--tx3', '--menu', '--menuhov', '--modal', '--input',
                   '--rowhov', '--rowsel', '--bar', '--thumb', '--thumbh', '--scrim', '--toast', '--toastline', '--shadow'];
// Ready-made theme colors (the dark and light themes are the two first choices of the picker)
const THEME_PALETTE = [['Midnight', '#1d2d5c'], ['Ocean', '#0b4f6c'], ['Forest', '#14532d'], ['Teal', '#0f5c5c'], ['Plum', '#5b2a86'], ['Wine', '#7a1f3d'], ['Crimson', '#8a1c1c'], ['Espresso', '#5a3a22'],
                       ['Slate', '#475569'], ['Graphite', '#3f3f46'], ['Sky', '#dbeafe'], ['Mint', '#dcfce7'], ['Lavender', '#ede9fe'], ['Blush', '#fce7f3'], ['Sand', '#f5ecd9'], ['Cloud', '#e5e7eb']];

// Builds every surface and text color from one theme color: dark-looking colors give a dark theme, light ones a light theme
function computeBase(hex) {
  const B = hexToRgb(hex), light = lum(B) >= 0.5, W = [255, 255, 255], K = [0, 0, 0];
  const m = (a, b, t) => rgbToHex(...mixRgb(a, b, t));
  if (!light) return { light, vars: {
    '--bg': m(B, K, 0.55), '--panel': m(B, K, 0), '--panel2': m(B, W, 0.07), '--hover': m(B, W, 0.14), '--line': m(B, W, 0.12),
    '--tx': '#ffffff', '--tx2': m(W, B, 0.3), '--tx3': m(W, B, 0.55),
    '--menu': m(B, W, 0.1), '--menuhov': m(B, W, 0.18), '--modal': m(B, W, 0.06), '--input': m(B, K, 0.25),
    '--rowhov': 'rgba(255,255,255,.10)', '--rowsel': 'rgba(255,255,255,.18)', '--bar': m(B, W, 0.28), '--thumb': m(B, W, 0.2), '--thumbh': m(B, W, 0.35),
    '--scrim': 'rgba(0,0,0,.7)', '--toast': m(B, W, 0.1), '--toastline': m(B, W, 0.2), '--shadow': '0 16px 36px rgba(0,0,0,.6)' } };
  return { light, vars: {
    '--bg': m(B, K, 0.07), '--panel': m(B, K, 0), '--panel2': m(B, K, 0.05), '--hover': m(B, K, 0.1), '--line': m(B, K, 0.12),
    '--tx': '#121212', '--tx2': m(K, B, 0.35), '--tx3': m(K, B, 0.55),
    '--menu': m(B, W, 0.5), '--menuhov': m(B, K, 0.07), '--modal': m(B, W, 0.35), '--input': m(B, K, 0.05),
    '--rowhov': 'rgba(0,0,0,.06)', '--rowsel': 'rgba(0,0,0,.12)', '--bar': m(B, K, 0.18), '--thumb': m(B, K, 0.15), '--thumbh': m(B, K, 0.3),
    '--scrim': 'rgba(0,0,0,.4)', '--toast': m(B, W, 0.5), '--toastline': m(B, K, 0.15), '--shadow': '0 12px 30px rgba(0,0,0,.22)' } };
}
const baseAccent = () => normHex(hexOk(S.user.settings.accent) ? S.user.settings.accent : ACCENT_DEFAULT);
const baseThemeColor = () => normHex(hexOk(S.user.settings.themeColor) ? S.user.settings.themeColor : '#16213a');

// Sets the accent color and the derived colors (hover, readable text color, color on top of the accent)
function applyAccent(hex) {
  const rgb = hexToRgb(hex), L = lum(rgb), root = document.documentElement.style;
  document.documentElement.dataset.accent = normHex(hex) === ACCENT_DEFAULT ? 'default' : 'custom';   // drives the Play / Pause button color
  const light = document.documentElement.dataset.theme === 'light';
  let txt = rgb;
  if (light) { for (let i = 0; i < 12 && lum(txt) > 0.28; i++) txt = mixRgb(txt, [0, 0, 0], 0.12); }
  else { for (let i = 0; i < 12 && lum(txt) < 0.22; i++) txt = mixRgb(txt, [255, 255, 255], 0.12); }
  const onBlack = (L + 0.05) / 0.05, onWhite = 1.05 / (L + 0.05);
  root.setProperty('--g', rgbToHex(...rgb));
  root.setProperty('--gh', rgbToHex(...mixRgb(rgb, [255, 255, 255], 0.2)));
  root.setProperty('--gt', rgbToHex(...txt));
  root.setProperty('--on-g', onBlack >= onWhite ? '#000' : '#fff');
}
// Two customizations: the THEME (dark, light, or any theme color) and the ACCENT color
function applyTheme() {
  const st = S.user.settings, root = document.documentElement;
  BASE_VARS.forEach(v => root.style.removeProperty(v));
  if (st.theme === 'custom') {
    const base = computeBase(baseThemeColor());
    root.dataset.theme = base.light ? 'light' : 'dark';
    for (const k of Object.keys(base.vars)) root.style.setProperty(k, base.vars[k]);
  } else {
    root.dataset.theme = st.theme === 'light' ? 'light' : 'dark';
  }
  applyAccent(S.dynamicAccent || baseAccent());
}

// Dominant (most saturated) color of a cover image
// With neutral = true (dynamic accent), a black / white / grey cover gives a matching neutral instead of null
function dominantColor(src, neutral) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 32;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, 32, 32);
        const d = x.getImageData(0, 0, 32, 32).data;
        const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
        let sumL = 0, nL = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue;
          sumL += (d[i] + d[i + 1] + d[i + 2]) / 765; nL++;
          const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dl = mx - mn;
          if (dl < 0.08) continue;
          const s = dl / (1 - Math.abs(2 * l - 1) || 1);
          let h = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4;
          h = (h * 60 + 360) % 360;
          const w = s * (1 - Math.abs(2 * l - 1)), bin = bins[Math.floor(h / 30) % 12];
          bin.w += w; bin.r += d[i] * w; bin.g += d[i + 1] * w; bin.b += d[i + 2] * w;
        }
        const best = bins.reduce((a, b) => b.w > a.w ? b : a);
        if (best.w < 0.5) {
          // Black / white / grey cover: no real color in it, so the accent becomes a matching neutral (never the default green)
          if (!neutral || !nL) return resolve(null);
          const g = Math.round(150 + (sumL / nL) * 100);   // dark cover -> soft grey, white cover -> near white
          return resolve(rgbToHex(g, g, g));
        }
        let rgb = [best.r / best.w, best.g / best.w, best.b / best.w];
        const L = lum(rgb);
        if (L < 0.08) rgb = mixRgb(rgb, [255, 255, 255], 0.35);
        if (L > 0.6) rgb = mixRgb(rgb, [0, 0, 0], 0.25);
        resolve(rgbToHex(...rgb));
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
async function updateDynamicAccent(src) {
  if (!S.user.settings.dynamicColor || !src) S.dynamicAccent = null;
  else S.dynamicAccent = await dominantColor(src, true);
  applyAccent(S.dynamicAccent || baseAccent());
}

/* Color of a playlist / folder photo, used to tint the playlist page (cached by image URL) */
const photoColorCache = new Map();
function averageColor(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 16;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, 16, 16);
        const d = x.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        resolve(n ? rgbToHex(r / n, g / n, b / n) : null);
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
async function photoColor(src) {
  if (photoColorCache.has(src)) return photoColorCache.get(src);
  let hex = await dominantColor(src);
  if (!hex) {                                   // grey / black and white photos: use the average color, lifted a little so it stays visible
    hex = await averageColor(src);
    if (hex) { let rgb = hexToRgb(hex); if (lum(rgb) < 0.05) rgb = mixRgb(rgb, [255, 255, 255], 0.25); hex = rgbToHex(...rgb); }
  }
  photoColorCache.set(src, hex);
  return hex;
}
// Tints the header of the playlist page with the color of its photo (or removes the tint)
const photoTintOn = () => S.user.settings.photoColor !== false;
let tintToken = 0;
async function applyHeroTint(el, src) {
  const token = ++tintToken;
  if (!src || !photoTintOn()) { el.classList.remove('tinted'); el.style.removeProperty('--hero-c'); return; }
  if (photoColorCache.has(src)) {
    const c = photoColorCache.get(src);
    if (c) { el.style.setProperty('--hero-c', c); el.classList.add('tinted'); } else { el.classList.remove('tinted'); el.style.removeProperty('--hero-c'); }
    return;
  }
  el.classList.remove('tinted'); el.style.removeProperty('--hero-c');
  const c = await photoColor(src);
  if (token !== tintToken || !c) return;
  el.style.setProperty('--hero-c', c); el.classList.add('tinted');
}

/* ===== state ===== */
/* Application state, library model and persistence */
const DEFAULT_SHORTCUTS = {
  playPause: 'Space', next: 'Ctrl+ArrowRight', prev: 'Ctrl+ArrowLeft',
  volUp: 'Ctrl+ArrowUp', volDown: 'Ctrl+ArrowDown', seekFwd: 'ArrowRight', seekBack: 'ArrowLeft',
  search: 'Ctrl+F', panel: 'Ctrl+I', queue: 'Ctrl+Q'
};

const defaultUser = () => ({
  version: 8, musicRoot: '', lastRoot: '', syncFolder: '',
  pins: [], movedFolders: [], folderOrder: [], folderPrefs: {}, hiddenFolders: [], images: {},
  playlists: [], meta: {}, recent: { songs: [], ctx: [] },   // meta: details of playlist songs that are missing or live outside the library
  settings: {
    volume: 1, muted: false, showRemaining: false, repeat: 'off', shuffles: {}, sorts: {}, sidebarWidth: 260,
    panel: { open: true, mode: 'now', side: 'right', width: 300 },
    theme: 'dark', themeColor: '#16213a', accent: '#1ed760', dynamicColor: false, photoColor: true,
    adv: { covers: true, tags: true },
    shortcuts: Object.assign({}, DEFAULT_SHORTCUTS), last: null
  }
});

const S = {
  user: defaultUser(), dataDir: '', version: '', userName: '',
  tracks: [], byPath: new Map(), all: [], folders: [],
  view: { type: 'home' }, query: '', items: [], selected: -1,
  // Playback context (the playlist being played) and the "Add to queue" list
  queue: [], order: [], pos: -1, ctx: null, userQueue: [],
  currentPath: null, curFromQueue: false, loaded: false, resumeAt: 0, failStreak: 0,
  scanning: false, scan: null, firstLoad: null, rootOk: true, saveError: null, syncState: { state: 'off' },
  bad: new Map(), drag: null, pendingSidebar: false, coverToken: 0, coverCache: new Map(), dynamicAccent: null
};

/* ----- Views and their stable keys ----- */
const viewKey = v => (v.type === 'all' || v.type === 'search') ? v.type : v.type === 'home' ? 'home:' + (v.id || '') : (v.type === 'folder' ? 'fo:' : 'pl:') + v.id;
const sameView = (a, b) => !!a && !!b && a.type === b.type && (a.id || '') === (b.id || '');
const shuffleOn = v => !!(v && S.user.settings.shuffles[viewKey(v)]);
const findPl = id => S.user.playlists.find(p => p.id === id);
const findFolder = id => S.folders.find(f => f.id === id);

function viewTitle(v) {
  if (v.type === 'all') return 'All songs';
  if (v.type === 'search') return 'Search results';
  if (v.type === 'home') return { recent: 'Recently played', rec: 'Recommended for you', new: 'Recently added' }[v.id] || 'Home';
  if (v.type === 'folder') { const f = findFolder(v.id); return f ? f.name : 'Folder'; }
  if (v.type === 'playlist') { const p = findPl(v.id); return p ? p.name : 'Playlist'; }
  return '';
}

/* ----- Images of playlists and folders (copied into PocketwaveData/images) ----- */
const imgKey = v => v.type === 'playlist' ? 'pl:' + v.id : v.type === 'folder' ? 'fo:' + v.id : null;
const imgFile = name => toFileUrl(S.dataDir.replace(/[\\/]+$/, '') + '/images/' + name);
function imgUrl(key) {
  const n = key && S.user.images[key];
  return n ? imgFile(n) : null;
}

/* ----- Library ----- */
const relKey = t => (t.rel || '').split(/[\\/]+/).filter(Boolean).join('/') || '.';
function setLibrary(tracks) {
  S.tracks = tracks;
  S.byPath = new Map();
  for (const t of tracks) S.byPath.set(t.path, t);
  const hidden = new Set(S.user.hiddenFolders || []);
  const visible = tracks.filter(t => !t.extra && !hidden.has(relKey(t)));
  S.all = visible;
  const m = new Map();
  for (const t of visible) {
    let f = m.get(t.folder);
    if (!f) { const key = relKey(t); f = { id: key, key, path: t.folder, list: [] }; m.set(t.folder, f); }
    f.list.push(t);
  }
  S.folders = [...m.values()];
  nameFolders();
}

// A folder playlist is named after the subfolder only (or the custom name chosen by the user)
function nameFolders() {
  const rootName = base(S.user.musicRoot || '') || 'Music';
  const raw = f => f.key === '.' ? rootName : f.key.split('/').pop();
  const parentOf = f => { const p = f.key.split('/'); return p.length > 1 ? p[p.length - 2] : rootName; };
  const custom = f => (S.user.folderPrefs[f.key] || {}).name;
  const counts = new Map();
  for (const f of S.folders) if (!custom(f)) { const k = raw(f).toLowerCase(); counts.set(k, (counts.get(k) || 0) + 1); }
  for (const f of S.folders) {
    const c = custom(f);
    f.custom = !!c;
    f.name = c || (counts.get(raw(f).toLowerCase()) > 1 ? `${raw(f)} (${parentOf(f)})` : raw(f));
  }
  S.folders.sort((x, y) => coll.compare(x.name, y.name));
}

function getTrack(p) {
  const t = S.byPath.get(p);
  if (t) return t;
  const m = S.user.meta[p] || {};
  return { path: p, title: m.title || stem(p), artist: m.artist || '', album: m.album || '', duration: m.duration || 0, track: 0, missing: true };
}
const isPlayable = p => S.byPath.has(p);
const sKey = t => t._s || (t._s = norm(`${t.title} ${t.artist} ${t.album} ${t.rel || ''} ${stem(t.path)}`));

// Keeps playlists valid when the music folder moves (e.g. a USB drive gets a new letter)
function remapPaths(oldRoot, newRoot) {
  const n = x => String(x).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (!oldRoot || n(oldRoot) === n(newRoot)) return;
  const o = n(oldRoot);
  const sep = newRoot.includes('\\') ? '\\' : '/';
  const map = p => {
    if (S.byPath.has(p)) return p;
    const q = String(p).replace(/\\/g, '/');
    if (q.toLowerCase().startsWith(o + '/')) {
      const cand = newRoot.replace(/[\\/]+$/, '') + sep + q.slice(o.length + 1).split('/').join(sep);
      if (S.byPath.has(cand)) return cand;
    }
    return p;
  };
  const uniq = a => [...new Set(a.map(map))];
  for (const pl of S.user.playlists) pl.tracks = uniq(pl.tracks);
  if (S.user.settings.last) S.user.settings.last.path = map(S.user.settings.last.path);
}

/* ----- Covers ----- */
async function coverOf(p) {
  if (S.coverCache.has(p)) return S.coverCache.get(p);
  let src = null;
  try { src = await pocketwave.cover(p, { tags: S.user.settings.adv.covers }); } catch (e) { /* no cover */ }
  if (S.coverCache.size > 60) S.coverCache.delete(S.coverCache.keys().next().value);
  S.coverCache.set(p, src);
  return src;
}

/* ----- Persistence ----- */
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 300);
}
async function doSave() {
  try {
    const r = await pocketwave.saveUser(S.user);
    S.saveError = r && r.ok ? null : (r && r.error) || 'unknown error';
  } catch (e) { S.saveError = e.message; }
  renderBanner();
}

/* ===== engine ===== */
/* Audio playback: one plain <audio> element */
const audio = new Audio();
audio.preload = 'auto';
const onAudio = (type, fn) => audio.addEventListener(type, fn);
function engineSetVolume() {
  const s = S.user.settings;
  audio.volume = s.muted ? 0 : s.volume;
}

/* ===== ui ===== */
/* Toasts, context menu and modal dialogs */
function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3500);
}

// Preview card shown when a song is added to the queue
async function previewToast(t, heading) {
  const el = document.createElement('div');
  el.className = 'toast preview';
  el.innerHTML = `<div class="pv-cover">${ic('note')}</div><div class="pv-txt"><div class="pv-h">${esc(heading)}</div><div class="pv-t">${esc(t.title)}</div><div class="pv-a">${esc(t.artist || 'Unknown artist')}</div></div>`;
  $('#toast').appendChild(el);
  setTimeout(() => el.remove(), 4500);
  const src = await coverOf(t.path);
  if (src) { const c = el.querySelector('.pv-cover'); c.style.backgroundImage = `url("${src}")`; c.innerHTML = ''; }
}

let menuState = null;
function showMenu(x, y, items) {
  const m = $('#menu');
  menuState = { x, y, items };
  m.innerHTML = items.map((it, i) => it.sep ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''} ${it.checked ? 'chk' : ''}" ${it.disabled ? 'disabled' : ''}>${esc(it.label)}</button>`).join('');
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
}
function hideMenu() { $('#menu').hidden = true; menuState = null; }

function modal({ title, body, buttons, onOpen, cls }) {
  return new Promise(resolve => {
    const root = $('#modal-root');
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="modal ${cls || ''}" role="dialog" aria-modal="true"><h2>${esc(title)}</h2><div class="mb">${body || ''}</div><div class="foot"></div></div>`;
    const close = v => { ov.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const foot = ov.querySelector('.foot');
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' pri' : '') + (b.danger ? ' danger' : '');
      el.textContent = b.label;
      el.addEventListener('click', () => { const v = b.run ? b.run(ov) : b.value; if (v !== false) close(v); });
      foot.appendChild(el);
    }
    const onKey = e => {
      if (root.lastElementChild !== ov) return; // only the top-most dialog reacts
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') { e.preventDefault(); foot.querySelector('.pri')?.click(); }
    };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(null); });
    root.appendChild(ov);
    onOpen && onOpen(ov, close);
    (ov.querySelector('input[type=text]') || foot.querySelector('.pri') || foot.lastChild)?.focus();
  });
}
const askText = (title, label, initial) => modal({
  title, body: `<div class="field"><label>${esc(label)}</label><input type="text" maxlength="80" value="${esc(initial || '')}"></div>`,
  buttons: [{ label: 'Cancel', value: null }, { label: 'Confirm', primary: true, run: ov => { const v = ov.querySelector('input').value.trim(); return v ? v : false; } }],
  onOpen: ov => ov.querySelector('input').select()
});
const askConfirm = (title, text, okLabel) => modal({
  title, body: `<p>${esc(text)}</p>`,
  buttons: [{ label: 'Cancel', value: false }, { label: okLabel || 'Confirm', primary: true, value: true }]
}).then(v => v === true);

// Loading popup shown the first time a folder is read
function showLoadingPopup(title) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal loading" role="alertdialog" aria-live="polite"><div class="spinner"></div><h2>${esc(title)}</h2><p class="ld-txt">Looking for audio files…</p><div class="bar ld ind"><i></i></div><p class="ld-sub">This only happens the first time. Your files are only read, never changed.</p></div>`;
  $('#modal-root').appendChild(ov);
  return {
    update(p) {
      if (!p || !p.total) return;
      ov.querySelector('.ld-txt').textContent = `Reading song ${Math.min(p.done + 1, p.total)} of ${p.total}`;
      const bar = ov.querySelector('.bar');
      bar.classList.remove('ind');
      bar.querySelector('i').style.width = Math.round(p.done / p.total * 100) + '%';
    },
    close() { ov.remove(); }
  };
}
