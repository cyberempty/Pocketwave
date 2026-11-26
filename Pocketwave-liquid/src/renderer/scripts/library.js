'use strict';

/* ===== library ===== */
/* Sidebar, song list, playlists and library scanning */

/* ---------- Sorting, searching, current list ---------- */
// While something is typed in the search box, the whole library is searched, whatever list is open
const curView = () => S.query ? { type: 'search' } : S.view;
const searchPool = () => [...S.all, ...S.tracks.filter(t => t.extra)];
// The search results have no fixed order by default: they are ordered by how well they match
const defaultSort = () => { const t = curView().type; return (t === 'all' || t === 'folder') ? { key: 'title', dir: 1 } : null; };
// Search box inside a playlist or folder: looks only at the songs of that list
const listFilterOn = () => !S.query && !!S.listQuery && (S.view.type === 'playlist' || S.view.type === 'folder');
function getSort() {
  const s = S.user.settings.sorts, k = viewKey(curView());
  return k in s ? s[k] : defaultSort();
}
function cycleSort(key) {
  const cur = getSort();
  let next;
  if (!cur || cur.key !== key) next = { key, dir: 1 };
  else if (cur.dir === 1) next = { key, dir: -1 };
  else next = defaultSort() ? { key, dir: 1 } : null;
  S.user.settings.sorts[viewKey(curView())] = next;
  scheduleSave();
  renderMain(true);
}
function baseItems() {
  const v = curView();
  if (v.type === 'search') return searchPool().map(t => ({ t }));
  if (v.type === 'all') return S.all.map(t => ({ t }));
  if (v.type === 'folder') { const f = findFolder(v.id); return (f ? f.list : []).map(t => ({ t })); }
  if (v.type === 'playlist') { const pl = findPl(v.id); return pl ? pl.tracks.map(p => ({ t: getTrack(p) })) : []; }
  return [];
}
function currentItems() {
  let items = baseItems();
  const terms = queryTerms(S.query || (listFilterOn() ? S.listQuery : ''));
  if (terms.length) {
    items = items.map(it => { it.sc = searchScore(it.t, terms); return it; }).filter(it => it.sc > 0);
  }
  const s = getSort();
  if (!s && terms.length) {
    // Same score (e.g. all the songs of one artist): grouped by artist, then album and track number, then title
    items.sort((a, b) => (b.sc - a.sc) || coll.compare(a.t.artist || '', b.t.artist || '') || coll.compare(a.t.album || '', b.t.album || '')
      || ((a.t.track || 0) - (b.t.track || 0)) || coll.compare(a.t.title || '', b.t.title || ''));
  } else if (s) {
    const { key, dir } = s;
    const val = t => key === 'title' ? t.title : key === 'artist' ? t.artist : t.album;
    items.sort((a, b) => {
      if (key === 'duration') return dir * ((a.t.duration || 0) - (b.t.duration || 0));
      const va = val(a.t) || '', vb = val(b.t) || '';
      if (!va !== !vb) return va ? -1 : 1; // empty values go last
      let r = coll.compare(va, vb);
      if (r === 0 && key === 'album') r = (a.t.track || 0) - (b.t.track || 0);
      if (r === 0) r = coll.compare(a.t.title, b.t.title);
      return dir * r;
    });
  }
  return items;
}
// Playlists and folders whose name matches the search
function searchGroups() {
  const terms = queryTerms(S.query);
  if (!terms.length) return { playlists: [], folders: [] };
  const hit = name => { const k = norm(name); return terms.every(w => k.includes(w)); };
  return { playlists: S.user.playlists.filter(p => hit(p.name)), folders: S.folders.filter(f => hit(f.name)) };
}
function setView(v) {
  S.view = v; S.query = ''; S.listQuery = ''; S.selected = -1;
  $('#q').value = ''; $('#q-clear').hidden = true;
  renderSidebar(); renderMain(true); updatePlayer();
  $('#scroller').scrollTop = 0;
}

/* ---------- Sidebar ---------- */
const isActiveCtx = v => !!S.ctx && S.loaded && sameView(S.ctx, v);
// Used only to draw the "playing" highlight and animation: it also covers the song restored when the app is reopened (paused, not started yet)
const isShownCtx = v => !!S.ctx && !!S.currentPath && sameView(S.ctx, v);

function navBtn(type, icon, label, count) {
  const v = { type };
  const on = sameView(S.view, v);
  const pl = isShownCtx(v);
  return `<button class="nav-i ${on ? 'on' : ''} ${pl ? 'playing' : ''}" data-type="${type}" title="${esc(label)}">${ic(icon)}<span class="l">${esc(label)}</span>${count ? `<span class="n">${count}</span>` : ''}</button>`;
}
function libItem(type, id, label, count, pinned) {
  const v = { type, id };
  const tileUrl = imgUrl(keyOfItem(type, id));
  const on = sameView(S.view, v);
  const pl = isShownCtx(v);
  return `<div class="nav-i lib-i has-dots ${on ? 'on' : ''} ${pl ? 'playing' : ''} ${pl && audio.paused ? 'paused' : ''} ${pinned ? 'pinned' : ''}" role="button" tabindex="0" draggable="true" data-type="${type}" data-id="${esc(id)}" title="${esc(label)}">
    <span class="tile ${tileUrl ? 'img' : ''}" ${tileUrl ? `style="background-image:url('${tileUrl}')"` : ''}>${ic('note')}</span>
    <span class="txt"><span class="lrow"><span class="l">${esc(label)}</span>${pinned ? `<span class="pinmark" title="Pinned">${ic('pin')}</span>` : ''}</span><span class="sub">${plural(count, 'song', 'songs')}</span></span>
    <span class="eqi"><i></i><i></i><i></i></span>
    <button class="dots" data-dots="1" title="More options" tabindex="-1">${ic('more')}</button>
  </div>`;
}

/* ---- Order and pins: pinned items stay at the top of their own section ---- */
const keyOfItem = (type, id) => type === 'all' ? 'all' : (type === 'playlist' ? 'pl:' : 'fo:') + id;
const isPinned = (type, id) => S.user.pins.includes(keyOfItem(type, id));

/* ---- What is shown where ----
   "My playlists": pinned items first (playlists AND folders, in pin order), then the other playlists,
   then the folders that were moved there with "Move to playlist" (without being pinned).
   "Folders": the folders that are neither pinned nor moved. Pinning a folder therefore adds it to "My playlists". */
