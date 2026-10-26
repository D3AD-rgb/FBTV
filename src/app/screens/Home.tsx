import type { CatalogueChannel } from '../../shared/model.ts';
import { countryCounts, kidsChannels, newsGroups, sportsGroups, ukGroups, uhdGroups } from '../../shared/collections.ts';
import { PageScroll, Shelf } from '../ui/Shelf.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Logo, QualityChip } from '../ui/ChannelTile.tsx';
import { setTab, openPage } from '../nav/router.ts';
import { catalogue, ready } from '../data/catalogue.ts';
import { channelsFor } from '../data/lists.ts';
import { prefs, recents } from '../data/library.ts';
import { diagnosticsPage } from './Settings.tsx';
import { ChannelShelf, collectionPage, watchFrom } from './Collection.tsx';
import { countriesPage, countryPage, uhdPage } from './Countries.tsx';
import { channelSubline } from './LiveTV.tsx';

function flat(groups: { channels: CatalogueChannel[] }[]): CatalogueChannel[] {
  const seen = new Set<string>();
  const out: CatalogueChannel[] = [];
  for (const g of groups) for (const c of g.channels) if (!seen.has(c.id)) (seen.add(c.id), out.push(c));
  return out;
}

function Hero({ channel }: { channel: CatalogueChannel | null }) {
  if (!channel) {
    return (
      <section class="hero" data-scroll-anchor="0">
        <div class="hero-eyebrow hstack">
          <span class="chip">Version {__APP_VERSION__}</span>
        </div>
        <div class="hero-title">Welcome to FBTV</div>
        <div class="hero-meta">
          Live TV, news, sports and channels from around the world, from public sources. Pick a channel in Live TV
          to start; your favourites and recent channels will appear here.
        </div>
        <div class="hero-actions hstack" data-focus-group>
          <button class="btn" data-focusable data-focus-default data-focus-id="home:live" onClick={() => setTab('live')}>
            <Icon name="tv" />
            <span>Browse Live TV</span>
          </button>
          <button class="btn" data-focusable data-focus-id="home:diagnostics" onClick={() => openPage(diagnosticsPage())}>
            <Icon name="info" />
            <span>Check this TV</span>
          </button>
        </div>
      </section>
    );
  }
  return (
    <section class="hero" data-scroll-anchor="0">
      <div class="hero-eyebrow hstack">
        <span class="chip">Continue watching</span>
        <QualityChip channel={channel} />
      </div>
      <div class="hero-row hstack">
        <Logo channel={channel} size="hero" />
        <div>
          <div class="hero-title">{channel.name}</div>
          <div class="hero-meta">{channelSubline(channel)}</div>
        </div>
      </div>
      <div class="hero-actions hstack" data-focus-group>
        <button
          class="btn"
          data-focusable
          data-focus-default
          data-focus-id="home:resume"
          onClick={() => {
            const data = ready();
            if (data) watchFrom(channel, channelsFor('recent', data), 'Recently watched');
          }}
        >
          <Icon name="play" />
          <span>Watch</span>
        </button>
        <button class="btn" data-focusable data-focus-id="home:live" onClick={() => setTab('live')}>
          <Icon name="tv" />
          <span>Live TV</span>
        </button>
      </div>
    </section>
  );
}

export function Home() {
  const state = catalogue.value;
  const data = ready();
  const last = data && recents.value[0] ? data.byId.get(recents.value[0].id) || null : null;
  const langs = prefs.value.languages;
  return (
    <div class="screen">
      <div
        class="backdrop"
        style="background: radial-gradient(1200px 620px at 78% 20%, #17435a 0%, rgba(14,16,19,0) 70%), radial-gradient(800px 500px at 100% 0%, #1e2b52 0%, rgba(14,16,19,0) 70%);"
      />
      <PageScroll>
        <Hero channel={last} />
        {state.status === 'loading' ? (
          <Shelf id="loading" title="Loading channels">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} class="tile skeleton" />
            ))}
          </Shelf>
        ) : null}
        {state.status === 'empty' ? (
          <Shelf id="nodata" title="Channels">
            <EmptyState id="home:nodata" title="No channel catalogue on this TV" wide>
              {state.reason}
            </EmptyState>
          </Shelf>
        ) : null}
        {data ? <HomeShelves langs={langs} /> : null}
        <Shelf id="football" title="Live football">
          <EmptyState id="home:football-empty" title="No football data configured" wide>
            Fixtures, scores and live status come from a football data provider (football-data.org), not from
            playlists. Matches appear here once the catalogue builder publishes fixtures.
          </EmptyState>
        </Shelf>
      </PageScroll>
    </div>
  );
}

