/**
 * "On your PC": films, series and other videos from the media folder on the PC, streamed by
 * the library server. Continue watching, recently watched and favourites come first; a
 * series opens its seasons and episodes in order. OK plays; Red in the player favourites.
 */
import { useEffect } from 'preact/hooks';
import type { CatalogueChannel } from '../../shared/model.ts';
import { favourites, recents } from '../data/library.ts';
import { episodeName, groupSeries, loadLocalMedia, localChannel, localLabel, localMedia, type LocalItem, type LocalSeries } from '../data/localMedia.ts';
import { resumePosition } from '../data/playback.ts';
import { library } from '../data/sourceLibrary.ts';
import { openPage, type PageEntry } from '../nav/router.ts';
import { ChannelTile } from '../ui/ChannelTile.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Shelf } from '../ui/Shelf.tsx';
import { VirtualList } from '../ui/VirtualList.tsx';
import { watchFrom } from './Collection.tsx';
import { clock } from './Watch.tsx';

const SHELF = 40;
const files = (n: number) => `${n.toLocaleString()} file${n === 1 ? '' : 's'}`;

function Row({ id, title, count, items, base, more }: { id: string; title: string; count?: string; items: LocalItem[]; base: string; more?: () => void }) {
  const channels = items.map((it) => localChannel(it, base));
  return (
    <Shelf id={id} title={title} count={count}>
      {channels.slice(0, SHELF).map((c) => (
        <ChannelTile key={c.id} channel={c} focusId={`${id}:${c.id}`} onSelect={() => watchFrom(c, channels, title)} />
      ))}
      {more && items.length > SHELF ? (
        <button class="country-card card more" data-focusable data-focus-id={`${id}:all`} onClick={more}>
          <span class="cname">See all</span>
          <span class="ccount">{files(items.length)}</span>
        </button>
      ) : null}
    </Shelf>
  );
}

/** Ids watched most recently first, limited to `of`. */
function recentOf(of: LocalItem[]): LocalItem[] {
  const by = new Map(of.map((it) => [`local:${it.id}`, it]));
  return recents.value.map((r) => by.get(r.id)).filter((x): x is LocalItem => !!x);
}

export function LocalShelves({ id, category }: { id: string; category: 'movies' | 'series' }) {
  const lib = library.value;
  useEffect(loadLocalMedia, [lib.status, lib.status === 'ready' ? lib.base : '']);
  const st = localMedia.value;
  const sid = `${id}:pc`;
  if (lib.status !== 'ready' || st.status === 'idle' || st.status === 'loading') return null;
  if (st.status === 'needs-server' || st.status === 'error') {
    return (
      <Shelf id={sid} title="On your PC">
        <EmptyState id={`${sid}:empty`} title={st.status === 'error' ? 'Your PC did not answer' : 'Your own films play from your PC'} wide>
          {st.status === 'error'
            ? st.reason
            : 'Films and series you keep in the library\'s media folder play when the TV reads the library from the PC: run "npm run library:serve" there and set its address in Settings › Sources.'}
        </EmptyState>
      </Shelf>
    );
  }
  const own = st.items.filter((it) => (category === 'movies' ? it.kind !== 'episode' : it.kind === 'episode'));
  if (!st.items.length || !own.length) {
    return (
      <Shelf id={sid} title="On your PC">
        <EmptyState id={`${sid}:empty`} title={category === 'movies' ? 'No films on your PC yet' : 'No series on your PC yet'} wide>
          {category === 'movies'
            ? 'Put films in the media\\movies folder of the library on the PC (e.g. "Heat (1995).mp4", with "Heat (1995).en.srt" for subtitles), then run "npm run library:rebuild".'
            : 'Put episodes in media\\series\\<Show>\\Season 1 (named like "Show S01E02.mkv"), then run "npm run library:rebuild".'}
        </EmptyState>
      </Shelf>
    );
  }
  const base = st.base;
  const resumable = own.filter((it) => resumePosition(`local:${it.id}`) > 30);
  const recent = recentOf(own);
  const fav = own.filter((it) => favourites.value.indexOf(`local:${it.id}`) >= 0);
  return (
    <>
      {resumable.length ? <Row id={`${sid}:resume`} title="Continue watching from your PC" items={resumable} base={base} /> : null}
      {recent.length ? <Row id={`${sid}:recent`} title="Recently watched on your PC" items={recent} base={base} /> : null}
      {fav.length ? <Row id={`${sid}:fav`} title="Favourites from your PC" items={fav} base={base} /> : null}
      {category === 'movies' ? <PcFilms sid={sid} items={own} base={base} /> : <PcSeries sid={sid} items={own} base={base} />}
    </>
  );
}

