/**
 * Wire format for the published catalogue. Strips values the TV can reconstruct (default
 * source, epgId equal to id, stream languages equal to the channel's, stream ids that are
 * URL fingerprints), cutting the download and — more importantly on TV hardware — the
 * JSON parse time. `decode(encode(x))` round-trips exactly.
 */
import type { CatalogueChannel, CatalogueStream } from './model.ts';
import { streamFingerprint } from './normalize.ts';

export const DEFAULT_SOURCE = 'iptv-org';

type WireStream = Omit<CatalogueStream, 'id' | 'source'> & { id?: string; source?: string };
type WireChannel = Omit<CatalogueChannel, 'streams' | 'sources'> & { streams: WireStream[]; sources?: string[] };

function sameList(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function encodeChannels(channels: CatalogueChannel[]): WireChannel[] {
  return channels.map((c) => {
    const out: WireChannel = { ...c, streams: [] };
    if (out.epgId === c.id) delete out.epgId;
    if (c.sources.length === 1 && c.sources[0] === DEFAULT_SOURCE) delete out.sources;
    out.streams = c.streams.map((s) => {
      const w: WireStream = { ...s };
      if (s.id === streamFingerprint(s.url)) delete w.id;
      if (s.source === DEFAULT_SOURCE) delete w.source;
      if (sameList(s.languages, c.languages)) delete w.languages;
      return w;
    });
    return out;
  });
}

export function decodeChannels(wire: WireChannel[]): CatalogueChannel[] {
  return wire.map((w) => {
    const c = w as unknown as CatalogueChannel;
    if (!w.sources) c.sources = [DEFAULT_SOURCE];
    // epgId is only restored for iptv-org ids (guide matching uses the channel id).
    if (!c.epgId && c.sources.indexOf(DEFAULT_SOURCE) >= 0 && c.id.indexOf('src:') !== 0) c.epgId = c.id;
    for (const s of w.streams) {
      const cs = s as CatalogueStream;
      if (!cs.id) cs.id = streamFingerprint(cs.url);
      if (!cs.source) cs.source = DEFAULT_SOURCE;
      if (!cs.languages && c.languages) cs.languages = c.languages.slice();
    }
    return c;
  });
}
