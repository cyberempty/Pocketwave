'use strict';

/* ===== player ===== */
/* Playback logic (queue, shuffle, repeat) and the player bar */
const curTrack = () => S.currentPath ? getTrack(S.currentPath) : null;

function setQueue(paths, start, shuffle) {
  S.queue = paths.slice();
  const n = paths.length;
  if (shuffle) {
    S.order = [start, ...shuf([...Array(n).keys()].filter(i => i !== start))];
    S.pos = 0;
  } else { S.order = [...Array(n).keys()]; S.pos = start; }
}
// Starts playing a list. The list's view becomes the "playing context" (highlighted in the sidebar)
function playItems(items, start, view) {
  if (!items || !items.length) return;
  S.ctx = { type: view.type, id: view.id };
  recordContext(view);
  setQueue(items.map(it => it.t.path), start, shuffleOn(view));
  playAt(S.pos);
}
function playContext() {
  if (!S.items || !S.items.length) return;
  const v = curView();
  const ok = S.items.map((it, i) => i).filter(i => isPlayable(S.items[i].t.path));
  if (!ok.length) return toast('None of these songs can be played: their files are missing.', 'err');
  const start = shuffleOn(v) ? ok[Math.floor(Math.random() * ok.length)] : ok[0];
  playItems(S.items, start, v);
}
function playItem(i) {
  const it = S.items[i];
  if (!it) return;
  if (!isPlayable(it.t.path)) return toast(`“${it.t.title}” was not found: the file was deleted or moved outside the synced folder.`, 'err');
  playItems(S.items, i, curView());
}

function playAt(pos, opts) {
  if (pos < 0 || pos >= S.order.length) return;
  if (!isPlayable(S.queue[S.order[pos]])) return toast('That song was not found: its file was deleted or moved.', 'err');
  S.pos = pos;
  startTrack(S.queue[S.order[pos]], false, opts);
}
function startTrack(p, fromQueue, opts) {
  opts = opts || {};
  S.currentPath = p; S.curFromQueue = fromQueue; S.loaded = true; S.switching = true;
  recordPlayed(p);
  statNewPlay();
  S.resumeAt = opts.resumeAt != null ? opts.resumeAt : 0;
  audio.src = toFileUrl(p);
  audio.play().catch(() => {});
  onTrackChange();
}
function onTrackChange() {
  const t = curTrack();
  document.title = t ? `${t.title} – Pocketwave` : 'Pocketwave';
  S.user.settings.last = t ? { path: t.path, pos: 0, ctx: S.ctx } : null;
  updatePlayer(); paintRows(true); setCover(t); renderSidebar(); renderPanel(); updateHeroPlay();
}
function togglePlay() {
  if (!S.currentPath) {
    if (S.userQueue.length) return next(false);
    if (S.items && S.items.length) return playContext();
    return toast('There are no songs to play.');
  }
  if (!S.loaded) { if (S.curFromQueue) startTrack(S.currentPath, true, { resumeAt: S.resumeAt }); else { const at = S.resumeAt; playAt(S.pos, { resumeAt: at }); } return; }
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}
// First playable position starting at "pos" and walking in direction "dir" (missing files are skipped)
function stepFrom(pos, dir) {
  for (let k = pos; k >= 0 && k < S.order.length; k += dir) if (isPlayable(S.queue[S.order[k]])) return k;
  return -1;
}
function next(auto) {
  while (S.userQueue.length) {                       // queued songs go first
    const p = S.userQueue.shift();
    if (isPlayable(p)) { startTrack(p, true); return; }
  }
  if (!S.order.length) { if (auto) stopAtEnd(); return; }
  let k = stepFrom(S.pos + 1, 1);
  if (k >= 0) return playAt(k);
  if (S.user.settings.repeat === 'all') {
    if (S.ctx && shuffleOn(S.ctx)) S.order = shuf([...S.queue.keys()]);
    k = stepFrom(0, 1);
    if (k >= 0) return playAt(k);
  }
  if (auto) stopAtEnd();
}
function stopAtEnd() { audio.pause(); audio.currentTime = 0; updatePlayer(); paintRows(true); updateHeroPlay(); renderSidebar(); }
function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (S.curFromQueue && S.pos >= 0) return playAt(S.pos);
  let k = stepFrom(S.pos - 1, -1);
  if (k < 0 && S.user.settings.repeat === 'all') k = stepFrom(S.order.length - 1, -1);
  if (k < 0) { audio.currentTime = 0; return; }
  playAt(k);
}

