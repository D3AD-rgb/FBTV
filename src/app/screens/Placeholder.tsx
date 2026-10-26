import type { ComponentChildren } from 'preact';
import { PageScroll, Shelf } from '../ui/Shelf.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';

interface Section {
  id: string;
  title: string;
  emptyTitle: string;
  body: ComponentChildren;
  wide?: boolean;
}

/** A screen whose sections exist but have no data source configured yet. */
export function SectionScreen(props: { id: string; title: string; intro: string; sections: Section[] }) {
  return (
    <div class="screen">
      <PageScroll>
        <section data-scroll-anchor="0">
          <div class="page-title">{props.title}</div>
          <div class="page-sub">{props.intro}</div>
        </section>
        {props.sections.map((s) => (
          <Shelf key={s.id} id={`${props.id}:${s.id}`} title={s.title}>
            <EmptyState id={`${props.id}:${s.id}:empty`} title={s.emptyTitle} wide={s.wide}>
              {s.body}
            </EmptyState>
          </Shelf>
        ))}
      </PageScroll>
    </div>
  );
}

export function Movies() {
  return (
    <SectionScreen
      id="movies"
      title="Movies"
      intro="24/7 movie channels from public playlists, and on-demand films when you connect a library you're entitled to."
      sections={[
        {
          id: 'channels',
          title: 'Movie channels',
          emptyTitle: 'Catalogue not loaded yet',
          body: 'Free 24/7 movie channels (live, not on demand) appear here, grouped by their published category.',
        },
        {
          id: 'vod',
          title: 'On demand',
          emptyTitle: 'No on-demand library connected',
          body: 'Connect your own Jellyfin or Plex server, an Xtream account you subscribe to, or an authorised VOD playlist in Settings › Sources.',
          wide: true,
        },
      ]}
    />
  );
}

export function Series() {
  return (
    <SectionScreen
      id="series"
      title="Series"
      intro="24/7 series channels from public playlists, and seasons and episodes from a library you connect."
      sections={[
        {
          id: 'channels',
          title: 'Series channels',
          emptyTitle: 'Catalogue not loaded yet',
          body: 'Free 24/7 series channels (live, not on demand) appear here.',
        },
        {
          id: 'vod',
          title: 'On demand',
          emptyTitle: 'No series library connected',
          body: 'Seasons, episodes, resume and next-episode need an on-demand source. Add one in Settings › Sources.',
          wide: true,
        },
      ]}
    />
  );
}

export function Kids() {
  return (
    <SectionScreen
      id="kids"
      title="Kids"
      intro="Children's channels chosen from published category data and your own allowlist, never from title words alone."
      sections={[
        {
          id: 'channels',
          title: "Children's channels",
          emptyTitle: 'Catalogue not loaded yet',
          body: 'Channels tagged kids or animation in the source metadata appear here, plus any you approve.',
        },
        {
          id: 'mode',
          title: 'Kids Mode',
          emptyTitle: 'Kids Mode is off',
          body: 'Kids Mode limits browsing and search to this area, with a PIN to leave. It is an interface lock, not full parental control.',
          wide: true,
        },
      ]}
    />
  );
}
