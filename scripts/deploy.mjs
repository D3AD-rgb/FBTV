// Installs the packaged IPK on the TV and launches it.
// Usage: npm run deploy [-- --device tv] [--ipk path] [--inspect] [--no-launch]
// The device must already be registered with `ares-setup-device` (see docs/deploy-webos.md).
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ROOT, appConfig, ares, run, arg } from './lib/util.mjs';

const cfg = appConfig();
const device = String(arg('device', process.env.FBTV_DEVICE || 'tv'));

/** Newest IPK for this app in releases/ (release or dev build), unless --ipk is given. */
function newestIpk() {
  const dir = resolve(ROOT, 'releases');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(`${cfg.appId}_`) && f.endsWith('_all.ipk'))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files.length ? join(dir, files[0].f) : null;
}
const chosen = arg('ipk', null);
const ipk = chosen ? resolve(ROOT, String(chosen)) : newestIpk();
if (!ipk) {
  console.error('No package found in releases/. Run "npm run package" first.');
  process.exit(1);
}

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
