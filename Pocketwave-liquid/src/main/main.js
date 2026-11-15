'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const fsp = fs.promises;
const scanner = require('./scanner');

const ROOT_DIR = path.join(__dirname, '..', '..');
// Portable mode: the data folder lives next to the program (on macOS: next to Pocketwave.app, not inside it)
function programDir() {
  if (!app.isPackaged) return ROOT_DIR;
  if (process.platform === 'darwin') return path.resolve(path.dirname(process.execPath), '..', '..', '..');
  return path.dirname(process.execPath);
}
const APP_DIR = programDir();
let dataDir = path.join(APP_DIR, 'PocketwaveData');
// Older versions called this folder "WavelyData", "GreenWaveData" or "WavyData": it is renamed once, so existing playlists and settings are kept
try {
  if (!fs.existsSync(dataDir)) {
    for (const legacy of ['WavelyData', 'WavyData', 'GreenWaveData']) {
      const legacyDir = path.join(APP_DIR, legacy);
      if (fs.existsSync(legacyDir)) { fs.renameSync(legacyDir, dataDir); break; }
    }
  }
} catch (e) { /* a new data folder is created instead */ }
let win = null;
let scanning = false;
const backedUp = new Set();

function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const t = path.join(dir, '.write-test');
    fs.writeFileSync(t, '1');
    fs.unlinkSync(t);
    return true;
  } catch (e) { return false; }
}
const pointerFile = () => path.join(app.getPath('appData'), 'Pocketwave', 'data-folder.txt');
const userFile = () => path.join(dataDir, 'userdata.json');
const libFile = () => path.join(dataDir, 'library.json');
const imagesDir = () => path.join(dataDir, 'images');

// Portable mode: Chromium's own data also stays inside the program folder
if (isWritable(dataDir)) app.setPath('userData', path.join(dataDir, 'electron'));

function readJSON(file, fallback) {
  const tryParse = f => JSON.parse(fs.readFileSync(f, 'utf8'));
  try {
    return tryParse(file);
  } catch (e) {
    if (fs.existsSync(file)) {
      try { fs.renameSync(file, file + '.corrupt-' + Date.now()); } catch (e2) { /* ignore */ }
      try { return tryParse(file + '.bak'); } catch (e3) { /* ignore */ }
    }
    return fallback;
  }
}

const chains = new Map();
function writeJSON(file, obj) {
  const prev = chains.get(file) || Promise.resolve();
  const job = prev.catch(() => {}).then(async () => {
    if (!backedUp.has(file)) {
      backedUp.add(file);
      try { await fsp.copyFile(file, file + '.bak'); } catch (e) { /* no previous file */ }
    }
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(obj));
    await fsp.rename(tmp, file);
  });
  chains.set(file, job);
  return job;
}

function resolveDataDirInteractive() {
  if (isWritable(dataDir)) return;
  try {
    const saved = fs.readFileSync(pointerFile(), 'utf8').trim();
    if (saved && isWritable(saved)) { dataDir = saved; return; }
  } catch (e) { /* no saved location */ }
  for (;;) {
    const r = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Pocketwave',
      message: 'The program folder is not writable.',
      detail: 'Pocketwave needs to save your favorites, playlists, images and settings. Choose a folder where they can be stored (for example on your USB drive or in Documents).',
      buttons: ['Choose folder', 'Quit'],
      defaultId: 0, cancelId: 1
    });
    if (r !== 0) { app.exit(0); return; }
    const sel = dialog.showOpenDialogSync({ title: 'Folder for Pocketwave data', properties: ['openDirectory', 'createDirectory'] });
    if (sel && sel[0]) {
      const d = path.join(sel[0], 'PocketwaveData');
      if (isWritable(d)) {
        dataDir = d;
        try {
          fs.mkdirSync(path.dirname(pointerFile()), { recursive: true });
          fs.writeFileSync(pointerFile(), d);
        } catch (e) { /* the pointer is only a convenience */ }
        return;
      }
      dialog.showErrorBox('Pocketwave', 'Pocketwave cannot write to that folder. Please choose another one.');
    }
  }
}

/* ---------- Window size and position ----------
   The main process remembers the exact window size, position and state (normal / maximized / full screen)
   in PocketwaveData/window-state.json and restores them on the next start. The widths of the left sidebar and of
   the right panel are saved by the interface in PocketwaveData/userdata.json (settings.sidebarWidth, settings.panel.width). */
