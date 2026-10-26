import { genreGroups, kidsChannels } from '../../shared/collections.ts';
import { PageScroll, Shelf } from '../ui/Shelf.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { ready } from '../data/catalogue.ts';
import { prefs } from '../data/library.ts';
import { ChannelShelf } from './Collection.tsx';
import { MovieShelves, SeriesShelves } from './Vod.tsx';
import { LocalShelves } from './LocalMedia.tsx';
import { library, type LibItem } from '../data/sourceLibrary.ts';
import { showToast } from '../ui/toast.tsx';

function VodEmpty({ id, what }: { id: string; what: string }) {
  return (
    <Shelf id={`${id}:vod`} title="On demand">
      <EmptyState id={`${id}:vod:empty`} title={`No ${what} on demand yet`} wide>
        On-demand titles come from the library on the PC: public-domain films and classic TV from the Internet
        Archive, and any Xtream or VOD playlist you are entitled to. Run "npm run library:refresh" there.
      </EmptyState>
    </Shelf>
  );
}

const VOD_STATUS: Record<string, string> = {
  imported: 'available',
  'needs-setup': 'not set up',
  'needs-credentials': 'needs credentials',
  empty: 'empty',
  error: 'error',
};

/**
 * On demand (Rule 10: Movies / Series VOD sources): titles by language (Bengali, English, Hindi)
 * and genre, then the registry's VOD sources with their status.
 */
function VodSection(props: { id: string; category: 'movies' | 'series' }) {
  const lib = library.value;
  if (lib.status !== 'ready') return <VodEmpty id={props.id} what={props.category === 'movies' ? 'films' : 'series'} />;
  const group = props.category === 'movies' ? 'Movies VOD' : 'Series VOD';
  const sources = lib.registry.items.filter((i) => i.group === group);
  const available = sources.filter((i) => i.contentType !== 'vod-review').reduce((n, i) => n + i.channels, 0);
  const explain = (i: LibItem) => showToast(i.error || i.note || `${i.name}: ${VOD_STATUS[i.status] || i.status}`);
  return (
    <>
      <LocalShelves id={props.id} category={props.category} />
      {props.category === 'movies' ? <MovieShelves id={props.id} /> : <SeriesShelves id={props.id} />}
      {available ? null : <VodEmpty id={props.id} what={props.category === 'movies' ? 'films' : 'series'} />}
      <Shelf id={`${props.id}:vod:sources`} title="On-demand sources" count="from the library on the PC">
        {sources.map((i) => (
          <button key={i.id} class="country-card card" data-focusable data-focus-id={`${props.id}:vodsrc:${i.id}`} onClick={() => explain(i)}>
            <span class="ccode">{i.languages.join(', ') || 'review'}</span>
            <span class="cname">{i.name}</span>
            <span class="ccount">{i.channels ? `${i.channels.toLocaleString()} · ${VOD_STATUS[i.status] || i.status}` : VOD_STATUS[i.status] || i.status}</span>
          </button>
        ))}
      </Shelf>
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
        <VodSection id={props.id} category={props.category} />
        {groups.length ? (
          groups.map((g) => <ChannelShelf key={g.id} id={g.id} title={g.title} note="24/7 live channels" channels={g.channels} />)
        ) : (
          <Shelf id={`${props.id}:channels`} title={`${props.title} channels`}>
            <EmptyState id={`${props.id}:channels:empty`} title="No channels in the catalogue">
              Free 24/7 {props.category} channels appear here when the catalogue includes them.
            </EmptyState>
          </Shelf>
        )}
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
      intro="On-demand films in Bengali, English and Hindi (public-domain titles and your own providers), then free 24/7 movie channels."
    />
  );
}

export function Series() {
  return (
    <ChannelsByGenre
      id="series"
      category="series"
      title="Series"
      intro="On-demand series in Bengali, English and Hindi (public-domain classic TV and your own providers), then free 24/7 series channels."
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