function pinnedItems() {
  const out = [];
  for (const k of S.user.pins) {
    if (k.startsWith('pl:') && findPl(k.slice(3))) out.push({ type: 'playlist', id: k.slice(3) });
    else if (k.startsWith('fo:') && findFolder(k.slice(3))) out.push({ type: 'folder', id: k.slice(3) });
  }
  return out;
}
const unpinnedPlaylists = () => S.user.playlists.filter(p => !isPinned('playlist', p.id)).map(p => p.id);
function allFolderIds() {   // all folders in the user's order (then alphabetical)
  const idx = new Map((S.user.folderOrder || []).map((k, i) => [k, i]));
  return S.folders.map((f, n) => ({ id: f.id, n }))
    .sort((a, b) => ((idx.has(a.id) ? idx.get(a.id) : 1e9) - (idx.has(b.id) ? idx.get(b.id) : 1e9)) || a.n - b.n).map(x => x.id);
}
const movedFolderIds = () => (S.user.movedFolders || []).filter(id => findFolder(id));
const isMoved = id => movedFolderIds().includes(id);
const movedUnpinnedFolders = () => movedFolderIds().filter(id => !isPinned('folder', id));
const unpinnedFolders = () => allFolderIds().filter(id => !isPinned('folder', id) && !isMoved(id));
const myPlaylistsItems = () => [...pinnedItems(), ...unpinnedPlaylists().map(id => ({ type: 'playlist', id })), ...movedUnpinnedFolders().map(id => ({ type: 'folder', id }))];
function itemInfo(type, id) {
  if (type === 'playlist') { const p = findPl(id); return { name: p.name, count: p.tracks.length }; }
  const f = findFolder(id); return { name: f.name, count: f.list.length };
}

// Order inside a group: pinned items follow the pin order; unpinned ones follow their own list
function siblingKeys(type, id) {
  if (isPinned(type, id)) return pinnedItems().map(i => keyOfItem(i.type, i.id));
  if (type === 'folder' && isMoved(id)) return movedUnpinnedFolders().map(x => keyOfItem('folder', x));
  return (type === 'playlist' ? unpinnedPlaylists() : unpinnedFolders()).map(x => keyOfItem(type, x));
}
function swapIn(list, a, b) { const i = list.indexOf(a), j = list.indexOf(b); [list[i], list[j]] = [list[j], list[i]]; }
function canMove(type, id, delta) {
  const list = siblingKeys(type, id);
  return list[list.indexOf(keyOfItem(type, id)) + delta] !== undefined;
}
function moveBy(type, id, delta) {
  if (!canMove(type, id, delta)) return;
  const me = keyOfItem(type, id), list = siblingKeys(type, id), other = list[list.indexOf(me) + delta];
  if (isPinned(type, id)) {
    const pins = pinnedItems().map(i => keyOfItem(i.type, i.id)); swapIn(pins, me, other); S.user.pins = pins;
  } else if (type === 'folder' && isMoved(id)) {
    const ids = movedFolderIds().map(x => 'fo:' + x); swapIn(ids, me, other);
    S.user.movedFolders = ids.map(k => k.slice(3));
  } else if (type === 'playlist') {
    const ids = S.user.playlists.map(p => 'pl:' + p.id); swapIn(ids, me, other);
    S.user.playlists = ids.map(k => findPl(k.slice(3)));
  } else {
    const ids = allFolderIds().map(x => 'fo:' + x); swapIn(ids, me, other);
    S.user.folderOrder = ids.map(k => k.slice(3));
  }
  scheduleSave(); renderSidebar();
}
// Drag and drop. Dropping on a pinned item pins the moved one (and puts it there);
// dropping on an unpinned item of the same kind unpins it and puts it there.
function canDrop(src, dst) { return isPinned(dst.type, dst.id) || src.type === dst.type; }
function moveLibItem(src, dst, after) {
  if (src.type === dst.type && src.id === dst.id) return;
  if (!canDrop(src, dst)) return;
  const sk = keyOfItem(src.type, src.id), dk = keyOfItem(dst.type, dst.id);
  if (isPinned(dst.type, dst.id)) {
    const pins = pinnedItems().map(i => keyOfItem(i.type, i.id)).filter(k => k !== sk);
    let at = pins.indexOf(dk); if (after) at++;
    pins.splice(at, 0, sk); S.user.pins = pins;
  } else {
    S.user.pins = S.user.pins.filter(k => k !== sk);
    if (src.type === 'playlist') {
      const ids = S.user.playlists.map(p => p.id).filter(x => x !== src.id);
      let at = ids.indexOf(dst.id); if (after) at++;
      ids.splice(at, 0, src.id); S.user.playlists = ids.map(findPl);
    } else if (isMoved(dst.id)) {                       // dropped on a folder that lives in "My playlists"
      const ids = movedFolderIds().filter(x => x !== src.id);
      let at = ids.indexOf(dst.id); if (after) at++;
      ids.splice(at, 0, src.id); S.user.movedFolders = ids;
    } else {                                            // dropped in the "Folders" section
      S.user.movedFolders = movedFolderIds().filter(x => x !== src.id);
      const ids = allFolderIds().filter(x => x !== src.id);
      let at = ids.indexOf(dst.id); if (after) at++;
      ids.splice(at, 0, src.id); S.user.folderOrder = ids;
    }
  }
  scheduleSave(); renderSidebar();
}
function togglePin(v) {
  const k = keyOfItem(v.type, v.id);
  if (S.user.pins.includes(k)) S.user.pins = S.user.pins.filter(x => x !== k);
  else S.user.pins.unshift(k);   // newly pinned items go to the top of "My playlists"
  scheduleSave(); renderSidebar();
}
// "Move to playlist": the folder is listed in "My playlists" without being pinned to the top
function moveFolderToPlaylists(id) {
  const f = findFolder(id); if (!f) return;
  S.user.movedFolders = [...movedFolderIds().filter(x => x !== id), id];
  scheduleSave(); renderSidebar();
  toast(`“${f.name}” moved to My playlists`, 'ok');
}
// Puts a moved folder back in the "Folders" section
function moveFolderBack(id) {
  const f = findFolder(id); if (!f) return;
  S.user.movedFolders = movedFolderIds().filter(x => x !== id);
  S.user.pins = S.user.pins.filter(k => k !== 'fo:' + id);
  scheduleSave(); renderSidebar();
  toast(`“${f.name}” moved back to Folders`, 'ok');
}
function renderSidebar() {
  if (S.drag) { S.pendingSidebar = true; return; } // do not rebuild the list while an item is being dragged
  $('#nav').innerHTML =
    navBtn('home', 'home', 'Home', 0) +
    navBtn('stats', 'chart', 'Statistics', 0) +
    navBtn('all', 'note', 'All songs', S.all.length);
  let h = `<div class="sec-h"><span>My playlists</span><button id="newpl" class="ibtn" title="Create a playlist">${ic('plus')}</button></div>`;
  const mine = myPlaylistsItems();
  if (!mine.length) h += `<div class="hide-narrow" style="padding:4px 14px;color:var(--tx3);font-size:12.5px">No playlists yet</div>`;
  for (const it of mine) { const i = itemInfo(it.type, it.id); h += libItem(it.type, it.id, i.name, i.count, isPinned(it.type, it.id)); }
  h += `<div class="sec-h"><span>Folders</span></div>`;
  const folders = unpinnedFolders();
  if (!folders.length) h += `<div class="hide-narrow" style="padding:4px 14px;color:var(--tx3);font-size:12.5px">${S.folders.length ? 'All folders are in My playlists' : 'No folders yet'}</div>`;
  for (const id of folders) { const i = itemInfo('folder', id); h += libItem('folder', id, i.name, i.count, false); }
  $('#lib').innerHTML = h;
  $('#btn-rescan').classList.toggle('spin', S.scanning);
  renderPanelCards();
  refreshHomePlaying();
}
function itemMenu(type, id, x, y) {
  if (type === 'playlist') return playlistMenu(id, x, y);
  if (type === 'folder') return folderMenu(id, x, y);
}

