/**
 * Other apps on the TV: which official broadcaster apps are installed, and opening them
 * (Luna com.webos.applicationManager; ACG application.query / application.launcher).
 *
 * Installed apps are found by asking the TV for its launch points and matching titles; when that
 * is not available, known app ids are checked with getAppLoadStatus. Nothing is guessed silently:
 * Diagnostics shows what was found.
 */
import { signal } from '@preact/signals';
import { isWebOS, lunaCall } from './webos.ts';

export interface ServiceApp {
  /** Streaming service, e.g. "NOW (Sky Sports)". */
  label: string;
  /** What viewers call it, for small cards ("Sky Sports"). */
  short: string;
  /** Broadcaster or channel names this service carries (rights data, TV listings). */
  carries: RegExp;
  /** Launch-point titles of its LG app. */
  title: RegExp;
  /** Known LG app ids, tried when launch points cannot be listed. */
  ids: string[];
}

/** Official apps for the broadcasters FBTV lists (UK first). */
export const SERVICES: ServiceApp[] = [
  { label: 'NOW (Sky Sports)', short: 'Sky Sports', carries: /\bsky sports?\b|^now\b|\bnow tv\b/i, title: /^now\b|now tv/i, ids: ['com.nowtv.uk', 'uk.co.nowtv'] },
  { label: 'HBO Max (TNT Sports)', short: 'TNT Sports', carries: /\btnt sports\b|hbo max|discovery\+/i, title: /hbo max|tnt sports|discovery\+/i, ids: ['com.hbo.hbomax', 'com.wbd.hbomax'] },
  { label: 'Prime Video', short: 'Prime Video', carries: /amazon|prime video/i, title: /prime video|amazon/i, ids: ['amazon'] },
  { label: 'BBC iPlayer', short: 'BBC', carries: /\bbbc\b|iplayer/i, title: /iplayer/i, ids: ['bbc.iplayer.3.0'] },
  { label: 'ITVX', short: 'ITV', carries: /\bitv\d?\b|itvx/i, title: /itvx|\bitv\b/i, ids: ['com.itv.itvx'] },
  { label: 'Channel 4', short: 'Channel 4', carries: /channel 4/i, title: /channel 4/i, ids: ['com.channel4.ondemand'] },
  { label: 'Channel 5', short: 'Channel 5', carries: /channel 5|\b5 action\b|my5/i, title: /channel 5|my5/i, ids: ['com.channel5.my5'] },
  { label: 'DAZN', short: 'DAZN', carries: /\bdazn\b/i, title: /dazn/i, ids: ['dazn', 'com.dazn.dazn'] },
  { label: 'Apple TV', short: 'Apple TV', carries: /apple tv/i, title: /apple tv/i, ids: ['com.apple.appletv'] },
  { label: 'Paramount+', short: 'Paramount+', carries: /paramount\+/i, title: /paramount/i, ids: ['com.cbs-ott.2'] },
  { label: 'Peacock', short: 'Peacock', carries: /peacock|\bnbc\b|usa network|telemundo/i, title: /peacock/i, ids: ['com.peacocktv.peacock'] },
  { label: 'YouTube', short: 'YouTube', carries: /youtube|cazétv|cazetv|livemode/i, title: /^youtube$/i, ids: ['youtube.leanback.v4'] },
];

/** Services that carry a broadcaster or channel name. Pure. */
export function servicesFor(names: string[]): ServiceApp[] {
  const out: ServiceApp[] = [];
  for (const n of names) for (const s of SERVICES) if (s.carries.test(n) && out.indexOf(s) < 0) out.push(s);
  return out;
}

/** label -> installed app id (null = not installed); filled by detectApps(). */
export const installedApps = signal<Record<string, string | null> | null>(null);
export const appsMethod = signal<'launch-points' | 'load-status' | 'unavailable' | null>(null);

let detecting: Promise<void> | null = null;

export function detectApps(): Promise<void> {
  if (detecting) return detecting;
  detecting = (async () => {
    const found: Record<string, string | null> = {};
    if (!isWebOS()) {
      for (const s of SERVICES) found[s.label] = null;
      installedApps.value = found;
      appsMethod.value = 'unavailable';
      return;
    }
    try {
      const res = (await lunaCall('luna://com.webos.applicationManager/listLaunchPoints', {}, 5000)) as unknown as { launchPoints?: { id: string; title: string }[] };
      if (res.launchPoints && res.launchPoints.length) {
        for (const s of SERVICES) {
          const lp = res.launchPoints.filter((p) => s.title.test(p.title || ''))[0];
          found[s.label] = lp ? lp.id : null;
        }
        installedApps.value = found;
        appsMethod.value = 'launch-points';
        return;
      }
    } catch {
      // not available to this app; fall back to checking known ids
    }
    for (const s of SERVICES) {
      found[s.label] = null;
      for (const id of s.ids) {
        try {
          const r = (await lunaCall('luna://com.webos.applicationManager/getAppLoadStatus', { appId: id }, 3000)) as unknown as { exist?: boolean };
          if (r.exist) {
            found[s.label] = id;
            break;
          }
        } catch {
          // keep looking
        }
      }
    }
    installedApps.value = found;
    appsMethod.value = 'load-status';
  })();
  return detecting;
}

export async function launchApp(id: string): Promise<boolean> {
  try {
    const r = await lunaCall('luna://com.webos.applicationManager/launch', { id }, 5000);
    return r.returnValue !== false;
  } catch {
    return false;
  }
}

export function shortName(label: string): string {
  const s = SERVICES.filter((x) => x.label === label)[0];
  return s ? s.short : label;
}
