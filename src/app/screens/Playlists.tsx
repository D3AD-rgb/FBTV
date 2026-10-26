/**
 * Playlists: every collection's playlists (the nine supplied repositories, My Playlist and the
 * other sources), FBTV's own lists by category, your selection and your named playlists.
 *
 * Layout: search and actions on top; sections | playlists | preview. OK opens a playlist (OK on an
 * entry plays it). Red selects, Green adds to one of your playlists, Yellow renames, Blue deletes
 * (your playlists). Every action also has an on-screen button.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { fold } from '../../shared/normalize.ts';
import { library, type LibItem } from '../data/sourceLibrary.ts';
import {
  addToCustom,
  clearAll,
  createCustom,
  deleteCustom,
  entriesToChannels,
  entryProblem,
  isSelected,
  loadEntries,
  loadPlaylistIndex,
  memberTitle,
  playlistIndex,
  playlistState,
  removeFromCustom,
  renameCustom,
  restoreSelection,
  saveSelection,
  selectAll,
  syncStatus,
  toggleSelected,
  validationText,
  type CustomPlaylist,
  type PlaylistEntry,
  type SourcePlaylist,
} from '../data/playlists.ts';
import { pushKeyHandler } from '../nav/input.ts';
import { closeOverlay, closePage, openOverlay, openPage, routeKey, type PageEntry } from '../nav/router.ts';
import { getEngine } from '../focus/index.ts';
import { VirtualList } from '../ui/VirtualList.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { showToast } from '../ui/toast.tsx';
import { watchFrom } from './Collection.tsx';
import { watchInLiveTV } from './LiveTV.tsx';

export interface Row {
  id: string;
  title: string;
  sub: string;
  kind: 'src' | 'lib' | 'custom';
  playlist?: SourcePlaylist;
  item?: LibItem;
  custom?: CustomPlaylist;
}

interface Section {
  id: string;
  label: string;
  rows: Row[];
  note?: string;
}

const activeSection = signal('all');
/** Up from the top of either list goes to the header (the preview column is also "above" a tall list). */
const HEAD = '[data-focus-id="pl:search"]';

const n = (x: number) => x.toLocaleString();

export function srcSub(p: SourcePlaylist): string {
  const parts = [`${n(p.channels)} entries`, `${n(p.playable)} playable`];
  if (p.withheld) parts.push(`${n(p.withheld)} withheld`);
  if (p.unsupported) parts.push(`${n(p.unsupported)} unsupported`);
  if (p.malformed) parts.push(`${n(p.malformed)} errors`);
  const v = p.validation;
  if (v.confirmed) parts.push(`${n(v.confirmed)} confirmed`);
  if (v.recognised + v.reachable) parts.push(`${n(v.recognised + v.reachable)} answered`);
  return parts.join(' · ');
}

const srcRow = (p: SourcePlaylist): Row => ({ id: `src:${p.id}`, title: p.title, sub: srcSub(p), kind: 'src', playlist: p });
const libRow = (i: LibItem): Row => {
  const v = i.validation;
  const bits = [`${n(i.channels)} channels`, 'FBTV list'];
  if (v.playbackConfirmed) bits.push(`${n(v.playbackConfirmed)} confirmed`);
  if (v.reachable) bits.push(`${n(v.reachable)} answered`);
  return { id: `lib:${i.id}`, title: i.name, sub: bits.join(' · '), kind: 'lib', item: i };
};
const customRow = (c: CustomPlaylist): Row => ({ id: `custom:${c.id}`, title: c.name, sub: `${c.members.length} playlist${c.members.length === 1 ? '' : 's'} · your playlist`, kind: 'custom', custom: c });