/* ---------- Manual playlists and folder playlists ---------- */
const uniqueName = base => { let n = base, i = 2; while (S.user.playlists.some(p => p.name === n)) n = `${base} (${i++})`; return n; };
async function newPlaylist(thenAdd) {
  const name = await askText('New playlist', 'Playlist name', '');
  if (!name) return null;
  const pl = { id: uid(), name, tracks: [] };
  S.user.playlists.push(pl);
  if (thenAdd) pl.tracks.push(...thenAdd);
  scheduleSave(); renderSidebar();
  if (thenAdd) toast(`Added to “${name}”`, 'ok');
  return pl;
}
function plusMenu(x, y) {
  showMenu(x, y, [
    { label: 'New playlist…', run: () => newPlaylist() },
    { label: 'Import playlist (M3U / M3U8)…', run: () => importPlaylist() }
  ]);
}
function playlistMenu(id, x, y) {
  const pl = findPl(id);
  if (!pl) return;
  const v = { type: 'playlist', id };
  showMenu(x, y, [
    { label: 'Play', run: () => { setView(v); playContext(); } },
    { label: isPinned('playlist', id) ? 'Unpin' : 'Pin to top', run: () => togglePin(v) },
    { label: 'Move up', disabled: !canMove('playlist', id, -1), run: () => moveBy('playlist', id, -1) },
    { label: 'Move down', disabled: !canMove('playlist', id, 1), run: () => moveBy('playlist', id, 1) },
    { label: 'Export as M3U8…', run: () => exportPlaylist('playlist', id) },
    { sep: true },
    { label: 'Edit', run: () => openEditDialog('playlist', id) },
    { label: 'Delete', danger: true, run: () => deletePlaylist(id) }
  ]);
}
function folderMenu(id, x, y) {
  const f = findFolder(id);
  if (!f) return;
  const v = { type: 'folder', id };
  showMenu(x, y, [
    { label: 'Play', run: () => { setView(v); playContext(); } },
    { label: isPinned('folder', id) ? 'Unpin' : 'Pin to top', run: () => togglePin(v) },
    isMoved(id) || isPinned('folder', id)
      ? { label: 'Move to folders', run: () => moveFolderBack(id) }
      : { label: 'Move to playlist', run: () => moveFolderToPlaylists(id) },
    { label: 'Move up', disabled: !canMove('folder', id, -1), run: () => moveBy('folder', id, -1) },
    { label: 'Move down', disabled: !canMove('folder', id, 1), run: () => moveBy('folder', id, 1) },
    { label: 'Show folder path', run: () => showFolderPath(f) },
    { label: 'Export as M3U8…', run: () => exportPlaylist('folder', id) },
    { sep: true },
    { label: 'Edit', run: () => openEditDialog('folder', id) },
    { label: 'Delete', danger: true, run: () => hideFolder(id) }
  ]);
}