// Shuffle belongs to a playlist: it is remembered per playlist, even after closing the program
function toggleShuffle(view) {
  const v = view || S.ctx || S.view, key = viewKey(v);
  const on = !S.user.settings.shuffles[key];
  if (on) S.user.settings.shuffles[key] = true; else delete S.user.settings.shuffles[key];
  if (S.ctx && sameView(S.ctx, v) && S.order.length) {
    const curIdx = S.order[S.pos];
    if (on) { S.order = [curIdx, ...shuf([...S.queue.keys()].filter(i => i !== curIdx))]; S.pos = 0; }
    else { S.order = [...S.queue.keys()]; S.pos = curIdx; }
    renderPanel();
  }
  scheduleSave(); updatePlayer(); updateHeroPlay();
}
function cycleRepeat() {
  const r = S.user.settings.repeat;
  S.user.settings.repeat = r === 'off' ? 'all' : r === 'all' ? 'one' : 'off';
  scheduleSave(); updatePlayer();
}
function restoreLast() {
  const l = S.user.settings.last;
  if (!l || !S.byPath.has(l.path)) return;
  const ctx = l.ctx && l.ctx.type && l.ctx.type !== 'search' ? l.ctx : { type: 'all' };
  const saved = S.view; S.view = ctx;
  let items = currentItems();
  S.view = saved;
  let start = items.findIndex(it => it.t.path === l.path);
  if (start < 0) { S.view = { type: 'all' }; items = currentItems(); S.view = saved; start = items.findIndex(it => it.t.path === l.path); S.ctx = { type: 'all' }; }
  else S.ctx = { type: ctx.type, id: ctx.id };
  if (start < 0) return;
  setQueue(items.map(it => it.t.path), start, shuffleOn(S.ctx));
  S.currentPath = l.path; S.loaded = false; S.curFromQueue = false; S.resumeAt = l.pos || 0;
  document.title = `${S.byPath.get(l.path).title} – Pocketwave`;
  updatePlayer(); setCover(curTrack()); renderSidebar(); renderPanel();
}

/* ----- Listening statistics -----
   Time is counted from the audio clock while a song really plays (seeking, pausing and buffering are not counted).
   Everything stays in the local user file: total time, time per day and, per song, time and plays. */
