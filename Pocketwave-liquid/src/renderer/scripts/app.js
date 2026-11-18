'use strict';

/* ===== home ===== */
/* Home page, Spotify style: quick-access tiles and rows of cards
   (recently played, your playlists, folders, recommended, recently added). */
const HOME_MAX = 12;

/* ----- What has been played recently ----- */
function recordPlayed(path) {
  const r = S.user.recent;
  r.songs = [path, ...r.songs.filter(p => p !== path)].slice(0, 40);
  scheduleSave();
}
function recordContext(view) {
  if (view.type !== 'playlist' && view.type !== 'folder') return;
  const r = S.user.recent, k = keyOfItem(view.type, view.id);
  r.ctx = [{ type: view.type, id: view.id }, ...r.ctx.filter(c => keyOfItem(c.type, c.id) !== k)].slice(0, 12);
}
const ctxExists = c => c.type === 'playlist' ? !!findPl(c.id) : !!findFolder(c.id);

/* ----- Recommendations: no network and no tracking, just a daily pick from your own library ----- */
function dailyShuffle(list, salt) {
  const d = new Date();
  let seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() + salt;
  const rnd = () => {                                   // small seeded generator: the picks stay the same all day
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function homeData() {
  const r = S.user.recent;
  const recentSongs = r.songs.map(p => S.byPath.get(p)).filter(Boolean).slice(0, HOME_MAX);
  const recentSet = new Set(r.songs.slice(0, 20));
  const rec = dailyShuffle(S.all.filter(t => !recentSet.has(t.path)), S.all.length).slice(0, HOME_MAX);
  const added = S.all.slice().sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).slice(0, HOME_MAX);
  // Quick tiles: "All songs", then the playlists and folders played most recently (filled up with your own playlists)
  const quick = [{ type: 'all', name: 'All songs' }];
  const seen = new Set();
  const add = it => { const k = keyOfItem(it.type, it.id); if (quick.length < 7 && !seen.has(k)) { seen.add(k); const i = itemInfo(it.type, it.id); quick.push({ type: it.type, id: it.id, name: i.name }); } };
  r.ctx.filter(ctxExists).forEach(add);
  myPlaylistsItems().forEach(add);
  unpinnedFolders().map(id => ({ type: 'folder', id })).forEach(add);
  return { recentSongs, rec, added, quick, lists: { recent: recentSongs, rec, new: added } };
}

/* ----- Rendering ----- */
// One greeting for the whole day, with the name of the computer user (read locally, never sent anywhere)
const greeting = () => S.userName ? `Hello, ${S.userName}` : 'Hello';
const bgStyle = url => url ? `style="background-image:url('${url}')"` : '';
const EQ = '<span class="eqi"><i></i><i></i><i></i></span>';
function viewCard(type, id) {
  const i = itemInfo(type, id), url = imgUrl(keyOfItem(type, id)), playing = isActiveCtx({ type, id });
  return `<div class="hcard ${playing ? 'playing' : ''} ${playing && audio.paused ? 'paused' : ''}" data-hk="view" data-type="${type}" data-id="${esc(id)}" title="${esc(i.name)}">
    <div class="himg ${url ? 'img' : ''}" ${bgStyle(url)}>${ic('note')}${EQ}<button class="hplay" title="Play">${ic(playing && !audio.paused ? 'pause' : 'play')}</button></div>
    <div class="hname">${esc(i.name)}</div><div class="hsub">${type === 'playlist' ? 'Playlist' : 'Folder'} · ${plural(i.count, 'song', 'songs')}</div></div>`;
}
function songCard(t, sec, i) {
  return `<div class="hcard" data-hk="song" data-sec="${sec}" data-i="${i}" title="${esc(t.title)}">
    <div class="himg" data-cover="${esc(t.path)}">${ic('note')}<button class="hplay" title="Play">${ic('play')}</button></div>
    <div class="hname">${esc(t.title)}</div><div class="hsub">${esc(t.artist || 'Unknown artist')}</div></div>`;
}
function quickTile(q) {
  const playing = isActiveCtx(q.type === 'all' ? { type: 'all' } : { type: q.type, id: q.id });
  const state = `${playing ? 'playing' : ''} ${playing && audio.paused ? 'paused' : ''}`, btn = `<button class="hplay" title="Play">${ic(playing && !audio.paused ? 'pause' : 'play')}</button>`;
  if (q.type === 'all') return `<div class="qtile ${state}" data-hk="view" data-type="all" title="All songs"><div class="qimg all">${ic('note')}</div><div class="qn">All songs</div>${EQ}${btn}</div>`;
  const url = imgUrl(keyOfItem(q.type, q.id));
  return `<div class="qtile ${state}" data-hk="view" data-type="${q.type}" data-id="${esc(q.id)}" title="${esc(q.name)}"><div class="qimg ${url ? 'img' : ''}" ${bgStyle(url)}>${ic('note')}</div><div class="qn">${esc(q.name)}</div>${EQ}${btn}</div>`;
}
const section = (title, cards) => cards ? `<div class="hsec"><h2>${esc(title)}</h2></div><div class="hrow">${cards}</div>` : '';

function renderHome() {
  const box = $('#home');
  if (!S.all.length) {
    box.innerHTML = `<h1 class="greet">${esc(greeting())}</h1><div class="home-empty"><h2>No songs yet</h2><p>There are no supported audio files in ${esc(S.user.musicRoot)}.<br>Add music to the folder: it is picked up automatically.</p></div>`;
    return;
  }
  const d = homeData();
  S.homeLists = d.lists;
  const mine = myPlaylistsItems().slice(0, HOME_MAX).map(i => viewCard(i.type, i.id)).join('');
  const folders = unpinnedFolders().slice(0, HOME_MAX).map(id => viewCard('folder', id)).join('');
  box.innerHTML = `<h1 class="greet">${esc(greeting())}</h1>
    <div class="qgrid">${d.quick.map(quickTile).join('')}</div>
    ${section('Recently played', d.recentSongs.map((t, i) => songCard(t, 'recent', i)).join(''))}
    ${section('Your playlists', mine)}
    ${section('Folders', folders)}
    ${section('Recommended for you', d.rec.map((t, i) => songCard(t, 'rec', i)).join(''))}
    ${section('Recently added', d.added.map((t, i) => songCard(t, 'new', i)).join(''))}`;
  box.querySelectorAll('.himg[data-cover]').forEach(async el => {      // covers load one by one, without blocking the page
    const src = await coverOf(el.dataset.cover, true);
    if (src && el.isConnected) { el.style.backgroundImage = `url("${src}")`; el.classList.add('img'); }
  });
}

// The items of a list, without opening it (so the page that is on screen does not change)
function itemsOf(v) {
  const savedView = S.view, savedQuery = S.query;
  S.view = v; S.query = '';
  const items = currentItems();
  S.view = savedView; S.query = savedQuery;
  return items;
}
// Play button on a Home tile or card: plays the playlist (or pauses it if it is playing) and stays on the Home page
function playFromHome(v) {
  if (isActiveCtx(v)) return togglePlay();
  const items = itemsOf(v);
  const ok = items.map((it, i) => i).filter(i => isPlayable(items[i].t.path));
  if (!ok.length) return toast('None of these songs can be played: their files are missing.', 'err');
  playItems(items, shuffleOn(v) ? ok[Math.floor(Math.random() * ok.length)] : ok[0], v);
}
// Keeps the playing highlight, the animation and the Play / Pause icon of the Home tiles up to date without redrawing the page
function refreshHomePlaying() {
  const box = $('#home');
  if (!box || box.hidden) return;
  box.querySelectorAll('[data-hk="view"]').forEach(el => {
    const v = el.dataset.type === 'all' ? { type: 'all' } : { type: el.dataset.type, id: el.dataset.id };
    const on = isActiveCtx(v), playing = on && !audio.paused;
    el.classList.toggle('playing', on);
    el.classList.toggle('paused', on && audio.paused);
    const btn = el.querySelector('.hplay');
    if (btn) { btn.innerHTML = ic(playing ? 'pause' : 'play'); btn.title = playing ? 'Pause' : 'Play'; }
  });
}
function playHomeSong(sec, i) {
  const list = (S.homeLists || {})[sec];
  if (!list || !list[i]) return;
  playItems(list.map(t => ({ t })), i, { type: 'home', id: sec });
}
function bindHome() {
  const box = $('#home');
  box.addEventListener('click', e => {
    const el = e.target.closest('[data-hk]');
    if (!el) return;
    const play = !!e.target.closest('.hplay');
    if (el.dataset.hk === 'song') return playHomeSong(el.dataset.sec, +el.dataset.i);
    const v = el.dataset.type === 'all' ? { type: 'all' } : { type: el.dataset.type, id: el.dataset.id };
    if (play) return playFromHome(v);       // Play: start it, but do not open the playlist
    setView(v);                             // a click anywhere else on the card opens it
  });
  box.addEventListener('contextmenu', e => {
    const el = e.target.closest('[data-hk="view"]');
    if (!el || el.dataset.type === 'all') return;
    e.preventDefault();
    itemMenu(el.dataset.type, el.dataset.id, e.clientX, e.clientY);
  });
}

/* ===== shortcuts ===== */
/* Customizable keyboard shortcuts */
const SHORTCUT_LABELS = {
  playPause: 'Play / Pause', next: 'Next song', prev: 'Previous song', volUp: 'Volume up', volDown: 'Volume down',
  seekFwd: 'Seek forward 5 seconds', seekBack: 'Seek back 5 seconds', search: 'Search', panel: 'Show / hide side panel',
  queue: 'Open queue'
};
const SHORTCUT_ACTIONS = {
  playPause: () => togglePlay(), next: () => next(false), prev: () => prev(),
  volUp: () => changeVolume(0.05), volDown: () => changeVolume(-0.05),
  seekFwd: () => { if (S.loaded) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); },
  seekBack: () => { if (S.loaded) audio.currentTime = Math.max(0, audio.currentTime - 5); },
  search: () => { $('#q').focus(); $('#q').select(); },
  panel: () => togglePanel(), queue: () => toggleQueue()
};
const KEY_NAMES = { ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space' };
const prettyCombo = c => c ? c.split('+').map(p => KEY_NAMES[p] || p).join(' + ') : '—';

function comboFromEvent(e) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  let key;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}
const actionFor = combo => Object.keys(S.user.settings.shortcuts).find(a => S.user.settings.shortcuts[a] === combo);

