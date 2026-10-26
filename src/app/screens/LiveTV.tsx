/**
 * Live deck (blueprint direction C): category chips, a live preview window, the focused
 * channel's details, and a numbered, windowed channel list. Focusing a row previews it
 * after a short pause (Settings can turn this off); OK opens full screen.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { CatalogueChannel } from '../../shared/model.ts';
import { catalogue, ready } from '../data/catalogue.ts';
import { LIST_LABELS, LIST_ORDER, channelNumbers, channelsFor, type ListId } from '../data/lists.ts';
import { favourites, prefs, toggleFavourite } from '../data/library.ts';
import { getPlayer, nowPlaying, playChannel, playContext, streamLabel, videoLayout } from '../data/playback.ts';
import { pushKeyHandler } from '../nav/input.ts';
import { openPage, routeKey } from '../nav/router.ts';
import { getEngine } from '../focus/index.ts';
import { VirtualList } from '../ui/VirtualList.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Logo, QualityChip } from '../ui/ChannelTile.tsx';
import { showToast } from '../ui/toast.tsx';
import { describeError } from '../player/policy.ts';
import { watchPage } from './Watch.tsx';
import { countriesPage } from './Countries.tsx';

const PREVIEW = { left: 96, top: 214, width: 880, height: 495 };
const PREVIEW_DELAY_MS = 1200;
const ROW_H = 96;

/** Remembered across visits to the tab. */
const activeList = signal<ListId>('all');
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
  if (c.languages && data) parts.push(c.languages.slice(0, 2).map((l) => data.languageName[l] || l).join(', '));
  if (c.categories && data && c.categories[0]) parts.push(data.categoryName[c.categories[0]] || c.categories[0]);
  return parts.join(' · ');
}

function InfoPanel({ channel }: { channel: CatalogueChannel | null }) {
  if (!channel) return null;
  const s = channel.streams[0];
  const geo = channel.streams.every((x) => (x.labels || []).indexOf('Geo-blocked') >= 0);
  const part = channel.streams.every((x) => (x.labels || []).indexOf('Not 24/7') >= 0);
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
        {geo ? <span class="chip muted">May only work in its country</span> : null}
        {part ? <span class="chip muted">Not 24/7</span> : null}
        {favourites.value.indexOf(channel.id) >= 0 ? <span class="chip">★ Favourite</span> : null}
      </div>
      <div class="live-info-sub">
        {channelSubline(channel)}
        {channel.streams.length > 1 ? ` · ${channel.streams.length} feeds` : ''}
        {s && s.feedName ? ` · ${streamLabel(s)}` : ''}
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
  return (
    <div class="lrow">
      <span class="lrow-num">{number || ''}</span>
      <Logo channel={c} size="row" />
      <div class="lrow-text">
        <div class="lrow-name">
          {c.name}
          {favourites.value.indexOf(c.id) >= 0 ? <span class="lrow-fav"> ★</span> : null}
          {playing ? <span class="lrow-playing"> ● playing</span> : null}
        </div>
        <div class="lrow-sub">{channelSubline(c)}</div>
      </div>
    </div>
  );
}

export function LiveTV() {
  const state = catalogue.value;
  const data = ready();
  const [list, setList] = useState<ListId>(activeList.value);
  const [current, setCurrent] = useState<CatalogueChannel | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myRoute = useRef(routeKey.value);

  const channels = useMemo(() => (data ? channelsFor(list, data) : []), [data, list, favourites.value]);
  const numbers = data ? channelNumbers(data).numberOf : new Map<string, number>();

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

  const schedulePreview = (c: CatalogueChannel) => {
    if (timer.current) clearTimeout(timer.current);
    if (!prefs.value.previewOnFocus) return;
    if (nowPlaying.value && nowPlaying.value.channel.id === c.id) return;
    timer.current = setTimeout(() => {
      playContext.value = { ids: channels.map((x) => x.id), label: LIST_LABELS[list] };
      playChannel(c);
    }, PREVIEW_DELAY_MS);
  };

  const openFull = (c: CatalogueChannel) => {
    if (timer.current) clearTimeout(timer.current);
    playContext.value = { ids: channels.map((x) => x.id), label: LIST_LABELS[list] };
    if (!nowPlaying.value || nowPlaying.value.channel.id !== c.id) playChannel(c);
    openPage(watchPage());
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
  if (state.status === 'loading') {
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
  if (!data) {
    return (
      <div class="screen live-deck">
        <div class="live-list">
          <EmptyState id="live:empty" title="No channels loaded" wide>
            {state.status === 'empty' ? state.reason : ''} Build the catalogue with “npm run catalogue” and reinstall, or
            set the catalogue URL once GitHub Pages is publishing it.
          </EmptyState>
        </div>
      </div>
    );
  }

  const playingId = nowPlaying.value ? nowPlaying.value.channel.id : null;
  return (
    <div class="screen live-deck">
      <div class="live-chips hstack" data-focus-group data-focus-enter=".is-selected">
        {LIST_ORDER.map((id) => (
          <button
            key={id}
            class={'chip selectable' + (id === list ? ' is-selected' : '')}
            data-focusable
            data-focus-id={`live:chip:${id}`}
            onClick={() => {
              setList(id);
              activeList.value = id;
              activeIndex.value = 0;
            }}
          >
            {LIST_LABELS[id]}
          </button>
        ))}
        <button class="chip selectable" data-focusable data-focus-id="live:chip:countries" onClick={() => openPage(countriesPage())}>
          Countries ›
        </button>
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
        {LIST_LABELS[list]} · {channels.length.toLocaleString()} channels
      </div>
      <div class="live-list">
        <VirtualList
          id={`live:${list}`}
          items={channels}
          rowHeight={ROW_H}
          height={768}
          index={Math.min(activeIndex.value, Math.max(0, channels.length - 1))}
          renderRow={(c) => <Row c={c} number={numbers.get(c.id)} playing={c.id === playingId} />}
          onIndexChange={(c, i) => {
            activeIndex.value = i;
            setCurrent(c);
            schedulePreview(c);
          }}
          onSelect={(c) => openFull(c)}
          empty={
            <EmptyState id="live:list-empty" title={`No channels in ${LIST_LABELS[list]}`}>
              {list === 'fav'
                ? 'Press the red button on any channel to add it here.'
                : list === 'recent'
                  ? 'Channels you watch appear here.'
                  : list === 'online'
                    ? 'Shows channels whose stream answered at the catalogue’s last check (within 24 hours).'
                    : list === 'uhd'
                      ? 'No channel in the catalogue is verified or advertised as 4K yet.'
                      : 'Nothing in the catalogue matches this list.'}
            </EmptyState>
          }
        />
      </div>
    </div>
  );
}
