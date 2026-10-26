/**
 * Runtime capability probes for Diagnostics. Everything is feature-detected on the
 * actual device; nothing is assumed from the webOS version.
 */
export type Support = 'yes' | 'maybe' | 'no';

export interface Probe {
  label: string;
  value: Support | string;
}

function canPlay(video: HTMLVideoElement, type: string): Support {
  const r = video.canPlayType(type);
  return r === 'probably' ? 'yes' : r === 'maybe' ? 'maybe' : 'no';
}

function mse(type: string): Support {
  const MS = (window as unknown as { MediaSource?: { isTypeSupported(t: string): boolean } }).MediaSource;
  if (!MS || typeof MS.isTypeSupported !== 'function') return 'no';
  try {
    return MS.isTypeSupported(type) ? 'yes' : 'no';
  } catch {
    return 'no';
  }
}

/** Flex `gap` cannot be detected with CSS.supports (grid gap answers for it), so measure. */
export function flexGapSupported(): boolean {
  const el = document.createElement('div');
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.style.rowGap = '1px';
  el.style.position = 'absolute';
  el.appendChild(document.createElement('div'));
  el.appendChild(document.createElement('div'));
  document.body.appendChild(el);
  const ok = el.scrollHeight === 1;
  document.body.removeChild(el);
  return ok;
}

export const VIDEO_TYPES: [string, string][] = [
  ['HLS (application/vnd.apple.mpegurl)', 'application/vnd.apple.mpegurl'],
  ['HLS (application/x-mpegURL)', 'application/x-mpegURL'],
  ['MPEG-TS (video/mp2t)', 'video/mp2t'],
  ['H.264 High (avc1.640028)', 'video/mp4; codecs="avc1.640028"'],
  ['HEVC Main (hvc1.1.6.L120.90)', 'video/mp4; codecs="hvc1.1.6.L120.90"'],
  ['HEVC Main10 4K (hvc1.2.4.L153.90)', 'video/mp4; codecs="hvc1.2.4.L153.90"'],
  ['AV1 (av01.0.08M.08)', 'video/mp4; codecs="av01.0.08M.08"'],
  ['AAC-LC (mp4a.40.2)', 'audio/mp4; codecs="mp4a.40.2"'],
  ['HE-AAC (mp4a.40.5)', 'audio/mp4; codecs="mp4a.40.5"'],
  ['AC-3 (ac-3)', 'audio/mp4; codecs="ac-3"'],
  ['E-AC-3 (ec-3)', 'audio/mp4; codecs="ec-3"'],
  ['MP3 (audio/mpeg)', 'audio/mpeg'],
];

export const MSE_TYPES: [string, string][] = [
  ['MSE H.264 + AAC (fMP4)', 'video/mp4; codecs="avc1.640028,mp4a.40.2"'],
  ['MSE HEVC (fMP4)', 'video/mp4; codecs="hvc1.1.6.L120.90"'],
  ['MSE AC-3 audio', 'audio/mp4; codecs="ac-3"'],
  ['MSE E-AC-3 audio', 'audio/mp4; codecs="ec-3"'],
  ['MSE MPEG-TS (video/mp2t)', 'video/mp2t; codecs="avc1.42E01E,mp4a.40.2"'],
];

export function probeMedia(): Probe[] {
  const v = document.createElement('video');
  const out: Probe[] = VIDEO_TYPES.map(([label, t]) => ({ label: `<video> ${label}`, value: canPlay(v, t) }));
  const hasMSE = typeof (window as unknown as { MediaSource?: unknown }).MediaSource !== 'undefined';
  out.push({ label: 'Media Source Extensions', value: hasMSE ? 'yes' : 'no' });
  for (const [label, t] of MSE_TYPES) out.push({ label, value: mse(t) });
  return out;
}

export function probePlatform(): Probe[] {
  const w = window as unknown as Record<string, unknown>;
  let tz = 'unknown';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch {
    /* Intl not available */
  }
  let ls: Support = 'no';
  try {
    window.localStorage.setItem('fbtv:probe', '1');
    window.localStorage.removeItem('fbtv:probe');
    ls = 'yes';
  } catch {
    ls = 'no';
  }
  const yn = (b: boolean): Support => (b ? 'yes' : 'no');
  return [
    { label: 'Viewport', value: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio || 1}x` },
    { label: 'Time zone', value: tz },
    { label: 'localStorage', value: ls },
    { label: 'IndexedDB', value: yn(typeof w.indexedDB !== 'undefined') },
    { label: 'fetch', value: yn(typeof w.fetch === 'function') },
    { label: 'AbortController', value: yn(typeof w.AbortController === 'function') },
    { label: 'ResizeObserver', value: yn(typeof w.ResizeObserver === 'function') },
    { label: 'IntersectionObserver', value: yn(typeof w.IntersectionObserver === 'function') },
    { label: 'DecompressionStream (gzip)', value: yn(typeof w.DecompressionStream === 'function') },
    { label: 'WebAssembly', value: yn(typeof w.WebAssembly === 'object') },
    { label: 'CSS flex gap', value: yn(flexGapSupported()) },
    { label: 'CSS aspect-ratio', value: yn(!!(window.CSS && CSS.supports && CSS.supports('aspect-ratio', '1'))) },
  ];
}
