/**
 * Global search over the imported catalogue: channels, countries, languages, categories and
 * collections, grouped by type. Debounced; works with the webOS on-screen keyboard and
 * physical keyboards. Football teams/competitions join when fixtures exist (v0.6).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { CatalogueChannel } from '../../shared/model.ts';
import type { SearchHit } from '../../shared/search.ts';
import {
  genreGroups,
  kidsChannels,
  newsGroups,
  sportsGroups,
  ukGroups,
  byName,
  type Group,
} from '../../shared/collections.ts';
import { Icon } from '../ui/Icon.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { PageScroll, Shelf } from '../ui/Shelf.tsx';
import { catalogue, ready, type LoadedCatalogue } from '../data/catalogue.ts';
import { prefs } from '../data/library.ts';
import { searchIndexFor } from '../data/searchIndex.ts';
import { openPage } from '../nav/router.ts';
import { ChannelShelf, collectionPage } from './Collection.tsx';
import { countryPage, uhdPage } from './Countries.tsx';

const EXAMPLES = ['BBC One', 'UK channels', 'Bangladesh', 'English news', 'Arabic sports', 'Cricket', '4K'];
const DEBOUNCE_MS = 250;

/** Remembered while the app runs, so Back from a result returns to the same search. */
const lastQuery = signal('');

function openCollection(id: string, data: LoadedCatalogue) {
  const langs = prefs.value.languages;
  const all = () => ready()!.channels;
  const pages: Record<string, () => void> = {
    uk: () => openPage(collectionPage('uk', 'UK TV', () => ukGroups(all()))),
    news: () => openPage(collectionPage('news', 'News', () => newsGroups(all(), langs))),
    sports: () => openPage(collectionPage('sports', 'Sports', () => sportsGroups(all()))),
    'sports:arabic': () =>
      openPage(collectionPage('sports-arabic', 'Arabic sports', () => sportsGroups(all()).filter((g) => g.id === 'sports:arabic'))),
    'sports:football': () =>
      openPage(collectionPage('sports-football', 'Football channels', () => sportsGroups(all()).filter((g) => g.id === 'sports:football'))),
    kids: () => openPage(collectionPage('kids', 'Kids', () => [{ id: 'kids:all', title: "Children's channels", channels: kidsChannels(all()) }])),
    uhd: () => openPage(uhdPage()),
    movies: () => openPage(collectionPage('movies', 'Movie channels', () => genreGroups(all(), 'movies', langs))),
    series: () => openPage(collectionPage('series', 'Series channels', () => genreGroups(all(), 'series', langs))),
  };
  const fn = pages[id];
  if (fn) fn();
  void data;
}

function languagePage(code: string, data: LoadedCatalogue) {
  const name = data.languageName[code] || code;
  openPage(
    collectionPage(`lang:${code}`, `${name}-language channels`, () => {
      const d = ready()!;
      const list = d.channels.filter((c) => (c.languages || []).indexOf(code) >= 0).sort(byName);
      const byCountry = new Map<string, CatalogueChannel[]>();
      for (const c of list) {
        const k = c.country || '?';
        const arr = byCountry.get(k);
        if (arr) arr.push(c);
        else byCountry.set(k, [c]);
      }
      const groups: Group[] = [];
      byCountry.forEach((chs, k) => {
        const co = d.countryById.get(k);
        groups.push({ id: `lang:${code}:${k}`, title: co ? co.name : 'Other', channels: chs });
      });
      return groups.sort((a, b) => b.channels.length - a.channels.length);
    }),
  );
}

function categoryPage(id: string, data: LoadedCatalogue) {
  const name = data.categoryName[id] || id;
  openPage(
    collectionPage(`cat:${id}`, name, () => {
      const d = ready()!;
      const list = d.channels.filter((c) => (c.categories || []).indexOf(id) >= 0);
      const home = prefs.value.homeCountry;
      return [
        { id: `cat:${id}:home`, title: 'In your country', channels: list.filter((c) => c.country === home).sort(byName) },
        { id: `cat:${id}:all`, title: 'Everywhere', channels: list.sort(byName) },
      ].filter((g) => g.channels.length);
    }),
  );
}