const dayKey = d => { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function cleanStats(s) {
  const o = { total: 0, plays: 0, days: {}, songs: {}, since: 0 };
  if (!s || typeof s !== 'object') return o;
  const num = v => (Number.isFinite(+v) && +v > 0) ? +v : 0;
  o.total = num(s.total); o.plays = Math.floor(num(s.plays)); o.since = num(s.since);
  const keep = dayKey(new Date(Date.now() - 400 * 864e5));       // about 13 months of daily totals
  for (const [k, v] of Object.entries(s.days || {})) if (/^\d{4}-\d\d-\d\d$/.test(k) && k >= keep && num(v)) o.days[k] = num(v);
  for (const [p, e] of Object.entries(s.songs || {})) {
    if (!e || typeof e !== 'object' || (!num(e.sec) && !num(e.plays))) continue;
    o.songs[p] = { sec: num(e.sec), plays: Math.floor(num(e.plays)), title: String(e.title || ''), artist: String(e.artist || ''), album: String(e.album || ''), dur: num(e.dur) };
  }
  return o;
}
let statLast = -1;
const statBreak = () => { statLast = -1; };
function statNewPlay() { S.playSec = 0; S.playCounted = false; statLast = -1; }
function statTick() {
  if (audio.paused || audio.seeking || !S.currentPath || !S.loaded || S.switching) { statLast = -1; return; }
  const ct = audio.currentTime, d = ct - statLast;
  const prev = statLast;
  statLast = ct;
  if (prev < 0 || !(d > 0 && d < 1.5)) return;          // first tick after a pause, or a jump from seeking: not listening time
  const t = curTrack(), st = S.user.stats;
  if (!t) return;
  if (!st.since) st.since = Date.now();
  st.total += d;
  const k = dayKey();
  st.days[k] = (st.days[k] || 0) + d;
  const e = st.songs[t.path] || (st.songs[t.path] = { sec: 0, plays: 0, title: t.title, artist: t.artist || '', album: t.album || '', dur: t.duration || 0 });
  e.sec += d;
  S.playSec = (S.playSec || 0) + d;
  // A play counts after 30 seconds (or half of a shorter song), like on the big streaming services
  if (!S.playCounted && S.playSec >= Math.min(30, (t.duration || 60) * 0.5)) {
    S.playCounted = true; e.plays++; st.plays++;
    e.title = t.title; e.artist = t.artist || ''; e.album = t.album || ''; e.dur = t.duration || 0;
  }
}

/* ----- Audio events ----- */
onAudio('loadedmetadata', () => {
  if (S.resumeAt > 0 && S.resumeAt < audio.duration) audio.currentTime = S.resumeAt;
  S.resumeAt = 0;
  updateProgress();
});
onAudio('playing', () => { S.switching = false; S.failStreak = 0; if (S.currentPath) S.bad.delete(S.currentPath); });
for (const ev of ['play', 'pause', 'playing', 'emptied']) {
  onAudio(ev, () => { if (ev === 'pause') saveLastPosition(); updatePlayer(); paintRows(true); updateHeroPlay(); renderSidebar(); });
}
onAudio('ended', () => {
  if (S.user.settings.repeat === 'one') { statNewPlay(); audio.currentTime = 0; audio.play().catch(() => {}); }
  else next(true);
});
// Only the last song played is resumed when the program is opened again, from the exact point where it stopped
function saveLastPosition() {
  if (!S.currentPath || !S.loaded || S.switching) return;
  S.user.settings.last = { path: S.currentPath, pos: audio.currentTime, ctx: S.ctx };
  scheduleSave();
}
for (const ev of ['pause', 'seeking', 'emptied', 'waiting']) onAudio(ev, statBreak);
let lastSave = 0, dragging = false;
onAudio('timeupdate', () => {
  statTick();
  if (!dragging) updateProgress();
  const now = Date.now();
  if (now - lastSave > 1000) { lastSave = now; saveLastPosition(); }
});
onAudio('error', async () => {
  S.switching = false;
  if (!S.currentPath || !S.loaded) return;
  const p = S.currentPath, t = getTrack(p);
  const exists = await pocketwave.exists(p);
  S.bad.set(p, exists ? 'unreadable' : 'missing');
  toast(exists ? `Cannot play “${t.title}”: the file is unreadable or damaged.`
               : `“${t.title}” was not found: the file has been moved or deleted.`, 'err');
  S.failStreak++;
  paintRows(true); updatePlayer();
  const more = S.userQueue.length || S.pos + 1 < S.order.length || S.user.settings.repeat === 'all';
  if (more && S.failStreak < S.queue.length + S.userQueue.length + 1 && S.currentPath === p) setTimeout(() => { if (S.currentPath === p) next(true); }, 900);
});

/* ----- Player bar ----- */
const setFill = (el, pct) => el.style.setProperty('--p', pct + '%');
function updatePlayer() {
  const t = curTrack();
  $('#np-title').textContent = t ? t.title : 'Nothing playing';
  $('#np-artist').textContent = t ? (t.artist || 'Unknown artist') : '';
  const playing = S.loaded && !audio.paused;
  $('#b-play').innerHTML = ic(playing ? 'pause' : 'play');
  $('#b-play').title = playing ? 'Pause' : 'Play';
  const set = S.user.settings;
  const sh = shuffleOn(S.ctx || S.view);
  $('#b-shuffle').classList.toggle('on', sh);
  $('#b-shuffle').title = sh ? 'Shuffle: on (this playlist)' : 'Shuffle: off';
  $('#b-repeat').classList.toggle('on', set.repeat !== 'off');
  $('#b-repeat').innerHTML = ic(set.repeat === 'one' ? 'repeat1' : 'repeat');
  $('#b-repeat').title = set.repeat === 'off' ? 'Repeat: off' : set.repeat === 'all' ? 'Repeat: all songs' : 'Repeat: this song';
  $('#b-panel').classList.toggle('on', set.panel.open);
  $('#b-queue').classList.toggle('on', set.panel.open && set.panel.mode === 'queue');
  updateVolumeUi();
  updateProgress();
  updateNowPlaying();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}
// Right time label: the total length, or (after a click on it) the remaining time with a minus sign, for example -2:12
const durLabel = (cur, dur) => S.user.settings.showRemaining ? '-' + fmt(Math.max(0, dur - cur)) : fmt(dur);
function updateProgress() {
  const t = curTrack();
  const dur = audio.duration > 0 && S.loaded ? audio.duration : (t ? t.duration : 0);
  const cur = S.loaded ? audio.currentTime : S.resumeAt;
  $('#t-cur').textContent = fmt(cur);
  $('#t-dur').textContent = durLabel(cur, dur);
  const pct = dur ? Math.min(1000, cur / dur * 1000) : 0;
  const sk = $('#seek');
  if (!dragging) sk.value = pct;
  setFill(sk, pct / 10);
  updateNowPlayingProgress(cur, dur, pct);
  if ('mediaSession' in navigator && dur > 0 && cur <= dur && Date.now() - (updateProgress.t || 0) > 900) {
    updateProgress.t = Date.now();
    try { navigator.mediaSession.setPositionState({ duration: dur, position: Math.max(0, cur), playbackRate: 1 }); } catch (e) { /* ignore */ }
  }
}
function updateVolumeUi() {
  const set = S.user.settings;
  const v = set.muted ? 0 : set.volume;
  engineSetVolume();
  $('#vol').value = Math.round(v * 100);
  setFill($('#vol'), v * 100);
  $('#b-mute').innerHTML = ic(v === 0 ? 'mute' : v < 0.45 ? 'volLow' : 'vol');
  $('#b-mute').title = v === 0 ? 'Unmute' : 'Mute';
  updateNowPlayingVolume(v);
}
function changeVolume(delta) {
  const set = S.user.settings;
  set.muted = false;
  set.volume = Math.max(0, Math.min(1, Math.round((set.volume + delta) * 100) / 100));
  scheduleSave(); updateVolumeUi();
}
async function setCover(t) {
  const tok = ++S.coverToken;
  const el = $('#cover');
  const apply = src => {
    el.style.backgroundImage = src ? `url("${src}")` : '';
    el.innerHTML = src ? '' : ic('note');
    updateMedia(t, src);
    updateDynamicAccent(src);
    fillPanelCover();
    updateNowPlayingCover(src);
  };
  if (!t) return apply(null);
  if (S.coverCache.has(t.path)) return apply(S.coverCache.get(t.path));
  apply(null);
  const src = await coverOf(t.path);
  if (tok === S.coverToken) apply(src);
}
function updateMedia(t, cover) {
  if (!('mediaSession' in navigator) || !t || typeof MediaMetadata === 'undefined') return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: cover ? [{ src: cover }] : [] });
  } catch (e) { /* ignore */ }
}
/* ----- Media keys and operating system controls ----- */
// The keyboard media keys reach the program twice on some systems (system controls + global key): the second one is ignored.
let lastMedia = { g: '', t: 0 };
function mediaCommand(name) {
  const g = name === 'play' || name === 'pause' || name === 'play-pause' ? 'toggle' : name;
  const now = Date.now();
  if (lastMedia.g === g && now - lastMedia.t < 400) return;
  lastMedia = { g, t: now };
  if (name === 'play') { if (audio.paused) togglePlay(); }
  else if (name === 'pause') { if (!audio.paused) audio.pause(); }
  else if (name === 'play-pause') togglePlay();
  else if (name === 'next') next(false);
  else if (name === 'prev') prev();
  else if (name === 'stop') { audio.pause(); audio.currentTime = 0; }
}
// Moves the playback position (value 0..1000); shared by the player bar and the full window "Now playing" screen
function commitSeek(value) {
  dragging = false;
  if (!S.loaded) {
    if (S.currentPath) { const dur = (curTrack() || {}).duration || 0; S.resumeAt = value / 1000 * dur; togglePlay(); }
    return;
  }
  if (audio.duration > 0) audio.currentTime = value / 1000 * audio.duration;
}
function bindPlayer() {
  $('#seek').addEventListener('input', e => {
    dragging = true;
    const dur = audio.duration || (curTrack() || {}).duration || 0;
    $('#t-cur').textContent = fmt(e.target.value / 1000 * dur);
    $('#t-dur').textContent = durLabel(e.target.value / 1000 * dur, dur);
    setFill(e.target, e.target.value / 10);
  });
  $('#seek').addEventListener('change', e => commitSeek(e.target.value));
  const toggleRemaining = () => { S.user.settings.showRemaining = !S.user.settings.showRemaining; scheduleSave(); updateProgress(); updateDurTitle(); };
  const updateDurTitle = () => { $('#t-dur').title = S.user.settings.showRemaining ? 'Click to show the total time' : 'Click to show the remaining time'; };
  $('#t-dur').addEventListener('click', toggleRemaining);
  $('#t-dur').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRemaining(); } });
  updateDurTitle();
  $('#vol').addEventListener('input', e => {
    S.user.settings.volume = e.target.value / 100;
    S.user.settings.muted = e.target.value === '0';
    scheduleSave(); updateVolumeUi();
  });
  $('#b-mute').addEventListener('click', () => {
    const set = S.user.settings;
    if (!set.muted && set.volume === 0) set.volume = 0.5;
    set.muted = !set.muted; scheduleSave(); updateVolumeUi();
  });
  $('#b-play').addEventListener('click', togglePlay);
  $('#b-next').addEventListener('click', () => next(false));
  $('#b-prev').addEventListener('click', prev);
  $('#b-shuffle').addEventListener('click', () => toggleShuffle());
  $('#b-repeat').addEventListener('click', cycleRepeat);
  $('#b-queue').addEventListener('click', () => toggleQueue());
  $('#b-panel').addEventListener('click', () => togglePanel());
  if ('mediaSession' in navigator) {
    const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { /* unsupported */ } };
    h('play', () => mediaCommand('play')); h('pause', () => mediaCommand('pause'));
    h('stop', () => mediaCommand('stop'));
    h('previoustrack', () => mediaCommand('prev')); h('nexttrack', () => mediaCommand('next'));
    h('seekto', d => { if (d.seekTime != null) audio.currentTime = d.seekTime; });
    h('seekbackward', d => { audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10)); });
    h('seekforward', d => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset || 10)); });
  }
}

