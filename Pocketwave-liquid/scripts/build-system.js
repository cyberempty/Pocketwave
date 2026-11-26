'use strict';
/* Pocketwave Build System: the terminal shown while Pocketwave is built (same look on Windows, Linux and macOS).
 * Started by the launchers (Build-Pocketwave.bat / .sh / .command) once a Node.js is available:
 *   node scripts/build-system.js
 * Six phases: environment, dependencies, Electron runtime, build, portable folder, cleanup.
 * Offline when ../components holds everything for this system, online otherwise.
 * Exit code 0: Pocketwave-portable is ready. 1: the build stopped (the message is on screen).
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RT = path.join(ROOT, 'runtime');
const COMP = path.resolve(ROOT, '..', 'components');
const PORT = path.join(ROOT, 'Pocketwave-portable');
const arg = k => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const PLATFORM = arg('platform') || process.platform, ARCH = arg('arch') || process.arch, TARGET = `${PLATFORM}-${ARCH}`;   // --platform / --arch: build for another system
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const EDITION = path.basename(ROOT).replace(/^pocketwave-?/i, '');
const NAME = 'Pocketwave' + (EDITION ? ' ' + EDITION[0].toUpperCase() + EDITION.slice(1).toLowerCase() : '');
const ELECTRON = ((pkg.devDependencies || {}).electron || '').replace(/^[^\d]*/, '');
const TOTAL = 6;
const START = [0, 10, 35, 50, 92, 96];          // percent at the start of each phase

/* ---------------- offline or online ---------------- */
function offlineReady() {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(COMP, 'electron-checksums.json'), 'utf8'));
    return (meta.files || []).some(f => `${f.platform}-${f.arch}` === TARGET)
      && fs.existsSync(path.join(COMP, 'npm-cache', '_cacache'))
      && fs.existsSync(path.join(COMP, `node-${TARGET}`));
  } catch (e) { return false; }
}
const OFFLINE = offlineReady();

/* ---------------- screen ---------------- */
const tty = !!process.stdout.isTTY;
const paint = (code, t) => tty ? `\x1b[${code}m${t}\x1b[0m` : t;
const c = { dim: t => paint('90', t), bold: t => paint('1;97', t), white: t => paint('97', t), blue: t => paint('1;38;5;75', t),
  green: t => paint('1;32', t), red: t => paint('1;91', t), yellow: t => paint('1;93', t), grey: t => paint('37', t) };
const S = { t0: Date.now(), n: 0, title: 'Starting', status: 'Preparing', pct: 0, state: 'run', logs: [] };
const mmss = ms => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const TAGS = { STEP: c.blue, OK: c.green, ERROR: c.red, WARN: c.yellow, INFO: c.grey };
const fit = (t, max) => max > 1 && t.length > max ? t.slice(0, max - 1) + '…' : t;
const shortPath = p => { const a = p.split(path.sep).filter(Boolean); return a.length > 3 ? '…' + path.sep + a.slice(-3).join(path.sep) : p; };

function log(tag, msg) {
  const time = mmss(Date.now() - S.t0);
  S.logs.push({ time, tag, msg });
  if (!tty) console.log(`[${time}] ${tag.padEnd(5)} ${msg}`);
  draw();
}

function frame() {
  const cols = Math.max(60, (process.stdout.columns || 100)), rows = process.stdout.rows || 30;
  const lab = (k, v) => '  ' + c.dim(k.padEnd(9)) + v;
  const room = cols - 14;
  const mode = OFFLINE ? c.green('Offline') + '  ' + c.white(fit(`(no connection needed: components from ${shortPath(COMP)})`, room - 9))
                       : c.blue('Online') + '  ' + c.white(fit('(components are downloaded: about 140 MB)', room - 8));
  const stCol = S.state === 'fail' ? c.red : S.state === 'ok' ? c.green : c.white;
  const w = Math.max(20, Math.min(cols - 20, 110));
  const filled = Math.round(w * Math.max(0, Math.min(100, S.pct)) / 100);
  const barCol = S.state === 'fail' ? '1;38;5;203' : S.state === 'ok' ? '1;38;5;78' : '1;38;5;75';
  const bar = paint(barCol, '█'.repeat(filled)) + c.dim('░'.repeat(w - filled));
  const head = [
    '',
    '  ' + c.bold(`${NAME.toUpperCase()}  BUILD SYSTEM`),
    '',
    lab('Project', c.white(`${NAME}  (${TARGET})`)),
    lab('Mode', mode),
    lab('Phase', c.white(S.state === 'fail' ? 'Stopped' : S.state === 'ok' ? 'Complete' : `${S.n}/${TOTAL}  ${S.title}`)),
    lab('Status', stCol(fit(S.status, room))),
    '  ' + bar + '  ' + c.white(String(Math.round(S.pct)).padStart(3) + '%') + '  ' + c.white(mmss(Date.now() - S.t0)),
    '  ' + c.dim('─'.repeat(cols - 4)),
  ];
  const keep = Math.max(3, rows - head.length - 2);
  const body = S.logs.slice(-keep).map(l => '  ' + c.dim(l.time) + '  ' + TAGS[l.tag](l.tag.padEnd(5)) + '  ' + (l.tag === 'INFO' ? c.grey : c.white)(fit(l.msg, cols - 18)));
  return head.concat(body);
}
function draw() {
  if (!tty) return;
  process.stdout.write('\x1b[H' + frame().map(l => l + '\x1b[K').join('\n') + '\n\x1b[J');
}
let timer = null;
function startScreen() {
  if (tty) {
    process.stdout.write('\x1b]0;Pocketwave - Build System\x07\x1b[?25l\x1b[2J');
    process.on('exit', () => process.stdout.write('\x1b[?25h'));
    process.on('SIGINT', () => { process.stdout.write('\x1b[?25h\n'); process.exit(130); });
  } else console.log(`${NAME.toUpperCase()}  BUILD SYSTEM  (${TARGET}, ${OFFLINE ? 'offline' : 'online'})`);
  // the bar creeps forward during the long phases, so the screen never looks frozen
  timer = setInterval(() => {
    if (S.state !== 'run') return;
    const next = (START[S.n] !== undefined ? START[S.n] : 100) - 1, from = START[S.n - 1] || 0;
    if ([2, 3, 4].includes(S.n)) S.pct = Math.max(S.pct, Math.min(next, from + (next - from) * (1 - Math.exp(-(Date.now() - S.phaseT) / 20000))));
    draw();
  }, 250);
}

