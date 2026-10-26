import { useEffect, useState } from 'preact/hooks';
import { genreGroups, kidsChannels } from '../../shared/collections.ts';
import type { CatalogueChannel } from '../../shared/model.ts';
import { PageScroll, Shelf } from '../ui/Shelf.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { ready } from '../data/catalogue.ts';
import { prefs } from '../data/library.ts';
import { ChannelShelf, watchFrom } from './Collection.tsx';
import { library, loadCatalog, type LibItem } from '../data/sourceLibrary.ts';
import { showToast } from '../ui/toast.tsx';

function VodEmpty({ id, what }: { id: string; what: string }) {
  return (
    <Shelf id={`${id}:vod`} title="On demand">
      <EmptyState id={`${id}:vod:empty`} title={`No ${what} library connected`} wide>
        On-demand titles, seasons, episodes and resume need a source you are entitled to: your own Jellyfin or Plex
        server, an Xtream account you subscribe to, or an authorised VOD playlist. None of the public sources FBTV
        uses provide on-demand content.
      </EmptyState>
    </Shelf>
  );
}

/** An on-demand title from the library's Layer B catalog (movies.json / series.json). */
interface VodTitle {
  uid: string;
  title: string;
  url?: string;
  status: string;
  languages: string[];
  poster?: string;
  group?: string;
}

const VOD_STATUS: Record<string, string> = {
  imported: 'available',
  'needs-setup': 'not set up',
  'needs-credentials': 'needs credentials',
  empty: 'empty',
  error: 'error',
};

/**
 * On-demand sources from the library registry (Rule 10: Movies / Series VOD dropdowns). Each source
 * shows its status; titles appear only when a source supplies them in English, Hindi or Bengali.
 */
function VodSources(props: { id: string; category: 'movies' | 'series' }) {
  const lib = library.value;
  const [titles, setTitles] = useState<VodTitle[] | null>(null);
  const group = props.category === 'movies' ? 'Movies VOD' : 'Series VOD';
  useEffect(() => {
    if (lib.status !== 'ready') return;
    let alive = true;
    loadCatalog<{ items: VodTitle[] }>(`${props.category}.json`).then((d) => alive && setTitles(d && d.items ? d.items : []));
    return () => {
      alive = false;
    };
  }, [lib.status]);
  if (lib.status !== 'ready') return <VodEmpty id={props.id} what={props.category === 'movies' ? 'film' : 'series'} />;
  const sources = lib.registry.items.filter((i) => i.group === group);
  const playable = (titles || []).filter((t) => t.url && t.status === 'imported');
  const asChannels: CatalogueChannel[] = playable.map((t) => ({ id: `vod:${t.uid}`, name: t.title, logo: t.poster, languages: t.languages, streams: [{ id: `vod:${t.uid}#0`, url: t.url!, source: 'library' }], sources: ['library'] }));
  const explain = (i: LibItem) => showToast(i.error || i.note || `${i.name}: ${VOD_STATUS[i.status] || i.status}`);
  return (
    <>
      {asChannels.length ? (
        <Shelf id={`${props.id}:vod:titles`} title="On demand" count={`${asChannels.length}`}>
          {asChannels.slice(0, 80).map((c) => (
            <button key={c.id} class="country-card card" data-focusable data-focus-id={`${props.id}:vod:${c.id}`} onClick={() => watchFrom(c, asChannels, 'On demand')}>
              <span class="cname">{c.name}</span>
              <span class="ccount">{(c.languages || []).join(', ')}</span>
            </button>
          ))}
        </Shelf>
      ) : null}
      <Shelf id={`${props.id}:vod:sources`} title="On-demand sources" count="from the library on the PC">
        {sources.map((i) => (
          <button key={i.id} class="country-card card" data-focusable data-focus-id={`${props.id}:vodsrc:${i.id}`} onClick={() => explain(i)}>
            <span class="ccode">{i.languages.join(', ') || 'review'}</span>
            <span class="cname">{i.name}</span>
            <span class="ccount">{i.channels ? `${i.channels.toLocaleString()} · ${VOD_STATUS[i.status] || i.status}` : VOD_STATUS[i.status] || i.status}</span>
          </button>
        ))}
      </Shelf>
      {asChannels.length ? null : <VodEmpty id={props.id} what={props.category === 'movies' ? 'film' : 'series'} />}
    </>
  );
}

function ChannelsByGenre(props: { id: string; category: 'movies' | 'series'; title: string; intro: string }) {
  const data = ready();
  const groups = data ? genreGroups(data.channels, props.category, prefs.value.languages) : [];
  return (
    <div class="screen">
      <PageScroll>
        <section data-scroll-anchor="0">
          <div class="page-title">{props.title}</div>
          <div class="page-sub">{props.intro}</div>
        </section>
        {groups.length ? (
          groups.map((g) => <ChannelShelf key={g.id} id={g.id} title={g.title} note="live channels" channels={g.channels} />)
        ) : (
          <Shelf id={`${props.id}:channels`} title={`${props.title} channels`}>
            <EmptyState id={`${props.id}:channels:empty`} title="No channels in the catalogue">
              Free 24/7 {props.category} channels appear here when the catalogue includes them.
            </EmptyState>
          </Shelf>
        )}
        <VodSources id={props.id} category={props.category} />
      </PageScroll>
    </div>
  );
}

export function Movies() {
  return (
    <ChannelsByGenre
      id="movies"
      category="movies"
      title="Movies"
      intro="Free 24/7 movie channels from public playlists. These are live channels, not on-demand films."
    />
  );
}

export function Series() {
  return (
    <ChannelsByGenre
      id="series"
      category="series"
      title="Series"
      intro="Free 24/7 series channels from public playlists. These are live channels, not on-demand episodes."
    />
  );
}

export function Kids() {
  const data = ready();
  const kids = data ? kidsChannels(data.channels) : [];
  return (
    <div class="screen">
      <PageScroll>
        <section data-scroll-anchor="0">
          <div class="page-title">Kids</div>
          <div class="page-sub">
            Channels tagged kids or animation in the source data, plus channels you approve. Titles alone never put a
            channel here. Check channels yourself before leaving children alone with them.
          </div>
        </section>
        {kids.length ? (
          <ChannelShelf id="kids:channels" title="Children's channels" note="from category data" channels={kids} />
        ) : (
          <Shelf id="kids:channels" title="Children's channels">
            <EmptyState id="kids:channels:empty" title="No children's channels in the catalogue">
              Channels tagged kids or animation appear here.
            </EmptyState>
          </Shelf>
        )}
        <Shelf id="kids:mode" title="Kids Mode">
          <EmptyState id="kids:mode:empty" title="Kids Mode arrives in v0.9" wide>
            Kids Mode will limit browsing and search to this area, with a PIN to leave. It is an interface lock, not
            full parental control.
          </EmptyState>
        </Shelf>
      </PageScroll>
    </div>
  );
}
