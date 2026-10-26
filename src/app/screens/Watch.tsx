/**
 * Full-screen player. Up/Down and CH± step through the list the viewer came from (banner
 * first, switch after a short pause so several presses skip several channels); digits jump
 * to a channel number; Blue returns to the previous channel; Red toggles favourite; Left
 * opens the channel list; OK shows or hides the info bar. Back returns to browsing with the
 * channel still playing in the preview. On-demand items (films, episodes, your PC's media)
 * add ◀◀/▶▶ seeking (30 s), resume where you stopped, and sidecar subtitles.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CatalogueChannel } from '../../shared/model.ts';
import { ready } from '../data/catalogue.ts';
import { channelNumbers } from '../data/lists.ts';
import { favourites, prefs, toggleFavourite } from '../data/library.ts';
import {
  getPlayer,
  isOnDemand,
  nowPlaying,
  playChannel,
  playContext,
  previousChannelId,
  resolveChannel,
  streamLabel,
  videoLayout,
} from '../data/playback.ts';
import { pushKeyHandler } from '../nav/input.ts';
import { closeOverlay, openOverlay, overlays, routeKey, type PageEntry } from '../nav/router.ts';
import { getEngine } from '../focus/index.ts';
import { describeError } from '../player/policy.ts';
import { Logo, QualityChip } from '../ui/ChannelTile.tsx';
import { Icon } from '../ui/Icon.tsx';
import { VirtualList } from '../ui/VirtualList.tsx';
import { showToast } from '../ui/toast.tsx';
import { channelSubline } from './LiveTV.tsx';

const SWITCH_DELAY_MS = 500;
const DIGIT_TIMEOUT_MS = 2000;
const INFO_HIDE_MS = 5000;
const SEEK_STEP_S = 30;

/** "1:02:03" or "2:03". Pure. */
export function clock(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Index of the channel `delta` steps away in the context list (wraps around). Pure. */
export function stepInList(ids: string[], currentId: string | null, delta: number): string | null {
  if (!ids.length) return null;
  const i = currentId ? ids.indexOf(currentId) : -1;
  const base = i < 0 ? 0 : i;
  const n = ids.length;
  return ids[(((base + delta) % n) + n) % n]!;
}

function ChannelListOverlay({ onPick }: { onPick: (c: CatalogueChannel) => void }) {
  const data = ready();
  const ctxList = playContext.value.channels;
  const ids = playContext.value.ids;
  const items = (ctxList && ctxList.length
    ? ctxList
    : data
      ? (ids.length ? ids : data.channels.map((c) => c.id)).map((id) => data.byId.get(id)).filter(Boolean)
      : []) as CatalogueChannel[];
  const numbers = data ? channelNumbers(data).numberOf : new Map<string, number>();
  const cur = nowPlaying.value ? items.indexOf(nowPlaying.value.channel) : 0;
  return (
    <div class="overlay" data-focus-trap>
      <div class="watch-list">
        <div class="watch-list-title">{playContext.value.label || 'Channels'}</div>
        <VirtualList
          id="watch:list"
          items={items}
          rowHeight={92}
          height={900}
          index={Math.max(0, cur)}
          renderRow={(c) => (
            <div class="lrow">
              <span class="lrow-num">{numbers.get(c.id) || ''}</span>
              <Logo channel={c} size="row" />
              <div class="lrow-text">
                <div class="lrow-name">{c.name}</div>
                <div class="lrow-sub">{channelSubline(c)}</div>
              </div>
            </div>
          )}
          onSelect={(c) => onPick(c)}
        />
      </div>
    </div>
  );
}

function Watch() {
  const np = nowPlaying.value;
  const player = getPlayer();
  const status = player ? player.status.value : 'idle';
  const error = player ? player.error.value : null;
  const info = player ? player.info.value : {};
  const [showInfo, setShowInfo] = useState(true);
  const [pending, setPending] = useState<CatalogueChannel | null>(null);
  const [digits, setDigits] = useState('');
  const myRoute = useRef(routeKey.value);
  const timers = useRef<{ switch?: ReturnType<typeof setTimeout>; digits?: ReturnType<typeof setTimeout>; hide?: ReturnType<typeof setTimeout> }>({});
  const state = useRef({ pending, digits, showInfo });
  state.current = { pending, digits, showInfo };
  const onDemand = isOnDemand(np ? np.channel : null);
  const [, setTick] = useState(0);
  const [sub, setSub] = useState(-1);
  useEffect(() => setSub(-1), [np ? np.channel.id : '']);
  // Position readout for on-demand items while the bar is up.
  useEffect(() => {
    if (!onDemand || !showInfo) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [onDemand, showInfo]);

  const seekBy = (delta: number) => {
    const p = getPlayer();
    if (!p || !isOnDemand(nowPlaying.value ? nowPlaying.value.channel : null)) return false;
    const dur = p.duration();
    p.seek(Math.max(0, Math.min(dur ? dur - 5 : Infinity, p.position() + delta)));
    poke();
    return true;
  };

  useEffect(() => {
    videoLayout.value = { mode: 'full' };
    return () => {
      const t = timers.current;
      if (t.switch) clearTimeout(t.switch);
      if (t.digits) clearTimeout(t.digits);
      if (t.hide) clearTimeout(t.hide);
    };
  }, []);

  const poke = () => {
    setShowInfo(true);
    if (timers.current.hide) clearTimeout(timers.current.hide);
    timers.current.hide = setTimeout(() => {
      // Keep the bar while loading or showing an error.
      const p = getPlayer();
      if (p && p.status.value === 'playing') setShowInfo(false);
    }, INFO_HIDE_MS);
  };
  useEffect(poke, [np ? np.channel.id : '']);

  const play = (c: CatalogueChannel) => {
    setPending(null);
    playChannel(c);
    poke();
  };

  const queueSwitch = (delta: number) => {
    const data = ready();
    const from = state.current.pending ? state.current.pending.id : np ? np.channel.id : null;
    const id = stepInList(playContext.value.ids, from, delta);
    const target = id ? resolveChannel(id, (x) => (data ? data.byId.get(x) : undefined)) : undefined;
    if (!target) return;
    setPending(target);
    poke();
    if (timers.current.switch) clearTimeout(timers.current.switch);
    timers.current.switch = setTimeout(() => play(target), SWITCH_DELAY_MS);
  };

  const commitDigits = (value: string) => {
    setDigits('');
    const data = ready();
    if (!data || !value) return;
    const id = channelNumbers(data).byNumber.get(Number(value));
    const c = id ? data.byId.get(id) : undefined;
    if (c) play(c);
    else showToast(`No channel ${value}`);
  };

  const openList = () =>
    openOverlay({
      key: 'watch-list',
      render: () => (
        <ChannelListOverlay
          onPick={(c) => {
            closeOverlay('watch-list');
            play(c);
          }}
        />
      ),
    });

  useEffect(
    () =>
      pushKeyHandler((a) => {
        if (routeKey.value !== myRoute.current || overlays.value.length) return false;
        const rev = prefs.value.reverseChannelKeys ? -1 : 1;
        const p = getPlayer();
        switch (a.action) {
          case 'up':
          case 'channelUp':
            queueSwitch(-1 * rev);
            return true;
          case 'down':
          case 'channelDown':
            queueSwitch(1 * rev);
            return true;
          case 'digit': {
            const next = (state.current.digits + String(a.digit)).slice(0, 4);
            setDigits(next);
            if (timers.current.digits) clearTimeout(timers.current.digits);
            timers.current.digits = setTimeout(() => commitDigits(next), DIGIT_TIMEOUT_MS);
            return true;
          }
          case 'ok':
            if (state.current.digits) {
              if (timers.current.digits) clearTimeout(timers.current.digits);
              commitDigits(state.current.digits);
              return true;
            }
            if (!state.current.showInfo) {
              poke();
              requestAnimationFrame(() => getEngine().focusFirst());
              return true;
            }
            return false; // activates the focused bar button
          case 'left':
            if (state.current.showInfo && getEngine().focused && getEngine().focused!.closest('.watch-bar')) return false;
            openList();
            return true;
          case 'right':
            if (state.current.showInfo && getEngine().focused && getEngine().focused!.closest('.watch-bar')) return false;
            poke();
            return true;
          case 'red': {
            const c = nowPlaying.value ? nowPlaying.value.channel : null;
            if (c) showToast(toggleFavourite(c.id) ? `Added ${c.name} to favourites` : `Removed ${c.name} from favourites`);
            return true;
          }
          case 'blue': {
            const data = ready();
            const prev = previousChannelId.value ? resolveChannel(previousChannelId.value, (x) => (data ? data.byId.get(x) : undefined)) : undefined;
            if (prev) play(prev);
            return true;
          }
          case 'rewind':
            return seekBy(-SEEK_STEP_S);
          case 'fastForward':
            return seekBy(SEEK_STEP_S);
          case 'pause':
            if (p) p.pause();
            poke();
            return true;
          case 'play':
            if (p) p.resume();
            return true;
          case 'playPause':
            if (p) (p.status.value === 'paused' ? p.resume() : p.pause());
            poke();
            return true;
          case 'back':
            if (state.current.digits) {
              setDigits('');
              return true;
            }
            return false; // router closes the page
          default:
            return false;
        }
      }),
    [],
  );

  const shown = pending || (np ? np.channel : null);
  if (!shown) {
    return (
      <div class="screen watch">
        <div class="watch-center">Nothing is playing.</div>
      </div>
    );
  }
  const data = ready();
  const number = data ? channelNumbers(data).numberOf.get(shown.id) : undefined;
  const fav = favourites.value.indexOf(shown.id) >= 0;
  const streams = np ? np.channel.streams : [];
  const nextFeed = np && np.streamIndex + 1 < streams.length ? np.streamIndex + 1 : -1;

  return (
    <div class="screen watch">
      {status === 'loading' && !pending ? <div class="spinner" aria-label="Loading" /> : null}
      {digits ? <div class="digit-entry">{digits}</div> : null}
      {status === 'error' && error && !pending ? (
        <div class="watch-error" data-focus-trap>
          <h2>{describeError(error).title}</h2>
          <p>{describeError(error).hint}</p>
          <div class="hstack actions">
            <button class="btn" data-focusable data-focus-default data-focus-id="watch:retry" onClick={() => np && playChannel(np.channel, np.streamIndex)}>
              <Icon name="retry" /> <span>Try again</span>
            </button>
            {nextFeed >= 0 ? (
              <button class="btn" data-focusable data-focus-id="watch:nextfeed" onClick={() => np && playChannel(np.channel, nextFeed)}>
                Try another feed
              </button>
            ) : null}
            <button class="btn" data-focusable data-focus-id="watch:list" onClick={openList}>
              <Icon name="list" /> <span>Channels</span>
            </button>
          </div>
        </div>
      ) : null}
      {showInfo || pending ? (
        <div class="watch-bar">
          <div class="watch-bar-top hstack">
            {onDemand ? (
              <span class="chip">On demand</span>
            ) : (
              <span class="chip live">
                <span class="dot" /> LIVE
              </span>
            )}
            {playContext.value.label ? <span class="chip">{playContext.value.label}</span> : null}
          </div>
          <div class="watch-bar-main hstack">
            <Logo channel={shown} size="hero" />
            <div class="watch-bar-text">
              <div class="watch-bar-meta">
                {number ? `${number} · ` : ''}
                {channelSubline(shown)}
              </div>
              <div class="watch-bar-name">{shown.name}</div>
              <div class="watch-bar-meta">
                {pending ? 'Switching…' : np ? streamLabel(np.stream) : ''}
                {!pending && info.engine ? ` · ${info.engine === 'native' ? 'TV player' : info.engine}` : ''}
                {!pending && info.width && info.height ? ` · ${info.width}×${info.height} measured` : ''}
              </div>
            </div>
            <div class="spacer" />
            <QualityChip channel={shown} />
          </div>
          {onDemand && player && player.duration() ? (
            <div class="watch-progress">
              <span>{clock(player.position())}</span>
              <div class="bar">
                <div class="fill" style={{ width: `${Math.min(100, (player.position() / player.duration()) * 100)}%` }} />
              </div>
              <span>{clock(player.duration())}</span>
            </div>
          ) : null}
          {!pending ? (
            <div class="watch-actions hstack" data-focus-group>
              <button class="btn small" data-focusable data-focus-id="watch:fav" onClick={() => np && toggleFavourite(np.channel.id)}>
                {fav ? '★ Favourite' : '☆ Favourite'}
              </button>
              <button class="btn small" data-focusable data-focus-id="watch:channels" onClick={openList}>
                <Icon name="list" /> <span>Channels</span>
              </button>
              {player && player.audioTracks().length > 1 ? (
                <button
                  class="btn small"
                  data-focusable
                  data-focus-id="watch:audio"
                  onClick={() => {
                    const tracks = player.audioTracks();
                    const i = tracks.findIndex((t) => t.active);
                    const next = tracks[(i + 1) % tracks.length]!;
                    player.setAudioTrack(next.id);
                    showToast(`Audio: ${next.label}`);
                  }}
                >
                  Audio
                </button>
              ) : null}
              {onDemand ? (
                <button class="btn small" data-focusable data-focus-id="watch:back30" onClick={() => seekBy(-SEEK_STEP_S)}>
                  ◀◀ 30s
                </button>
              ) : null}
              {onDemand ? (
                <button class="btn small" data-focusable data-focus-id="watch:fwd30" onClick={() => seekBy(SEEK_STEP_S)}>
                  30s ▶▶
                </button>
              ) : null}
              {player && player.sidecars().length ? (
                <button
                  class="btn small"
                  data-focusable
                  data-focus-id="watch:subs"
                  onClick={() => {
                    const names = player.sidecars();
                    const next = sub + 1 >= names.length ? -1 : sub + 1;
                    player.showSidecar(next);
                    setSub(next);
                    showToast(next < 0 ? 'Subtitles off' : `Subtitles: ${names[next]}`);
                  }}
                >
                  {sub < 0 ? 'Subtitles' : `Subtitles: ${player.sidecars()[sub]}`}
                </button>
              ) : null}
              {nextFeed >= 0 ? (
                <button class="btn small" data-focusable data-focus-id="watch:feed" onClick={() => np && playChannel(np.channel, nextFeed)}>
                  Next feed
                </button>
              ) : null}
              <button class="btn small" data-focusable data-focus-id="watch:retry2" onClick={() => np && playChannel(np.channel, np.streamIndex)}>
                <Icon name="retry" /> <span>Retry</span>
              </button>
            </div>
          ) : null}
          <div class="watch-hints">
            {onDemand ? '◀◀ ▶▶ skip 30 s · ' : ''}▲▼ change channel · ◀ channel list · 0–9 number · Blue last channel · Red favourite
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function watchPage(): PageEntry {
  return { key: 'watch', title: 'Watching', render: () => <Watch /> };
}
