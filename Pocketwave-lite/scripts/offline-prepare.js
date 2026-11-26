'use strict';
/* Offline build helper. Joins the Electron runtime stored in ../components/electron-parts into one zip and checks every checksum.
 *
 *   node scripts/offline-prepare.js <components folder> <output folder> <platform-arch>      (example: win32-x64)
 *
 * Exit code 0: the zip is ready in the output folder. 2: this platform is not in components (the launcher then builds online). 1: damaged files.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [comp, out, target] = process.argv.slice(2);
if (!comp || !out || !target) { console.error('Usage: node offline-prepare.js <components> <output> <platform-arch>'); process.exit(1); }
const stamp = () => new Date().toTimeString().slice(0, 8);
const log = m => console.log(`  [${stamp()}] ${m}`);

function sha256(file) {
  return new Promise((res, rej) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
  });
}

(async () => {
  const meta = JSON.parse(fs.readFileSync(path.join(comp, 'electron-checksums.json'), 'utf8'));
  const entry = (meta.files || []).find(f => `${f.platform}-${f.arch}` === target);
  if (!entry) { log(`No Electron runtime for ${target} in components.`); process.exit(2); }
  fs.mkdirSync(out, { recursive: true });
  const zip = path.join(out, entry.name);
  fs.rmSync(zip, { force: true });
  const w = fs.openSync(zip, 'w');
  let n = 0;
  for (const p of entry.parts) {
    const file = path.join(comp, 'electron-parts', p.name);
    if (!fs.existsSync(file)) { log(`Missing file: ${p.name}`); process.exit(1); }
    if (fs.statSync(file).size !== p.size || await sha256(file) !== p.sha256) { log(`Damaged file (checksum mismatch): ${p.name}`); process.exit(1); }
    fs.writeSync(w, fs.readFileSync(file));
    log(`Part ${++n}/${entry.parts.length} verified: ${p.name}`);
  }
  fs.closeSync(w);
  if (await sha256(zip) !== entry.sha256) { log('The joined Electron runtime does not match the official checksum.'); process.exit(1); }
  log(`Electron ${meta.electron} for ${target} is ready (official SHA-256 verified).`);
})().catch(e => { console.error('  ' + e.message); process.exit(1); });