/* ---------------- helpers ---------------- */
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function rmRetry(p) { fs.rmSync(p, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
function nodeDir() { return path.dirname(process.execPath); }
function npmCli() {
  for (const p of [path.join(nodeDir(), 'node_modules', 'npm', 'bin', 'npm-cli.js'), path.join(nodeDir(), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')])
    if (fs.existsSync(p)) return p;
  return null;
}
const ENV = Object.assign({}, process.env, {
  PATH: nodeDir() + path.delimiter + (process.env.PATH || ''),
  npm_config_cache: path.join(RT, 'npm-cache'),
  electron_config_cache: path.join(RT, 'electron-cache'),
  ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
  npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false',
});
if (OFFLINE) ENV.POCKETWAVE_ELECTRON_ZIP_DIR = path.join(RT, 'electron-zip');

function run(args, onLine) {
  return new Promise(resolve => {
    const out = [];
    const p = cp.spawn(process.execPath, args, { cwd: ROOT, env: ENV, windowsHide: true });
    const feed = () => { let rest = ''; return d => { const parts = (rest + d.toString()).split(/\r?\n/); rest = parts.pop(); parts.forEach(l => { if (l.trim()) { out.push(l.trim()); if (onLine) onLine(l.trim()); } }); }; };
    p.stdout.on('data', feed()); p.stderr.on('data', feed());
    p.on('error', e => { out.push(e.message); resolve({ code: 1, out }); });
    p.on('close', code => resolve({ code, out }));
  });
}

function stop(message, hint, out) {
  S.state = 'fail'; S.status = message;
  log('ERROR', message);
  if (hint) log('WARN', hint);
  (out || []).filter(l => !/npm warn deprecated/.test(l)).slice(-12).forEach(l => log('INFO', l));
  if (timer) clearInterval(timer);
  draw();
  console.log('\n  ' + (tty ? '\x1b[1;91m' : '') + `${NAME} could not be built. Please read the message above.` + (tty ? '\x1b[0m' : ''));
  process.exit(1);
}
const HINT_OFF = 'The components folder may be incomplete: copy the whole Pocketwave folder again.';
const HINT_ON = 'Check your Internet connection and try again.';

async function phase(n, title, status, fn) {
  S.n = n; S.title = title; S.status = status; S.pct = START[n - 1]; S.phaseT = Date.now();
  log('STEP', `Phase ${n}/${TOTAL}  ${title}`);
  await fn();
}

/* ---------------- the six phases ---------------- */
(async () => {
  startScreen();
  S.status = 'Starting'; draw();

  await phase(1, 'Checking the environment', 'Checking Node.js and the project', async () => {
    const major = +process.versions.node.split('.')[0];
    if (major < 18) stop(`Node.js ${process.version} is too old (version 18 or newer is needed).`, OFFLINE ? HINT_OFF : null);
    if (!npmCli()) stop('npm was not found next to Node.js.', OFFLINE ? HINT_OFF : null);
    if (!fs.existsSync(path.join(ROOT, 'package-lock.json'))) stop('package-lock.json is missing: copy the whole Pocketwave folder again.');
    log('OK', `Environment  Node.js ${process.version}, ${TARGET}, Electron ${ELECTRON}`);
  });

  await phase(2, 'Project dependencies', OFFLINE ? 'Preparing the local npm cache' : 'Downloading the project packages', async () => {
    try {
      rmRetry(path.join(RT, 'npm-cache'));
      if (OFFLINE) fs.cpSync(path.join(COMP, 'npm-cache'), path.join(RT, 'npm-cache'), { recursive: true });
    } catch (e) { stop('Could not prepare the npm cache: ' + e.message, OFFLINE ? HINT_OFF : null); }
    try { rmRetry(path.join(ROOT, 'node_modules')); } catch (e) { log('WARN', 'An old node_modules folder could not be removed (a program may be using it): ' + e.message); }
    S.status = OFFLINE ? 'Installing the packages from the local cache' : 'Installing the packages';
    const r = await run([npmCli(), 'ci', '--ignore-scripts', '--no-progress', ...(OFFLINE ? ['--offline'] : [])], l => { S.status = l; });
    if (r.code !== 0) stop('npm could not install the dependencies.', OFFLINE ? HINT_OFF : HINT_ON, r.out);
    log('OK', 'Dependencies installed');
  });

  await phase(3, 'Electron runtime', OFFLINE ? 'Verifying the Electron runtime' : 'Electron is downloaded during the build', async () => {
    if (!OFFLINE) { log('INFO', 'The Electron runtime (about 110 MB) is downloaded by the build in the next phase.'); return; }
    const r = await run([path.join(__dirname, 'offline-prepare.js'), COMP, path.join(RT, 'electron-zip'), TARGET], l => { S.status = l.replace(/^\[[\d:]+\]\s*/, ''); });
    if (r.code !== 0) stop('The Electron runtime could not be prepared.', HINT_OFF, r.out);
    r.out.forEach(l => log('INFO', l.replace(/^\[[\d:]+\]\s*/, '')));
    log('OK', `Electron ${ELECTRON} verified (official SHA-256)`);
  });

  await phase(4, 'Building Pocketwave', 'Packaging the application', async () => {
    const r = await run([path.join(__dirname, 'build.js'), `--platform=${PLATFORM}`, `--arch=${ARCH}`], l => { S.status = l; });
    if (r.code !== 0) stop('The build failed.', OFFLINE ? HINT_OFF : HINT_ON, r.out);
    const size = (r.out.find(l => l.startsWith('Extracted size:')) || '').replace('Extracted size: ', '').replace(/\s*\(.*$/, '');
    log('OK', 'Build ready' + (size ? ` (${size})` : ''));
  });

  await phase(5, 'Creating Pocketwave-portable', 'Creating the portable folder', async () => {
    const built = path.join(ROOT, 'dist', `Pocketwave-${PLATFORM}-${ARCH}`);
    try {
      rmRetry(PORT);
      let ok = false;
      for (let i = 0; i < 12 && !ok; i++) { try { fs.renameSync(built, PORT); ok = true; } catch (e) { if (i === 11) throw e; sleep(400); } }   // antivirus may hold the new files for a moment
    } catch (e) { stop('Could not create Pocketwave-portable: ' + e.message); }
    if (PLATFORM === 'darwin') {
      cp.spawnSync('xattr', ['-cr', PORT]);
      cp.spawnSync('codesign', ['--force', '--deep', '--sign', '-', path.join(PORT, 'Pocketwave.app')]);
    } else if (PLATFORM === 'linux') {
      fs.chmodSync(path.join(PORT, 'Pocketwave'), 0o755);
      const l = cp.spawnSync('ldd', [path.join(PORT, 'Pocketwave')], { encoding: 'utf8' });
      const missing = ((l.stdout || '').split('\n')).filter(x => x.includes('not found')).map(x => x.trim());
      if (missing.length) { log('WARN', 'Some system libraries are missing (for example libgtk-3-0, libnss3, libasound2 on Debian / Ubuntu):'); missing.forEach(m => log('INFO', m)); }
    }
    log('OK', 'Created ' + path.basename(PORT));
  });

  await phase(6, 'Cleaning up', 'Removing the temporary files', async () => {
    for (const p of [path.join(ROOT, 'node_modules'), path.join(ROOT, 'dist')]) { try { rmRetry(p); } catch (e) { log('WARN', 'Could not remove ' + path.basename(p) + ': ' + e.message); } }
    // runtime/ is removed by the launcher once this process (and a downloaded Node.js inside it) has ended
    for (const f of fs.existsSync(RT) ? fs.readdirSync(RT) : []) {
      const p = path.join(RT, f);
      if (process.execPath.startsWith(p + path.sep)) continue;
      try { rmRetry(p); } catch (e) { /* the launcher tries again */ }
    }
    log('OK', 'Temporary files removed');
  });

  S.state = 'ok'; S.pct = 100; S.title = 'Done'; S.status = `${NAME} is ready. Starting it...`;
  log('OK', `${NAME} is ready: ${path.basename(PORT)}`);
  if (timer) clearInterval(timer);
  draw();
  if (tty) process.stdout.write('\n');
  sleep(1800);
  process.exit(0);
})().catch(e => stop('Unexpected error: ' + (e && e.message), null, e && e.stack ? e.stack.split('\n') : []));
