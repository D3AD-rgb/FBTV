// TEST DATA — every playlist, URL and file name below is synthetic.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { FocusEngine, type Measure } from '../src/app/focus/engine.ts';
import { getEngine, initFocus } from '../src/app/focus/index.ts';
import { installInput } from '../src/app/nav/input.ts';
import { BUNDLED_ONLY, library, libraryBases, type LibItem } from '../src/app/data/sourceLibrary.ts';
import {
  addToCustom,
  clearAll,
  createCustom,
  deleteCustom,
  entriesToChannels,
  entryProblem,
  mergeEntries,
  playlistIndex,
  playlistState,
  removeFromCustom,
  renameCustom,
  resolveUrl,
  restoreSelection,
  saveSelection,
  selectAll,
  toggleSelected,
  type PlaylistEntry,
  type PlaylistIndex,
  type SourcePlaylist,
} from '../src/app/data/playlists.ts';
import { groupSeries, localChannel, localLabel, searchLocal, type LocalItem } from '../src/app/data/localMedia.ts';
import { resumePosition, resumeValue } from '../src/app/data/playback.ts';
import { readJSON, writeJSON } from '../src/app/platform/storage.ts';
import { clock } from '../src/app/screens/Watch.tsx';
import { Playlists, buildSections } from '../src/app/screens/Playlists.tsx';

const NOW = '2026-10-26T00:00:00.000Z';
const fresh = () => (playlistState.value = { version: 1, updatedAt: '', selected: [], saved: null, custom: [] });
const bundled = () => (library.value = { status: 'ready', origin: 'bundled', base: 'library/', registry: { schema: 1, generatedAt: NOW, shards: {}, groups: [], items: [] } });
const server = () => (library.value = { status: 'ready', origin: 'server', base: 'http://192.168.0.10:8787/', registry: { schema: 1, generatedAt: NOW, shards: {}, groups: [], items: [] } });

describe('playlist selection and custom playlists', () => {
  beforeEach(() => {
    bundled();
    fresh();
  });

  it('selects, deselects, selects all and clears only the given ids', () => {
    expect(toggleSelected('src:a')).toBe(true);
    expect(toggleSelected('src:b')).toBe(true);
    expect(toggleSelected('src:a')).toBe(false);
    expect(playlistState.value.selected).toEqual(['src:b']);
    selectAll(['src:b', 'src:c', 'src:d']);
    expect(playlistState.value.selected).toEqual(['src:b', 'src:c', 'src:d']);
    clearAll(['src:c']);
    expect(playlistState.value.selected).toEqual(['src:b', 'src:d']);
    expect(playlistState.value.updatedAt).not.toBe('');
  });

  it('saves and restores a selection', () => {
    expect(restoreSelection()).toBe(false);
    selectAll(['src:a', 'src:b']);
    saveSelection();
    clearAll(['src:a', 'src:b']);
    expect(playlistState.value.selected).toEqual([]);
    expect(restoreSelection()).toBe(true);
    expect(playlistState.value.selected).toEqual(['src:a', 'src:b']);
  });

  it('combines, renames, adds to, removes from and deletes a named playlist', () => {
    const c = createCustom('  Weekend  ', ['src:a', 'src:b', 'src:a']);
    expect(c.name).toBe('Weekend');
    expect(c.members).toEqual(['src:a', 'src:b']);
    renameCustom(c.id, 'Match day');
    addToCustom(c.id, ['lib:country-uk', 'src:b']);
    removeFromCustom(c.id, 'src:a');
    const now = playlistState.value.custom[0]!;
    expect(now.name).toBe('Match day');
    expect(now.members).toEqual(['src:b', 'lib:country-uk']);
    toggleSelected(`custom:${c.id}`);
    deleteCustom(c.id);
    expect(playlistState.value.custom).toEqual([]);
    expect(playlistState.value.selected).toEqual([]);
  });

  it('keeps the state on the TV across reloads', () => {
    selectAll(['src:keep']);
    expect(readJSON<{ selected: string[] }>('playlists:state', { selected: [] }).selected).toEqual(['src:keep']);
  });
});