const DEFAULT_WINDOW = { width: 1360, height: 820 };   // on small screens it shrinks keeping the same proportions
const MIN_WINDOW = { width: 560, height: 480 };
const windowFile = () => path.join(dataDir, 'window-state.json');

function loadWindowState() {
  const s = readJSON(windowFile(), null);
  if (!s || typeof s !== 'object') return null;
  const num = v => (typeof v === 'number' && isFinite(v) ? Math.round(v) : null);
  const w = num(s.width), h = num(s.height);
  if (!w || !h || w < MIN_WINDOW.width || h < MIN_WINDOW.height) return null;
  const st = { width: w, height: h, x: num(s.x), y: num(s.y), maximized: !!s.maximized, fullScreen: !!s.fullScreen };
  // The saved position is only used when the window would still be visible on a connected screen
  if (st.x !== null && st.y !== null) {
    const visible = screen.getAllDisplays().some(d => {
      const a = d.workArea;
      return st.x + 80 < a.x + a.width && st.x + st.width - 80 > a.x && st.y + 20 < a.y + a.height && st.y + 60 > a.y;
    });
    if (!visible) { st.x = null; st.y = null; }
  }
  return st;
}
// The "Now playing" screen can put the whole program in full screen (HTML full screen). That is a temporary state of the
// screen, not a choice about the window, so it is never saved: the window is stored as it was before.
let htmlFullScreen = false, beforeHtmlFullScreen = { maximized: false };
function currentWindowState() {
  const b = win.getNormalBounds();   // the size the window has when it is not maximized / full screen
  return {
    x: b.x, y: b.y, width: b.width, height: b.height,
    maximized: htmlFullScreen ? beforeHtmlFullScreen.maximized : win.isMaximized(),
    fullScreen: htmlFullScreen ? false : win.isFullScreen()
  };
}
let windowSaveTimer = null;
function saveWindowState(sync) {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  clearTimeout(windowSaveTimer);
  const write = () => {
    if (!win || win.isDestroyed()) return;
    try {
      const tmp = windowFile() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(currentWindowState()));
      fs.renameSync(tmp, windowFile());
    } catch (e) { /* the window state is only a convenience */ }
  };
  if (sync) write(); else windowSaveTimer = setTimeout(write, 500);
}

// Small startup log (PocketwaveData/pocketwave-log.txt, last ~40 KB): errors only, no personal data. It helps to find why a window does not open.
function logLine(msg) {
  try {
    const f = path.join(dataDir, 'pocketwave-log.txt');
    let old = ''; try { old = fs.readFileSync(f, 'utf8'); } catch (e) { /* first line */ }
    if (old.length > 40000) old = old.slice(-20000);
    fs.writeFileSync(f, old + new Date().toISOString() + '  ' + msg + '\n');
  } catch (e) { /* the log must never break the program */ }
}
process.on('uncaughtException', e => logLine('uncaughtException ' + (e && e.stack || e)));
process.on('unhandledRejection', e => logLine('unhandledRejection ' + (e && e.stack || e)));