function bindShortcuts() {
  document.addEventListener('keydown', e => {
    if (S.capturing) return;
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = (tag === 'input' && !['range', 'checkbox', 'radio'].includes(e.target.type)) || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape') { hideMenu(); if (typing && e.target.id === 'q') { $('#q-clear').click(); e.target.blur(); } return; }
    if ($('#modal-root').children.length) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    const action = actionFor(combo);
    if (!action) { if (e.key === 'Enter' && S.selected >= 0 && tag !== 'button' && !typing) playItem(S.selected); return; }
    const hasMod = /^(Ctrl|Alt)\+/.test(combo);
    if (typing && !hasMod) return;
    if (tag === 'input' && e.target.type === 'range' && /Arrow/.test(combo) && !hasMod) return;
    if (combo === 'Space' && tag === 'button') return;
    e.preventDefault();
    SHORTCUT_ACTIONS[action]();
  });
}

// Asks for a new key combination. Resolves with the combo, or null when cancelled.
async function captureShortcut(action) {
  let handler;
  S.capturing = true;
  const p = modal({
    title: 'Change shortcut',
    body: `<p>Press the new key combination for <b>${esc(SHORTCUT_LABELS[action])}</b>.<br>Press Esc to cancel.</p><div class="field"><div class="val" id="cap-val" style="text-align:center;font-size:18px;font-weight:700">…</div></div><p id="cap-err" style="color:var(--danger);margin:0"></p>`,
    buttons: [{ label: 'Cancel', value: null }],
    onOpen: (ov, close) => {
      document.activeElement && document.activeElement.blur();
      handler = e => {
        if (e.key === 'Escape') return;
        e.preventDefault(); e.stopPropagation();
        const c = comboFromEvent(e);
        if (!c) return;
        $('#cap-val').textContent = prettyCombo(c);
        const other = actionFor(c);
        if (other && other !== action) { $('#cap-err').textContent = `Already used by “${SHORTCUT_LABELS[other]}”. Choose another one.`; return; }
        close(c);
      };
      document.addEventListener('keydown', handler, true);
    }
  });
  const r = await p;
  document.removeEventListener('keydown', handler, true);
  S.capturing = false;
  return r;
}