function HomeShelves({ langs }: { langs: string[] }) {
  const data = ready()!;
  const fav = channelsFor('fav', data);
  const recent = channelsFor('recent', data);
  const uk = flat(ukGroups(data.channels));
  const news = flat(newsGroups(data.channels, langs));
  const sports = flat(sportsGroups(data.channels));
  const kids = kidsChannels(data.channels);
  const uhd = flat(uhdGroups(data.channels));
  const countries = countryCounts(data.channels).slice(0, 14);
  const ch = data.channels;
  return (
    <>
      {fav.length ? (
        <ChannelShelf id="home:fav" title="Favourite channels" channels={fav} />
      ) : (
        <Shelf id="favourites" title="Favourite channels">
          <EmptyState id="home:fav-empty" title="No favourites yet">
            Press the red button on any channel to keep it here.
          </EmptyState>
        </Shelf>
      )}
      {recent.length ? <ChannelShelf id="home:recent" title="Recently watched" channels={recent} /> : null}
      {uk.length ? <ChannelShelf id="home:uk" title="UK TV" channels={uk} /> : null}
      {news.length ? <ChannelShelf id="home:news" title="News" note="in your languages" channels={news} /> : null}
      {sports.length ? <ChannelShelf id="home:sports" title="Sports channels" channels={sports} /> : null}
      <Shelf id="home:countries" title="Countries" count={`${countryCounts(ch).length}`}>
        {countries.map((c) => {
          const info = data.countryById.get(c.code);
          return (
            <button
              key={c.code}
              class="country-card card"
              data-focusable
              data-focus-id={`home:country:${c.code}`}
              onClick={() => openPage(countryPage(c.code))}
            >
              <span class="ccode">{c.code}</span>
              <span class="cname">{info ? info.name : c.code}</span>
              <span class="ccount">{c.count.toLocaleString()} channels</span>
            </button>
          );
        })}
        <button class="country-card card more" data-focusable data-focus-id="home:countries:all" onClick={() => openPage(countriesPage())}>
          <span class="cname">All countries ›</span>
        </button>
      </Shelf>
      {kids.length ? (
        <ChannelShelf id="home:kids" title="Kids" note="from category data" channels={kids} />
      ) : null}
      {uhd.length ? <ChannelShelf id="home:uhd" title="4K" note="verified first, then advertised" channels={uhd} /> : null}
      <Shelf id="home:more" title="Browse">
        <button class="country-card card more" data-focusable data-focus-id="home:more:uk" onClick={() => openPage(collectionPage('uk', 'UK TV', () => ukGroups(ready()!.channels)))}>
          <span class="cname">UK TV ›</span>
        </button>
        <button class="country-card card more" data-focusable data-focus-id="home:more:news" onClick={() => openPage(collectionPage('news', 'News', () => newsGroups(ready()!.channels, langs)))}>
          <span class="cname">News ›</span>
        </button>
        <button class="country-card card more" data-focusable data-focus-id="home:more:sports" onClick={() => openPage(collectionPage('sports', 'Sports', () => sportsGroups(ready()!.channels)))}>
          <span class="cname">Sports ›</span>
        </button>
        <button class="country-card card more" data-focusable data-focus-id="home:more:4k" onClick={() => openPage(uhdPage())}>
          <span class="cname">4K ›</span>
        </button>
      </Shelf>
    </>
  );
}
