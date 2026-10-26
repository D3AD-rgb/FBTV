// Builds the app and packages it as an IPK with the official LG CLI (ares-package).
// Usage: npm run package [-- --skip-build] [--with-library [--library-server <url>|--library-server-file <file>|--no-library-server]]
// --with-library bundles the local source library (build-data/library-export) for your own TV.
// Such a package is named …-local… and must not be published. It also records library server
// addresses (library/server.json) that the TV tries in order: those in --library-server-file (one
// per line, e.g. an always-on server), then this PC's home-network address ("npm run
// library:serve"), then the bundled copy.
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
  // --library-server-file: addresses, one per line (keeps an access key out of shell history).
  const fromFile = arg('library-server-file', null);
  const given = fromFile
    ? readFileSync(String(fromFile), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    : arg('library-server', null)
      ? [String(arg('library-server', null))]
      : [];
  const ip = lanAddress();
  const urls = given.concat(ip && !arg('no-pc', false) ? [`http://${ip}:8787/registry.json`] : []);
  for (const url of urls)
    if (!/^https?:\/\/[^/\s]+(\/k\/[A-Za-z0-9_-]{16,128})?\/registry\.json$/.test(url))
      throw new Error('A library server must look like http://<pc-ip>:8787/registry.json or https://<host>/k/<key>/registry.json');
  if (urls.length) {
    writeFileSync(resolve(appDir, 'library', 'server.json'), JSON.stringify({ urls }));
    console.log(`The TV tries, in order: ${urls.map((u) => u.replace(/\/k\/([^/]{4})[^/]*/, '/k/$1…')).join(', ')}, then the bundled copy.`);
  } else console.log('No library server address: the TV will use the bundled library only.');
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