describe('where the TV reads the library from', () => {
  const pc = 'http://192.168.0.10:8787/registry.json';
  it('uses the PC address in a local build, then the bundled copy', () => {
    expect(libraryBases('', pc)).toEqual(['http://192.168.0.10:8787/', 'library/']);
    expect(libraryBases('', '')).toEqual(['library/']);
  });
  it('prefers an address entered in Settings, and honours "Use bundled"', () => {
    expect(libraryBases('http://10.0.0.5:9000/registry.json', pc)).toEqual(['http://10.0.0.5:9000/', 'library/']);
    expect(libraryBases('http://10.0.0.5:9000', pc)).toEqual(['http://10.0.0.5:9000/', 'library/']);
    expect(libraryBases(BUNDLED_ONLY, pc)).toEqual(['library/']);
  });
});

describe('merging and playing entries', () => {
  const e = (n: string, u: string[], extra: Partial<PlaylistEntry> = {}): PlaylistEntry => ({ n, u, s: 'ok', line: 1, ...extra });

  it('merges the same channel once with every URL as a fallback, without changing the inputs', () => {
    const a = [e('One', ['http://a.test/1'], { k: 'one' }), { n: 'Gone', s: 'withheld', line: 2 } as PlaylistEntry];
    const b = [e('One HD', ['http://b.test/1', 'http://a.test/1'], { k: 'one' }), e('Two', ['http://c.test/2'])];
    const merged = mergeEntries([a, b]);
    expect(merged.map((x) => x.n)).toEqual(['One', 'Gone', 'Two']);
    expect(merged[0]!.u).toEqual(['http://a.test/1', 'http://b.test/1']);
    expect(a[0]!.u).toEqual(['http://a.test/1']);
  });

  it('resolves private references only through the library server', () => {
    bundled();
    expect(resolveUrl('https://a.test/x.m3u8')).toBe('https://a.test/x.m3u8');
    expect(resolveUrl('@play/0123456789abcdef01234567')).toBeNull();
    expect(entryProblem(e('Mine', ['@play/0123456789abcdef01234567']))).toMatch(/library from your PC/);
    expect(entriesToChannels([e('Mine', ['@play/0123456789abcdef01234567'])], 'src:x')).toEqual([]);
    server();
    expect(resolveUrl('@play/0123456789abcdef01234567')).toBe('http://192.168.0.10:8787/play/0123456789abcdef01234567');
    expect(resolveUrl('@xtream/home/movie/12.mp4')).toBe('http://192.168.0.10:8787/xtream/home/movie/12.mp4');
    expect(entryProblem(e('Mine', ['@play/0123456789abcdef01234567']))).toBe('');
  });

  it('turns playable entries into channels with fallbacks; on-demand ones resume', () => {
    bundled();
    const list = entriesToChannels([e('Live', ['http://a.test/1.m3u8', 'http://b.test/1.m3u8']), e('Film', ['http://a.test/f.mp4'], { vod: 1 }), { n: 'Bad', s: 'unsupported', u: ['rtmp://x'], line: 3 }], 'src:p');
    expect(list.map((c) => c.name)).toEqual(['Live', 'Film']);
    expect(list[0]!.streams.map((s) => s.url)).toEqual(['http://a.test/1.m3u8', 'http://b.test/1.m3u8']);
    expect(list[0]!.playback).toBeUndefined();
    expect(list[1]!.playback!.resumeKey).toBe('pl:http://a.test/f.mp4');
  });
});

