// Installs the packaged IPK on the TV and launches it.
// Usage: npm run deploy [-- --device tv] [--ipk path] [--inspect] [--no-launch]
// The device must already be registered with `ares-setup-device` (see docs/deploy-webos.md).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, appConfig, ares, run, arg, ipkName } from './lib/util.mjs';

const cfg = appConfig();
const device = String(arg('device', process.env.FBTV_DEVICE || 'tv'));
const appinfoPath = resolve(ROOT, 'dist', 'app', 'appinfo.json');
const version = existsSync(appinfoPath) ? JSON.parse(readFileSync(appinfoPath, 'utf8')).version : cfg.version;
const ipk = resolve(ROOT, String(arg('ipk', resolve('releases', ipkName(cfg.appId, version)))));

if (!existsSync(ipk)) {
  console.error(`Package not found: ${ipk}\nRun "npm run package" first.`);
  process.exit(1);
}

console.log(`Installing ${ipk} on device "${device}"…`);
run(ares('ares-install'), ['--device', device, ipk]);

if (!arg('no-launch', false)) {
  console.log(`Launching ${cfg.appId}…`);
  run(ares('ares-launch'), ['--device', device, cfg.appId]);
}
if (arg('inspect', false)) {
  run(ares('ares-inspect'), ['--device', device, '--app', cfg.appId, '--open']);
}
console.log(
  '\nReminder: Developer Mode sessions expire (about 50 hours). Extend the session in the ' +
    'Developer Mode app on the TV, or sideloaded apps are removed.',
);