function ResultCards(props: { title: string; hits: SearchHit[]; onSelect: (h: SearchHit) => void; id: string }) {
  return (
    <Shelf id={props.id} title={props.title} count={`${props.hits.length}`}>
      {props.hits.map((h) => (
        <button
          key={h.doc.id}
          class="country-card card"
          data-focusable
          data-focus-id={`${props.id}:${h.doc.id}`}
          onClick={() => props.onSelect(h)}
        >
          <span class="cname">{h.doc.title}</span>
          {h.doc.kind === 'country' ? <span class="ccount">{h.doc.id}</span> : null}
        </button>
      ))}
    </Shelf>
  );
}

export function Search() {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(lastQuery.value);
  const [debounced, setDebounced] = useState(lastQuery.value);
  const data = ready();

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query);
      lastQuery.value = query;
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const groups = data && debounced.trim() ? searchIndexFor(data).grouped(debounced, 40) : [];
  const channelHits = groups.filter((g) => g.kind === 'channel')[0];
  const channels = channelHits && data ? (channelHits.hits.map((h) => data.byId.get(h.doc.id)).filter(Boolean) as CatalogueChannel[]) : [];
  const other = groups.filter((g) => g.kind !== 'channel');
  const titles: Record<string, string> = {
    collection: 'Collections',
    country: 'Countries',
    language: 'Languages',
    category: 'Categories',
    competition: 'Competitions',
    team: 'Teams',
    match: 'Matches',
  };

  return (
    <div class="screen">
      <PageScroll align="nearest">
        <section data-scroll-anchor="0">
          <div class="page-title">Search</div>
          <div
            class="search-field hstack"
            data-focusable
            data-focus-default
            data-focus-id="search:field"
            onClick={() => input.current && input.current.focus()}
          >
            <Icon name="search" size={34} />
            <input
              ref={input}
              type="text"
              value={query}
              placeholder="Channels, countries, languages, categories…"
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              aria-label="Search"
            />
          </div>
          <div class="search-examples hstack" data-focus-group data-focus-memory>
            {EXAMPLES.map((q) => (
              <button key={q} class="chip selectable" data-focusable data-focus-id={`search:ex:${q}`} onClick={() => setQuery(q)}>
                {q}
              </button>
            ))}
          </div>
        </section>
        {!data ? (
          <div style="margin-top:40px">
            <EmptyState id="search:nodata" title={catalogue.value.status === 'loading' ? 'Loading the catalogue…' : 'No catalogue loaded'} wide>
              Search works over the channel catalogue once it is loaded on this TV.
            </EmptyState>
          </div>
        ) : debounced.trim() && !groups.length ? (
          <div style="margin-top:40px">
            <EmptyState id="search:none" title={`No results for “${debounced}”`} wide>
              Try a channel name, a country (or its code, like UK or BD), a language, or a category such as news or
              sports. Football teams and competitions become searchable once fixtures are configured.
            </EmptyState>
          </div>
        ) : null}
        {channels.length ? <ChannelShelf id="search:channels" title="Channels" channels={channels} /> : null}
        {data
          ? other.map((g) => (
              <ResultCards
                key={g.kind}
                id={`search:${g.kind}`}
                title={titles[g.kind] || g.kind}
                hits={g.hits}
                onSelect={(h) => {
                  if (h.doc.kind === 'country') openPage(countryPage(h.doc.id));
                  else if (h.doc.kind === 'collection') openCollection(h.doc.id, data);
                  else if (h.doc.kind === 'language') languagePage(h.doc.id, data);
                  else if (h.doc.kind === 'category') categoryPage(h.doc.id, data);
                }}
              />
            ))
          : null}
      </PageScroll>
    </div>
  );
}