describe('local media on the TV', () => {
  const item = (over: Partial<LocalItem>): LocalItem => ({ id: '0123456789abcdef', kind: 'movie', title: 'Heat', ext: 'mkv', size: 1, modified: NOW, subtitles: [], ...over });

  it('labels films and episodes', () => {
    expect(localLabel(item({ year: 1995 }))).toBe('Heat (1995)');
    expect(localLabel(item({ kind: 'episode', series: 'Show', season: 1, episode: 2, title: 'Pilot' }))).toBe('Show · S01E02 · Pilot');
    expect(localLabel(item({ kind: 'episode', series: 'Show', season: 1, episode: 3, title: 'Episode 3' }))).toBe('Show · S01E03');
  });

  it('streams through the library server with subtitles, artwork and resume', () => {
    const c = localChannel(item({ art: true, subtitles: [{ id: 0, label: 'EN', language: 'en' }] }), 'http://192.168.0.10:8787/');
    expect(c.id).toBe('local:0123456789abcdef');
    expect(c.streams[0]!.url).toBe('http://192.168.0.10:8787/media/0123456789abcdef.mkv');
    expect(c.logo).toBe('http://192.168.0.10:8787/media/0123456789abcdef/art');
    expect(c.playback!.subtitles).toEqual([{ url: 'http://192.168.0.10:8787/media/0123456789abcdef/sub/0.vtt', label: 'EN', language: 'en' }]);
    expect(c.playback!.resumeKey).toBe('local:0123456789abcdef');
    expect(c.streams[0]!.feedName).toBe('From your PC');
  });

  it('groups series by season in episode order and searches by every word', () => {
    const eps = [
      item({ id: 'a', kind: 'episode', series: 'B Show', season: 2, episode: 1, title: 'x' }),
      item({ id: 'b', kind: 'episode', series: 'B Show', season: 1, episode: 2, title: 'y' }),
      item({ id: 'c', kind: 'episode', series: 'B Show', season: 1, episode: 1, title: 'z', art: true }),
      item({ id: 'd', kind: 'episode', series: 'A Show', season: 1, episode: 1, title: 'w' }),
      item({ id: 'e', kind: 'movie', title: 'Heat', year: 1995 }),
    ];
    const g = groupSeries(eps);
    expect(g.map((s) => s.title)).toEqual(['A Show', 'B Show']);
    expect(g[1]!.seasons.map((s) => [s.season, s.episodes.map((x) => x.id)])).toEqual([
      [1, ['c', 'b']],
      [2, ['a']],
    ]);
    expect(g[1]!.poster!.id).toBe('c');
    expect(g[1]!.count).toBe(3);
    expect(searchLocal(eps, 'heat 1995').map((x) => x.id)).toEqual(['e']);
    expect(searchLocal(eps, 'b show').length).toBe(3);
    expect(searchLocal(eps, '  ')).toEqual([]);
  });

  it('reads saved positions and formats times', () => {
    writeJSON('resume:local:x', 125);
    expect(resumePosition('local:x')).toBe(125);
    expect(resumePosition('local:none')).toBe(0);
    expect(resumeValue(600, 7200)).toBe(600);
    expect(resumeValue(7150, 7200)).toBe(0); // last minute of a film: finished
    expect(resumeValue(100, 150)).toBe(100); // a short clip keeps its place until its last 5%
    expect(resumeValue(145, 150)).toBe(0);
    expect(clock(59)).toBe('0:59');
    expect(clock(3723)).toBe('1:02:03');
  });
});

// ------------------------------------------------------------------ the Playlists screen