/* ===== settings ===== */
/* Settings: Library, Appearance, Shortcuts */
const sw = (id, on, dis) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}><span></span></label>`;
const SET_TABS = [['library', 'Library'], ['appearance', 'Appearance'], ['graphics', 'Graphics'], ['shortcuts', 'Shortcuts']];

function openSettings(tab) {
  S.settingsTab = tab || S.settingsTab || 'library';
  modal({
    title: 'Settings', cls: 'wide',
    body: `<div class="set-wrap"><div class="set-tabs">${SET_TABS.map(([k, l]) => `<button class="set-tab" data-tab="${k}">${l}</button>`).join('')}</div><div class="set-body" id="set-body"></div></div>`,
    buttons: [{ label: 'Close', primary: true, value: true }],
    onOpen: (ov, close) => {
      S.settingsClose = close;
      ov.querySelectorAll('.set-tab').forEach(b => b.addEventListener('click', () => { S.settingsTab = b.dataset.tab; renderSettingsTab(); }));
      renderSettingsTab();
    }
  });
}
function renderSettingsTab() {
  const body = $('#set-body'); if (!body) return;
  document.querySelectorAll('.set-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === S.settingsTab));
  const t = { library: tabLibrary, appearance: tabAppearance, graphics: tabGraphics, shortcuts: tabShortcuts }[S.settingsTab];
  const keep = body.scrollTop;
  body.innerHTML = t.html();
  t.bind(body);
  body.scrollTop = keep;
}
const closeSettings = () => { if (S.settingsClose) S.settingsClose(true); };

/* ---------- Library ---------- */
function syncStatusText() {
  const st = S.syncState || { state: 'off' };
  if (st.state === 'listening') return 'Listening for changes in real time…';
  if (st.state === 'error') return 'Not available right now: ' + (st.message || 'folder not reachable') + '. Pocketwave keeps trying.';
  return 'Waiting for a music folder';
}
function refreshSyncStatus() { document.querySelectorAll('.sync-status').forEach(el => { el.textContent = syncStatusText(); }); }
const tabLibrary = {
  html() {
    const u = S.user, adv = u.settings.adv;
    return `
    <div class="set-sec"><h3>Music library</h3>
      <div class="set-row"><div class="lbl">Music folder (synchronized)<small class="sync-status">${esc(syncStatusText())}</small><small class="val" style="display:block;margin-top:6px">${esc(u.musicRoot || 'Not chosen yet')}</small></div><div class="ctl2"><button class="btn sm" id="st-pick">Browse…</button></div></div>
      <div class="hint">This folder is always monitored: songs you add, remove, rename, move or edit in it are updated in Pocketwave automatically, and it cannot be switched off.</div>
      <div class="set-row"><div class="lbl">Program data folder<small>Playlists, settings and photos</small><small class="val" style="display:block;margin-top:6px">${esc(S.dataDir)}</small></div><div class="ctl2"><button class="btn sm" id="st-data">Change folder</button></div></div>
      <div class="rowbtns"><button class="btn sm" id="st-scan">${ic('refresh')}Refresh library</button><button class="btn sm danger" id="st-reset">Reset…</button></div>
      <div class="hint">Supported audio formats: MP3, WAV, FLAC, OGG, AAC, M4A, OPUS. WMA is not supported by the playback engine.</div>
    </div>
    <div class="set-sec"><h3>Playlists</h3>
      <div class="set-row"><div class="lbl">Import a playlist<small>Reads M3U and M3U8 files. To export, use the playlist menu.</small></div><div class="ctl2"><button class="btn sm" id="pl-import">Import…</button></div></div>
    </div>
    <div class="set-sec"><h3>Extra synchronized folder (optional)</h3>
      <div class="set-row"><div class="lbl">Second folder to keep in sync<small class="sync-status">${esc(u.syncFolder ? syncStatusText() : 'Not set')}</small><small class="val" style="display:block;margin-top:6px">${esc(u.syncFolder || 'Not set')}</small></div><div class="ctl2"><button class="btn sm" id="sy-pick">Browse…</button><button class="btn sm" id="sy-clear" ${u.syncFolder ? '' : 'disabled'}>Clear</button></div></div>
    </div>
    <div class="set-sec"><h3>Advanced options</h3>
      <div class="set-row"><div class="lbl">Extract covers from tags automatically<small>When off, only cover.jpg / folder.jpg images in the folder are used.</small></div><div class="ctl2">${sw('ad-covers', adv.covers)}</div></div>
      <div class="set-row"><div class="lbl">Read ID3 metadata<small>Titles, artists and albums from the tags. When off, file names are used.</small></div><div class="ctl2">${sw('ad-tags', adv.tags)}</div></div>
    </div>
    <div class="set-sec"><h3>Photos and removed folders</h3>
      <div class="set-row"><div class="lbl">Photos of playlists and folders<small>Compressed copies of the photos you added are kept in the program data folder.</small></div><div class="ctl2"><button class="btn sm" id="im-manage">Manage images folder</button></div></div>
      <div class="set-row"><div class="lbl">Folders removed from Pocketwave: ${u.hiddenFolders.length}<small>They still exist on your computer.</small></div><div class="ctl2"><button class="btn sm" id="hf-restore" ${u.hiddenFolders.length ? '' : 'disabled'}>Restore all</button></div></div>
    </div>
    <div class="hint">Pocketwave ${esc(S.version)} · MIT License · Works offline, no account, no data collection.</div>`;
  },
  bind(b) {
    const u = S.user;
    $('#st-pick').onclick = () => { closeSettings(); chooseRoot(); };
    $('#st-data').onclick = async () => { const d = await pocketwave.relocateData(); if (d) { S.dataDir = d; await doSave(); toast('Data is now saved in ' + d, 'ok'); renderSettingsTab(); } };
    $('#st-scan').onclick = () => { closeSettings(); rescan({ manual: true }); };
    $('#st-reset').onclick = () => { closeSettings(); askReset(); };
    $('#sy-pick').onclick = async () => {
      const p = await pocketwave.chooseFolder('Choose the extra folder to keep in sync');
      if (!p) return;
      u.syncFolder = p; scheduleSave();
      closeSettings();
      await rescan({ manual: true, first: true });
      applyWatch();
    };
    $('#sy-clear').onclick = async () => { u.syncFolder = ''; scheduleSave(); renderSettingsTab(); await rescan({ manual: true }); applyWatch(); };
    $('#ad-covers').onchange = e => { u.settings.adv.covers = e.target.checked; scheduleSave(); S.coverCache.clear(); setCover(curTrack()); renderPanel(); };
    $('#ad-tags').onchange = e => { u.settings.adv.tags = e.target.checked; scheduleSave(); toast('Re-reading your files…'); closeSettings(); rescan({ manual: false }).then(applyWatch); };
    $('#pl-import').onclick = () => { closeSettings(); importPlaylist(); };
    $('#im-manage').onclick = openImagesManager;
    $('#hf-restore').onclick = () => { u.hiddenFolders = []; scheduleSave(); setLibrary(S.tracks); renderSidebar(); renderMain(); renderSettingsTab(); toast('Folders restored', 'ok'); };
  }
};

async function openImagesManager() {
  const info = await pocketwave.imageInfo();
  modal({
    title: 'Images folder',
    body: `<p>The pictures you add to playlists and folders are copied here, so they always stay available.</p>
      <div class="field"><label>Location</label><div class="val">${esc(info.dir)}</div></div>
      <p style="margin:0">${plural(info.count, 'image', 'images')}, ${(info.bytes / 1048576).toFixed(1)} MB</p>`,
    buttons: [
      { label: 'Delete all images', danger: true, run: async () => {
        if (!await askConfirm('Delete all images?', 'All pictures of playlists and folders will be removed from Pocketwave.', 'Delete all')) return false;
        await pocketwave.clearImages(); S.user.images = {}; scheduleSave(); renderSidebar(); renderMain(); toast('Images deleted'); return true;
      } },
      { label: 'Open folder', run: async () => { const r = await pocketwave.openImagesFolder(); if (!r.ok) toast('Could not open the folder: ' + r.error, 'err'); return false; } },
      { label: 'Close', primary: true, value: true }
    ]
  });
}

async function askReset() {
  const res = await modal({
    title: 'Reset Pocketwave?',
    body: `<p>This removes the music folder, the extra synchronized folder and the scanned library, stops playback and clears the queue, and brings the program back to its original state (the welcome screen). Your music files are not touched.</p>
      <p>By default your playlists are kept.</p>
      <label class="check"><input type="checkbox" id="rs-all"> Also delete my playlists, photos and settings</label>`,
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Reset', primary: true, danger: true, run: ov => ({ all: ov.querySelector('#rs-all').checked }) }
    ]
  });
  if (res) await resetApp(res.all);
}
async function resetApp(all) {
  audio.pause(); audio.removeAttribute('src'); audio.load();
  S.currentPath = null; S.loaded = false; S.curFromQueue = false; S.resumeAt = 0;
  S.queue = []; S.order = []; S.pos = -1; S.ctx = null; S.userQueue = [];
  S.bad.clear(); S.query = ''; S.selected = -1; $('#q').value = ''; $('#q-clear').hidden = true;
  if (all) {
    await pocketwave.clearImages();
    S.user = defaultUser();
  } else {
    for (const k of Object.keys(S.user.images)) if (k.startsWith('fo:')) { pocketwave.removeImage(S.user.images[k]); delete S.user.images[k]; }
    S.user.musicRoot = ''; S.user.lastRoot = ''; S.user.syncFolder = ''; S.user.hiddenFolders = [];
    S.user.pins = S.user.pins.filter(k => k.startsWith('pl:'));
    S.user.folderPrefs = {}; S.user.folderOrder = []; S.user.movedFolders = [];
    S.user.settings.last = null;
    S.user.settings.sorts = {};
    for (const k of Object.keys(S.user.settings.shuffles)) if (k.startsWith('fo:') || k === 'all') delete S.user.settings.shuffles[k];
  }
  await pocketwave.clearLibrary();
  setLibrary([]);
  S.view = { type: 'home' }; S.rootOk = true;
  document.title = 'Pocketwave';
  applyTheme(); applySidebar(S.user.settings.sidebarWidth); applyPanel();
  renderSidebar(); renderBanner(); renderMain(); updatePlayer(); setCover(null);
  await doSave();
  applyWatch();
  toast('Pocketwave has been reset.', 'ok');
}

/* ---------- Appearance: two customizations, the theme color and the accent color ---------- */
const tabAppearance = {
  html() {
    const st = S.user.settings, acc = baseAccent(), tc = baseThemeColor();
    const custom = st.theme === 'custom';
    return `
    <div class="set-sec"><h3>Theme</h3>
      <div class="radio-row">${[['dark', 'Dark'], ['light', 'Light']].map(([k, l]) => `<button class="chip ${st.theme === k ? 'on' : ''}" data-theme="${k}">${l}</button>`).join('')}</div>
      <div class="sub-h">Or choose a theme color</div>
      <div class="palette">${THEME_PALETTE.map(([n, c]) => `<button class="dot ${custom && c === tc ? 'on' : ''}" data-tc="${c}" style="background:${c}" title="${n} ${c}" aria-label="${n}"></button>`).join('')}</div>
      <div class="hex"><div class="sw" id="th-sw" style="background:${tc}"></div><input id="th-hx" type="text" value="${tc.toUpperCase()}" maxlength="7" placeholder="#16213A" spellcheck="false" aria-label="Theme color in hexadecimal"></div>
      <div class="hint">Pick a ready-made color or type your own in hexadecimal format (for example #16213A). Backgrounds and panels follow it.</div>
    </div>
    <div class="set-sec"><h3>Accent color</h3>
      <div class="palette">${PALETTE.map(([n, c]) => `<button class="dot ${c === acc ? 'on' : ''}" data-c="${c}" style="background:${c}" title="${n} ${c}" aria-label="${n}"></button>`).join('')}</div>
      <div class="hex"><div class="sw" id="hx-sw" style="background:${acc}"></div><input id="hx" type="text" value="${acc.toUpperCase()}" maxlength="7" placeholder="#1DB954" spellcheck="false" aria-label="Accent color in hexadecimal"></div>
      <div class="hint">Buttons, the progress bar, Play / Pause and highlights use this color. Type a color in hexadecimal format (for example #00FF00): the program changes in real time.</div>
      <div class="acc-preview"><button class="bigplay">${ic('play')}</button><span class="tag">Preview</span><div class="bar2"></div></div>
      <div class="rowbtns"><button class="btn sm" id="ac-reset">Restore default (green)</button></div>
    </div>
    <div class="set-sec"><h3>Background colors</h3>
      <div class="radio-row">${[['auto', 'Automatic'], ['custom', 'My colors']].map(([k, l]) => `<button class="chip ${st.bgMode === k ? 'on' : ''}" data-bgmode="${k}">${l}</button>`).join('')}</div>
      ${st.bgMode === 'custom' ? `
      <div class="sub-h">How many colors</div>
      <div class="radio-row">${[1, 2, 3, 4, 5].map(n => `<button class="chip ${st.bgCount === n ? 'on' : ''}" data-bgcount="${n}">${n}</button>`).join('')}</div>
      ${st.bgColors.slice(0, st.bgCount).map((c, i) => `<div class="bg-row"><input type="color" class="bg-pick" data-bgp="${i}" value="${c}" aria-label="Background color ${i + 1}"><div class="hex"><input class="bg-hx" data-bgh="${i}" type="text" value="${c.toUpperCase()}" maxlength="7" spellcheck="false" aria-label="Background color ${i + 1} in hexadecimal"></div></div>`).join('')}
      <div class="hint">These colors fill the light behind the glass and stay fixed, whatever the accent or the song.</div>` : `<div class="hint">The background follows the accent color (and the album cover, if Dynamic color is on) with colors that match each other.</div>`}
    </div>
    <div class="set-sec"><h3>Dynamic color</h3>
      <div class="set-row"><div class="lbl">Use the dominant color of the album cover<small>The accent color follows the song that is playing.</small></div><div class="ctl2">${sw('ac-dyn', st.dynamicColor)}</div></div>
    </div>`;
  },
  bind(b) {
    const st = S.user.settings;
    const markTheme = () => {
      b.querySelectorAll('[data-theme]').forEach(x => x.classList.toggle('on', x.dataset.theme === st.theme));
      b.querySelectorAll('[data-tc]').forEach(d => d.classList.toggle('on', st.theme === 'custom' && d.dataset.tc === baseThemeColor()));
      $('#th-sw').style.background = baseThemeColor();
    };
    const setThemeColor = hex => { st.theme = 'custom'; st.themeColor = normHex(hex); scheduleSave(); applyTheme(); markTheme(); };
    b.querySelectorAll('[data-theme]').forEach(c => c.onclick = () => { st.theme = c.dataset.theme; scheduleSave(); applyTheme(); markTheme(); });
    b.querySelectorAll('[data-tc]').forEach(d => d.onclick = () => { setThemeColor(d.dataset.tc); $('#th-hx').value = baseThemeColor().toUpperCase(); $('#th-hx').classList.remove('bad'); });
    $('#th-hx').oninput = e => {
      const ok = hexOk(e.target.value);
      e.target.classList.toggle('bad', !ok);
      if (ok) setThemeColor(e.target.value);
    };
    $('#th-hx').onblur = e => { e.target.value = baseThemeColor().toUpperCase(); e.target.classList.remove('bad'); };

    b.querySelectorAll('[data-bgmode]').forEach(c => c.onclick = () => { st.bgMode = c.dataset.bgmode; scheduleSave(); applyTheme(); renderSettingsTab(); });
    b.querySelectorAll('[data-bgcount]').forEach(c => c.onclick = () => { st.bgCount = +c.dataset.bgcount; scheduleSave(); applyTheme(); renderSettingsTab(); });
    const setBg = (i, hex) => { st.bgColors[i] = normHex(hex); scheduleSave(); applyTheme(); };
    b.querySelectorAll('[data-bgp]').forEach(p => p.oninput = () => {
      setBg(+p.dataset.bgp, p.value);
      const h = b.querySelector(`[data-bgh="${p.dataset.bgp}"]`); if (h) { h.value = normHex(p.value).toUpperCase(); h.classList.remove('bad'); }
    });
    b.querySelectorAll('[data-bgh]').forEach(h => {
      h.oninput = () => {
        const ok = hexOk(h.value); h.classList.toggle('bad', !ok);
        if (ok) { setBg(+h.dataset.bgh, h.value); const p = b.querySelector(`[data-bgp="${h.dataset.bgh}"]`); if (p) p.value = normHex(h.value); }
      };
      h.onblur = () => { h.value = st.bgColors[+h.dataset.bgh].toUpperCase(); h.classList.remove('bad'); };
    });

    const setAccent = hex => {
      st.accent = normHex(hex); scheduleSave(); applyTheme();
      b.querySelectorAll('[data-c]').forEach(d => d.classList.toggle('on', d.dataset.c === st.accent));
      $('#hx-sw').style.background = st.accent;
    };
    b.querySelectorAll('[data-c]').forEach(d => d.onclick = () => { setAccent(d.dataset.c); $('#hx').value = st.accent.toUpperCase(); $('#hx').classList.remove('bad'); });
    $('#hx').oninput = e => {
      const ok = hexOk(e.target.value);
      e.target.classList.toggle('bad', !ok);
      if (ok) setAccent(e.target.value);
    };
    $('#hx').onblur = e => { e.target.value = baseAccent().toUpperCase(); e.target.classList.remove('bad'); };
    $('#ac-reset').onclick = () => { setAccent(ACCENT_DEFAULT); $('#hx').value = ACCENT_DEFAULT.toUpperCase(); $('#hx').classList.remove('bad'); };
    $('#ac-dyn').onchange = async e => {
      st.dynamicColor = e.target.checked; scheduleSave();
      const t = curTrack(), src = t && S.coverCache.get(t.path);
      await updateDynamicAccent(src || null);
    };
  }
};

/* ---------- Shortcuts ---------- */
const tabGraphics = {
  html() {
    const g = S.user.settings.gfx, cur = gfxPresetOf(g);
    return `
    <div class="set-sec"><h3>Graphics quality</h3>
      <div class="radio-row">${GFX_PRESET_LABELS.map(([k, l]) => `<button class="chip ${cur === k ? 'on' : ''}" data-gp="${k}">${l}</button>`).join('')}${cur === 'custom' ? '<button class="chip on" disabled>Custom</button>' : ''}</div>
      <div class="hint">Pick what suits your computer: on a powerful PC use High or Maximum for the full Liquid Glass look; on an older one use Minimum or Low and the app stays smooth. Changes apply immediately.</div>
    </div>
    <div class="set-sec"><h3>Advanced</h3>
      ${Object.entries(GFX_OPTS).map(([o, d]) => `<div class="sub-h">${d.label}</div>
      <div class="radio-row">${d.vals.map(([v, l]) => `<button class="chip ${g[o] === v ? 'on' : ''}" data-go="${o}" data-gv="${v}">${l}</button>`).join('')}</div>
      <div class="hint">${d.hint}</div>`).join('')}
    </div>
    <div class="set-sec"><h3>Diagnostics</h3>
      <div class="sub-h">FPS counter</div>
      <div class="radio-row">${[['off', 'Off'], ['on', 'On']].map(([v, l]) => `<button class="chip ${g.showFps === v ? 'on' : ''}" data-gf="${v}">${l}</button>`).join('')}</div>
      <div class="hint">Shows the frames per second and the slowest recent frame in the top-right corner, to check whether a setting really helps. 60 fps is perfectly smooth.</div>
    </div>`;
  },
  bind(b) {
    const g = S.user.settings.gfx;
    b.querySelectorAll('[data-gf]').forEach(x => x.onclick = () => { g.showFps = x.dataset.gf; scheduleSave(); applyGfx(); renderSettingsTab(); });
    const done = () => { g.preset = gfxPresetOf(g); scheduleSave(); applyGfx(); renderSettingsTab(); };
    b.querySelectorAll('[data-gp]').forEach(x => x.onclick = () => { Object.assign(g, GFX_PRESETS[x.dataset.gp]); done(); });
    b.querySelectorAll('[data-go]').forEach(x => x.onclick = () => { g[x.dataset.go] = x.dataset.gv; done(); });
  }
};
const tabShortcuts = {
  html() {
    const sc = S.user.settings.shortcuts;
    return `<div class="set-sec"><h3>Keyboard shortcuts</h3>
      ${Object.keys(SHORTCUT_LABELS).map(a => `<div class="sc-row"><div class="lbl">${esc(SHORTCUT_LABELS[a])}</div><span class="kbd">${esc(prettyCombo(sc[a]))}</span><button class="btn sm" data-edit="${a}">Edit</button></div>`).join('')}
      <div class="rowbtns" style="margin-top:14px"><button class="btn sm" id="sc-reset">Restore default shortcuts</button></div>
      <div class="hint">Your shortcuts are saved in the program data folder (userdata.json).</div></div>`;
  },
  bind(b) {
    b.querySelectorAll('[data-edit]').forEach(btn => btn.onclick = async () => {
      const a = btn.dataset.edit, c = await captureShortcut(a);
      if (c) { S.user.settings.shortcuts[a] = c; scheduleSave(); renderSettingsTab(); }
    });
    $('#sc-reset').onclick = () => { S.user.settings.shortcuts = Object.assign({}, DEFAULT_SHORTCUTS); scheduleSave(); renderSettingsTab(); };
  }
};

/* ===== app ===== */
/* Startup, global events and the resizable sidebar */

/* ----- Resizable sidebar ----- */
const SB = { min: 72, snap: 140, narrow: 190, max: 420, def: 260 };
function applySidebar(w) {
  let width = w, compact;
  if (innerWidth < 760) { width = SB.min; compact = true; }
  else if (w < SB.snap) { width = SB.min; compact = true; }
  else { width = Math.max(SB.narrow, Math.min(SB.max, w)); compact = false; }
  document.documentElement.style.setProperty('--sw', width + 'px');
  $('#app').classList.toggle('compact', compact);
  return width;
}
function bindResizer() {
  const rz = $('#resizer');
  let startX = 0, startW = 0, cur = SB.def;
  rz.addEventListener('pointerdown', e => {
    e.preventDefault();
    startX = e.clientX; startW = $('#side').getBoundingClientRect().width;
    rz.setPointerCapture(e.pointerId); rz.classList.add('drag'); document.body.classList.add('resizing');
  });
  rz.addEventListener('pointermove', e => {
    if (!rz.classList.contains('drag')) return;
    cur = startW + (e.clientX - startX);
    applySidebar(cur);
    applyPanelWidth(panelSt().width);
    paintRows(true);
  });
  const end = () => {
    if (!rz.classList.contains('drag')) return;
    rz.classList.remove('drag'); document.body.classList.remove('resizing');
    S.user.settings.sidebarWidth = cur < SB.snap ? SB.min : Math.max(SB.narrow, Math.min(SB.max, cur));
    scheduleSave();
  };
  rz.addEventListener('pointerup', end);
  rz.addEventListener('pointercancel', end);
  rz.addEventListener('dblclick', () => { S.user.settings.sidebarWidth = SB.def; applySidebar(SB.def); applyPanelWidth(panelSt().width); scheduleSave(); paintRows(true); });
}

/* ----- Events ----- */
function bindEvents() {
  // Menu
  $('#menu').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (!b || !menuState) return;
    const { x, y, items } = menuState;
    const it = items[+b.dataset.i];
    hideMenu();
    const r = it.run && it.run();
    if (Array.isArray(r)) showMenu(x, y, r);
  });
  document.addEventListener('mousedown', e => { if (!e.target.closest('#menu')) hideMenu(); });
  window.addEventListener('blur', hideMenu);
  window.addEventListener('resize', () => {
    hideMenu(); applySidebar(S.user.settings.sidebarWidth); applyPanelWidth(panelSt().width);
    const was = $('#app').classList.contains('rp-open'); syncPanelVisibility();
    if (!was && $('#app').classList.contains('rp-open')) renderPanel();
    paintRows(true);
  });

  // Sidebar
  $('#side').addEventListener('click', e => {
    if (e.target.closest('#newpl')) { const r = e.target.closest('#newpl').getBoundingClientRect(); return plusMenu(r.left, r.bottom + 4); }
    const it = e.target.closest('[data-type]');
    if (!it) return;
    const type = it.dataset.type;
    if (type === 'queue') return toggleQueue();
    const dots = e.target.closest('[data-dots]');
    if (dots) { const r = dots.getBoundingClientRect(); return itemMenu(type, it.dataset.id, r.left, r.bottom + 4); }
    const v = { type, id: it.dataset.id || undefined };
    if (!sameView(S.view, v)) setView(v);
    if (e.detail >= 2) playContext(); // double-click starts the playlist (in shuffle mode if it is on for that playlist)
  });
  $('#side').addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('div[data-type]')) { e.preventDefault(); e.target.click(); }
  });
  $('#side').addEventListener('contextmenu', e => {
    const it = e.target.closest('[data-type="playlist"],[data-type="folder"]');
    if (!it) return;
    e.preventDefault();
    itemMenu(it.dataset.type, it.dataset.id, e.clientX, e.clientY);
  });
  // Drag and drop to reorder playlists and folders in the sidebar
  const lib = $('#lib');
  const clearDrop = () => lib.querySelectorAll('.drop-before,.drop-after,.dragging').forEach(el => el.classList.remove('drop-before', 'drop-after', 'dragging'));
  lib.addEventListener('dragstart', e => {
    const it = e.target.closest('.lib-i'); if (!it) return;
    S.drag = { type: it.dataset.type, id: it.dataset.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', it.dataset.id);
    setTimeout(() => it.classList.add('dragging'), 0);
  });
  lib.addEventListener('dragover', e => {
    if (!S.drag) return;
    const it = e.target.closest('.lib-i');
    if (!it || it.dataset.type !== S.drag.type) return;
    if (!canDrop(S.drag, { type: it.dataset.type, id: it.dataset.id })) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    lib.querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
    const r = it.getBoundingClientRect();
    it.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
  });
  lib.addEventListener('drop', e => {
    if (!S.drag) return;
    const it = e.target.closest('.lib-i');
    if (!it) return;
    const dst = { type: it.dataset.type, id: it.dataset.id };
    if (!canDrop(S.drag, dst)) return;
    e.preventDefault();
    const r = it.getBoundingClientRect();
    const src = S.drag;
    S.drag = null; clearDrop();
    moveLibItem(src, dst, e.clientY > r.top + r.height / 2);
  });
  lib.addEventListener('dragend', () => {
    S.drag = null; clearDrop();
    if (S.pendingSidebar) { S.pendingSidebar = false; renderSidebar(); }
  });
  $('#btn-rescan').addEventListener('click', () => rescan({ manual: true }));
  $('#btn-settings').addEventListener('click', () => openSettings());

  // Song list
  $('#scroller').addEventListener('scroll', () => requestAnimationFrame(() => paintRows(false)));
  $('#colhead').addEventListener('click', e => {
    const b = e.target.closest('[data-sort]');
    if (b && !b.disabled) cycleSort(b.dataset.sort);
  });
  $('#rows').addEventListener('click', e => {
    const r = rowItem(e); if (!r || !r.it) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'play') {
      if (e.detail >= 2) return;
      if (r.it.t.path === S.currentPath) togglePlay(); else playItem(r.i);
    } else if (act === 'more') { const b = e.target.closest('button').getBoundingClientRect(); trackMenu(r.it, b.left - 180, b.bottom + 4); }
    else if (e.detail >= 2) playItem(r.i); // double-click anywhere on the row
    else selectRow(r);
  });
  $('#rows').addEventListener('contextmenu', e => {
    const r = rowItem(e); if (!r || !r.it) return;
    e.preventDefault(); selectRow(r); trackMenu(r.it, e.clientX, e.clientY);
  });

  // Search
  let qTimer = null;
  $('#q').addEventListener('input', e => {
    $('#q-clear').hidden = !e.target.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { S.query = e.target.value.trim(); S.selected = -1; renderMain(); $('#scroller').scrollTop = 0; }, 80);
  });
  $('#q-clear').addEventListener('click', () => { $('#q').value = ''; $('#q').dispatchEvent(new Event('input')); $('#q').focus(); });

  window.addEventListener('beforeunload', () => {
    if (S.currentPath && S.loaded) S.user.settings.last = { path: S.currentPath, pos: audio.currentTime, ctx: S.ctx };
    pocketwave.saveUserSync(S.user);
  });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => e.preventDefault());
  pocketwave.onScanProgress(p => { S.scan = p; if (S.firstLoad) S.firstLoad.update(p); else if (S.scanning) requestAnimationFrame(renderBanner); });
  pocketwave.onMediaKey(mediaCommand);
  pocketwave.onWatchAdded(onWatchAdded);
  pocketwave.onWatchUpdated(onWatchUpdated);
  pocketwave.onWatchRenamed(onWatchRenamed);
  pocketwave.onWatchRemoved(onWatchRemoved);
  pocketwave.onWatchStatus(s => {
    const wasDown = S.syncState && S.syncState.state === 'error';
    S.syncState = s; refreshSyncStatus();
    if (wasDown && s.state === 'listening') rescan({ manual: false }); // the folder is back (e.g. a drive was plugged in again): catch up
  });
}

/* ----- Startup ----- */
function mergeUser(saved) {
  const d = defaultUser();
  const sv = saved.settings || {};
  const u = Object.assign(d, saved);
  const st = Object.assign({}, defaultUser().settings, sv);
  st.panel = Object.assign({}, d.settings.panel, sv.panel || {});
  if (sv.queueWidth && !sv.panel) st.panel.width = sv.queueWidth; // older versions
  st.adv = Object.assign({}, d.settings.adv, sv.adv || {});
  st.bgColors = d.settings.bgColors.map((c, i) => (sv.bgColors && /^#[0-9a-f]{6}$/i.test(sv.bgColors[i] || '')) ? sv.bgColors[i].toLowerCase() : c);
  st.bgCount = Math.max(1, Math.min(5, Math.round(Number(st.bgCount)) || 3));
  if (st.bgMode !== 'custom') st.bgMode = 'auto';
  const dg = defaultUser().settings.gfx;   // (d.settings is replaced by the saved settings above, so take a fresh default)
  st.gfx = Object.assign({}, dg, sv.gfx || {});   // graphics quality: keep only valid values
  for (const [o, def] of Object.entries(GFX_OPTS)) if (!def.vals.some(([v]) => v === st.gfx[o])) st.gfx[o] = dg[o];
  st.gfx.showFps = st.gfx.showFps === 'on' ? 'on' : 'off';
  st.gfx.preset = gfxPresetOf(st.gfx);
  st.shortcuts = Object.assign({}, DEFAULT_SHORTCUTS, sv.shortcuts || {});
  for (const k of ['sorts', 'shuffles']) if (!st[k] || typeof st[k] !== 'object') st[k] = {};
  u.settings = st;
  for (const k of ['playlists', 'pins', 'movedFolders', 'folderOrder', 'hiddenFolders']) if (!Array.isArray(u[k])) u[k] = [];
  for (const k of ['folderPrefs', 'images', 'meta']) if (!u[k] || typeof u[k] !== 'object') u[k] = {};
  // Older versions created an automatic "Listen later" playlist: remove it once, if it is empty
  if ((saved.version || 1) < 3) {
    const gone = u.playlists.filter(p => /^listen later$/i.test(p.name) && !p.tracks.length).map(p => p.id);
    u.playlists = u.playlists.filter(p => !gone.includes(p.id));
    u.pins = u.pins.filter(k => !gone.some(id => k === 'pl:' + id));
  }
  // Features removed in this version
  for (const k of ['speed', 'speedAutoReset', 'outputDevice', 'eq', 'replayGain', 'crossfade', 'gapless', 'autoResume', 'queueWidth']) delete st[k];
  delete st.adv.dupes; delete u.resume; delete u.syncWatch; delete u.favorites; delete st.shortcuts.favorite;   // favorites were removed
  delete u.bookmarks; delete st.shortcuts.bookmark;                                                              // bookmarks were removed
  if ((saved.version || 1) < 7) {                                                                                // the side sections are a little narrower now
    if (st.sidebarWidth === 300) st.sidebarWidth = 260;
    if (st.panel.width === 340) st.panel.width = 300;
  }
  if (!u.recent || !Array.isArray(u.recent.songs) || !Array.isArray(u.recent.ctx)) u.recent = { songs: [], ctx: [] };
  if (!['dark', 'light', 'custom'].includes(st.theme)) st.theme = 'dark';   // "follow system" no longer exists
  u.version = 8;
  return u;
}
async function init() {
  $('#ico-search').innerHTML = ic('search');
  $('#q-clear').innerHTML = ic('close');
  $('#b-prev').innerHTML = ic('prev'); $('#b-next').innerHTML = ic('next');
  $('#b-shuffle').innerHTML = ic('shuffle'); $('#b-queue').innerHTML = ic('queue');
  $('#cover').innerHTML = ic('note');
  $('#btn-rescan').innerHTML = ic('refresh'); $('#btn-settings').innerHTML = ic('gear');
  bindEvents(); bindPlayer(); bindNowPlaying(); bindPanel(); bindHome(); bindShortcuts(); bindResizer();

  let info;
  try { info = await pocketwave.init(); } catch (e) { info = { user: null, library: null, dataDir: '', version: '' }; }
  S.dataDir = info.dataDir; S.version = info.version; S.userName = info.userName || '';
  if (info.user && typeof info.user === 'object') S.user = mergeUser(info.user);
  if (info.library && Array.isArray(info.library.tracks)) setLibrary(info.library.tracks);
  S.rootOk = true;
  applyTheme(); applySidebar(S.user.settings.sidebarWidth); applyPanel();
  updateVolumeUi();
  renderSidebar(); renderBanner(); renderMain(); updatePlayer();
  restoreLast();
  // Monitoring is always on. The first time a folder is read (no saved library yet) a loading popup is shown.
  if (S.user.musicRoot) rescan({ manual: false, first: !S.tracks.length }).then(applyWatch);
  else applyWatch();
}

/* ----- Liquid glass: slow drift of the colored background (38 s forward, 38 s back, ease-in-out) -----
   Driven from here, NOT by a CSS animation: a running CSS animation made scrolling slower even while paused.
   It updates 8 / 12 / 24 times a second (or every frame for "Smooth"), chosen in Settings > Graphics, and does nothing at all while
   scrolling, resizing, with a dialog / menu / Now playing open, with the window hidden, or with the motion Off. ----- */
const LG_K = [[-4, -2, 2], [6, 4, 2.16], [-2, 6, 2.06]];   // x %, y %, scale (no rotation: a rotated layer is very expensive to composite on big windows)
const lgEase = u => {                                                 // CSS ease-in-out: cubic-bezier(.42, 0, .58, 1)
  let lo = 0, hi = 1, s = u;
  for (let i = 0; i < 24; i++) { s = (lo + hi) / 2; const x = 3 * (1 - s) * (1 - s) * s * .42 + 3 * (1 - s) * s * s * .58 + s * s * s; if (x < u) lo = s; else hi = s; }
  return 3 * (1 - s) * s * s + s * s * s;
};
const lgDrift = { t0: performance.now(), busyUntil: 0, timer: 0, raf: 0 };
function lgDriftStep() {
  const el = document.getElementById('lgbg'); if (!el) return;
  const root = document.documentElement;
  if (performance.now() < lgDrift.busyUntil || document.hidden || root.classList.contains('np-open') || document.querySelector('.overlay') || !document.getElementById('menu').hidden) return;
  const t = ((performance.now() - lgDrift.t0) / 1000) % 76, x = t < 38 ? t / 38 : 2 - t / 38;
  const k = Math.min(1, Math.floor(x * 2)), f = lgEase(x * 2 - k), A = LG_K[k], B = LG_K[k + 1], m = i => A[i] + (B[i] - A[i]) * f;
  el.style.transform = `translate3d(${m(0).toFixed(3)}%,${m(1).toFixed(3)}%,0) scale(${m(2).toFixed(4)})`;
}
function lgDriftSet() {   // called whenever the graphics settings change
  clearTimeout(lgDrift.timer); cancelAnimationFrame(lgDrift.raf);
  const mo = S.user.settings.gfx.motion;
  if (mo === 'off') return;
  if (mo === 'smooth') { const loop = () => { lgDriftStep(); lgDrift.raf = requestAnimationFrame(loop); }; loop(); return; }
  const every = { '8': 125, '12': 83, '24': 41 }[mo] || 125;
  const tick = () => { lgDriftStep(); lgDrift.timer = setTimeout(tick, every); };
  tick();
}
(function () {
  const busy = () => { lgDrift.busyUntil = performance.now() + 250; };
  addEventListener('resize', busy, { passive: true });
  addEventListener('scroll', busy, { capture: true, passive: true });
  addEventListener('wheel', busy, { passive: true });
})();

/* ----- FPS counter (Settings > Graphics > Diagnostics) ----- */
function fpsMeter(on) {
  let el = document.getElementById('fps-meter');
  if (!on) { if (el) { el._stop = true; el.remove(); } return; }
  if (el) return;
  el = document.createElement('div'); el.id = 'fps-meter'; el.textContent = '… fps'; document.body.appendChild(el);
  let n = 0, worst = 0, last = performance.now(), t0 = last;
  const f = now => {
    if (el._stop) return;
    n++; worst = Math.max(worst, now - last); last = now;
    if (now - t0 >= 500) { el.textContent = Math.round(n * 1000 / (now - t0)) + ' fps · worst ' + Math.round(worst) + ' ms'; n = 0; worst = 0; t0 = now; }
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}

init();