/* ===== panel ===== */
/* Right side panel: "Now playing" (cover, title, artist, next songs, playlists and folders with their images)
   and "Queue". It can be docked on either side, moved by dragging its header, and resized. */
const PW = { min: 240, max: 560, def: 300 };
const panelSt = () => S.user.settings.panel;

function applyPanelWidth(w) {
  const room = innerWidth - ($('#side').getBoundingClientRect().width || 0) - 24 - 320;
  const width = Math.round(Math.max(PW.min, Math.min(PW.max, Math.max(PW.min, room), w)));
  document.documentElement.style.setProperty('--pw', width + 'px');
  return width;
}
// On narrow windows the panel would cover the song list, so it only opens there when the user asks for it
const panelVisible = () => panelSt().open && (innerWidth >= 900 || S.panelForced);
function syncPanelVisibility() {
  const vis = panelVisible();
  $('#app').classList.toggle('rp-open', vis);
  $('#rpanel').hidden = !vis;
}
function applyPanel() {
  const p = panelSt(), app = $('#app');
  app.classList.toggle('rp-right', p.side !== 'left');
  app.classList.toggle('rp-left', p.side === 'left');
  syncPanelVisibility();
  document.querySelectorAll('.rtab').forEach(b => b.classList.toggle('on', b.dataset.mode === p.mode));
  $('#b-panel').classList.toggle('on', p.open);
  $('#b-queue').classList.toggle('on', p.open && p.mode === 'queue');
  applyPanelWidth(p.width);
  renderPanel();
}
function setPanel(open, mode) {
  const p = panelSt();
  if (open != null) { p.open = open; if (open) S.panelForced = true; }
  if (mode) p.mode = mode;
  scheduleSave(); applyPanel(); renderSidebar();
  setTimeout(() => paintRows(true), 0);
}
const togglePanel = () => setPanel(!panelSt().open);
function toggleQueue() {
  const p = panelSt();
  if (p.open && p.mode === 'queue') setPanel(true, 'now'); else setPanel(true, 'queue');
}

