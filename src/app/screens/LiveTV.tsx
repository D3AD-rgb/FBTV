/**
 * Live deck (blueprint direction C): category chips, a live preview window, the focused
 * channel's details, and a numbered, windowed channel list. Focusing a row previews it
 * after a short pause (Settings can turn this off); OK opens full screen.
 *
 * With a source library on the TV (Rule 10) the chips become library sources: "Sources ▾"
 * opens the registry dropdown, and a few quick chips jump to common lists. Without one the
 * deck falls back to the bundled catalogue's fixed lists.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { CatalogueChannel } from '../../shared/model.ts';
import { catalogue, ready } from '../data/catalogue.ts';
import { LIST_LABELS, LIST_ORDER, channelNumbers, channelsFor, type ListId } from '../data/lists.ts';
import { favourites, prefs, recents, toggleFavourite } from '../data/library.ts';
import { getPlayer, nowPlaying, playChannel, playContext, streamLabel, videoLayout } from '../data/playback.ts';
import {
  channelsForItem,
  includeUnreviewed,
  isLibChannel,
  libStatus,
  library,
  loadShard,
  preferredItem,
  setPreferredItem,
  type LibChannel,
  type LibItem,
} from '../data/sourceLibrary.ts';
import { pushKeyHandler } from '../nav/input.ts';
import { closeOverlay, openOverlay, openPage, routeKey, setTab } from '../nav/router.ts';
import { getEngine } from '../focus/index.ts';
import { VirtualList } from '../ui/VirtualList.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Logo, QualityChip } from '../ui/ChannelTile.tsx';
import { SourcePicker } from '../ui/SourcePicker.tsx';
import { showToast } from '../ui/toast.tsx';
import { describeError } from '../player/policy.ts';
import { watchPage } from './Watch.tsx';
import { countriesPage } from './Countries.tsx';

const PREVIEW = { left: 96, top: 214, width: 880, height: 495 };
const PREVIEW_DELAY_MS = 1200;
const ROW_H = 96;

/** Library lists offered as one-press chips, when the registry has them. */
const QUICK: [string, string][] = [
  ['country-uk', 'UK'],
  ['news-english', 'English News'],
  ['sports-english', 'Sports · English'],
  ['football-all', 'Football'],
  ['country-bd', 'Bangladesh'],
  ['country-in', 'India'],
  ['radio', 'Radio'],
  ['live-all', 'All'],
];

type Source = { kind: 'list'; id: ListId } | { kind: 'lib'; id: string };

/** Remembered across visits to the tab. null = the default (library preference, else "all"). */
const activeSource = signal<Source | null>(null);
const activeIndex = signal(0);

export function countryLabel(c: CatalogueChannel): string {
  const data = ready();
  const co = c.country && data ? data.countryById.get(c.country) : undefined;
  // Emoji flags are not reliable in TV system fonts (FND-013): show the name only.
  return co ? co.name : c.country || '';
}

export function channelSubline(c: CatalogueChannel): string {
  const data = ready();
  const parts: string[] = [];
  const country = countryLabel(c);
  if (country) parts.push(country);
  const lang = (l: string) => (data && data.languageName[l]) || l;
  if (c.languages && c.languages.length) parts.push(c.languages.slice(0, 2).map(lang).join(', '));
  if (c.categories && c.categories[0]) parts.push((data && data.categoryName[c.categories[0]]) || c.categories[0]);
  return parts.join(' · ');
}

/** Playable first, then the TV's home country, then by how much the last check confirmed. Stable otherwise. */
const RANK: Record<string, number> = { playback_confirmed: 0, reachable: 1, untested: 2, temporarily_unavailable: 3, playback_failed: 3 };
function sortLibrary(list: LibChannel[]): LibChannel[] {
  const home = (prefs.value.homeCountry || '').toLowerCase();
  return list
    .map((c, i) => ({
      c,
      i,
      p: c.playable ? 0 : 1,
      h: home && (c.country || '').toLowerCase() === home ? 0 : 1,
      r: RANK[c.validation] !== undefined ? RANK[c.validation]! : 2,
    }))
    .sort((a, b) => a.p - b.p || a.h - b.h || a.r - b.r || a.i - b.i)
    .map((x) => x.c);
}

