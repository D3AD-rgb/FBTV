/**
 * Generic collection page: a title, an optional note, and one shelf per group. Used for UK
 * TV, News, Sports, Kids, 4K, Movies, Series and each country. Selecting a tile plays it
 * full screen with that shelf as the channel-switching context.
 */
import type { CatalogueChannel } from '../../shared/model.ts';
import type { Group } from '../../shared/collections.ts';
import { ready } from '../data/catalogue.ts';
import { channelNumbers } from '../data/lists.ts';
import { nowPlaying, playChannel, playContext } from '../data/playback.ts';
import { openPage, type PageEntry } from '../nav/router.ts';
import { PageScroll, Shelf } from '../ui/Shelf.tsx';
import { ChannelTile } from '../ui/ChannelTile.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { watchPage } from './Watch.tsx';

/** Shelves render at most this many tiles; the rest are reachable via the Live TV list. */
const SHELF_LIMIT = 40;

export function watchFrom(c: CatalogueChannel, list: CatalogueChannel[], label: string): void {
  playContext.value = { ids: list.map((x) => x.id), label };
  playChannel(c);
  openPage(watchPage());
}

export function ChannelShelf(props: { id: string; title: string; note?: string; channels: CatalogueChannel[] }) {
  const data = ready();
  const numbers = data ? channelNumbers(data).numberOf : new Map<string, number>();
  const playing = nowPlaying.value ? nowPlaying.value.channel.id : null;
  const shown = props.channels.slice(0, SHELF_LIMIT);
  const count =
    props.channels.length > SHELF_LIMIT
      ? `${SHELF_LIMIT} of ${props.channels.length.toLocaleString()}`
      : `${props.channels.length}`;
  return (
    <Shelf id={props.id} title={props.title} count={props.note ? `${count} · ${props.note}` : count}>
      {shown.map((c) => (
        <ChannelTile
          key={c.id}
          channel={c}
          focusId={`${props.id}:${c.id}`}
          number={numbers.get(c.id)}
          playing={c.id === playing}
          onSelect={() => watchFrom(c, props.channels, props.title)}
        />
      ))}
    </Shelf>
  );
}

function Collection(props: { id: string; title: string; intro?: string; groups: () => Group[]; emptyText: string }) {
  const data = ready();
  const groups = data ? props.groups() : [];
  return (
    <div class="screen">
      <PageScroll>
        <section data-scroll-anchor="0">
          <div class="page-title">{props.title}</div>
          {props.intro ? <div class="page-sub">{props.intro}</div> : null}
        </section>
        {groups.length ? (
          groups.map((g) => <ChannelShelf key={g.id} id={g.id} title={g.title} note={g.note} channels={g.channels} />)
        ) : (
          <EmptyState id={`${props.id}:empty`} title="Nothing here yet" wide>
            {props.emptyText}
          </EmptyState>
        )}
      </PageScroll>
    </div>
  );
}

export function collectionPage(
  id: string,
  title: string,
  groups: () => Group[],
  opts: { intro?: string; emptyText?: string } = {},
): PageEntry {
  return {
    key: `collection:${id}`,
    title,
    render: () => (
      <Collection
        id={id}
        title={title}
        intro={opts.intro}
        groups={groups}
        emptyText={opts.emptyText || 'The catalogue has no channels for this collection.'}
      />
    ),
  };
}
