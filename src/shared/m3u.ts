/**
 * Defensive M3U / M3U8 playlist parser (IPTV "extended M3U").
 *
 * Remote playlists are untrusted input: the parser never evaluates anything, caps the
 * number of entries and line length, tolerates missing headers, CRLF, BOMs and unquoted
 * attributes, and reports problems as warnings instead of throwing.
 *
 * Supported: #EXTM3U header attributes (x-tvg-url / url-tvg / tvg-url), #EXTINF duration +
 * attributes + title, #EXTVLCOPT:http-user-agent / http-referrer, inline http-user-agent /
 * http-referrer attributes, #EXTGRP, and bare URL lines.
 */
export interface M3UEntry {
  title: string;
  url: string;
  duration: number;
  /** All EXTINF attributes, keys lower-cased (tvg-id, tvg-name, tvg-logo, group-title, …). */
  attrs: Record<string, string>;
  group?: string;
  userAgent?: string;
  referrer?: string;
  /** 1-based line number of the URL, for diagnostics. */
  line: number;
}

export interface M3UResult {
  header: Record<string, string>;
  /** EPG URLs advertised by the playlist header. */
  epgUrls: string[];
  entries: M3UEntry[];
  warnings: string[];
}

export interface ParseOptions {
  maxEntries?: number;
  maxLineLength?: number;
}

const DEFAULTS = { maxEntries: 100000, maxLineLength: 8192 };

/** Parses `key="value"` / `key=value` pairs. Exported for tests. */
export function parseAttributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z0-9_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,"']+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const key = m[1]!.toLowerCase();
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] || '';
    if (!(key in out)) out[key] = value.trim();
  }
  return out;
}

/** Index of the comma that separates EXTINF attributes from the title (outside quotes). */
function titleComma(s: string): number {
  let quote: string | null = null;
  let last = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ',') {
      last = i;
      // The first unquoted comma after attributes ends them; titles may contain commas.
      return last;
    }
  }
  return last;
}

function isUrlLine(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(udp|rtp|igmp):/i.test(s);
}

export function parseM3U(input: string, opts: ParseOptions = {}): M3UResult {
  const maxEntries = opts.maxEntries || DEFAULTS.maxEntries;
  const maxLine = opts.maxLineLength || DEFAULTS.maxLineLength;
  const result: M3UResult = { header: {}, epgUrls: [], entries: [], warnings: [] };
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const lines = text.split(/\r\n|\n|\r/);

  let pending: { title: string; duration: number; attrs: Record<string, string>; line: number } | null = null;
  let group: string | undefined;
  let userAgent: string | undefined;
  let referrer: string | undefined;
  let sawHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.length > maxLine) {
      result.warnings.push(`line ${i + 1}: longer than ${maxLine} characters, skipped`);
      continue;
    }
    const line = raw.trim();
    if (!line) continue;

    if (/^#EXTM3U/i.test(line)) {
      sawHeader = true;
      result.header = parseAttributes(line.slice(7));
      const epg = result.header['x-tvg-url'] || result.header['url-tvg'] || result.header['tvg-url'];
      if (epg) {
        for (const u of epg.split(',')) {
          const t = u.trim();
          if (/^https?:\/\//i.test(t)) result.epgUrls.push(t);
        }
      }
      continue;
    }

    if (/^#EXTINF:/i.test(line)) {
      if (pending) result.warnings.push(`line ${pending.line}: #EXTINF without a URL, skipped`);
      const body = line.slice(8);
      const comma = titleComma(body);
      const meta = comma >= 0 ? body.slice(0, comma) : body;
      const title = comma >= 0 ? body.slice(comma + 1).trim() : '';
      const durMatch = /^\s*(-?\d+(?:\.\d+)?)/.exec(meta);
      const attrs = parseAttributes(durMatch ? meta.slice(durMatch[0].length) : meta);
      pending = { title, duration: durMatch ? Number(durMatch[1]) : -1, attrs, line: i + 1 };
      continue;
    }

    if (/^#EXTVLCOPT:/i.test(line)) {
      const opt = line.slice(11);
      const eq = opt.indexOf('=');
      if (eq > 0) {
        const key = opt.slice(0, eq).trim().toLowerCase();
        const value = opt.slice(eq + 1).trim();
        if (key === 'http-user-agent') userAgent = value;
        else if (key === 'http-referrer' || key === 'http-referer') referrer = value;
      }
      continue;
    }

    if (/^#EXTGRP:/i.test(line)) {
      group = line.slice(8).trim() || undefined;
      continue;
    }

    if (line.charAt(0) === '#') continue; // other directives / comments

    if (!isUrlLine(line)) {
      result.warnings.push(`line ${i + 1}: not a URL, skipped`);
      pending = null;
      continue;
    }

    if (result.entries.length >= maxEntries) {
      result.warnings.push(`stopped after ${maxEntries} entries`);
      break;
    }

    const attrs = pending ? pending.attrs : {};
    const entry: M3UEntry = {
      title: pending ? pending.title || attrs['tvg-name'] || '' : '',
      url: line,
      duration: pending ? pending.duration : -1,
      attrs,
      group: attrs['group-title'] || group,
      userAgent: userAgent || attrs['http-user-agent'] || attrs['user-agent'] || undefined,
      referrer: referrer || attrs['http-referrer'] || attrs['http-referer'] || attrs['referrer'] || undefined,
      line: i + 1,
    };
    result.entries.push(entry);
    pending = null;
    group = undefined;
    userAgent = undefined;
    referrer = undefined;
  }

  if (pending) result.warnings.push(`line ${pending.line}: #EXTINF without a URL at end of file`);
  if (!sawHeader && result.entries.length) result.warnings.push('missing #EXTM3U header');
  return result;
}