/* ---- Photos of playlists and folders (cropped, compressed to WebP, then stored in PocketwaveData/images) ---- */
const PHOTO_OUT = 768, CROP_VIEW = 320;
// Lets the user move and resize the picture inside a square frame; resolves with the compressed bytes (or null if cancelled)
async function cropPhoto(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes]));
  const st = { z: 1, x: 0, y: 0 };                                   // zoom (1 = the picture just covers the frame) and offset of its center, in frame pixels
  const base = Math.max(CROP_VIEW / bmp.width, CROP_VIEW / bmp.height);
  const clamp = () => {
    const w = bmp.width * base * st.z, h = bmp.height * base * st.z;
    st.x = Math.max(-(w - CROP_VIEW) / 2, Math.min((w - CROP_VIEW) / 2, st.x));
    st.y = Math.max(-(h - CROP_VIEW) / 2, Math.min((h - CROP_VIEW) / 2, st.y));
  };
  const draw = (cv, size) => {
    const k = size / CROP_VIEW, x = cv.getContext('2d'), w = bmp.width * base * st.z * k, h = bmp.height * base * st.z * k;
    x.fillStyle = '#121212'; x.fillRect(0, 0, size, size);
    x.drawImage(bmp, size / 2 + st.x * k - w / 2, size / 2 + st.y * k - h / 2, w, h);
  };
  const res = await modal({
    title: 'Adjust photo', cls: 'crop',
    body: `<div class="crop-box" id="cr-box"><canvas id="cr-cv" width="${CROP_VIEW}" height="${CROP_VIEW}"></canvas></div>
      <div class="crop-ctl"><span>Size</span><input type="range" id="cr-z" min="100" max="400" value="100" aria-label="Photo size"><button class="btn sm" id="cr-reset">Reset</button></div>
      <div class="hint">Drag the picture to move it. Use the slider or the mouse wheel to make it bigger or smaller.</div>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Use photo', primary: true, value: 'ok' }],
    onOpen: ov => {
      const cv = ov.querySelector('#cr-cv'), z = ov.querySelector('#cr-z');
      const paint = () => { clamp(); draw(cv, CROP_VIEW); z.value = Math.round(st.z * 100); };
      let drag = null;
      cv.onpointerdown = e => { drag = { px: e.clientX, py: e.clientY, x: st.x, y: st.y }; cv.setPointerCapture(e.pointerId); };
      cv.onpointermove = e => { if (!drag) return; st.x = drag.x + e.clientX - drag.px; st.y = drag.y + e.clientY - drag.py; paint(); };
      cv.onpointerup = cv.onpointercancel = () => { drag = null; };
      cv.onwheel = e => { e.preventDefault(); st.z = Math.max(1, Math.min(4, st.z * (e.deltaY < 0 ? 1.08 : 1 / 1.08))); paint(); };
      z.oninput = () => { st.z = z.value / 100; paint(); };
      ov.querySelector('#cr-reset').onclick = () => { st.z = 1; st.x = st.y = 0; paint(); };
      paint();
    }
  });
  if (res !== 'ok') { bmp.close && bmp.close(); return null; }
  const c = document.createElement('canvas'); c.width = c.height = PHOTO_OUT;
  draw(c, PHOTO_OUT); bmp.close && bmp.close();
  let blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.82));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));   // very old Chromium: JPEG instead
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: blob.type === 'image/webp' ? 'webp' : 'jpg' };
}
// Lets the user pick a picture, crop it and save it; returns the name of the stored (compressed) file, or null
async function pickPhoto() {
  const r = await pocketwave.pickImage();
  if (!r) return null;
  if (!r.ok) { toast('Could not use that photo: ' + r.error, 'err'); return null; }
  let out;
  try { out = await cropPhoto(r.bytes); } catch (e) { toast('That file is not a valid image.', 'err'); return null; }
  if (!out) return null;
  const saved = await pocketwave.saveImage(out.bytes, out.ext);
  if (!saved.ok) { toast('Could not save the photo: ' + saved.error, 'err'); return null; }
  toast(`Photo saved (${fmtBytes(r.bytes.length)} → ${fmtBytes(out.bytes.length)})`, 'ok');
  return saved.name;
}
// Shows the photo large, over the whole window (click, Esc or the button to close)
function openLightbox(url, title) {
  const root = $('#modal-root'), ov = document.createElement('div');
  ov.className = 'lightbox';
  ov.innerHTML = `<img src="${url}" alt="${esc(title || 'Photo')}" draggable="false"><button class="ibtn lb-x" title="Close">${ic('close')}</button>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  ov.onclick = close;
  root.appendChild(ov);
}
async function chooseImage(type, id) {
  const name = await pickPhoto();
  if (!name) return;
  const key = keyOfItem(type, id), old = S.user.images[key];
  S.user.images[key] = name;
  if (old) pocketwave.removeImage(old);
  scheduleSave(); renderSidebar(); renderMain(); renderPanel();
}
async function removeImage(type, id) {
  const key = keyOfItem(type, id), old = S.user.images[key];
  if (!old) return;
  if (!await askConfirm('Delete this photo?', 'The photo will be deleted from Pocketwave. The playlist itself is not changed.', 'Delete')) return;
  delete S.user.images[key];
  await pocketwave.removeImage(old);
  scheduleSave(); renderSidebar(); renderMain(); renderPanel();
  toast('Photo deleted');
}
// Click (left or right) on the photo of a playlist: upload / change / delete
function photoMenu(type, id, x, y) {
  const has = !!S.user.images[keyOfItem(type, id)];
  showMenu(x, y, has
    ? [{ label: 'Change photo…', run: () => chooseImage(type, id) }, { label: 'Delete photo', danger: true, run: () => removeImage(type, id) }]
    : [{ label: 'Upload photo…', run: () => chooseImage(type, id) }]);
}

/* ---- Edit dialog: name and photo ---- */
const autoFolderName = f => f.key === '.' ? (base(S.user.musicRoot || '') || 'Music') : f.key.split('/').pop();
async function openEditDialog(type, id) {
  const key = keyOfItem(type, id);
  const item = type === 'playlist' ? findPl(id) : findFolder(id);
  if (!item) return;
  const st = { img: S.user.images[key] || null, fresh: null, removed: false };
  const shown = () => st.fresh || (st.removed ? null : st.img);
  const paint = () => {
    const n = shown(), el = $('#ed-img');
    el.style.backgroundImage = n ? `url("${imgFile(n)}")` : '';
    el.classList.toggle('img', !!n);
    $('#ed-up').textContent = n ? 'Change photo…' : 'Upload photo…';
    $('#ed-del').disabled = !n;
  };
  const res = await modal({
    title: type === 'playlist' ? 'Edit playlist' : 'Edit folder playlist', cls: 'edit',
    body: `<div class="edit-wrap"><div class="edit-img" id="ed-img">${ic('note')}</div>
      <div class="edit-side"><div class="field"><label>Name</label><input type="text" id="ed-name" maxlength="80" value="${esc(item.name)}"></div>
        ${type === 'folder' ? `<div class="rowbtns" style="margin:0 0 12px"><button class="btn sm" id="ed-auto">Use original name</button></div>` : ''}
        <div class="field"><label>Photo</label><div class="rowbtns" style="margin:0"><button class="btn sm" id="ed-up">Upload photo…</button><button class="btn sm danger" id="ed-del">Remove photo</button></div></div></div></div>`,
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Save', primary: true, run: ov => {
        const nm = ov.querySelector('#ed-name').value.trim();
        if (!nm) { toast('The name cannot be empty.', 'err'); return false; }
        if (type === 'playlist') item.name = nm;
        else { if (nm === autoFolderName(item)) delete S.user.folderPrefs[item.key]; else S.user.folderPrefs[item.key] = { name: nm }; nameFolders(); }
        if (st.fresh) { if (st.img) pocketwave.removeImage(st.img); S.user.images[key] = st.fresh; }
        else if (st.removed && st.img) { pocketwave.removeImage(st.img); delete S.user.images[key]; }
        scheduleSave(); renderSidebar(); renderMain(); renderPanel();
        return 'saved';
      } }
    ],
    onOpen: ov => {
      paint();
      ov.querySelector('#ed-up').onclick = async () => {
        const n = await pickPhoto();
        if (n) { if (st.fresh) pocketwave.removeImage(st.fresh); st.fresh = n; paint(); }
      };
      ov.querySelector('#ed-del').onclick = async () => {
        if (!await askConfirm('Remove this photo?', 'The photo will be deleted from Pocketwave.', 'Remove')) return;
        if (st.fresh) { pocketwave.removeImage(st.fresh); st.fresh = null; }
        if (st.img) st.removed = true;
        paint();
      };
      const auto = ov.querySelector('#ed-auto');
      if (auto) auto.onclick = () => { ov.querySelector('#ed-name').value = autoFolderName(item); };
    }
  });
  if (res !== 'saved' && st.fresh) pocketwave.removeImage(st.fresh);   // cancelled: do not keep the new photo
}

