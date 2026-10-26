/**
 * Local search index. Every query word must match some term of a document (AND semantics),
 * by exact word, prefix, or a small edit distance for longer words. Abbreviations and
 * common variants are expanded before matching. Documents are only ever built from
 * imported data, so search can't surface anything that isn't really there.
 */
import { fold } from './normalize.ts';

export type ResultKind =
  | 'channel'
  | 'collection'
  | 'country'
  | 'language'
  | 'category'
  | 'competition'
  | 'team'
  | 'match'
  | 'movie'
  | 'series'
  | 'episode';

export interface SearchDoc {
  kind: ResultKind;
  id: string;
  title: string;
  subtitle?: string;
  /** Extra searchable text (alt names, country/language/category names, keywords). */
  keywords?: string[];
  /** Added to the score, e.g. favourites or verified streams. */
  boost?: number;
}

export interface SearchHit {
  doc: SearchDoc;
  score: number;
}

/** Query words → replacement words (all folded). Multi-word expansions are AND-ed. */
const SYNONYMS: Record<string, string[]> = {
  epl: ['premier', 'league'],
  pl: ['premier', 'league'],
  ucl: ['champions', 'league'],
  uel: ['europa', 'league'],
  uecl: ['conference', 'league'],
  efl: ['football', 'league'],
  laliga: ['la', 'liga'],
  uk: ['united', 'kingdom'],
  gb: ['united', 'kingdom'],
  britain: ['united', 'kingdom'],
  british: ['united', 'kingdom'],
  england: ['united', 'kingdom'],
  usa: ['united', 'states'],
  us: ['united', 'states'],
  american: ['united', 'states'],
  uae: ['united', 'arab', 'emirates'],
  bangla: ['bengali'],
  bangladeshi: ['bangladesh'],
  arab: ['arabic'],
  soccer: ['football'],
  cartoons: ['animation'],
  cartoon: ['animation'],
  children: ['kids'],
  childrens: ['kids'],
  uhd: ['4k'],
  '2160p': ['4k'],
  film: ['movies'],
  films: ['movies'],
  movie: ['movies'],
  shows: ['series'],
  doc: ['documentary'],
  docs: ['documentary'],
  documentaries: ['documentary'],
};

/** Words that carry no meaning in a TV search. */
const STOPWORDS = ['channel', 'channels', 'tv', 'live', 'the', 'and', 'of', 'watch', 'stream', 'streams'];

/** Splits folded text into words; runs of single letters merge into an acronym ("b b c" → "bbc"). */
export function tokenize(text: string): string[] {
  const raw = fold(text)
    .split(' ')
    .filter((t) => t.length > 0);
  const out: string[] = [];
  let run = '';
  for (const t of raw) {
    if (t.length === 1 && /[a-z]/.test(t)) {
      run += t;
      continue;
    }
    if (run) out.push(run);
    run = '';
    out.push(t);
  }
  if (run) out.push(run);
  return out;
}

export function expandQuery(query: string): string[] {
  const out: string[] = [];
  const words = tokenize(query);
  for (const w of words) {
    const exp = SYNONYMS[w];
    for (const t of exp || [w]) {
      if (out.indexOf(t) < 0) out.push(t);
    }
  }
  const meaningful = out.filter((t) => STOPWORDS.indexOf(t) < 0);
  // "UK channels" must not become an empty query.
  return meaningful.length ? meaningful : out;
}

/**
 * Edit distance counting a swap of adjacent letters as one edit (optimal string
 * alignment), with an upper bound (returns max+1 when exceeded).
 */
export function boundedDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prevPrev: number[] = [];
  let prev: number[] = [];
  for (let j = 0; j <= b.length; j++) prev.push(j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
        v = Math.min(v, prevPrev[j - 2]! + 1);
      }
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[b.length]!;
}

interface Indexed {
  doc: SearchDoc;
  title: string[];
  terms: string[];
}

function matchScore(q: string, terms: string[]): number {
  let best = 0;
  for (const t of terms) {
    if (t === q) return 3;
    if (best < 2 && t.length > q.length && t.indexOf(q) === 0) best = 2;
  }
  if (best || q.length < 5) return best;
  const max = q.length >= 8 ? 2 : 1;
  for (const t of terms) {
    if (Math.abs(t.length - q.length) <= max && boundedDistance(q, t, max) <= max) return 1;
  }
  return 0;
}

export class SearchIndex {
  private readonly items: Indexed[];

  constructor(docs: SearchDoc[]) {
    this.items = docs.map((doc) => {
      const title = tokenize(doc.title);
      const terms = title.concat(tokenize((doc.keywords || []).join(' ')), tokenize(doc.subtitle || ''));
      return { doc, title, terms };
    });
  }

  get size(): number {
    return this.items.length;
  }

  search(query: string, opts: { limit?: number; kinds?: ResultKind[]; filter?: (d: SearchDoc) => boolean } = {}): SearchHit[] {
    const words = expandQuery(query);
    if (!words.length) return [];
    const hits: SearchHit[] = [];
    for (const it of this.items) {
      if (opts.kinds && opts.kinds.indexOf(it.doc.kind) < 0) continue;
      if (opts.filter && !opts.filter(it.doc)) continue;
      let score = 0;
      let ok = true;
      for (const w of words) {
        const inTitle = matchScore(w, it.title);
        const anywhere = inTitle || matchScore(w, it.terms);
        if (!anywhere) {
          ok = false;
          break;
        }
        score += inTitle ? inTitle * 2 : anywhere;
      }
      if (!ok) continue;
      // Exact full-title match ranks first ("BBC One" before "BBC One Scotland").
      if (it.title.join(' ') === words.join(' ')) score += 10;
      score += (it.doc.boost || 0) - it.title.length * 0.01;
      hits.push({ doc: it.doc, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return opts.limit ? hits.slice(0, opts.limit) : hits;
  }

  /** Results grouped by kind, in a fixed display order, each group capped. */
  grouped(query: string, perKind = 20): { kind: ResultKind; hits: SearchHit[] }[] {
    const order: ResultKind[] = [
      'channel',
      'collection',
      'match',
      'competition',
      'team',
      'country',
      'language',
      'category',
      'movie',
      'series',
      'episode',
    ];
    const all = this.search(query);
    const groups: { kind: ResultKind; hits: SearchHit[] }[] = [];
    for (const kind of order) {
      const hits = all.filter((h) => h.doc.kind === kind).slice(0, perKind);
      if (hits.length) groups.push({ kind, hits });
    }
    return groups;
  }
}
