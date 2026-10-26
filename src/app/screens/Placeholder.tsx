import { genreGroups, kidsChannels } from '../../shared/collections.ts';
import { PageScroll, Shelf } from '../ui/Shelf.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { ready } from '../data/catalogue.ts';
import { prefs } from '../data/library.ts';
import { ChannelShelf } from './Collection.tsx';

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
        <VodEmpty id={props.id} what={props.category === 'movies' ? 'film' : 'series'} />
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