// "Delete" on a folder removes it from the program only: the folder and its files stay on the PC
async function hideFolder(id) {
  const f = findFolder(id); if (!f) return;
  if (!await askConfirm('Delete this folder from Pocketwave?', `“${f.name}” will disappear from Pocketwave, including its songs. The folder and your files stay on your computer, untouched. You can bring it back from Settings.`, 'Delete')) return;
  const key = f.key;
  if (!S.user.hiddenFolders.includes(key)) S.user.hiddenFolders.push(key);
  const img = S.user.images['fo:' + key];
  if (img) { delete S.user.images['fo:' + key]; pocketwave.removeImage(img); }
  S.user.pins = S.user.pins.filter(k => k !== 'fo:' + key);
  S.user.folderOrder = S.user.folderOrder.filter(k => k !== key);
  S.user.movedFolders = movedFolderIds().filter(k => k !== key);
  setLibrary(S.tracks);
  if (S.view.type === 'folder' && S.view.id === id) setView({ type: 'all' }); else { renderSidebar(); renderMain(); }
  scheduleSave();
  toast(`“${f.name}” was removed from Pocketwave`, 'ok');
}
function showFolderPath(f) {
  modal({
    title: 'Folder path',
    body: `<div class="field"><label>${esc(f.name)}</label><div class="val">${esc(f.path)}</div></div>`,
    buttons: [
      { label: 'Copy path', run: () => { try { navigator.clipboard.writeText(f.path); toast('Path copied', 'ok'); } catch (e) { toast('Could not copy the path', 'err'); } return false; } },
      { label: 'Open folder', run: () => { pocketwave.reveal(f.list[0].path); return true; } },
      { label: 'Close', primary: true, value: true }
    ]
  });
}
async function deletePlaylist(id) {
  const pl = findPl(id); if (!pl) return;
  if (!await askConfirm('Delete this playlist?', `The playlist “${pl.name}” will be deleted. Your music files are not touched.`, 'Delete')) return;
  const img = S.user.images['pl:' + id];
  if (img) { delete S.user.images['pl:' + id]; pocketwave.removeImage(img); }
  S.user.playlists = S.user.playlists.filter(p => p.id !== id);
  S.user.pins = S.user.pins.filter(k => k !== 'pl:' + id);
  delete S.user.settings.shuffles['pl:' + id];
  scheduleSave();
  if (S.view.type === 'playlist' && S.view.id === id) setView({ type: 'all' }); else renderSidebar();
}
function addToPlaylist(plId, paths) {
  const pl = findPl(plId); if (!pl) return;
  const fresh = paths.filter(p => !pl.tracks.includes(p));
  pl.tracks.push(...fresh);
  scheduleSave(); renderSidebar();
  if (S.view.type === 'playlist' && S.view.id === plId) renderMain(true);
  toast(fresh.length ? `Added to “${pl.name}”` : `Already in “${pl.name}”`, fresh.length ? 'ok' : '');
}

/* ---- Export / import (M3U, M3U8) ---- */
async function exportPlaylist(type, id) {
  const info = type === 'playlist' ? findPl(id) : findFolder(id);
  if (!info) return;
  const tracks = type === 'playlist' ? info.tracks.map(getTrack) : info.list.slice().sort((a, b) => coll.compare(a.title, b.title));
  const entries = tracks.filter(t => !t.missing).map(t => ({ path: t.path, title: t.title, artist: t.artist, duration: t.duration }));
  if (!entries.length) return toast('This playlist has no songs to export.');
  const r = await pocketwave.exportM3U(info.name, entries);
  if (r.canceled) return;
  if (!r.ok) return toast('Export failed: ' + r.error, 'err');
  toast(`Exported ${plural(r.count, 'song', 'songs')} to ${base(r.file)}`, 'ok');
}
async function importPlaylist() {
  const r = await pocketwave.importM3U();
  if (!r) return;
  if (!r.ok) return toast('Import failed: ' + r.error, 'err');
  if (!r.entries.length) return toast('That playlist file is empty.');
  const lower = new Map(S.tracks.map(t => [t.path.toLowerCase(), t.path]));
  const seen = new Set(), paths = [], extras = [];
  let missing = 0;
  for (const e of r.entries) {
    let p = S.byPath.has(e.path) ? e.path : lower.get(e.path.toLowerCase());
    if (!p) {
      p = e.path;
      if (e.track) extras.push(Object.assign({}, e.track, { extra: true }));   // exists on disk but is not in the library
      else { missing++; S.user.meta[p] = { title: e.title || stem(p), artist: e.artist || '', album: '', duration: e.duration || 0 }; }
    }
    if (!seen.has(p)) { seen.add(p); paths.push(p); }
  }
  if (extras.length) { S.tracks = [...S.tracks, ...extras]; setLibrary(S.tracks); pocketwave.addExtras(extras); }
  const pl = { id: uid(), name: uniqueName(r.name || 'Imported playlist'), tracks: paths };
  S.user.playlists.push(pl);
  scheduleSave(); renderSidebar();
  setView({ type: 'playlist', id: pl.id });
  toast(`Imported “${pl.name}”: ${plural(paths.length, 'song', 'songs')}${missing ? `, ${missing} not found` : ''}`, missing ? '' : 'ok');
}