/* ----- "Now playing" view ----- */
function fillPanelCover() {
  const el = $('#np-big'); if (!el) return;
  const t = curTrack(), src = t && S.coverCache.get(t.path);
  el.style.backgroundImage = src ? `url("${src}")` : '';
  el.innerHTML = src ? '' : ic('note');
}
function renderNowTop() {
  const box = $('#np-top'); if (!box) return;
  const t = curTrack();
  if (!t) {
    box.innerHTML = `<div class="np-big" id="np-big">${ic('note')}</div><div class="np-meta"><div class="tx"><div class="np-big-title">Nothing playing</div><div class="np-big-artist">Play a song to see it here</div></div></div>`;
    return;
  }
  box.innerHTML = `<div class="np-big" id="np-big"></div>
    <div class="np-meta"><div class="tx"><div class="np-big-title" title="${esc(t.title)}">${esc(t.title)}</div><div class="np-big-artist">${esc(t.artist || 'Unknown artist')}</div>${t.album ? `<div class="np-big-album">${esc(t.album)}</div>` : ''}</div></div>`;
  fillPanelCover();
}
// The next 5 songs: first the ones added to the queue, then the following songs of the playlist
function upcomingTracks(n) {
  const out = [];
  S.userQueue.forEach((p, i) => { if (out.length < n && isPlayable(p)) out.push({ p, k: 'uq', i }); });
  if (S.ctx && S.order.length) for (let k = S.pos + 1; k < S.order.length && out.length < n; k++) if (isPlayable(S.queue[S.order[k]])) out.push({ p: S.queue[S.order[k]], k: 'ctx', i: k });
  return out;
}
function fillTileCovers(root) {
  root.querySelectorAll('.q-tile[data-cover]').forEach(async el => {
    const src = await coverOf(el.dataset.cover, true);
    if (src && el.isConnected) { el.style.backgroundImage = `url("${src}")`; el.innerHTML = ''; }
  });
}
function renderNext() {
  const p = panelSt();
  if (!panelVisible() || p.mode !== 'now') return;
  const box = $('#np-next'); if (!box) return;
  const up = upcomingTracks(5);
  box.innerHTML = up.length
    ? `<div class="rsec"><span>Next up</span></div>` + up.map(u => qRow(getTrack(u.p), `data-k="${u.k}" data-i="${u.i}"`, { cover: true })).join('')
    : '';
  fillTileCovers(box);
}
function renderPanelCards() {
  const p = panelSt();
  if (!p.open || p.mode !== 'now') return;
  const box = $('#np-cards'); if (!box) return;
  const card = (type, id, name, count) => {
    const url = imgUrl(keyOfItem(type, id)), pl = isShownCtx({ type, id });
    return `<div class="card ${pl ? 'playing' : ''} ${pl && audio.paused ? 'paused' : ''}" data-type="${type}" data-id="${esc(id)}" title="${esc(name)}">
      <div class="card-img ${url ? 'img' : ''}" ${url ? `style="background-image:url('${url}')"` : ''}>${ic('note')}<span class="eqi"><i></i><i></i><i></i></span></div>
      <button class="card-cam" data-cam="1" title="${url ? 'Change image' : 'Add image'}">${ic('camera')}</button>
      <div class="card-name">${esc(name)}</div><div class="card-sub">${plural(count, 'song', 'songs')}</div></div>`;
  };
  const mine = myPlaylistsItems(), fos = unpinnedFolders().map(findFolder).filter(Boolean);
  let h = `<div class="rsec"><span>Playlists</span></div>`;
  h += mine.length ? `<div class="cards">${mine.map(x => { const i = itemInfo(x.type, x.id); return card(x.type, x.id, i.name, i.count); }).join('')}</div>` : `<div class="q-empty">No playlists yet.</div>`;
  h += `<div class="rsec"><span>Folders</span></div>`;
  h += fos.length ? `<div class="cards">${fos.map(f => card('folder', f.id, f.name, f.list.length)).join('')}</div>` : `<div class="q-empty">No folders yet.</div>`;
  box.innerHTML = h;
}