function InfoPanel({ channel }: { channel: CatalogueChannel | null }) {
  if (!channel) return null;
  const lib = isLibChannel(channel) ? channel : null;
  const s = channel.streams[0];
  const geo = channel.streams.length > 0 && channel.streams.every((x) => (x.labels || []).indexOf('Geo-blocked') >= 0);
  const part = channel.streams.length > 0 && channel.streams.every((x) => (x.labels || []).indexOf('Not 24/7') >= 0);
  const playing = nowPlaying.value && nowPlaying.value.channel.id === channel.id ? nowPlaying.value : null;
  const player = getPlayer();
  const status = playing && player ? player.status.value : 'idle';
  const err = playing && player && status === 'error' ? player.error.value : null;
  return (
    <div class="live-info">
      <div class="live-info-name">{channel.name}</div>
      <div class="live-info-chips hstack">
        <span class="chip">{countryLabel(channel) || 'Country unknown'}</span>
        <QualityChip channel={channel} />
        {lib ? <span class={'chip' + (lib.playable ? '' : ' muted')}>{libStatus(lib)}</span> : null}
        {geo ? <span class="chip muted">May only work in its country</span> : null}
        {part ? <span class="chip muted">Not 24/7</span> : null}
        {favourites.value.indexOf(channel.id) >= 0 ? <span class="chip">★ Favourite</span> : null}
      </div>
      <div class="live-info-sub">
        {channelSubline(channel)}
        {channel.streams.length > 1 ? ` · ${channel.streams.length} feeds` : ''}
        {s && s.feedName ? ` · ${streamLabel(s)}` : ''}
        {lib ? ` · from ${lib.repos.join(', ')}` : ''}
      </div>
      {err ? (
        <div class="live-info-error">
          <b>{describeError(err).title}.</b> {describeError(err).hint}
        </div>
      ) : null}
    </div>
  );
}

function Row({ c, number, playing }: { c: CatalogueChannel; number?: number; playing: boolean }) {
  const lib = isLibChannel(c) ? c : null;
  return (
    <div class={'lrow' + (lib && !lib.playable ? ' is-offline' : '')}>
      <span class="lrow-num">{number || ''}</span>
      <Logo channel={c} size="row" />
      <div class="lrow-text">
        <div class="lrow-name">
          {c.name}
          {favourites.value.indexOf(c.id) >= 0 ? <span class="lrow-fav"> ★</span> : null}
          {playing ? <span class="lrow-playing"> ● playing</span> : null}
        </div>
        <div class="lrow-sub">{lib ? [channelSubline(c), libStatus(lib)].filter(Boolean).join(' · ') : channelSubline(c)}</div>
      </div>
    </div>
  );
}

/** Where a registry item that is not a channel list lives in the app. */
function openNonList(item: LibItem): void {
  if (item.contentType === 'fixtures' || item.contentType === 'football') setTab('football');
  else if (item.contentType === 'vod-movies') setTab('movies');
  else if (item.contentType === 'vod-series') setTab('series');
  else showToast(item.error || item.note || `${item.name}: nothing to play on the TV`);
}

