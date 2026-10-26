// Builds the app and packages it as an IPK with the official LG CLI (ares-package).
// Usage: npm run package [-- --skip-build] [--with-library [--library-server <url>|--no-library-server]]
// --with-library bundles the local source library (build-data/library-export) for your own TV.
// Such a package is named …-local… and must not be published. It also records this PC's
// home-network address (library/server.json), so the TV uses "npm run library:serve" whenever
// it is running, and the bundled copy otherwise.
import { mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { networkInterfaces, tmpdir } from 'node:os';
import { ROOT, appConfig, ares, run, out, arg, ipkName } from './lib/util.mjs';

const cfg = appConfig();
const appDir = resolve(ROOT, 'dist', 'app');
const outDir = resolve(ROOT, 'releases');

const withLibrary = !!arg('with-library', false);
if (withLibrary) process.env.FBTV_BUNDLE_LIBRARY = '1';
if (!arg('skip-build', false)) run(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build']);
const bundled = existsSync(resolve(appDir, 'library', 'registry.json'));
if (withLibrary && !bundled) throw new Error('--with-library: no library in dist/app/library. Run "npm run library:refresh" first.');
if (!existsSync(resolve(appDir, 'appinfo.json'))) throw new Error('dist/app/appinfo.json missing — build first.');
if (withLibrary && !arg('no-library-server', false)) {
  const given = arg('library-server', null);
  const ip = lanAddress();
  const url = given ? String(given) : ip ? `http://${ip}:8787/registry.json` : null;
  if (url && !/^http:\/\/[^/]+\/registry\.json$/.test(url)) throw new Error(`--library-server must look like http://<pc-ip>:8787/registry.json (got ${url})`);
  if (url) {
    writeFileSync(resolve(appDir, 'library', 'server.json'), JSON.stringify({ url }));
    console.log(`The TV will use your PC's library at ${url} when "npm run library:serve" is running.`);
  } else console.log('No home-network address found: the TV will use the bundled library only.');
}

mkdirSync(outDir, { recursive: true });
run(ares('ares-package'), ['--check', appDir]);
// Package into a temp folder: the IPK name only contains the version, so a dev build would
// otherwise overwrite the file of the release it was built after.
const tmpOut = mkdtempSync(join(tmpdir(), 'fbtv-ipk-'));
run(ares('ares-package'), ['--outdir', tmpOut, appDir]);

const version = JSON.parse(readFileSync(resolve(appDir, 'appinfo.json'), 'utf8')).version;
const built = join(tmpOut, ipkName(cfg.appId, version));
if (!existsSync(built)) throw new Error(`Expected package not found: ${built}`);

// Release builds (HEAD is exactly tag v<version>, clean tree) keep the canonical name;
// anything else is a dev build named <id>_<version>-dev.<commit>_all.ipk.
let name = ipkName(cfg.appId, version);
const tagged = tryOut('git', ['describe', '--tags', '--exact-match', 'HEAD']) === `v${version}`;
const clean = tryOut('git', ['status', '--porcelain']) === '';
if (!tagged || !clean || bundled) {
  const commit = tryOut('git', ['rev-parse', '--short', 'HEAD']) || 'nogit';
  name = `${cfg.appId}_${version}-${bundled ? 'local' : 'dev'}.${commit}${clean ? '' : '.dirty'}_all.ipk`;
}
const ipk = resolve(outDir, name);
copyFileSync(built, ipk);
const sha = createHash('sha256').update(readFileSync(ipk)).digest('hex');
writeFileSync(`${ipk}.sha256`, `${sha}  ${name}\n`);
console.log(`\nPackaged ${ipk}\nSHA-256 ${sha}`);
if (bundled) console.log('Contains your local source library: install it on your own TV only, do not publish it.');

/** First private IPv4 address of this PC (the one library:serve binds to). */
function lanAddress() {
  const ifs = networkInterfaces();
  for (const k of Object.keys(ifs))
    for (const a of ifs[k] || []) if (a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) return a.address;
  return null;
}

function tryOut(cmd, args) {
  try {
    return out(cmd, args);
  } catch {
    return '';
  }
}