/* ----- Queue view and "Add to queue" ----- */
// Songs added to the queue always play before the rest of the playlist:
// when the current song ends, or when the user skips it.
function addToQueue(paths, after) {
  if (after) S.userQueue.unshift(...paths); else S.userQueue.push(...paths);
  renderSidebar(); renderQueue();
  const t = getTrack(paths[0]);
  previewToast(t, after ? 'Playing next' : `Added to queue${S.userQueue.length > 1 ? ` (#${S.userQueue.length})` : ''}`);
}
function removeFromQueue(i) { S.userQueue.splice(i, 1); renderSidebar(); renderQueue(); }
function clearQueue() { S.userQueue = []; renderSidebar(); renderQueue(); }
function jumpQueue(i) { const [p] = S.userQueue.splice(i, 1); startTrack(p, true); }
function qRow(t, attrs, opts) {
  opts = opts || {};
  return `<div class="q-row ${opts.cur ? 'cur' : ''}" ${attrs} title="${esc(t.path)}">
    <div class="q-tile" ${opts.cover ? `data-cover="${esc(t.path)}"` : ''}>${ic('note')}</div>
    <div class="q-txt"><div class="q-t">${esc(t.title)}</div><div class="q-a">${esc(t.artist || 'Unknown artist')}</div></div>
    ${opts.remove ? `<button class="q-x" data-qact="rm" title="Remove from queue">${ic('close')}</button>` : ''}
  </div>`;
}
function queueHtml() {
  const cur = curTrack();
  let h = `<div class="q-sec">Now playing</div>`;
  h += cur ? qRow(cur, 'data-k="now"', { cur: true, cover: true }) : `<div class="q-empty">Nothing is playing.</div>`;
  h += `<div class="q-sec"><span>Next in queue</span>${S.userQueue.length ? '<button class="q-clear" data-qact="clear">Clear queue</button>' : ''}</div>`;
  if (S.userQueue.length) S.userQueue.forEach((p, i) => { h += qRow(getTrack(p), `data-k="uq" data-i="${i}"`, { remove: true, cover: i < 8 }); });
  else h += `<div class="q-empty">Use “Add to queue” on a song. It will play right after the current one.</div>`;
  if (S.ctx && S.order.length) {
    const end = Math.min(S.order.length, S.pos + 1 + 100);
    let up = '';
    for (let k = S.pos + 1; k < end; k++) up += qRow(getTrack(S.queue[S.order[k]]), `data-k="ctx" data-i="${k}"`);
    if (up) h += `<div class="q-sec">Next from ${esc(viewTitle(S.ctx))}</div>` + up;
  }
  return h;
}
function renderQueue() { const p = panelSt(); if (!p.open) return; if (p.mode === 'queue') renderPanel(); else renderNext(); }

function renderPanel() {
  const p = panelSt();
  if (!panelVisible()) return;
  const body = $('#rbody');
  if (p.mode === 'queue') {
    body.innerHTML = queueHtml();
    fillTileCovers(body);
    return;
  }
  body.innerHTML = '<div id="np-top"></div><div id="np-next"></div><div id="np-cards"></div>';
  renderNowTop(); renderNext(); renderPanelCards();
  const t = curTrack();
  if (t && !S.coverCache.has(t.path)) coverOf(t.path).then(fillPanelCover);
}

function bindPanel() {
  $('#r-close').innerHTML = ic('close');
  $('#b-panel').innerHTML = ic('panel');
  document.querySelectorAll('.rtab').forEach(b => b.addEventListener('click', () => setPanel(true, b.dataset.mode)));
  $('#r-close').addEventListener('click', () => setPanel(false));

  // Move the panel: drag its header to the left or right half of the window
  const head = $('#rhead');
  let st = null;
  const sideAt = x => x < innerWidth / 2 ? 'left' : 'right';
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || e.button !== 0) return;
    st = { x: e.clientX, y: e.clientY, moved: false };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', e => {
    if (!st) return;
    if (!st.moved && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 8) { st.moved = true; $('#dropzones').hidden = false; document.body.classList.add('moving'); }
    if (st.moved) document.querySelectorAll('#dropzones .dz').forEach(z => z.classList.toggle('on', z.dataset.side === sideAt(e.clientX)));
  });
  const endDrag = e => {
    if (!st) return;
    const was = st; st = null;
    if (!was.moved) return;
    $('#dropzones').hidden = true; document.body.classList.remove('moving');
    const side = sideAt(e.clientX);
    if (side !== panelSt().side) { panelSt().side = side; scheduleSave(); applyPanel(); paintRows(true); }
  };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);

  // Resize: drag the edge that faces the main area (double-click restores the default width)
  const rz = $('#rresizer');
  let startX = 0, startW = 0, cur = PW.def;
  rz.addEventListener('pointerdown', e => {
    e.preventDefault();
    startX = e.clientX; startW = $('#rpanel').getBoundingClientRect().width; cur = startW;
    rz.setPointerCapture(e.pointerId); rz.classList.add('drag'); document.body.classList.add('resizing');
  });
  rz.addEventListener('pointermove', e => {
    if (!rz.classList.contains('drag')) return;
    const dx = e.clientX - startX;
    cur = applyPanelWidth(panelSt().side === 'left' ? startW + dx : startW - dx);
    paintRows(true);
  });
  const end = () => {
    if (!rz.classList.contains('drag')) return;
    rz.classList.remove('drag'); document.body.classList.remove('resizing');
    panelSt().width = cur; scheduleSave();
  };
  rz.addEventListener('pointerup', end);
  rz.addEventListener('pointercancel', end);
  rz.addEventListener('dblclick', () => { panelSt().width = PW.def; applyPanelWidth(PW.def); scheduleSave(); paintRows(true); });

  // Content
  const body = $('#rbody');
  body.addEventListener('click', e => {
    if (e.target.closest('[data-qact="clear"]')) return clearQueue();
    const qrow = e.target.closest('.q-row');
    if (qrow) {
      const i = +qrow.dataset.i;
      if (e.target.closest('[data-qact="rm"]')) return removeFromQueue(i);
      if (qrow.dataset.k === 'uq') jumpQueue(i);
      else if (qrow.dataset.k === 'ctx') playAt(i);
      else if (qrow.dataset.k === 'now') togglePlay();
      return;
    }
    const card = e.target.closest('.card');
    if (card) {
      const type = card.dataset.type, id = card.dataset.id;
      if (e.target.closest('[data-cam]')) { const r = e.target.closest('[data-cam]').getBoundingClientRect(); return photoMenu(type, id, r.left, r.bottom + 4); }
      const v = { type, id };
      if (!sameView(S.view, v)) setView(v);
      if (e.detail >= 2) playContext();
    }
  });
  body.addEventListener('contextmenu', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    itemMenu(card.dataset.type, card.dataset.id, e.clientX, e.clientY);
  });
}

