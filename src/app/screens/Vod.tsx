/**
 * On-demand films and series from the library (Layer B: Bengali, English, Hindi), arranged by
 * language and then genre. Sources are legal: the Internet Archive's credible public-domain
 * items and providers you configure yourself. Selecting a series opens its episodes.
 */
import { useEffect, useState } from 'preact/hooks';
import type { CatalogueChannel } from '../../shared/model.ts';
import { library, loadCatalog } from '../data/sourceLibrary.ts';
import { openPage, type PageEntry } from '../nav/router.ts';
import { Shelf } from '../ui/Shelf.tsx';
import { ChannelTile } from '../ui/ChannelTile.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { VirtualList } from '../ui/VirtualList.tsx';
import { watchFrom } from './Collection.tsx';

export interface VodTitle {
  uid: string;
  title: string;
  url?: string | null;
  status: string;
  languages: string[];
  poster?: string;
  genre?: string;
  year?: number;
  durationSeconds?: number;
}

export interface VodSeries {
  title: string;
  seriesId: string;
  languages: string[];
  poster?: string;
  genre?: string;
  year?: number;
  seasons?: { season: number; episodes: { episode: number; title: string; url?: string | null; durationSeconds?: number; status?: string }[] }[];
}

/** The order the viewer asked for. */
export const VOD_LANGUAGES: [string, string][] = [
  ['ben', 'Bengali'],
  ['eng', 'English'],
  ['hin', 'Hindi'],
];
const SHELF = 40;

const playable = (t: VodTitle) => !!t.url && t.status === 'imported';
const minutes = (s?: number) => (s ? `${Math.round(s / 60)} min` : '');

function asChannel(t: VodTitle): CatalogueChannel {
  return {
    id: `vod:${t.uid}`,
    name: t.year ? `${t.title} (${t.year})` : t.title,
    logo: t.poster,
    languages: t.languages,
    categories: t.genre ? [t.genre] : undefined,
    streams: [{ id: `vod:${t.uid}#0`, url: t.url!, source: 'library' }],
    sources: ['library'],
    playback: { resumeKey: `vod:${t.uid}` },
  };
}

function useCatalog<T>(file: string): T[] | null {
  const lib = library.value;
  const [items, setItems] = useState<T[] | null>(null);
  useEffect(() => {
    if (lib.status !== 'ready') return;
    let alive = true;
    loadCatalog<{ items: T[] }>(file).then((d) => alive && setItems(d && d.items ? d.items : []));
    return () => {
      alive = false;
    };
  }, [lib.status, file]);
  return items;
}

function byGenre<T extends { genre?: string }>(list: T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const g = x.genre || 'Other';
    const a = m.get(g);
    if (a) a.push(x);
    else m.set(g, [x]);
  }
  return Array.from(m.entries()).sort((a, b) => b[1].length - a[1].length);
}

/** Films by language, then genre; each shelf links to the full list. */
export function MovieShelves({ id }: { id: string }) {
  const items = useCatalog<VodTitle>('movies.json');
  if (!items) return null;
  const seen = new Set<string>();
  // The same file can come from two searches (e.g. an English and a Hindi set): keep it once.
  const films = items.filter((t) => playable(t) && !seen.has(t.url!) && !seen.has(t.uid) && !!seen.add(t.url!).add(t.uid));
  return (
    <>
      {VOD_LANGUAGES.map(([code, name]) => {
        const own = films.filter((t) => t.languages.indexOf(code) >= 0);
        if (!own.length) return null;
        const groups = own.length > SHELF ? byGenre(own) : [[`${name} films`, own] as [string, VodTitle[]]];
        return groups.map(([genre, list]) => {
          const title = own.length > SHELF ? `${name} films · ${genre}` : genre;
          const channels = list.map(asChannel);
          return (
            <Shelf key={`${code}:${genre}`} id={`${id}:vod:${code}:${genre}`} title={title} count={`${list.length.toLocaleString()} on demand`}>
              {channels.slice(0, SHELF).map((c) => (
                <ChannelTile key={c.id} channel={c} focusId={`${id}:vod:${c.id}`} onSelect={() => watchFrom(c, channels, title)} />
              ))}
              {list.length > SHELF ? (
                <button class="country-card card more" data-focusable data-focus-id={`${id}:vod:${code}:${genre}:all`} onClick={() => openPage(titleListPage(title, list))}>
                  <span class="cname">See all</span>
                  <span class="ccount">{list.length.toLocaleString()} titles</span>
                </button>
              ) : null}
            </Shelf>
          );
        });
      })}
    </>
  );
}