const sp = (id: string, collection: string, title: string): SourcePlaylist => ({
  id,
  collection,
  repo: collection,
  file: `${title}.m3u`,
  title,
  origin: '',
  entries: 2,
  channels: 2,
  playable: 2,
  duplicates: 0,
  withheld: 0,
  unsupported: 0,
  malformed: 0,
  other: 0,
  vod: 0,
  validation: { confirmed: 0, recognised: 0, reachable: 0, unavailable: 0, failed: 0, untested: 2 },
  groups: 1,
});
const INDEX: PlaylistIndex = {
  schema: 1,
  generatedAt: NOW,
  collections: [
    { id: 'my-playlist', name: 'My Playlist', supplied: false, playlists: [] },
    { id: 'iptv-org', name: 'iptv-org/iptv', supplied: true, playlists: ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'] },
    { id: 'iptv-sources', name: 'HerbertHe/iptv-sources', supplied: true, playlists: ['cccccccccccc'] },
  ],
  playlists: [sp('aaaaaaaaaaaa', 'iptv-org', 'streams/uk'), sp('bbbbbbbbbbbb', 'iptv-org', 'streams/football'), sp('cccccccccccc', 'iptv-sources', 'cn')],
};
const ITEMS: LibItem[] = [
  { id: 'sports-all', name: 'All sports', group: 'Sports', type: 'list', contentType: 'live', languages: [], channels: 3, status: 'imported', validation: { checked: 0, reachable: 0, playbackConfirmed: 0, untested: 3 }, select: { sports: 'any' } },
];

describe('Playlists sections', () => {
  it('shows only categories that have data, with My Playlist and the supplied collections first', () => {
    const s = buildSections(INDEX.playlists, INDEX.collections, ITEMS, [], []);
    const ids = s.map((x) => x.id);
    expect(ids.slice(0, 6)).toEqual(['all', 'selected', 'custom', 'col:my-playlist', 'col:iptv-org', 'col:iptv-sources']);
    expect(ids).toContain('cat:sports');
    expect(ids).toContain('cat:football');
    expect(ids).not.toContain('cat:cricket');
    expect(s[0]!.rows.length).toBe(4);
  });
});

/** jsdom has no layout: give each focusable the rectangle the TV layout gives it. */
const measure: Measure = (el) => {
  const raw = el.getAttribute('data-rect');
  if (!raw) return { left: 0, top: 0, width: 0, height: 0 };
  const [left, top, width, height] = raw.split(',').map(Number) as [number, number, number, number];
  return { left, top, width, height };
};

function layout(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.pl-head [data-focusable]').forEach((el, i) => el.setAttribute('data-rect', `${330 + i * 190},140,170,60`));
  root.querySelectorAll<HTMLElement>('.pl-sections [data-focusable]').forEach((el) => el.setAttribute('data-rect', '96,270,400,740'));
  root.querySelectorAll<HTMLElement>('.pl-list [data-focusable]').forEach((el) => el.setAttribute('data-rect', '520,270,800,740'));
  root.querySelectorAll<HTMLElement>('.pl-preview .pl-actions').forEach((g, row) =>
    g.querySelectorAll<HTMLElement>('[data-focusable]').forEach((el, i) => el.setAttribute('data-rect', `${1344 + i * 130},${380 + row * 64},120,50`)),
  );
}

describe('Playlists screen with the remote', () => {
  let root: HTMLElement;
  let uninstall: (() => void) | null = null;
  beforeEach(() => {
    library.value = { status: 'ready', origin: 'bundled', base: 'library/', registry: { schema: 1, generatedAt: NOW, shards: {}, groups: [], items: ITEMS } };
    playlistIndex.value = { status: 'ready', index: INDEX, byId: new Map(INDEX.playlists.map((p) => [p.id, p])) };
    fresh();
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
    act(() => render(<Playlists />, root));
    layout(root);
  });
  afterEach(() => {
    if (uninstall) uninstall();
    uninstall = null;
    act(() => render(null, root));
  });

  it('moves between the header, sections, playlists and preview actions with the D-pad', () => {
    const engine = new FocusEngine({ root, measure, onChange: () => undefined });
    const $ = (id: string) => root.querySelector<HTMLElement>(`[data-focus-id="${id}"]`)!;
    const sections = $('vlist:pl:sections');
    const rows = root.querySelector<HTMLElement>('.pl-list [data-focusable]')!;
    expect(sections).toBeTruthy();
    expect(rows.getAttribute('data-focus-id')).toBe('vlist:pl:rows:all');
    engine.focus(sections);
    engine.move('right');
    expect(engine.focused).toBe(rows);
    engine.move('right');
    expect(engine.focused).toBe($('pl:p:open'));
    engine.move('right');
    expect(engine.focused).toBe($('pl:p:select'));
    engine.move('left');
    engine.move('left');
    expect(engine.focused).toBe(rows);
    // Up at the top of a tall list goes to the header, not to the preview column beside it.
    engine.move('up');
    expect(engine.focused).toBe($('pl:search'));
    engine.move('right');
    expect(engine.focused).toBe($('pl:all'));
    engine.move('down');
    expect([sections, rows]).toContain(engine.focused);
    engine.move('up');
    expect(engine.focused).toBe($('pl:all')); // the header remembers its last chip
    engine.focus(sections);
    engine.move('left');
    expect(engine.focused).toBe(sections); // nothing further left on this screen
  });

  it('Red on a focused playlist selects it; the preview shows its actions', () => {
    const engine = initFocus(root);
    uninstall = installInput({ engine, root, onExit: () => undefined });
    const rows = root.querySelector<HTMLElement>('.pl-list [data-focusable]')!;
    getEngine().focus(rows);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }));
    });
    expect(playlistState.value.selected).toEqual(['src:aaaaaaaaaaaa']);
    expect(root.querySelector('.pl-preview-title')!.textContent).toBe('streams/uk');
    expect(root.querySelector('[data-focus-id="pl:p:select"]')!.textContent).toBe('Deselect');
  });
});