/* ===== nowplaying ===== */
/* "Now playing" screen.
   Opens when the cover in the right panel is double-clicked. It fills only the program window (the window size does not
   change); the button in the bottom right corner switches the whole program to full screen and back.
   Everything uses the existing player: it only shows the current song and calls the same functions as the player bar. */
let npOpen = false, npLayer = 0, npCoverSrc = null;

const npEl = () => $('#nowplaying');

/* Like on YouTube: after a few seconds without moving the mouse, the cursor and the close / full-screen buttons
   fade away (windowed and full screen alike); any movement brings them back. */
const NP_IDLE_MS = 3000;
let npIdleTimer = null, npLastX = -1, npLastY = -1;
function npWake() {
  const el = npEl(); if (!el) return;
  el.classList.remove('idle');
  clearTimeout(npIdleTimer);
  if (!npOpen) return;
  npIdleTimer = setTimeout(() => {
    // while the pointer rests on one of the two buttons they stay visible
    if (npOpen && !el.querySelector('.npf-close:hover, .npf-full:hover')) el.classList.add('idle');
    else if (npOpen) npWake();
  }, NP_IDLE_MS);
}

function openNowPlaying() {
  if (npOpen || !curTrack()) return;
  npOpen = true;
  document.documentElement.classList.add('np-open');   // the glass interface underneath stops drawing (see liquidglass.css)
  npEl().hidden = false;
  npWake();
  requestAnimationFrame(() => npEl().classList.add('show'));
  updateNowPlaying(true); updateVolumeUi(); updateProgress();
  $('#npf-play').focus({ preventScroll: true });
}
function closeNowPlaying() {
  if (!npOpen) return;
  npOpen = false;
  document.documentElement.classList.remove('np-open');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  npEl().classList.remove('show', 'idle');
  clearTimeout(npIdleTimer);
  npEl().hidden = true;
}
function toggleNowPlayingFullScreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => toast('Full screen is not available', 'err'));
}