/**
 * "DIYP"/TXT playlists common in Chinese repositories:
 *   Group name,#genre#
 *   Channel name,http://url1#http://url2
 * Several URLs on one line (separated by '#') become separate entries for the same channel.
 */
export function parseTxtPlaylist(input: string, opts: ParseOptions = {}): M3UResult {
  const maxEntries = opts.maxEntries || DEFAULTS.maxEntries;
  const maxLine = opts.maxLineLength || DEFAULTS.maxLineLength;
  const result: M3UResult = { header: {}, epgUrls: [], entries: [], warnings: [] };
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const lines = text.split(/\r\n|\n|\r/);
  let group: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.length > maxLine) {
      result.warnings.push(`line ${i + 1}: longer than ${maxLine} characters, skipped`);
      continue;
    }
    const line = raw.trim();
    if (!line || line.charAt(0) === '#' || line.charAt(0) === '[') continue;
    const comma = line.indexOf(',');
    if (comma < 0) {
      result.warnings.push(`line ${i + 1}: not "name,url", skipped`);
      continue;
    }
    const name = line.slice(0, comma).trim();
    const rest = line.slice(comma + 1).trim();
    if (/^#genre#$/i.test(rest)) {
      group = name || undefined;
      continue;
    }
    const urls = rest.split('#').map((u) => u.trim()).filter(Boolean);
    if (!urls.length || !urls.some(isUrlLine)) {
      result.warnings.push(`line ${i + 1}: no URL after the name, skipped`);
      continue;
    }
    for (const url of urls) {
      if (!isUrlLine(url)) {
        result.warnings.push(`line ${i + 1}: "${url.slice(0, 40)}" is not a URL, skipped`);
        continue;
      }
      if (result.entries.length >= maxEntries) {
        result.warnings.push(`stopped after ${maxEntries} entries`);
        return result;
      }
      result.entries.push({ title: name, url, duration: -1, attrs: {}, group, line: i + 1 });
    }
  }
  return result;
}

/** Picks the parser by content: M3U when it has #EXTM3U/#EXTINF, otherwise TXT. */
export function parsePlaylist(input: string, opts: ParseOptions = {}): M3UResult & { format: 'm3u' | 'txt' } {
  if (/#EXTM3U|#EXTINF/i.test(input.slice(0, 20000))) return { ...parseM3U(input, opts), format: 'm3u' };
  return { ...parseTxtPlaylist(input, opts), format: 'txt' };
}

/** iptv-org style title decorations: "Name (1080p) [Geo-blocked] [Not 24/7]". */
export interface TitleParts {
  name: string;
  quality?: string;
  labels: string[];
}

export function splitTitle(title: string): TitleParts {
  let name = title;
  const labels: string[] = [];
  let quality: string | undefined;
  name = name.replace(/\[([^\]]+)\]/g, (_m, l: string) => {
    labels.push(l.trim());
    return ' ';
  });
  name = name.replace(/\((\d{3,4}[pi])\)/gi, (_m, q: string) => {
    quality = q.toLowerCase();
    return ' ';
  });
  return { name: name.replace(/\s+/g, ' ').trim(), quality, labels };
}