function createWindow() {
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const saved = loadWindowState();
  const fit = Math.min(1, (wa.width - 40) / DEFAULT_WINDOW.width, (wa.height - 40) / DEFAULT_WINDOW.height);   // keeps the proportions on small screens
  const iconPath = path.join(ROOT_DIR, 'assets', 'icon.png');
  const opts = {
    width: saved ? saved.width : Math.round(DEFAULT_WINDOW.width * fit),
    height: saved ? saved.height : Math.round(DEFAULT_WINDOW.height * fit),
    minWidth: MIN_WINDOW.width, minHeight: MIN_WINDOW.height,
    backgroundColor: '#000000', title: 'Pocketwave', autoHideMenuBar: true, show: false,
    // Liquid Glass: no separate grey title bar, the glass background continues behind the window buttons
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 14 } } : { titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 40 } }),
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false
    }
  };
  if (saved && saved.x !== null && saved.y !== null) { opts.x = saved.x; opts.y = saved.y; }
  win = new BrowserWindow(opts);
  let shown = false;
  const showWindow = why => {
    if (shown || !win || win.isDestroyed()) return;
    shown = true; logLine('window shown (' + why + ')');
    if (saved && saved.maximized) win.maximize();
    win.show();
    if (saved && saved.fullScreen) win.setFullScreen(true);
  };
  win.once('ready-to-show', () => showWindow('ready-to-show'));
  // Safety net: if the first paint never comes, the window is shown anyway after 4 seconds (it can never stay invisible)
  setTimeout(() => showWindow('timeout'), 4000);
  win.webContents.on('did-fail-load', (_e, code, desc) => { logLine('did-fail-load ' + code + ' ' + desc); showWindow('load-failed'); });
  win.webContents.on('render-process-gone', (_e, d) => { logLine('render-process-gone ' + (d && d.reason)); showWindow('renderer-gone'); });
  win.webContents.on('unresponsive', () => logLine('window unresponsive'));
  win.webContents.on('preload-error', (_e, p2, err) => logLine('preload-error ' + p2 + ' ' + (err && err.message)));
  win.webContents.on('console-message', (_e, level, msg, line, src) => { if (level >= 3) logLine('renderer error: ' + msg + ' (' + String(src).split('/').pop() + ':' + line + ')'); });
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, () => saveWindowState(false));
  win.on('close', () => saveWindowState(true));
  win.webContents.on('enter-html-full-screen', () => { beforeHtmlFullScreen = { maximized: win.isMaximized() }; htmlFullScreen = true; });
  win.webContents.on('leave-html-full-screen', () => { htmlFullScreen = false; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

/* ---------- Folder synchronization: real-time detection of every change ----------
   The monitored folders are the source of truth: new, removed, renamed, moved and modified audio files are
   detected while the program is running and reported to the interface. */
let watchRoots = [];                 // [{ path, main }]
let watchTags = true;
const watchers = new Map();          // root path -> FSWatcher
const timers = new Map();            // file path -> debounce timer
const pending = [];                  // unmatched "appeared" / "disappeared" files, waiting for a possible rename partner
let retryTimer = null, lastState = 'off';

const rootOf = full => watchRoots.find(r => full === r.path || scanner.isUnder(r.path, full));
const sameFile = (a, b) => a.kind !== b.kind && a.size === b.size && Math.abs(a.mtime - b.mtime) <= 2000;

let libLock = Promise.resolve();      // library updates run one at a time, so none is lost
function libUpdate(fn) {
  libLock = libLock.catch(() => {}).then(async () => {
    const lib = readJSON(libFile(), { version: 2, roots: [], scannedAt: 0, tracks: [] });
    lib.tracks = fn(lib.tracks || []);
    await writeJSON(libFile(), lib);
  });
  return libLock;
}
const libTracks = () => (readJSON(libFile(), { tracks: [] }).tracks || []);

async function finalize(entry) {
  const i = pending.indexOf(entry);
  if (i >= 0) pending.splice(i, 1);
  clearTimeout(entry.timer);
  if (entry.kind === 'add') {
    await libUpdate(t => [...t.filter(x => x.path !== entry.track.path), entry.track]);
    send('watch:added', entry.track);
  } else {
    await libUpdate(t => t.filter(x => x.path !== entry.path));
    send('watch:removed', entry.path);
  }
}
// A file renamed or moved shows up as "one file disappeared + one file appeared" with the same size and date
async function queueChange(entry) {
  const partner = pending.find(p => sameFile(p, entry));
  if (partner) {
    pending.splice(pending.indexOf(partner), 1);
    clearTimeout(partner.timer);
    const add = entry.kind === 'add' ? entry : partner, rm = entry.kind === 'rm' ? entry : partner;
    await libUpdate(t => [...t.filter(x => x.path !== rm.path && x.path !== add.track.path), add.track]);
    send('watch:renamed', { from: rm.path, track: add.track });
    return;
  }
  pending.push(entry);
  entry.timer = setTimeout(() => finalize(entry), 1500);
}
async function handleGone(full, root) {
  if (!fs.existsSync(root.path)) return;          // the whole folder is unavailable (e.g. unplugged drive): not a deletion
  const tracks = libTracks();
  const gone = scanner.isAudio(full)
    ? tracks.filter(t => t.path === full)
    : tracks.filter(t => t.path.startsWith(full + path.sep));   // a whole folder was removed or moved
  for (const t of gone) await queueChange({ kind: 'rm', path: t.path, size: t.size, mtime: t.mtime });
}
async function settle(full, n, lastSize) {
  if (scanning) { timers.set(full, setTimeout(() => settle(full, n, lastSize), 1500)); return; }
  const root = rootOf(full);
  if (!root) { timers.delete(full); return; }
  let st;
  try { st = await fsp.stat(full); } catch (e) { timers.delete(full); await handleGone(full, root); return; }
  if (st.isDirectory()) {                           // a folder appeared (copied or moved in): look inside it
    timers.delete(full);
    try { for (const ent of await fsp.readdir(full, { withFileTypes: true })) { const p = path.join(full, ent.name); if (ent.isDirectory() || scanner.isAudio(p)) schedule(p); } } catch (e) { /* ignore */ }
    return;
  }
  if (!scanner.isAudio(full)) { timers.delete(full); return; }
  if (st.size !== lastSize && n < 40) { timers.set(full, setTimeout(() => settle(full, n + 1, st.size), 700)); return; } // still being written
  timers.delete(full);
  const t = await scanner.readTrack(full, root.path, root.main, watchTags);
  if (!t) return;
  const known = libTracks().find(x => x.path === full);
  if (known) {                                      // same path: the file was modified
    if (known.size !== t.size || known.mtime !== t.mtime) { await libUpdate(all => [...all.filter(x => x.path !== full), t]); send('watch:updated', t); }
    return;
  }
  await queueChange({ kind: 'add', path: full, size: t.size, mtime: t.mtime, track: t });
}
function schedule(full) {
  clearTimeout(timers.get(full));
  timers.set(full, setTimeout(() => settle(full, 0, -1), 800));
}
function setState(state, message) {
  if (state !== lastState) { lastState = state; send('watch:status', { state, message }); }
}
function stopWatch() {
  for (const w of watchers.values()) { try { w.close(); } catch (e) { /* ignore */ } }
  watchers.clear();
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  for (const p of pending) clearTimeout(p.timer);
  pending.length = 0;
  clearInterval(retryTimer); retryTimer = null;
}
function openWatchers() {
  let ok = 0, lastErr = '';
  for (const r of watchRoots) {
    if (watchers.has(r.path)) { ok++; continue; }
    try {
      if (!fs.statSync(r.path).isDirectory()) throw new Error('Not a folder');
      const w = fs.watch(r.path, { recursive: true }, (_evt, fname) => { if (fname) schedule(path.join(r.path, String(fname))); });
      w.on('error', e => { try { w.close(); } catch (x) { /* ignore */ } watchers.delete(r.path); setState('error', e.message); });
      watchers.set(r.path, w); ok++;
    } catch (e) { lastErr = e.message; }
  }
  return ok === watchRoots.length ? { state: 'listening' } : { state: 'error', message: lastErr || 'Folder not available' };
}
// Monitoring is always on for the music folder (and the extra synced folder, if one is set)
function startWatch(roots, tags) {
  stopWatch();
  watchRoots = (roots || []).filter(r => r && r.path);
  watchTags = tags !== false;
  if (!watchRoots.length) { lastState = 'off'; return { state: 'off' }; }
  const st = openWatchers();
  lastState = st.state;
  // If a drive is unplugged and plugged back in, start listening again automatically
  retryTimer = setInterval(() => {
    const s2 = openWatchers();
    if (s2.state === 'listening' && lastState !== 'listening') setState('listening');
    else if (s2.state === 'error') setState('error', s2.message);
  }, 8000);
  return st;
}

/* ---------- Images of playlists and folders ---------- */
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const safeName = n => typeof n === 'string' && n === path.basename(n) && IMG_EXT.has(path.extname(n).toLowerCase());

// The operating system user name (the same one a terminal prompt shows, e.g. "user" in user@hostname). It never leaves this computer.
function osUserName() {
  try { return os.userInfo().username || ''; } catch (e) { return process.env.USERNAME || process.env.USER || ''; }
}

function registerIpc() {
  ipcMain.on('win:titlebar-dark', (_e, dark) => {   // window buttons readable on dark and light themes
    try { if (win && !win.isDestroyed() && win.setTitleBarOverlay && process.platform !== 'darwin') win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#ffffff' : '#111111', height: 40 }); } catch (e) { /* not supported */ }
  });
  ipcMain.handle('app:init', () => ({
    dataDir,
    version: app.getVersion(),
    userName: osUserName(),
    user: readJSON(userFile(), null),
    library: readJSON(libFile(), null)
  }));

  ipcMain.handle('user:save', async (_e, data) => {
    try { await writeJSON(userFile(), data); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.on('user:save-sync', (e, data) => {
    try {
      const tmp = userFile() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, userFile());
      e.returnValue = true;
    } catch (err) { e.returnValue = false; }
  });

  ipcMain.handle('library:scan', async (_e, roots, keep, opts) => {
    if (scanning) return { ok: false, error: 'A scan is already in progress.' };
    scanning = true;
    try {
      const old = readJSON(libFile(), null);
      const list = (roots || []).filter(r => r && r.path);
      const res = await scanner.scan(list, (old && old.tracks) || [], new Set(keep || []), p => send('scan:progress', p), opts || {});
      await writeJSON(libFile(), { version: 2, roots: list, scannedAt: Date.now(), tracks: res.tracks });
      return Object.assign({ ok: true }, res);
    } catch (e) {
      return { ok: false, error: e.message };
    } finally { scanning = false; }
  });

  ipcMain.handle('library:clear', async () => {
    try { await writeJSON(libFile(), { version: 2, roots: [], scannedAt: 0, tracks: [] }); return true; }
    catch (e) { return false; }
  });

  ipcMain.handle('dialog:folder', async (_e, title) => {
    const r = await dialog.showOpenDialog(win, { title: title || 'Choose a folder', properties: ['openDirectory'] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });

  ipcMain.handle('folder:ok', async (_e, p) => {
    try { return (await fsp.stat(p)).isDirectory(); } catch (e) { return false; }
  });
  ipcMain.handle('file:exists', async (_e, p) => {
    try { await fsp.access(p); return true; } catch (e) { return false; }
  });
  ipcMain.handle('file:cover', (_e, p, opts) => scanner.getCover(p, opts));
  ipcMain.handle('file:reveal', (_e, p) => { shell.showItemInFolder(p); });

  // Images: the renderer compresses the picture, the main process stores it in PocketwaveData/images
  ipcMain.handle('image:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a photo', properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const src = r.filePaths[0];
    try {
      if (!IMG_EXT.has(path.extname(src).toLowerCase())) return { ok: false, error: 'Unsupported image type.' };
      const st = await fsp.stat(src);
      if (st.size > 40 * 1024 * 1024) return { ok: false, error: 'The image is larger than 40 MB.' };
      return { ok: true, bytes: await fsp.readFile(src) };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('image:save', async (_e, bytes) => {
    try {
      const buf = Buffer.from(bytes);
      if (!buf.length || buf.length > 8 * 1024 * 1024) return { ok: false, error: 'Invalid image data.' };
      await fsp.mkdir(imagesDir(), { recursive: true });
      const name = Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + '.jpg';
      await fsp.writeFile(path.join(imagesDir(), name), buf);
      return { ok: true, name };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('image:remove', async (_e, name) => {
    if (!safeName(name)) return false;
    try { await fsp.unlink(path.join(imagesDir(), name)); return true; } catch (e) { return false; }
  });
  ipcMain.handle('image:info', async () => {
    try {
      const files = (await fsp.readdir(imagesDir())).filter(safeName);
      let bytes = 0;
      for (const f of files) bytes += (await fsp.stat(path.join(imagesDir(), f))).size;
      return { dir: imagesDir(), count: files.length, bytes };
    } catch (e) { return { dir: imagesDir(), count: 0, bytes: 0 }; }
  });
  ipcMain.handle('image:clear', async () => {
    try { for (const f of (await fsp.readdir(imagesDir())).filter(safeName)) await fsp.unlink(path.join(imagesDir(), f)); } catch (e) { /* ignore */ }
    return true;
  });
  ipcMain.handle('image:open', async () => {
    await fsp.mkdir(imagesDir(), { recursive: true });
    const err = await shell.openPath(imagesDir());
    return err ? { ok: false, error: err } : { ok: true };
  });

  // Playlists in M3U / M3U8 format (backup and compatibility with other players)
  ipcMain.handle('m3u:export', async (_e, name, entries) => {
    const safe = String(name || 'playlist').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'playlist';
    const r = await dialog.showSaveDialog(win, {
      title: 'Export playlist', defaultPath: safe + '.m3u8',
      filters: [{ name: 'M3U8 playlist', extensions: ['m3u8'] }, { name: 'M3U playlist', extensions: ['m3u'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try {
      const dir = path.dirname(r.filePath);
      const lines = ['#EXTM3U', '#PLAYLIST:' + String(name || '')];
      for (const e of entries || []) {
        const secs = Math.round(e.duration || 0);
        lines.push(`#EXTINF:${secs > 0 ? secs : -1},${e.artist ? e.artist + ' - ' : ''}${e.title || ''}`);
        const rel = path.relative(dir, e.path);
        lines.push(rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : e.path);   // relative when possible, so the playlist keeps working if the folder moves
      }
      await fsp.writeFile(r.filePath, lines.join('\n') + '\n', 'utf8');
      return { ok: true, file: r.filePath, count: (entries || []).length };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('m3u:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Import playlist', properties: ['openFile'],
      filters: [{ name: 'M3U / M3U8 playlist', extensions: ['m3u8', 'm3u'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      const file = r.filePaths[0];
      const st = await fsp.stat(file);
      if (st.size > 20 * 1024 * 1024) return { ok: false, error: 'The playlist file is too large.' };
      const buf = await fsp.readFile(file);
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = buf.toString('latin1'); }
      const dir = path.dirname(file), entries = [];
      let info = null;
      for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('#EXTINF:')) {
          const m = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)\s*,(.*)$/.exec(line);
          if (m) { const t = m[2].trim(), i = t.indexOf(' - '); info = { duration: Math.max(0, +m[1]), artist: i > 0 ? t.slice(0, i) : '', title: i > 0 ? t.slice(i + 3) : t }; }
          continue;
        }
        if (line.startsWith('#')) continue;
        let p = line;
        if (/^file:\/\//i.test(p)) { try { p = require('url').fileURLToPath(p); } catch (e) { continue; } }
        entries.push(Object.assign({ path: path.resolve(dir, p) }, info || {}));
        info = null;
        if (entries.length >= 5000) break;
      }
      for (const e of entries) {                    // read the songs that exist on disk
        try {
          if ((await fsp.stat(e.path)).isFile() && scanner.isAudio(e.path)) { e.track = await scanner.readTrack(e.path, path.dirname(e.path), true, true); }
        } catch (err) { /* the file does not exist */ }
      }
      return { ok: true, name: path.basename(file, path.extname(file)), entries };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('library:addExtras', async (_e, tracks) => {
    try {
      const add = (tracks || []).map(t => Object.assign({}, t, { extra: true }));
      await libUpdate(all => [...all.filter(x => !add.some(a => a.path === x.path)), ...add]);
      return true;
    } catch (e) { return false; }
  });

  ipcMain.handle('watch:set', (_e, roots, tags) => startWatch(roots, tags));

  ipcMain.handle('data:relocate', async () => {
    const sel = await dialog.showOpenDialog(win, { title: 'Folder for Pocketwave data', properties: ['openDirectory', 'createDirectory'] });
    if (sel.canceled || !sel.filePaths[0]) return null;
    const d = path.join(sel.filePaths[0], 'PocketwaveData');
    if (!isWritable(d)) return null;
    for (const f of ['userdata.json', 'library.json']) {
      try { fs.copyFileSync(path.join(dataDir, f), path.join(d, f)); } catch (e) { /* may not exist */ }
    }
    try { fs.cpSync(imagesDir(), path.join(d, 'images'), { recursive: true }); } catch (e) { /* no images yet */ }
    dataDir = d;
    try {
      fs.mkdirSync(path.dirname(pointerFile()), { recursive: true });
      fs.writeFileSync(pointerFile(), d);
    } catch (e) { /* ignore */ }
    return d;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    // macOS needs a menu for the standard keyboard shortcuts (copy, paste, quit); other systems use no menu bar
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
    resolveDataDirInteractive();
    registerIpc();
    createWindow();
    // Keyboard media keys also work when Pocketwave is in the background
    for (const [key, name] of [['MediaPlayPause', 'play-pause'], ['MediaNextTrack', 'next'], ['MediaPreviousTrack', 'prev'], ['MediaStop', 'stop']]) {
      try { globalShortcut.register(key, () => send('media:key', name)); } catch (e) { /* another app owns this key */ }
    }
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => { stopWatch(); app.quit(); });
}