/* ---------- Main area ---------- */
function updateHeroPlay() {
  const b = $('#h-play');
  if (!b) return;
  const v = curView();
  const playing = isShownCtx(v) && !audio.paused;
  b.innerHTML = ic(playing ? 'pause' : 'play');
  b.title = playing ? 'Pause' : 'Play';
  const sh = $('#h-shuf');
  if (sh) { sh.classList.toggle('on', shuffleOn(v)); sh.title = shuffleOn(v) ? 'Shuffle: on' : 'Shuffle: off'; }
}
let lqTimer = null;
function wireListSearch() {
  const lq = $('#lq'), clr = $('#lq-clear');
  if (!lq) return;
  const apply = () => { S.listQuery = lq.value.trim(); S.selected = -1; renderMain(); $('#scroller').scrollTop = 0; };
  lq.addEventListener('input', () => { clr.hidden = !lq.value; clearTimeout(lqTimer); lqTimer = setTimeout(apply, 80); });
  lq.addEventListener('keydown', e => { if (e.key === 'Escape' && lq.value) { e.stopPropagation(); lq.value = ''; clr.hidden = true; clearTimeout(lqTimer); apply(); } });
  clr.addEventListener('click', () => { lq.value = ''; clr.hidden = true; clearTimeout(lqTimer); apply(); lq.focus(); });
}
function renderMain() {
  // First start (no music folder yet): the "choose folder" screen. From then on the Home page is the start page.
  const welcome = !S.user.musicRoot && !S.query && (S.view.type === 'all' || S.view.type === 'home');
  const isHome = !welcome && (curView().type === 'home' || curView().type === 'stats');
  $('#home').hidden = !isHome;
  S.items = (welcome || isHome) ? [] : currentItems();
  const hero = $('#hero'), empty = $('#empty'), head = $('#colhead'), rows = $('#rows');
  if (isHome) {
    hero.hidden = true; head.hidden = true; empty.hidden = true; rows.style.height = '0'; rows.innerHTML = '';
    if (curView().type === 'stats') renderStats(); else renderHome();
    return;
  }
  if (welcome) {
    hero.hidden = true; head.hidden = true; rows.style.height = '0';
    empty.hidden = false;
    empty.innerHTML = `<img class="welcome-logo" src="../../assets/logo.png" alt="Pocketwave" draggable="false"><h2>Welcome to Pocketwave</h2><p>Choose the folder that contains your music.<br>Pocketwave reads all its subfolders and never modifies your files.</p><button class="btn pri" id="welcome-pick">${ic('folder')}Choose music folder</button>`;
    $('#welcome-pick').onclick = chooseRoot;
    rows.innerHTML = '';
    return;
  }
  hero.hidden = false; head.hidden = false;
  const refocusLq = document.activeElement && document.activeElement.id === 'lq';   // keep typing in the playlist search while the list updates
  const items = S.items, v = curView(), searching = v.type === 'search';
  const total = items.reduce((a, it) => a + (it.t.duration || 0), 0);
  const n = items.length;
  const hasMenu = v.type === 'playlist' || v.type === 'folder';
  const hasPhoto = hasMenu || v.type === 'all';          // All songs can have a photo too
  if (searching) {
    const g = searchGroups();
    const chip = (type, id, name) => {
      const url = imgUrl(keyOfItem(type, id));
      return `<button class="sr-chip" data-type="${type}" data-id="${esc(id)}"><span class="tile ${url ? 'img' : ''}" ${url ? `style="background-image:url('${url}')"` : ''}>${ic('note')}</span><span class="nm">${esc(name)}</span><span class="ct">${type === 'playlist' ? 'Playlist' : 'Folder'}</span></button>`;
    };
    const chips = [...g.playlists.map(p => chip('playlist', p.id, p.name)), ...g.folders.map(f => chip('folder', f.id, f.name))].join('');
    hero.innerHTML = `<div class="hero-in"><div class="hero-txt"><div class="kind">Search</div><h1 class="small"><span class="ttl">Results for “${esc(S.query)}”</span></h1>
      <div class="meta">${plural(n, 'song', 'songs')}, ${plural(g.playlists.length, 'playlist', 'playlists')}, ${plural(g.folders.length, 'folder', 'folders')}</div></div></div>
      ${chips ? `<div class="sr-groups">${chips}</div>` : ''}
      <div class="acts"><button class="bigplay" id="h-play" ${n ? '' : 'disabled'}></button></div>`;
    hero.querySelectorAll('.sr-chip').forEach(c => c.onclick = () => setView({ type: c.dataset.type, id: c.dataset.id }));
  } else {
    const meta = `${plural(n, 'song', 'songs')}${total ? ', ' + longDur(total) : ''}`;
    const heroImg = imgUrl(imgKey(v));
    hero.innerHTML = `<div class="hero-in"><div class="hero-art ${v.type} ${heroImg ? 'img' : ''} ${hasPhoto ? 'editable' : ''}" ${heroImg ? `style="background-image:url('${heroImg}')"` : ''}>${ic('note')}${hasPhoto ? `<button class="cam-btn" title="${heroImg ? 'Change photo' : 'Add photo'}">${ic('camera')}</button>` : ''}</div>
      <div class="hero-txt"><div class="kind">${v.type === 'all' ? 'Library' : 'Playlist'}</div>
        <h1><span class="ttl">${esc(viewTitle(v))}</span>${hasMenu ? `<button class="pencil" id="h-edit" title="Edit name and photo">${ic('edit')}</button>` : ''}</h1>
        <div class="meta">${meta}</div></div></div>
      <div class="acts"><button class="bigplay" id="h-play" ${n ? '' : 'disabled'}></button>
      <button class="ibtn ctl big" id="h-shuf" ${n ? '' : 'disabled'}>${ic('shuffle')}</button>
      ${hasMenu ? `<button class="ibtn big" id="h-more" title="More options">${ic('more')}</button>` : ''}
      ${hasMenu ? `<div class="lsearch"><span class="lsico">${ic('search')}</span><input id="lq" type="search" placeholder="Search in this ${v.type === 'folder' ? 'folder' : 'playlist'}" value="${esc(S.listQuery)}" autocomplete="off" spellcheck="false"><button class="ibtn" id="lq-clear" title="Clear" ${S.listQuery ? '' : 'hidden'}>${ic('close')}</button></div>` : ''}</div>`;
    if (hasPhoto) {
      const art = $('.hero-art');
      // With a photo, a click enlarges it (the camera button changes or deletes it); without one, a click adds it
      art.onclick = e => {
        if (heroImg && !e.target.closest('.cam-btn')) { if (e.detail >= 2) openLightbox(heroImg, viewTitle(v)); return; }   // double click on the photo enlarges it
        const r = (e.target.closest('.cam-btn') || art).getBoundingClientRect();
        photoMenu(v.type, v.id, e.target.closest('.cam-btn') ? r.left : e.clientX, e.target.closest('.cam-btn') ? r.bottom + 4 : e.clientY);
      };
      art.oncontextmenu = e => { e.preventDefault(); photoMenu(v.type, v.id, e.clientX, e.clientY); };   // right click
    }
    if (hasMenu) {
      $('#h-edit').onclick = () => openEditDialog(v.type, v.id);
      $('#h-more').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); itemMenu(v.type, v.id, r.left, r.bottom + 4); };
      wireListSearch();
    }
    // Shuffle: turning it on starts the playlist right away in random order (unless it is already playing)
    $('#h-shuf').onclick = () => {
      const wasOn = shuffleOn(v), playing = isActiveCtx(v);
      toggleShuffle(v);
      if (!wasOn && !playing) playContext();
    };
  }
  if (refocusLq && $('#lq')) { const l = $('#lq'); l.focus(); l.setSelectionRange(l.value.length, l.value.length); }
  updateHeroPlay();
  $('#h-play').onclick = () => { if (isShownCtx(curView())) togglePlay(); else playContext(); };

  const s = getSort();
  const hb = (key, label, cls) => {
    const on = s && s.key === key;
    return `<button class="${cls || ''} ${on ? 'on' : ''}" data-sort="${key}">${label}${on ? (s.dir === 1 ? ' ▲' : ' ▼') : ''}</button>`;
  };
  head.innerHTML = `<div style="text-align:center">#</div>${hb('title', 'Title')}${hb('artist', 'Artist', 'c-artist')}${hb('album', 'Album', 'c-album')}<div class="c-path">Path</div>${hb('duration', 'Duration', 'r')}<div></div>`;

  let msg = '';
  if (!n) {
    if (searching) { const g = searchGroups(); if (!g.playlists.length && !g.folders.length) msg = `<h2>No results</h2><p>Nothing matches “${esc(S.query)}” in your songs, playlists or folders.<br>Check the spelling or try fewer words.</p>`; }
    else if (listFilterOn()) msg = `<h2>No results</h2><p>No song in this ${v.type === 'folder' ? 'folder' : 'playlist'} matches “${esc(S.listQuery)}”.<br>Check the spelling or try fewer words.</p>`;
    else if (v.type === 'playlist') msg = `<h2>This playlist is empty</h2><p>Open the ⋯ menu of a song and choose “Add to playlist”.</p>`;
    else msg = `<h2>No songs found</h2><p>There are no supported audio files in ${esc(S.user.musicRoot)}.<br>Check the folder or refresh the library.</p>`;
  }
  empty.hidden = !msg; empty.innerHTML = msg;
  rows.style.height = (n * ROW_H) + 'px';
  paintRows(true);
}
let lastRange = '';
function paintRows(force) {
  const sc = $('#scroller'), rows = $('#rows');
  if (!S.items) return;
  const n = S.items.length;
  const off = rows.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
  const top = Math.max(0, sc.scrollTop - off);
  const first = Math.max(0, Math.floor(top / ROW_H) - 8);
  const last = Math.min(n, Math.ceil((top + sc.clientHeight) / ROW_H) + 8);
  const key = first + '-' + last + '-' + n;
  if (!force && key === lastRange) return;
  lastRange = key;
  let h = '';
  for (let i = first; i < last; i++) h += rowHtml(S.items[i], i);
  rows.innerHTML = h;
}
const MISSING_TIP = 'File not found: it was deleted or moved outside the synced folder.';
function rowHtml(it, i) {
  const t = it.t;
  const cur = t.path === S.currentPath;
  const bad = S.bad.get(t.path);
  const missing = !!t.missing || bad === 'missing';
  const durCell = missing ? 'Not found' : bad === 'unreadable' ? 'Unreadable' : fmt(t.duration);
  const artist = t.artist || 'Unknown artist';
  const num = missing
    ? `<span class="mi">${ic('warn')}</span>`
    : `<span class="n">${i + 1}</span><span class="eq"><i></i><i></i><i></i></span><button class="rbtn" data-act="play" title="Play">${ic(cur && !audio.paused ? 'pause' : 'play')}</button>`;
  return `<div class="grid row ${cur ? 'cur' : ''} ${cur && audio.paused ? 'paused' : ''} ${missing || bad ? 'missing' : ''} ${i === S.selected ? 'sel' : ''}" data-i="${i}" style="top:${i * ROW_H}px" title="${esc(missing ? MISSING_TIP + '\n' + t.path : t.path)}">
    <div class="c-num">${num}</div>
    <div class="c-title"><div class="t">${esc(t.title)}</div><div class="sub">${esc(artist)}</div></div>
    <div class="c-artist">${esc(t.artist)}</div>
    <div class="c-album">${esc(t.album)}</div>
    <div class="c-path">${esc(t.path)}</div>
    <div class="c-dur">${durCell}</div>
    <div><button class="more" data-act="more" title="More options">${ic('more')}</button></div>
  </div>`;
}
const rowItem = e => { const r = e.target.closest('.row'); return r ? { el: r, i: +r.dataset.i, it: S.items[+r.dataset.i] } : null; };
function selectRow(r) {
  const old = $('#rows .row.sel'); if (old) old.classList.remove('sel');
  r.el.classList.add('sel'); S.selected = r.i;
}
function trackMenu(it, x, y) {
  const p = it.t.path;
  const inPlaylist = !S.query && S.view.type === 'playlist';
  const removeItem = { label: 'Remove from this playlist', run: () => { const pl = findPl(S.view.id); pl.tracks = pl.tracks.filter(q => q !== p); scheduleSave(); renderSidebar(); renderMain(true); } };
  if (!isPlayable(p)) {                         // a song whose file is gone can only be removed from the playlist
    showMenu(x, y, inPlaylist ? [removeItem] : [{ label: 'File not found', disabled: true }]);
    return;
  }
  const items = [
    { label: 'Play', run: () => playItem(S.items.indexOf(it)) },
    { label: 'Play next', run: () => addToQueue([p], true) },
    { label: 'Add to queue', run: () => addToQueue([p], false) },
    { sep: true },
    { label: 'Add to playlist…', run: () => [
      ...S.user.playlists.map(pl => ({ label: pl.name, run: () => addToPlaylist(pl.id, [p]) })),
      { sep: true }, { label: 'New playlist…', run: () => newPlaylist([p]) }] }
  ];
  if (inPlaylist) items.push(removeItem);
  items.push({ sep: true }, { label: 'Show in folder', run: () => pocketwave.reveal(p) });
  showMenu(x, y, items);
}