/** Sections that have data. Pure over its inputs. */
export function buildSections(playlists: SourcePlaylist[], collections: { id: string; name: string; note?: string; supplied: boolean; playlists: string[] }[], items: LibItem[], custom: CustomPlaylist[], selected: string[]): Section[] {
  const byId = new Map(playlists.map((p) => [p.id, p]));
  const src = playlists.map(srcRow);
  const lib = items.filter((i) => !!i.select).map(libRow);
  const cust = custom.map(customRow);
  const all = new Map<string, Row>();
  for (const r of src.concat(lib, cust)) all.set(r.id, r);
  const pick = (ids: string[]) => ids.map((id) => all.get(id) || { id, title: memberTitle(id), sub: 'Not in the current library', kind: 'src' as const });
  const libBy = (f: (i: LibItem) => boolean) => lib.filter((r) => f(r.item!));
  const srcBy = (re: RegExp) => src.filter((r) => re.test(r.title));
  const sections: Section[] = [
    { id: 'all', label: 'All playlists', rows: src.concat(lib) },
    { id: 'selected', label: '★ Selected', rows: pick(selected), note: 'Press Red on any playlist to select it. Selected playlists can be combined into your own playlist or watched together in Live TV.' },
    { id: 'custom', label: 'My custom playlists', rows: cust, note: 'Select playlists (Red), then "Combine selected" — or press Green on a playlist to add it to one of yours.' },
  ];
  for (const c of collections.filter((x) => x.id === 'my-playlist').concat(collections.filter((x) => x.supplied), collections.filter((x) => !x.supplied && x.id !== 'my-playlist'))) {
    sections.push({ id: `col:${c.id}`, label: c.name, rows: c.playlists.map((id) => byId.get(id)).filter(Boolean).map((p) => srcRow(p!)), note: c.note || (c.id === 'my-playlist' ? 'Add your playlist in provider-profiles/profiles.local.json on the PC, then rebuild.' : undefined) });
  }
  const cat = (id: string, label: string, rows: Row[]) => {
    if (rows.length) sections.push({ id: `cat:${id}`, label, rows });
  };
  cat('live', 'Live TV', libBy((i) => i.group === 'Live TV'));
  cat('sports', 'Sports', libBy((i) => i.group === 'Sports' || i.group === 'Sports › By sport').concat(srcBy(/sport/i)));
  cat('football', 'Football', libBy((i) => i.group === 'Football').concat(srcBy(/football|soccer|futbol|足球/i)));
  cat('cricket', 'Cricket', libBy((i) => i.id === 'sport-cricket').concat(srcBy(/cricket/i)));
  cat('tennis', 'Tennis', libBy((i) => i.id === 'sport-tennis').concat(srcBy(/tennis/i)));
  cat('motorsport', 'Motorsport', libBy((i) => i.id === 'sport-motorsport' || i.id === 'sport-rally'));
  cat('combat', 'Combat sports', libBy((i) => i.id === 'sport-combat' || i.id === 'sport-boxing' || i.id === 'sport-wrestling'));
  cat('countries', 'Countries', libBy((i) => i.group === 'Live TV › Countries').concat(src.filter((r) => /^streams\/[a-z_]+\.m3u$|\/countries\//i.test(r.playlist!.file))));
  cat('languages', 'Languages', libBy((i) => i.group === 'Live TV › Languages').concat(src.filter((r) => /\/languages\//i.test(r.playlist!.file))));
  cat('4k', '4K', libBy((i) => i.id === '4k'));
  cat('news', 'News', libBy((i) => i.group === 'News').concat(srcBy(/news/i)));
  cat('movies', 'Movies', libBy((i) => i.id === 'movie-channels').concat(src.filter((r) => r.playlist!.collection === 'internet-archive' && /films/.test(r.playlist!.file)), srcBy(/movie|film|电影/i)));
  cat('series', 'Series', libBy((i) => i.id === 'series-channels').concat(src.filter((r) => r.playlist!.file === 'tv-eng'), srcBy(/series|电视剧/i)));
  cat('radio', 'Radio', libBy((i) => i.group === 'Radio').concat(srcBy(/radio|广播/i)));
  return sections;
}

// ------------------------------------------------------------------ dialogs

function NameDialog(props: { title: string; initial?: string; onSave: (name: string) => void }) {
  const [value, setValue] = useState(props.initial || '');
  const input = useRef<HTMLInputElement>(null);
  const save = () => {
    const v = value.trim();
    if (!v) return showToast('Enter a name first');
    closeOverlay('pl-name');
    props.onSave(v);
  };
  return (
    <div class="overlay" data-focus-trap role="dialog" aria-modal="true" aria-label={props.title}>
      <div class="overlay-backdrop" />
      <div class="dialog">
        <h2>{props.title}</h2>
        <div class="search-field small hstack" style="margin-top:20px" data-focusable data-focus-default data-focus-id="pl-name:input" onClick={() => input.current && input.current.focus()}>
          <input
            ref={input}
            type="text"
            value={value}
            maxLength={120}
            placeholder="Playlist name"
            aria-label="Playlist name"
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if ((e as KeyboardEvent).key === 'Enter') save();
            }}
          />
        </div>
        <div class="actions hstack">
          <button class="btn" data-focusable data-focus-id="pl-name:save" onClick={save}>
            Save
          </button>
          <button class="btn" data-focusable data-focus-id="pl-name:cancel" onClick={() => closeOverlay('pl-name')}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function askName(title: string, initial: string, onSave: (name: string) => void): void {
  openOverlay({ key: 'pl-name', render: () => <NameDialog title={title} initial={initial} onSave={onSave} /> });
}

/** "Add to playlist…": one of your playlists, or a new one. */
export function chooseCustom(members: string[], label: string): void {
  const render = () => {
    const custom = playlistState.value.custom;
    return (
      <div class="overlay" data-focus-trap role="dialog" aria-modal="true" aria-label="Add to playlist">
        <div class="overlay-backdrop" />
        <div class="dialog">
          <h2>Add {label} to…</h2>
          <div class="vstack" style="--stack-gap:12px;margin-top:20px;max-height:520px;overflow:hidden">
            <button
              class="btn"
              data-focusable
              data-focus-default
              data-focus-id="pl-add:new"
              onClick={() => {
                closeOverlay('pl-add');
                askName('New playlist', '', (name) => {
                  createCustom(name, members);
                  showToast(`Created "${name}"`);
                });
              }}
            >
              New playlist…
            </button>
            {custom.slice(0, 8).map((c) => (
              <button
                key={c.id}
                class="btn"
                data-focusable
                data-focus-id={`pl-add:${c.id}`}
                onClick={() => {
                  closeOverlay('pl-add');
                  addToCustom(c.id, members);
                  showToast(`Added to "${c.name}"`);
                }}
              >
                {c.name} ({c.members.length})
              </button>
            ))}
          </div>
          <div class="actions hstack">
            <button class="btn" data-focusable data-focus-id="pl-add:cancel" onClick={() => closeOverlay('pl-add')}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };
  openOverlay({ key: 'pl-add', render });
}

function confirmDelete(c: CustomPlaylist, after?: () => void): void {
  openOverlay({
    key: 'pl-delete',
    render: () => (
      <Dialog
        title={`Delete "${c.name}"?`}
        actions={[
          { id: 'keep', label: 'Keep', isDefault: true, onSelect: () => closeOverlay('pl-delete') },
          {
            id: 'delete',
            label: 'Delete',
            onSelect: () => {
              closeOverlay('pl-delete');
              deleteCustom(c.id);
              showToast(`Deleted "${c.name}"`);
              if (after) after();
            },
          },
        ]}
      >
        Only your playlist is deleted; the playlists it combines stay in their collections.
      </Dialog>
    ),
  });
}

// ------------------------------------------------------------------ main screen

export function Playlists() {
  const lib = library.value;
  const idx = playlistIndex.value;
  const state = playlistState.value;
  const [query, setQuery] = useState('');
  const [rowIndex, setRowIndex] = useState(0);
  const [preview, setPreview] = useState<{ id: string; entries: PlaylistEntry[] | null; error?: string } | null>(null);
  const myRoute = useRef(routeKey.value);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (lib.status === 'ready' && playlistIndex.value.status !== 'ready') loadPlaylistIndex();
  }, [lib.status]);

  const sections = useMemo(() => {
    if (idx.status !== 'ready' || lib.status !== 'ready') return [] as Section[];
    return buildSections(idx.index.playlists, idx.index.collections, lib.registry.items, state.custom, state.selected);
  }, [idx, lib, state.custom, state.selected]);
  const section = sections.filter((s) => s.id === activeSection.value)[0] || sections[0];
  const q = fold(query.trim());
  const rows = q ? sections[0]!.rows.concat(sections.filter((s) => s.id === 'custom')[0]!.rows).filter((r) => fold(r.title).indexOf(q) >= 0) : section ? section.rows : [];
  const focused: Row | null = rows[Math.min(rowIndex, rows.length - 1)] || null;
  const focusedRef = useRef<Row | null>(null);
  focusedRef.current = focused;

  // Preview of the focused playlist (loaded only when it stays focused).
  useEffect(() => {
    if (!focused) return;
    const id = focused.id;
    const t = setTimeout(() => {
      setPreview({ id, entries: null });
      loadEntries(id).then(
        (entries) => setPreview((p) => (p && p.id === id ? { id, entries } : p)),
        (err) => setPreview((p) => (p && p.id === id ? { id, entries: [], error: String((err && err.message) || err) } : p)),
      );
    }, 350);
    return () => clearTimeout(t);
  }, [focused && focused.id]);

  const act = {
    open: (r: Row) => openPage(playlistPage(r.id, r.title)),
    toggle: (r: Row) => showToast(toggleSelected(r.id) ? `Selected ${r.title}` : `Deselected ${r.title}`),
    add: (r: Row) => chooseCustom([r.id], `"${r.title}"`),
    watch: (r: Row) => watchInLiveTV(r.id, r.title),
    rename: (r: Row) => r.custom && askName('Rename playlist', r.custom.name, (name) => renameCustom(r.custom!.id, name)),
    del: (r: Row) => r.custom && confirmDelete(r.custom),
  };

  useEffect(
    () =>
      pushKeyHandler((a) => {
        if (routeKey.value !== myRoute.current) return false;
        const el = getEngine().focused;
        if (!el || !el.closest('.playlists')) return false;
        const r = focusedRef.current;
        if (!r) return false;
        if (a.action === 'red') act.toggle(r);
        else if (a.action === 'green') act.add(r);
        else if (a.action === 'yellow' && r.custom) act.rename(r);
        else if (a.action === 'blue' && r.custom) act.del(r);
        else return false;
        return true;
      }),
    [],
  );

  if (lib.status !== 'ready' || idx.status === 'loading') {
    return (
      <div class="screen playlists">
        <div class="pl-head">
          <div class="page-title">Playlists</div>
        </div>
        <div class="pl-list">
          <EmptyState id="pl:loading" title={lib.status === 'missing' ? 'No library on this TV' : 'Loading playlists…'} wide>
            {lib.status === 'missing' ? lib.reason : 'One moment.'}
          </EmptyState>
        </div>
      </div>
    );
  }
  if (idx.status === 'missing') {
    return (
      <div class="screen playlists">
        <div class="pl-head">
          <div class="page-title">Playlists</div>
        </div>
        <div class="pl-list">
          <EmptyState id="pl:missing" title="No playlists in this library" wide>
            {idx.reason}
          </EmptyState>
        </div>
      </div>
    );
  }

  const ids = rows.map((r) => r.id);
  const selectedHere = ids.filter((id) => state.selected.indexOf(id) >= 0).length;
  return (
    <div class="screen playlists">
      <div class="pl-head">
        <div class="hstack" style="--stack-gap:20px;align-items:center" data-focus-group data-focus-memory>
          <div class="page-title" style="margin:0">Playlists</div>
          <div class="search-field small hstack" data-focusable data-focus-id="pl:search" onClick={() => input.current && input.current.focus()}>
            <input ref={input} type="text" value={query} placeholder="Search playlists" aria-label="Search playlists" onInput={(e) => (setQuery((e.target as HTMLInputElement).value), setRowIndex(0))} />
          </div>
          <button class="chip selectable" data-focusable data-focus-id="pl:all" onClick={() => (selectAll(ids), showToast(`Selected ${ids.length}`))}>
            Select all
          </button>
          <button class="chip selectable" data-focusable data-focus-id="pl:clear" onClick={() => (clearAll(ids), showToast('Cleared'))}>
            Clear
          </button>
          <button
            class="chip selectable"
            data-focusable
            data-focus-id="pl:combine"
            onClick={() => {
              if (!state.selected.length) return showToast('Select playlists first (Red)');
              askName('Name your playlist', '', (name) => {
                createCustom(name, state.selected);
                showToast(`Created "${name}" from ${state.selected.length} playlists`);
              });
            }}
          >
            Combine selected…
          </button>
          <button class="chip selectable" data-focusable data-focus-id="pl:watch-selected" onClick={() => (state.selected.length ? watchInLiveTV('selection', 'My selection') : showToast('Select playlists first (Red)'))}>
            Watch selected
          </button>
          <button class="chip selectable" data-focusable data-focus-id="pl:save" onClick={() => (saveSelection(), showToast('Selection saved'))}>
            Save selection
          </button>
          <button class="chip selectable" data-focusable data-focus-id="pl:restore" onClick={() => showToast(restoreSelection() ? 'Selection restored' : 'No saved selection yet')}>
            Restore
          </button>
        </div>
        <div class="pl-status">
          {state.selected.length} selected{q ? ` · ${rows.length} matches` : section ? ` · ${selectedHere} of ${rows.length} here` : ''} · saved on{' '}
          {syncStatus.value === 'pc' ? 'this TV and your PC' : syncStatus.value === 'pc-failed' ? 'this TV (PC not reachable)' : 'this TV'}
        </div>
      </div>
      <div class="pl-sections">
        <VirtualList
          id="pl:sections"
          focusUp={HEAD}
          items={sections}
          rowHeight={78}
          height={740}
          index={Math.max(0, sections.indexOf(section!))}
          renderRow={(s) => (
            <div class="lrow">
              <div class="lrow-text">
                <div class="lrow-name">{s.label}</div>
                <div class="lrow-sub">{s.rows.length} playlist{s.rows.length === 1 ? '' : 's'}</div>
              </div>
            </div>
          )}
          onIndexChange={(s) => {
            activeSection.value = s.id;
            setRowIndex(0);
            setQuery('');
          }}
          onSelect={(s) => (activeSection.value = s.id)}
        />
      </div>
      <div class="pl-list">
        <VirtualList
          id={`pl:rows:${q ? 'search' : section ? section.id : ''}`}
          focusUp={HEAD}
          items={rows}
          rowHeight={96}
          height={740}
          renderRow={(r) => (
            <div class="lrow">
              <span class={'pl-check' + (isSelected(r.id) ? ' on' : '')} />
              <div class="lrow-text">
                <div class="lrow-name">{r.title}</div>
                <div class="lrow-sub">{r.sub}</div>
              </div>
            </div>
          )}
          index={Math.min(rowIndex, Math.max(0, rows.length - 1))}
          onIndexChange={(_r, i) => setRowIndex(i)}
          onSelect={(r) => act.open(r)}
          empty={
            <EmptyState id="pl:empty" title={q ? 'No playlist matches' : `Nothing in ${section ? section.label : 'this section'} yet`}>
              {q ? 'Try another name.' : (section && section.note) || ''}
            </EmptyState>
          }
        />
      </div>
      <div class="pl-preview">
        {focused ? (
          <>
            <div class="pl-preview-title">{focused.title}</div>
            <div class="pl-preview-sub">{focused.playlist ? `${focused.playlist.collection} · ${focused.playlist.file || 'your own'}` : focused.kind === 'lib' ? 'Built by FBTV from all sources' : 'Your playlist'}</div>
            <div class="hstack pl-actions" data-focus-group>
              <button class="btn" data-focusable data-focus-id="pl:p:open" onClick={() => act.open(focused)}>
                Open
              </button>
              <button class="btn" data-focusable data-focus-id="pl:p:select" onClick={() => act.toggle(focused)}>
                {isSelected(focused.id) ? 'Deselect' : 'Select'}
              </button>
              <button class="btn" data-focusable data-focus-id="pl:p:add" onClick={() => act.add(focused)}>
                Add to…
              </button>
              <button class="btn" data-focusable data-focus-id="pl:p:watch" onClick={() => act.watch(focused)}>
                Watch
              </button>
            </div>
            {focused.custom ? (
              <div class="hstack pl-actions" data-focus-group>
                <button class="btn" data-focusable data-focus-id="pl:p:rename" onClick={() => act.rename(focused)}>
                  Rename
                </button>
                <button class="btn" data-focusable data-focus-id="pl:p:delete" onClick={() => act.del(focused)}>
                  Delete
                </button>
              </div>
            ) : null}
            {focused.playlist ? <PreviewCounts p={focused.playlist} /> : null}
            <div class="pl-preview-entries">
              {!preview || preview.id !== focused.id || !preview.entries ? (
                <div class="muted-text">Loading entries…</div>
              ) : preview.error ? (
                <div class="muted-text">Could not load: {preview.error}</div>
              ) : (
                preview.entries.slice(0, 9).map((e, i) => (
                  <div key={i} class={'pl-entry' + (e.s === 'ok' ? '' : ' off')}>
                    {e.n}
                    <span>{e.s === 'ok' ? ` · ${validationText(e.v)}` : ` · ${entryProblem(e)}`}</span>
                  </div>
                ))
              )}
            </div>
            <div class="pl-keys">Red select · Green add to… · {focused.custom ? 'Yellow rename · Blue delete · ' : ''}OK open</div>
          </>
        ) : (
          <div class="muted-text">Choose a playlist to see its entries.</div>
        )}
      </div>
    </div>
  );
}

function PreviewCounts({ p }: { p: SourcePlaylist }) {
  const v = p.validation;
  return (
    <div class="pl-counts">
      {n(p.entries)} lines · {n(p.channels)} entries · {n(p.playable)} playable · {n(p.duplicates)} duplicates merged
      <br />
      {n(v.confirmed)} playback confirmed · {n(v.recognised)} format recognised · {n(v.reachable)} reachable · {n(v.unavailable + v.failed)} unavailable · {n(v.untested)} not yet checked
      {p.withheld || p.unsupported || p.malformed || p.other ? (
        <>
          <br />
          {n(p.withheld)} withheld · {n(p.unsupported)} unsupported · {n(p.malformed)} malformed · {n(p.other)} other
        </>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ one playlist

function PlaylistView({ member, title }: { member: string; title: string }) {
  const [entries, setEntries] = useState<PlaylistEntry[] | null>(null);
  const [error, setError] = useState('');
  const state = playlistState.value;
  const custom = member.indexOf('custom:') === 0 ? state.custom.filter((c) => c.id === member.slice(7))[0] : undefined;
  const membersKey = custom ? custom.members.join('|') : '';
  useEffect(() => {
    let alive = true;
    setEntries(null);
    loadEntries(member).then(
      (e) => alive && setEntries(e),
      (err) => alive && setError(String((err && err.message) || err)),
    );
    return () => {
      alive = false;
    };
  }, [member, membersKey]);
  const channels = useMemo(() => (entries ? entriesToChannels(entries, member) : []), [entries]);
  const playIndex = useMemo(() => {
    const m = new Map<PlaylistEntry, number>();
    if (entries) {
      let j = 0;
      for (const e of entries) if (e.s === 'ok' && e.u && e.u.some((u) => !entryProblem({ ...e, u: [u] }))) m.set(e, j++);
    }
    return m;
  }, [entries]);
  const name = custom ? custom.name : title;
  return (
    <div class="screen playlists">
      <div class="pl-head">
        <div class="breadcrumb">
          Playlists › <b>{name}</b>
        </div>
        <div class="hstack" style="--stack-gap:14px;margin-top:14px" data-focus-group>
          <button class="chip selectable" data-focusable data-focus-default data-focus-id="plv:watch" onClick={() => watchInLiveTV(member, name)}>
            Watch in Live TV
          </button>
          <button class="chip selectable" data-focusable data-focus-id="plv:select" onClick={() => showToast(toggleSelected(member) ? 'Selected' : 'Deselected')}>
            {isSelected(member) ? 'Deselect' : 'Select'}
          </button>
          {custom ? (
            <>
              <button class="chip selectable" data-focusable data-focus-id="plv:rename" onClick={() => askName('Rename playlist', custom.name, (v) => renameCustom(custom.id, v))}>
                Rename
              </button>
              <button class="chip selectable" data-focusable data-focus-id="plv:delete" onClick={() => confirmDelete(custom, () => closePage())}>
                Delete
              </button>
            </>
          ) : (
            <button class="chip selectable" data-focusable data-focus-id="plv:add" onClick={() => chooseCustom([member], `"${name}"`)}>
              Add to…
            </button>
          )}
        </div>
        <div class="pl-status">
          {entries ? `${entries.length.toLocaleString()} entries · ${channels.length.toLocaleString()} playable here` : error ? `Could not load: ${error}` : 'Loading…'}
        </div>
      </div>
      {custom ? (
        <div class="pl-sections">
          <VirtualList
            id={`plv:members:${custom.id}`}
            items={custom.members}
            rowHeight={78}
            height={740}
            renderRow={(m) => (
              <div class="lrow">
                <div class="lrow-text">
                  <div class="lrow-name">{memberTitle(m)}</div>
                  <div class="lrow-sub">Red: remove from this playlist</div>
                </div>
              </div>
            )}
            onSelect={(m) => openPage(playlistPage(m, memberTitle(m)))}
            onKey={(m, action) => {
              if (action !== 'red') return false;
              removeFromCustom(custom.id, m);
              showToast(`Removed ${memberTitle(m)}`);
              return true;
            }}
            empty={
              <EmptyState id="plv:nomembers" title="No playlists in it yet">
                Press Green on any playlist to add it here.
              </EmptyState>
            }
          />
        </div>
      ) : null}
      <div class={custom ? 'pl-list wide-right' : 'pl-list wide'}>
        {entries ? (
          <VirtualList
            id={`plv:entries:${member}`}
            items={entries}
            rowHeight={96}
            height={740}
            renderRow={(e) => {
              const problem = entryProblem(e);
              return (
                <div class={'lrow' + (problem ? ' is-offline' : '')}>
                  <div class="lrow-text">
                    <div class="lrow-name">{e.n}</div>
                    <div class="lrow-sub">
                      {[e.g, e.c, problem || validationText(e.v), e.u && e.u.length > 1 ? `${e.u.length} alternative streams` : ''].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </div>
              );
            }}
            onSelect={(e) => {
              const i = playIndex.get(e);
              if (i === undefined) return showToast(`${e.n}: ${entryProblem(e) || 'cannot play'}`);
              watchFrom(channels[i]!, channels, name);
            }}
            empty={
              <EmptyState id="plv:empty" title="No entries">
                {error || 'This playlist has no entries.'}
              </EmptyState>
            }
          />
        ) : (
          <EmptyState id="plv:loading" title={error ? 'Could not load this playlist' : 'Loading entries…'}>
            {error}
          </EmptyState>
        )}
      </div>
    </div>
  );
}

export function playlistPage(member: string, title: string): PageEntry {
  return { key: `playlist:${member}`, title, render: () => <PlaylistView member={member} title={title} /> };
}