export function LiveTV() {
  const state = catalogue.value;
  const data = ready();
  const lib = library.value;
  const registry = lib.status === 'ready' ? lib.registry : null;
  const secondary = includeUnreviewed.value;

  const chosen = activeSource.value;
  const source: Source = chosen || (registry ? { kind: 'lib', id: preferredItem.value } : { kind: 'list', id: 'all' });
  const libItem: LibItem | null = useMemo(() => {
    if (!registry || source.kind !== 'lib') return null;
    const byId = (id: string) => registry.items.filter((i) => i.id === id && !!i.select)[0];
    return byId(source.id) || byId('live-all') || registry.items.filter((i) => !!i.select)[0] || null;
  }, [registry, source.kind, source.id]);

  const [current, setCurrent] = useState<CatalogueChannel | null>(null);
  const [libList, setLibList] = useState<{ key: string; list: LibChannel[]; error?: string } | null>(null);
  const [libMap, setLibMap] = useState<Map<string, LibChannel> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myRoute = useRef(routeKey.value);

  const libKey = libItem ? `${libItem.id}|${secondary}` : '';
  useEffect(() => {
    if (!libItem) return;
    let alive = true;
    channelsForItem(libItem, secondary).then(
      (list) => alive && setLibList({ key: libKey, list: sortLibrary(list) }),
      (err) => alive && setLibList({ key: libKey, list: [], error: String((err && err.message) || err) }),
    );
    return () => {
      alive = false;
    };
  }, [libKey]);

  // Favourites and history may hold library channels that the bundled catalogue does not have.
  const personal = source.kind === 'list' && (source.id === 'fav' || source.id === 'recent');
  useEffect(() => {
    if (!registry || !personal) return;
    let alive = true;
    Promise.all([loadShard('primary'), secondary ? loadShard('secondary') : Promise.resolve([] as LibChannel[])]).then(([a, b]) => {
      if (!alive) return;
      const m = new Map<string, LibChannel>();
      for (const c of b) m.set(c.id, c);
      for (const c of a) m.set(c.id, c);
      setLibMap(m);
    });
    return () => {
      alive = false;
    };
  }, [!!registry, personal, secondary]);

  const loadingLib = source.kind === 'lib' && !!libItem && (!libList || libList.key !== libKey);
  const channels: CatalogueChannel[] = useMemo(() => {
    if (source.kind === 'lib') return libList && libList.key === libKey ? libList.list : [];
    if (registry && personal) {
      const ids = source.id === 'fav' ? favourites.value : recents.value.map((r) => r.id);
      return ids.map((id) => (data && data.byId.get(id)) || (libMap ? libMap.get(id) : undefined)).filter(Boolean) as CatalogueChannel[];
    }
    return data ? channelsFor(source.id, data) : [];
  }, [data, source.kind, source.id, libList, libKey, libMap, favourites.value, recents.value]);
  const playableList = channels.filter((c) => !isLibChannel(c) || c.playable);
  const numbers = data && source.kind === 'list' ? channelNumbers(data).numberOf : new Map<string, number>();
  const label = source.kind === 'lib' ? (libItem ? libItem.name : 'Library') : LIST_LABELS[source.id];

  useEffect(() => {
    videoLayout.value = { mode: 'box', ...PREVIEW };
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (videoLayout.value.mode === 'box') videoLayout.value = { mode: 'hidden' };
    };
  }, []);

  // Coming back from full screen: put the video back in the preview box.
  useEffect(() => {
    if (routeKey.value === myRoute.current) videoLayout.value = { mode: 'box', ...PREVIEW };
  }, [routeKey.value]);

  useEffect(() => {
    const first = channels[Math.min(activeIndex.value, Math.max(0, channels.length - 1))] || null;
    setCurrent(first);
  }, [channels]);

  const canPlay = (c: CatalogueChannel) => !isLibChannel(c) || c.playable;
  const setContext = () => {
    playContext.value = { ids: playableList.map((x) => x.id), label, channels: playableList };
  };

  const schedulePreview = (c: CatalogueChannel) => {
    if (timer.current) clearTimeout(timer.current);
    if (!prefs.value.previewOnFocus || !canPlay(c)) return;
    if (nowPlaying.value && nowPlaying.value.channel.id === c.id) return;
    timer.current = setTimeout(() => {
      setContext();
      playChannel(c);
    }, PREVIEW_DELAY_MS);
  };

  const openFull = (c: CatalogueChannel) => {
    if (timer.current) clearTimeout(timer.current);
    if (!canPlay(c)) {
      showToast(`${c.name}: ${libStatus(c as LibChannel)}`);
      return;
    }
    setContext();
    if (!nowPlaying.value || nowPlaying.value.channel.id !== c.id) playChannel(c);
    openPage(watchPage());
  };

  const choose = (s: Source) => {
    activeSource.value = s;
    activeIndex.value = 0;
    if (s.kind === 'lib') setPreferredItem(s.id);
  };

  const openPicker = () => {
    if (!registry) return;
    openOverlay({
      key: 'source-picker',
      render: () => (
        <SourcePicker
          registry={registry}
          currentId={libItem ? libItem.id : ''}
          onPick={(item) => {
            closeOverlay('source-picker');
            if (item.select) choose({ kind: 'lib', id: item.id });
            else openNonList(item);
          }}
        />
      ),
    });
  };

  const currentRef = useRef(current);
  currentRef.current = current;

  // Red = favourite for the highlighted channel while browsing this screen.
  useEffect(
    () =>
      pushKeyHandler((a) => {
        if (a.action !== 'red' || routeKey.value !== myRoute.current) return false;
        const el = getEngine().focused;
        if (!el || !el.closest('.live-deck')) return false;
        const c = currentRef.current;
        if (!c) return false;
        showToast(toggleFavourite(c.id) ? `Added ${c.name} to favourites` : `Removed ${c.name} from favourites`);
        return true;
      }),
    [],
  );

  if (!registry && (state.status === 'loading' || lib.status === 'loading')) {
    return (
      <div class="screen live-deck">
        <div class="live-list">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} class="skeleton skel-row" />
          ))}
        </div>
      </div>
    );
  }
  if (!data && !registry) {
    return (
      <div class="screen live-deck">
        <div class="live-list">
          <EmptyState id="live:empty" title="No channels loaded" wide>
            {state.status === 'empty' ? state.reason : ''} Build the library on the PC with “npm run library:refresh” and
            reinstall, or set a library server in Settings › Sources.
          </EmptyState>
        </div>
      </div>
    );
  }

  const playingId = nowPlaying.value ? nowPlaying.value.channel.id : null;
  const quick = registry ? (QUICK.map(([id, name]) => [registry.items.filter((i) => i.id === id && !!i.select)[0], name]).filter((x) => !!x[0]) as [LibItem, string][]) : [];
  const libSelected = source.kind === 'lib' && libItem ? libItem.id : '';
  const hidden = libItem && libList && libList.key === libKey && libItem.channels > playableList.length && !secondary ? libItem.channels - playableList.length : 0;
  return (
    <div class="screen live-deck">
      <div class="live-chips hstack" data-focus-group data-focus-enter=".is-selected">
        {registry ? (
          <>
            <button class="chip selectable source-chip" data-focusable data-focus-id="live:chip:sources" onClick={openPicker}>
              Sources ▾
            </button>
            {libItem && !quick.some(([i]) => i.id === libItem.id) && source.kind === 'lib' ? (
              <button class="chip selectable is-selected" data-focusable data-focus-id={`live:chip:lib:${libItem.id}`} onClick={openPicker}>
                {libItem.name}
              </button>
            ) : null}
            {quick.map(([item, name]) => (
              <button
                key={item.id}
                class={'chip selectable' + (item.id === libSelected ? ' is-selected' : '')}
                data-focusable
                data-focus-id={`live:chip:lib:${item.id}`}
                onClick={() => choose({ kind: 'lib', id: item.id })}
              >
                {name}
              </button>
            ))}
            {(['fav', 'recent'] as ListId[]).map((id) => (
              <button
                key={id}
                class={'chip selectable' + (source.kind === 'list' && source.id === id ? ' is-selected' : '')}
                data-focusable
                data-focus-id={`live:chip:${id}`}
                onClick={() => choose({ kind: 'list', id })}
              >
                {LIST_LABELS[id]}
              </button>
            ))}
          </>
        ) : (
          <>
            {LIST_ORDER.map((id) => (
              <button
                key={id}
                class={'chip selectable' + (source.kind === 'list' && id === source.id ? ' is-selected' : '')}
                data-focusable
                data-focus-id={`live:chip:${id}`}
                onClick={() => choose({ kind: 'list', id })}
              >
                {LIST_LABELS[id]}
              </button>
            ))}
            <button class="chip selectable" data-focusable data-focus-id="live:chip:countries" onClick={() => openPage(countriesPage())}>
              Countries ›
            </button>
          </>
        )}
      </div>
      <div class="live-preview">
        {!playingId ? (
          <div class="live-preview-empty">
            <div class="title">{prefs.value.previewOnFocus ? 'Pause on a channel to preview it' : 'Press OK to watch'}</div>
            <div class="sub">OK opens full screen · Red adds a favourite</div>
          </div>
        ) : null}
      </div>
      <InfoPanel channel={current} />
      <div class="live-list-head">
        {label} ·{' '}
        {loadingLib
          ? 'loading…'
          : channels.length === playableList.length
            ? `${channels.length.toLocaleString()} channels`
            : `${playableList.length.toLocaleString()} playable of ${channels.length.toLocaleString()}`}
        {hidden ? ` · ${hidden.toLocaleString()} more in unreviewed lists (Settings › Sources)` : ''}
      </div>
      <div class="live-list">
        {loadingLib ? (
          [0, 1, 2, 3, 4].map((i) => <div key={i} class="skeleton skel-row" />)
        ) : (
          <VirtualList
            id={`live:${source.kind}:${source.kind === 'lib' && libItem ? libItem.id : source.id}`}
            items={channels}
            rowHeight={ROW_H}
            height={768}
            index={Math.min(activeIndex.value, Math.max(0, channels.length - 1))}
            renderRow={(c, i) => <Row c={c} number={numbers.get(c.id) || (source.kind === 'lib' ? i + 1 : undefined)} playing={c.id === playingId} />}
            onIndexChange={(c, i) => {
              activeIndex.value = i;
              setCurrent(c);
              schedulePreview(c);
            }}
            onSelect={(c) => openFull(c)}
            empty={
              <EmptyState id="live:list-empty" title={`No channels in ${label}`}>
                {libList && libList.error
                  ? `The library could not be read: ${libList.error}`
                  : source.kind === 'lib'
                    ? libItem && libItem.channels && !secondary
                      ? 'This list only has channels from unreviewed sources. Turn them on in Settings › Sources.'
                      : (libItem && (libItem.note || libItem.error)) || 'Nothing in the library matches this list.'
                    : source.id === 'fav'
                      ? 'Press the red button on any channel to add it here.'
                      : source.id === 'recent'
                        ? 'Channels you watch appear here.'
                        : source.id === 'online'
                          ? 'Shows channels whose stream answered at the catalogue’s last check (within 24 hours).'
                          : source.id === 'uhd'
                            ? 'No channel in the catalogue is verified or advertised as 4K yet.'
                            : 'Nothing in the catalogue matches this list.'}
              </EmptyState>
            }
          />
        )}
      </div>
    </div>
  );
}
