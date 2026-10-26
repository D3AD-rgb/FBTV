// Builds the app and packages it as an IPK with the official LG CLI (ares-package).
// Usage: npm run package [-- --skip-build]
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ROOT, appConfig, ares, run, arg, ipkName } from './lib/util.mjs';

const cfg = appConfig();
const appDir = resolve(ROOT, 'dist', 'app');
const outDir = resolve(ROOT, 'releases');

if (!arg('skip-build', false)) run(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build']);
if (!existsSync(resolve(appDir, 'appinfo.json'))) throw new Error('dist/app/appinfo.json missing — build first.');

mkdirSync(outDir, { recursive: true });
run(ares('ares-package'), ['--check', appDir]);
run(ares('ares-package'), ['--outdir', outDir, appDir]);

const version = JSON.parse(readFileSync(resolve(appDir, 'appinfo.json'), 'utf8')).version;
const ipk = resolve(outDir, ipkName(cfg.appId, version));
if (!existsSync(ipk)) throw new Error(`Expected package not found: ${ipk}`);
const sha = createHash('sha256').update(readFileSync(ipk)).digest('hex');
writeFileSync(`${ipk}.sha256`, `${sha}  ${ipkName(cfg.appId, version)}\n`);
console.log(`\nPackaged ${ipk}\nSHA-256 ${sha}`);