/* ---------- Banner ---------- */
function renderBanner() {
  const b = $('#banner');
  let html = '', cls = '';
  if (S.saveError) {
    cls = 'err';
    html = `Your data could not be saved (${esc(S.saveError)}). Recent changes may be lost. <div class="act"><button class="btn" id="bn-reloc">Choose another data folder</button><button class="btn" id="bn-retry">Try again</button></div>`;
  } else if (S.scanning && !S.firstLoad) {
    const sc = S.scan || {};
    const txt = sc.phase === 'read' && sc.total ? `Scanning: ${sc.done} of ${sc.total} songs` : 'Looking for audio files…';
    const pct = sc.phase === 'read' && sc.total ? Math.round(sc.done / sc.total * 100) : 0;
    html = `${txt}<div class="bar ${pct ? '' : 'ind'}"><i style="width:${pct || 35}%"></i></div>`;
  } else if (S.user.musicRoot && !S.rootOk) {
    cls = 'warn';
    html = `The music folder is not available: ${esc(S.user.musicRoot)}. Connect the drive and try again, or choose another location. Songs already in your library stay visible but may not play. <div class="act"><button class="btn" id="bn-retry-root">Try again</button><button class="btn" id="bn-pick">Choose another folder</button></div>`;
  }
  b.hidden = !html; b.className = cls; b.innerHTML = html;
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('#bn-retry', doSave);
  on('#bn-reloc', async () => { const d = await pocketwave.relocateData(); if (d) { S.dataDir = d; await doSave(); toast('Data is now saved in ' + d, 'ok'); } });
  on('#bn-retry-root', () => rescan({ manual: true }));
  on('#bn-pick', chooseRoot);
  $('#btn-rescan').classList.toggle('spin', S.scanning);
}