// Cross-fades the blurred background between two layers when the cover changes
function npSetBackground(src) {
  const next = $(npLayer ? '#npf-bg-a' : '#npf-bg-b'), cur = $(npLayer ? '#npf-bg-b' : '#npf-bg-a');
  next.style.backgroundImage = src ? `url("${src}")` : '';
  next.classList.add('on'); cur.classList.remove('on');
  npLayer = 1 - npLayer;
}
function updateNowPlayingCover(src) {
  npCoverSrc = src || null;
  if (!npOpen) return;
  const el = $('#npf-cover');
  el.style.backgroundImage = src ? `url("${src}")` : '';
  el.innerHTML = src ? '' : ic('note');
  npSetBackground(src);
}
function updateNowPlayingProgress(cur, dur, pct) {
  if (!npOpen) return;
  const sk = $('#npf-seek');
  if (!npSeeking) sk.value = pct;
  setFill(sk, pct / 10);
  if (!npSeeking) { $('#npf-cur').textContent = fmt(cur); $('#npf-rem').textContent = '-' + fmt(Math.max(0, dur - cur)); }
}
function updateNowPlayingVolume(v) {
  if (!npOpen) return;
  $('#npf-volume').value = Math.round(v * 100);
  setFill($('#npf-volume'), v * 100);
  $('#npf-mute').innerHTML = ic(v === 0 ? 'mute' : 'volLow');
  $('#npf-mute').title = v === 0 ? 'Unmute' : 'Mute';
}
// Refreshes everything (called when the song, the play state or the volume changes)
function updateNowPlaying(force) {
  if (!npOpen) return;
  const t = curTrack();
  if (!t) return closeNowPlaying();
  const same = npEl().dataset.path === t.path;
  npEl().dataset.path = t.path;
  $('#npf-title').textContent = t.title;
  $('#npf-artist').textContent = t.artist || 'Unknown artist';
  const playing = S.loaded && !audio.paused;
  npEl().classList.toggle('paused', !playing);
  $('#npf-play').innerHTML = ic(playing ? 'pause' : 'play');
  $('#npf-play').title = playing ? 'Pause' : 'Play';
  if (force || !same) updateNowPlayingCover(npCoverSrc = S.coverCache.get(t.path) || null);
}

let npSeeking = false;
function bindNowPlaying() {
  $('#npf-close').innerHTML = ic('close');
  $('#npf-prev').innerHTML = ic('rewind');
  $('#npf-next').innerHTML = ic('ffwd');
  $('#npf-vol-max').innerHTML = ic('vol');
  $('#npf-full').innerHTML = ic('expand');

  // Two quick clicks (double-click) on the cover of the right panel
  document.addEventListener('click', e => {
    if (e.detail === 2 && e.target.closest && e.target.closest('#np-big')) openNowPlaying();
  });
  npEl().addEventListener('mousemove', e => {
    if (e.clientX === npLastX && e.clientY === npLastY) return;   // ignore events without real movement
    npLastX = e.clientX; npLastY = e.clientY; npWake();
  });
  npEl().addEventListener('mousedown', npWake);
  $('#npf-close').addEventListener('click', closeNowPlaying);
  $('#npf-full').addEventListener('click', toggleNowPlayingFullScreen);
  document.addEventListener('fullscreenchange', () => {
    const full = !!document.fullscreenElement;
    $('#npf-full').innerHTML = ic(full ? 'collapse' : 'expand');
    $('#npf-full').title = full ? 'Exit full screen' : 'Full screen';
  });
  document.addEventListener('keydown', e => {
    if (npOpen) npWake();
    if (npOpen && e.key === 'Escape') { e.preventDefault(); closeNowPlaying(); }
  });

  $('#npf-play').addEventListener('click', togglePlay);
  $('#npf-next').addEventListener('click', () => next(false));
  $('#npf-prev').addEventListener('click', prev);

  const seek = $('#npf-seek');
  seek.addEventListener('input', e => {
    npSeeking = true;
    const dur = audio.duration || (curTrack() || {}).duration || 0, t = e.target.value / 1000 * dur;
    $('#npf-cur').textContent = fmt(t);
    $('#npf-rem').textContent = '-' + fmt(Math.max(0, dur - t));
    setFill(e.target, e.target.value / 10);
  });
  seek.addEventListener('change', e => { npSeeking = false; commitSeek(e.target.value); });

  $('#npf-volume').addEventListener('input', e => {
    S.user.settings.volume = e.target.value / 100;
    S.user.settings.muted = e.target.value === '0';
    scheduleSave(); updateVolumeUi();
  });
  $('#npf-mute').addEventListener('click', () => $('#b-mute').click());
}
