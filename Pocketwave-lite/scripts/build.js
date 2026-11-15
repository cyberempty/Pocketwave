'use strict';
/* Builds the portable version of Pocketwave into ./dist
 *
 *   npm run build:win          Windows x64   (also: build:linux, build:mac)
 *   node scripts/build.js      the system you are running on
 *   node scripts/build.js --platform=win32|linux|darwin --arch=x64|arm64
 *   node scripts/build.js --electron=X.Y.Z    any other Electron version
 *   npm run build:win:latest   a newer Electron (more recent Chromium security fixes, but about 60 MB larger)
 *
 * The result is the folder dist/Pocketwave-<platform>-<arch>. The one-click launchers (Build-Pocketwave.bat for
 * Windows, Build-Pocketwave.sh for Linux, Build-Pocketwave.command for macOS) call this script and then move that
 * folder to ./Pocketwave-portable.
 */
const fs = require('fs');
const path = require('path');
const packager = require('@electron/packager');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const argv = name => { const a = process.argv.find(x => x.startsWith('--' + name + '=')); return a ? a.split('=')[1] : null; };
const electronVersion = argv('electron') || pkg.devDependencies.electron.replace(/^[^\d]*/, '');
const platform = argv('platform') || process.platform;
const arch = argv('arch') || process.arch;
const SIZE_LIMIT_MB = 250;

const MIT_LICENSE = `MIT License

Copyright (c) 2026 Pocketwave Authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

function folderSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? folderSize(p) : fs.lstatSync(p).size;
  }
  return total;
}

// Embeds assets/icon.ico into Pocketwave.exe (Windows only)
function embedWindowsIcon(outDir) {
  const ResEdit = require('resedit');
  const exePath = path.join(outDir, 'Pocketwave.exe');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(root, 'assets', 'icon.ico')));
  const gid = groups.length ? groups[0].id : 1, glang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, glang, ico.icons.map(i => i.data));
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
}

(async () => {
  if (!['win32', 'linux', 'darwin'].includes(platform)) throw new Error('Unsupported platform: ' + platform);
  if (!['x64', 'arm64'].includes(arch)) throw new Error('Unsupported architecture: ' + arch);
  console.log(`Electron ${electronVersion} for ${platform}-${arch}`);
  const [outDir] = await packager({
    dir: root,
    name: 'Pocketwave',
    platform,
    arch,
    electronVersion,
    out: path.join(root, 'dist'),
    overwrite: true,
    asar: true,
    prune: true,
    ignore: [/^\/dist/, /^\/scripts/, /^\/\.git/, /^\/PocketwaveData/, /^\/Pocketwave-portable/, /^\/runtime/, /^\/node_modules\/\.cache/, /^\/Build-Pocketwave/],
    // macOS uses assets/icon.icns; the Windows icon is embedded below and Linux uses assets/icon.png at run time
    ...(platform === 'darwin' ? { icon: path.join(root, 'assets', 'icon.icns') } : {}),
    appCopyright: 'Copyright (c) 2026 Pocketwave Authors'
  });

  if (platform === 'win32') embedWindowsIcon(outDir);

  // Size reductions that do not change how the program works:
  //  - the program is English only, so only the English Chromium locale file is kept (Windows and Linux);
  //  - the DirectX shader compiler (dxcompiler / dxil, Windows) is only used for WebGPU, which Pocketwave does not use.
  if (platform !== 'darwin') {
    const loc = path.join(outDir, 'locales');
    for (const f of fs.readdirSync(loc)) if (f !== 'en-US.pak') fs.rmSync(path.join(loc, f));
  }
  if (platform === 'win32') for (const f of ['dxcompiler.dll', 'dxil.dll']) fs.rmSync(path.join(outDir, f), { force: true });

  // Licenses: Pocketwave (MIT) at the top level, third-party notices and this README in ./licenses
  const lic = path.join(outDir, 'licenses');
  fs.mkdirSync(lic, { recursive: true });
  fs.renameSync(path.join(outDir, 'LICENSE'), path.join(lic, 'Electron-LICENSE.txt'));
  fs.renameSync(path.join(outDir, 'LICENSES.chromium.html'), path.join(lic, 'Chromium-LICENSES.html'));
  fs.writeFileSync(path.join(outDir, 'LICENSE'), MIT_LICENSE);
  if (fs.existsSync(path.join(root, 'README.md'))) fs.copyFileSync(path.join(root, 'README.md'), path.join(lic, 'README.md'));   // the README travels inside the licenses folder when present
  fs.writeFileSync(path.join(lic, 'THIRD-PARTY-NOTICES.txt'),
`Pocketwave is licensed under the MIT License (see ../LICENSE).

It is built on the following open-source components:

- Electron ${electronVersion} (MIT) - see Electron-LICENSE.txt
- Chromium and its dependencies (BSD-style and other permissive licenses) - see Chromium-LICENSES.html
- music-metadata ${pkg.dependencies['music-metadata']} (MIT) and its dependencies, whose license files
  are bundled inside the application archive (app.asar) under node_modules/
`);

  const mb = folderSize(outDir) / 1048576;
  console.log(`Build ready: ${outDir}`);
  console.log(`Extracted size: ${mb.toFixed(0)} MB ${mb <= SIZE_LIMIT_MB ? '(under the ' + SIZE_LIMIT_MB + ' MB goal)' : '(over the ' + SIZE_LIMIT_MB + ' MB goal)'}`);
})().catch(e => { console.error(e); process.exit(1); });