/* ---------- Library scanning ---------- */
const scanRoots = () => {
  const r = [];
  if (S.user.musicRoot) r.push({ path: S.user.musicRoot, main: true });
  if (S.user.syncFolder) r.push({ path: S.user.syncFolder, main: false });
  return r;
};
async function chooseRoot() {
  const p = await pocketwave.chooseFolder('Choose your music folder');
  if (!p) return;
  S.user.musicRoot = p; S.rootOk = true; scheduleSave();
  renderMain();
  await rescan({ manual: true, first: true });
  applyWatch();
}
async function rescan(opt) {
  opt = opt || {};
  const root = S.user.musicRoot;
  if (!root) return chooseRoot();
  if (S.scanning) return;
  S.rootOk = await pocketwave.folderAvailable(root);
  if (!S.rootOk) { renderBanner(); if (opt.manual) toast('The music folder cannot be reached.', 'err'); return; }
  S.scanning = true; S.scan = { phase: 'list', done: 0, total: 0 };
  if (opt.first) S.firstLoad = showLoadingPopup('Loading your music'); // first load of a folder: popup instead of the top line
  renderBanner(); renderSidebar();
  const keep = [...new Set(S.user.playlists.flatMap(p => p.tracks))];
  const res = await pocketwave.scan(scanRoots(), keep, { readTags: S.user.settings.adv.tags });
  S.scanning = false; S.scan = null;
  if (S.firstLoad) { S.firstLoad.close(); S.firstLoad = null; }
  if (!res.ok) { renderBanner(); renderSidebar(); toast('Scan failed: ' + res.error, 'err'); return; }
  S.bad.clear();
  const before = S.byPath;
  setLibrary(res.tracks);
  remapPaths(S.user.lastRoot, root);
  S.user.lastRoot = root;
  for (const k of Object.keys(S.user.meta)) if (S.byPath.has(k)) delete S.user.meta[k];   // the file is back
  // The folder is the source of truth. Songs deleted from it (or moved outside it) are shown as missing in playlists
  // (skipped when some sub-folders could not be read, to never flag songs by mistake)
  const marked = !res.skippedFolders && res.removedPaths && res.removedPaths.length ? markMissing(res.removedPaths, before) : 0;
  scheduleSave();
  renderBanner(); renderSidebar(); renderMain(); renderPanel();
  if (S.view.type === 'folder' && !findFolder(S.view.id)) setView({ type: 'all' });
  if (res.added || res.removed) toast(`Library updated: ${res.added} new, ${res.removed} removed`, 'ok');
  else if (opt.manual && !opt.first) toast('Your library is already up to date.', 'ok');
  if (marked) toast(`${plural(marked, 'song in your playlists is', 'songs in your playlists are')} missing: deleted or moved outside the synced folder.`, 'err');
  if (res.unreadable) toast(`${plural(res.unreadable, 'audio file has', 'audio files have')} unreadable tags and may be damaged.`);
  if (res.skippedFolders) toast(`${plural(res.skippedFolders, 'folder was', 'folders were')} skipped because they are not accessible.`);
  if (!S.loaded && S.currentPath == null) restoreLast();
}

/* ---------- Keeping playlists in step with the folder ---------- */
// Songs that no longer exist stay visible in their playlists (grey, "file not found") instead of leaving broken entries.
// Their details are remembered so the entries stay readable. The queues drop them.
function markMissing(paths, lookup) {
  const gone = new Set(paths), u = S.user;
  let marked = 0;
  for (const p of gone) {
    const t = lookup.get(p);
    if (t && u.playlists.some(pl => pl.tracks.includes(p))) { u.meta[p] = { title: t.title, artist: t.artist, album: t.album, duration: t.duration }; marked++; }
  }
  S.userQueue = S.userQueue.filter(p => !gone.has(p));
  if (u.settings.last && gone.has(u.settings.last.path)) u.settings.last = null;
  if (S.queue.some(p => gone.has(p) && p !== S.currentPath)) {
    const keep = new Map(), nq = [];
    S.queue.forEach((p, i) => { if (!gone.has(p) || p === S.currentPath) { keep.set(i, nq.length); nq.push(p); } });
    let kept = 0;
    for (let k = 0; k <= S.pos; k++) if (keep.has(S.order[k])) kept++;
    S.order = S.order.filter(i => keep.has(i)).map(i => keep.get(i));
    S.queue = nq; S.pos = S.pos < 0 ? -1 : kept - 1;
  }
  return marked;
}
// A song was renamed or moved: every reference follows it, with no duplicates and no broken entries
function renamePath(from, track) {
  const to = track.path, u = S.user, map = p => p === from ? to : p, uniq = a => [...new Set(a.map(map))];
  for (const pl of u.playlists) pl.tracks = uniq(pl.tracks);
  S.userQueue = S.userQueue.map(map);
  S.queue = S.queue.map(map);
  if (S.currentPath === from) S.currentPath = to;
  if (u.settings.last && u.settings.last.path === from) u.settings.last.path = to;
  delete u.meta[from]; delete u.meta[to];
  S.bad.delete(from); dropCover(from);
  S.tracks = S.tracks.filter(x => x.path !== from && x.path !== to);
  S.tracks.push(track);
  setLibrary(S.tracks);
}
function refreshAfterLibraryChange() {
  if (S.view.type === 'folder' && !findFolder(S.view.id)) { setView({ type: 'all' }); }
  else { renderSidebar(); renderMain(); }
  renderPanel();
}
function replaceTrack(t) {
  S.tracks = [...S.tracks.filter(x => x.path !== t.path), t];
  dropCover(t.path);
  delete S.user.meta[t.path];
  setLibrary(S.tracks);
}
// Events coming from the real-time folder monitoring
function onWatchAdded(t) {
  const known = S.byPath.has(t.path);
  replaceTrack(t);
  scheduleSave();
  refreshAfterLibraryChange();
  if (!known) toast(`Added “${t.title}”`, 'ok');
}
function onWatchUpdated(t) {
  replaceTrack(t);
  refreshAfterLibraryChange();
  if (t.path === S.currentPath) updatePlayer();
}
function onWatchRemoved(p) {
  const old = S.byPath.get(p);
  S.tracks = S.tracks.filter(x => x.path !== p);
  setLibrary(S.tracks);
  const marked = old ? markMissing([p], new Map([[p, old]])) : 0;
  scheduleSave();
  refreshAfterLibraryChange(); updatePlayer();
  if (old) toast(`“${old.title}” is no longer in the folder${marked ? ' and is shown as missing in your playlists' : ''}.`, marked ? 'err' : '');
}
function onWatchRenamed(r) {
  renamePath(r.from, r.track);
  scheduleSave();
  refreshAfterLibraryChange(); updatePlayer();
  toast(`Updated “${r.track.title}” (renamed or moved)`);
}
// Real-time monitoring is always on: the music folder (and the extra synced folder, if set)
async function applyWatch() {
  S.syncState = await pocketwave.watchSet(scanRoots(), S.user.settings.adv.tags);
  if (typeof refreshSyncStatus === 'function') refreshSyncStatus();
}