/** Series by language, then genre; a series opens its episodes. */
export function SeriesShelves({ id }: { id: string }) {
  const items = useCatalog<VodSeries>('series.json');
  if (!items) return null;
  const series = items.filter((s) => s.seasons && s.seasons.some((x) => x.episodes.some((e) => !!e.url)));
  return (
    <>
      {VOD_LANGUAGES.map(([code, name]) => {
        const own = series.filter((s) => s.languages.indexOf(code) >= 0);
        if (!own.length) return null;
        return byGenre(own).map(([genre, list]) => (
          <Shelf key={`${code}:${genre}`} id={`${id}:series:${code}:${genre}`} title={`${name} series · ${genre}`} count={`${list.length.toLocaleString()} series`}>
            {list.slice(0, SHELF).map((s) => {
              const eps = s.seasons!.reduce((n, x) => n + x.episodes.length, 0);
              const tile: CatalogueChannel = { id: `series:${s.seriesId}`, name: s.title, logo: s.poster, streams: [], sources: ['library'] };
              return (
                <div key={s.seriesId} class="vod-series">
                  <ChannelTile channel={tile} focusId={`${id}:series:${s.seriesId}`} onSelect={() => openPage(seriesPage(s))} />
                  <div class="vod-series-count">{eps} episodes</div>
                </div>
              );
            })}
          </Shelf>
        ));
      })}
    </>
  );
}

function TitleList({ title, list }: { title: string; list: VodTitle[] }) {
  const sorted = list.slice().sort((a, b) => a.title.localeCompare(b.title));
  const channels = sorted.map(asChannel);
  return (
    <div class="screen all-matches">
      <div class="all-matches-head">
        <div class="breadcrumb">
          On demand › <b>{title}</b>
        </div>
        <div class="page-sub" style="margin-top:12px">
          {list.length.toLocaleString()} titles · public-domain items from the Internet Archive and your own providers
        </div>
      </div>
      <div class="all-matches-list">
        <VirtualList
          id={`vodlist:${title}`}
          items={sorted}
          rowHeight={96}
          height={760}
          renderRow={(t) => (
            <div class="lrow">
              <span class="lrow-when">{t.year || ''}</span>
              <div class="lrow-text">
                <div class="lrow-name">{t.title}</div>
                <div class="lrow-sub">{[t.genre, minutes(t.durationSeconds)].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
          )}
          onSelect={(t, i) => watchFrom(channels[i]!, channels, title)}
        />
      </div>
    </div>
  );
}

export function titleListPage(title: string, list: VodTitle[]): PageEntry {
  return { key: `vodlist:${title}`, title, render: () => <TitleList title={title} list={list} /> };
}

function SeriesView({ s }: { s: VodSeries }) {
  const episodes = (s.seasons || []).flatMap((x) => x.episodes.map((e) => ({ ...e, season: x.season }))).filter((e) => !!e.url);
  const channels: CatalogueChannel[] = episodes.map((e) => ({
    id: `ep:${s.seriesId}:${e.season}:${e.episode}`,
    name: `${s.title} — ${e.title}`,
    logo: s.poster,
    languages: s.languages,
    streams: [{ id: `ep:${s.seriesId}:${e.season}:${e.episode}#0`, url: e.url!, source: 'library' }],
    sources: ['library'],
    playback: { resumeKey: `ep:${s.seriesId}:${e.season}:${e.episode}` },
  }));
  return (
    <div class="screen all-matches">
      <div class="all-matches-head">
        <div class="breadcrumb">
          Series › <b>{s.title}</b>
        </div>
        <div class="page-sub" style="margin-top:12px">
          {episodes.length} episodes{s.genre ? ` · ${s.genre}` : ''}
        </div>
      </div>
      <div class="all-matches-list">
        <VirtualList
          id={`series:${s.seriesId}`}
          items={episodes}
          rowHeight={96}
          height={760}
          renderRow={(e, i) => (
            <div class="lrow">
              <span class="lrow-when">{`Episode ${i + 1}`}</span>
              <div class="lrow-text">
                <div class="lrow-name">{e.title}</div>
                <div class="lrow-sub">{minutes(e.durationSeconds)}</div>
              </div>
            </div>
          )}
          onSelect={(_e, i) => watchFrom(channels[i]!, channels, s.title)}
          empty={
            <EmptyState id={`series:${s.seriesId}:empty`} title="No playable episodes">
              This series has no episode the TV can play.
            </EmptyState>
          }
        />
      </div>
    </div>
  );
}

export function seriesPage(s: VodSeries): PageEntry {
  return { key: `series:${s.seriesId}`, title: s.title, render: () => <SeriesView s={s} /> };
}
