/**
 * Metadata normalisation helpers. Names and group titles are unreliable, so they are only
 * used where nothing better exists, and every heuristic can be overridden.
 */

/**
 * Non-letter/digit matcher. Unicode property escapes are a *syntax error* before Chromium 64,
 * so the regex is built at runtime with a fallback that treats all non-ASCII as letters.
 */
const NON_WORD: RegExp = (() => {
  try {
    return new RegExp('[^\\p{L}\\p{N}]+', 'gu');
  } catch {
    return /[^0-9a-zª-￿]+/g;
  }
})();

/** Lower-case, strip diacritics and punctuation, collapse spaces. */
export function fold(s: string): string {
  let out = s.toLowerCase();
  try {
    out = out.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch {
    /* normalize() unavailable on very old engines */
  }
  return out.replace(/[&+]/g, ' and ').replace(NON_WORD, ' ').replace(/\s+/g, ' ').trim();
}

/** Words that describe the feed rather than the channel identity. */
const VARIANT_WORDS = /\b(hd|fhd|uhd|sd|4k|8k|hevc|h265|h264|1080p|1080i|720p|576i|480p|backup|alt|live|tv channel)\b/g;

/** Canonical name used for de-duplication of sources that have no channel id. */
export function canonicalName(name: string): string {
  return fold(name).replace(VARIANT_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

export function slug(s: string): string {
  return fold(s).replace(/\s+/g, '-').slice(0, 60) || 'channel';
}

/**
 * Country codes: iptv-org uses "UK" for the United Kingdom (FND-005); everything else is
 * ISO 3166-1 alpha-2. Internally we keep iptv-org's code.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  GB: 'UK',
  GBR: 'UK',
  ENG: 'UK',
  SCT: 'UK',
  WLS: 'UK',
  NIR: 'UK',
  USA: 'US',
  UAE: 'AE',
  KSA: 'SA',
};

export function normalizeCountry(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(c)) return undefined;
  return COUNTRY_ALIASES[c] || (c.length === 2 ? c : undefined);
}

/** ISO 639-1 → 639-3 for the languages most likely to appear in M3U attributes. */
const LANG_2_TO_3: Record<string, string> = {
  en: 'eng', ar: 'ara', bn: 'ben', fr: 'fra', de: 'deu', es: 'spa', it: 'ita', pt: 'por', hi: 'hin', ur: 'urd',
  tr: 'tur', ru: 'rus', zh: 'zho', ja: 'jpn', ko: 'kor', nl: 'nld', pl: 'pol', fa: 'fas', ta: 'tam', te: 'tel',
  pa: 'pan', gu: 'guj', ml: 'mal', mr: 'mar', el: 'ell', sv: 'swe', no: 'nor', da: 'dan', fi: 'fin', he: 'heb',
  id: 'ind', ms: 'msa', th: 'tha', vi: 'vie', uk: 'ukr', ro: 'ron', hu: 'hun', cs: 'ces', sq: 'sqi', so: 'som',
};
const LANG_NAMES: Record<string, string> = {
  english: 'eng', arabic: 'ara', bengali: 'ben', bangla: 'ben', french: 'fra', german: 'deu', spanish: 'spa',
  italian: 'ita', portuguese: 'por', hindi: 'hin', urdu: 'urd', turkish: 'tur', russian: 'rus', chinese: 'zho',
};

export function normalizeLanguage(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (/^[a-z]{3}$/.test(v)) return v;
  if (/^[a-z]{2}$/.test(v)) return LANG_2_TO_3[v];
  return LANG_NAMES[v];
}

export function normalizeLanguages(values: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of values) {
    for (const part of String(raw || '').split(/[;,|]/)) {
      const code = normalizeLanguage(part);
      if (code && out.indexOf(code) < 0) out.push(code);
    }
  }
  return out;
}

/** "1080p" → 1080; "4K"/"2160p" → 2160. Advertised only. */
export function qualityHeight(q: string | null | undefined): number | undefined {
  if (!q) return undefined;
  const s = q.toLowerCase();
  if (/\b(4k|uhd)\b/.test(s)) return 2160;
  const m = /(\d{3,4})\s*[pi]\b/.exec(s);
  return m ? Number(m[1]) : undefined;
}

/** A stream counts as verified UHD only from our own probe, never from names or labels. */
export function isVerifiedUHD(probe: { width: number; height: number } | undefined): boolean {
  return !!probe && (probe.height >= 2160 || probe.width >= 3840);
}

/**
 * Sport tags from channel names. A heuristic, so channels are tagged `sportsBy: 'name'`
 * and the UI never claims a channel is showing a particular match.
 */
const SPORT_KEYWORDS: [string, RegExp][] = [
  ['football', /\b(football|soccer|futbol|futebol|calcio|premier league|laliga|la liga|bundesliga|serie a|ligue 1|goal)\b/],
  ['cricket', /\b(cricket|ipl)\b/],
  ['rugby', /\b(rugby)\b/],
  ['tennis', /\b(tennis)\b/],
  ['basketball', /\b(basketball|nba)\b/],
  ['motorsport', /\b(motorsport|motor sport|racing|f1|formula 1|nascar|motogp|speed)\b/],
  ['golf', /\b(golf)\b/],
  ['combat', /\b(fight|fighting|boxing|ufc|mma|wwe|wrestling)\b/],
];

export function sportsFromName(name: string, altNames: string[] = []): string[] {
  const hay = fold([name].concat(altNames).join(' '));
  const out: string[] = [];
  for (const [sport, re] of SPORT_KEYWORDS) if (re.test(hay)) out.push(sport);
  return out;
}

/** iptv-org categories that make a channel eligible for the Kids area. */
export const KIDS_CATEGORIES = ['kids', 'animation'];

export function isKidsByCategory(categories: string[] | undefined): boolean {
  return !!categories && categories.some((c) => KIDS_CATEGORIES.indexOf(c) >= 0);
}

/** Stable short hash (FNV-1a 32-bit, hex) for ids and fingerprints. */
export function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Stream URL fingerprint: the same stream served over http/https, with a trailing slash,
 * different host case or reordered query parameters is one stream.
 */
export function streamFingerprint(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i.exec(url.trim());
  if (!m) return hash32(url.trim());
  const host = m[1]!.toLowerCase().replace(/:(80|443)$/, '');
  const path = (m[2] || '/').replace(/\/+$/, '') || '/';
  const query = m[3]
    ? m[3]
        .slice(1)
        .split('&')
        .filter(Boolean)
        .sort()
        .join('&')
    : '';
  return hash32(`${host}${path}${query ? '?' + query : ''}`);
}