function PcFilms({ sid, items, base }: { sid: string; items: LocalItem[]; base: string }) {
  const az = (l: LocalItem[]) => l.slice().sort((a, b) => a.title.localeCompare(b.title));
  const films = az(items.filter((it) => it.kind === 'movie'));
  const other = az(items.filter((it) => it.kind === 'other'));
  return (
    <>
      {films.length ? (
        <Row
          id={`${sid}:films`}
          title="Films on your PC"
          count={files(films.length)}
          items={films}
          base={base}
          more={() => openPage(localListPage('Films on your PC', films, base))}
        />
      ) : null}
      {other.length ? (
        <Row
          id={`${sid}:other`}
          title="Other videos on your PC"
          count={files(other.length)}
          items={other}
          base={base}
          more={() => openPage(localListPage('Other videos on your PC', other, base))}
        />
      ) : null}
    </>
  );
}

function PcSeries({ sid, items, base }: { sid: string; items: LocalItem[]; base: string }) {
  const series = groupSeries(items);
  return (
    <Shelf id={`${sid}:series`} title="Series on your PC" count={`${series.length} series`}>
      {series.map((s) => {
        const tile: CatalogueChannel = {
          id: `localseries:${s.title}`,
          name: s.title,
          logo: s.poster ? `${base}media/${s.poster.id}/art` : undefined,
          streams: [],
          sources: ['your PC'],
        };
        return (
          <div key={s.title} class="vod-series">
            <ChannelTile channel={tile} focusId={`${sid}:series:${s.title}`} onSelect={() => openPage(localSeriesPage(s, base))} />
            <div class="vod-series-count">
              {s.seasons.length > 1 ? `${s.seasons.length} seasons · ` : ''}
              {s.count} episodes
            </div>
          </div>
        );
      })}
    </Shelf>
  );
}

const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

function details(it: LocalItem): string {
  const at = resumePosition(`local:${it.id}`);
  return [
    it.ext.toUpperCase(),
    size(it.size),
    it.subtitles.length ? `subtitles: ${it.subtitles.map((s) => s.label).join(', ')}` : '',
    at > 30 ? `resume at ${clock(at)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function LocalList({ title, items, base, seasonOf }: { title: string; items: LocalItem[]; base: string; seasonOf?: boolean }) {
  const channels = items.map((it) => localChannel(it, base));
  return (
    <div class="screen all-matches">
      <div class="all-matches-head">
        <div class="breadcrumb">
          On your PC › <b>{title}</b>
        </div>
        <div class="page-sub" style="margin-top:12px">
          {files(items.length)} · streamed from your PC by the library server
        </div>
      </div>
      <div class="all-matches-list">
        <VirtualList
          id={`pclist:${title}`}
          items={items}
          rowHeight={96}
          height={760}
          renderRow={(it) => (
            <div class="lrow">
              <span class="lrow-when">{seasonOf ? (it.season !== undefined ? `Season ${it.season}` : '') : it.year || ''}</span>
              <div class="lrow-text">
                <div class="lrow-name">{seasonOf && it.episode !== undefined ? [`Episode ${it.episode}`, episodeName(it)].filter(Boolean).join(' · ') : localLabel(it)}</div>
                <div class="lrow-sub">{details(it)}</div>
              </div>
            </div>
          )}
          onSelect={(_it, i) => watchFrom(channels[i]!, channels, title)}
        />
      </div>
    </div>
  );
}

export function localListPage(title: string, items: LocalItem[], base: string): PageEntry {
  return { key: `pclist:${title}`, title, render: () => <LocalList title={title} items={items} base={base} /> };
}

/** Seasons in order, episodes in order; playing an episode lets ▲▼ step through the series. */
export function localSeriesPage(s: LocalSeries, base: string): PageEntry {
  const episodes = s.seasons.reduce<LocalItem[]>((a, x) => a.concat(x.episodes), []);
  return { key: `pcseries:${s.title}`, title: s.title, render: () => <LocalList title={s.title} items={episodes} base={base} seasonOf /> };
}
