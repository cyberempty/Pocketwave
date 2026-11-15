'use strict';
// Library scanning: READ-ONLY. It never modifies, moves or deletes any file.
const fs = require('fs');
const path = require('path');
const mm = require('music-metadata');

const EXTS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.aac', '.m4a']);
const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information']);
const isAudio = p => EXTS.has(path.extname(p).toLowerCase());

function isUnder(root, p) {
  const rel = path.relative(root, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

async function listFiles(root, errors) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (dir === root) throw new Error('The folder is not accessible: ' + root);
      errors.push(dir);
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name.toLowerCase())) stack.push(full);
      } else if (ent.isFile() && isAudio(ent.name)) {
        files.push(full);
      }
    }
  }
  return files;
}

// Songs of the main music folder get a path relative to it; songs of the synced folder are prefixed with its name
function relFor(root, folder, isMain) {
  const rel = path.relative(root, folder);
  if (isMain) return rel;
  const name = path.basename(root) || root.replace(/[\\/:]/g, '');
  return rel ? name + '/' + rel.split(path.sep).join('/') : name;
}

async function buildTrack(p, root, isMain, old, readTags) {
  let st;
  try { st = await fs.promises.stat(p); } catch (e) { return null; }
  const folder = path.dirname(p);
  const rel = relFor(root, folder, isMain);
  const mtime = Math.floor(st.mtimeMs);
  if (old && !old.extra && old.size === st.size && old.mtime === mtime && !!old.tagged === !!readTags) {
    return Object.assign({}, old, { folder, rel, root, extra: false });
  }
  let md = null;
  try { md = await mm.parseFile(p, { skipCovers: true, duration: true }); } catch (e) { md = null; }
  const c = md && readTags ? md.common : {};
  return {
    path: p,
    title: (c.title || '').trim() || path.basename(p, path.extname(p)),
    artist: (c.artist || c.albumartist || '').trim(),
    album: (c.album || '').trim(),
    track: (c.track && c.track.no) || 0,
    duration: (md && md.format && md.format.duration) || 0,
    folder, rel, root, size: st.size, mtime,
    tagged: !!readTags,
    bad: !md,
    extra: false
  };
}

// roots: [{ path, main }]. The first root is the main music folder.
async function scan(roots, oldTracks, keep, onProgress, opts) {
  const readTags = !opts || opts.readTags !== false;
  const errors = [];
  onProgress && onProgress({ phase: 'list', done: 0, total: 0 });
  const jobs = [];
  const seen = new Set();
  for (const r of roots) {
    let files;
    try { files = await listFiles(r.path, errors); } catch (e) { if (r.main) throw e; errors.push(r.path); continue; }
    for (const f of files) if (!seen.has(f)) { seen.add(f); jobs.push({ p: f, root: r.path, main: r.main }); }
  }
  const oldMap = new Map((oldTracks || []).map(t => [t.path, t]));
  const out = new Array(jobs.length);
  let next = 0, done = 0, lastTick = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      const j = jobs[i];
      out[i] = await buildTrack(j.p, j.root, j.main, oldMap.get(j.p), readTags);
      done++;
      const now = Date.now();
      if (onProgress && now - lastTick > 120) {
        lastTick = now;
        onProgress({ phase: 'read', done, total: jobs.length });
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  const tracks = out.filter(Boolean);
  const found = new Set(tracks.map(t => t.path));
  const old = oldTracks || [];
  const added = tracks.filter(t => !oldMap.has(t.path) || oldMap.get(t.path).extra).length;
  // Songs that disappeared from the scanned folders (songs of a previous folder are not counted)
  const removedPaths = old.filter(t => !t.extra && !found.has(t.path) && roots.some(r => isUnder(r.path, t.path))).map(t => t.path);
  const removed = removedPaths.length;
  const unreadable = tracks.filter(t => t.bad).length;

  // Keep metadata of songs used in favorites/playlists that live outside the scanned folders
  const keepSet = keep || new Set();
  for (const t of old) {
    if (!found.has(t.path) && keepSet.has(t.path) && !roots.some(r => isUnder(r.path, t.path))) {
      tracks.push(Object.assign({}, t, { extra: true }));
    }
  }
  onProgress && onProgress({ phase: 'read', done: jobs.length, total: jobs.length });
  return { tracks, added, removed, removedPaths, unreadable, skippedFolders: errors.length };
}

const readTrack = (p, root, isMain, readTags) => buildTrack(p, root, isMain, null, readTags !== false);

async function getCoverBuffer(p, useTags) {
  if (useTags) {
    try {
      const md = await mm.parseFile(p, { duration: false });
      const pic = mm.selectCover(md.common.picture);
      if (pic) return Buffer.from(pic.data);
    } catch (e) { /* fall back to a cover image in the folder */ }
  }
  const dir = path.dirname(p);
  for (const n of ['cover', 'folder', 'front', 'album', 'albumart']) {
    for (const e of ['.jpg', '.jpeg', '.png']) {
      try {
        const buf = await fs.promises.readFile(path.join(dir, n + e));
        if (buf.length < 8 * 1024 * 1024) return buf;
      } catch (err) { /* keep trying */ }
    }
  }
  return null;
}

// Returns the cover as a data URL
async function getCover(p, opts) {
  const buf = await getCoverBuffer(p, !opts || opts.tags !== false);
  if (!buf) return null;
  const mime = buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png'
    : buf[0] === 0x47 && buf[1] === 0x49 ? 'image/gif'
    : buf[0] === 0x52 && buf[1] === 0x49 ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

module.exports = { scan, readTrack, getCover, EXTS, isAudio, isUnder };
