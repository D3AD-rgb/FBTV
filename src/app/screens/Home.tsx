import { PageScroll, Shelf } from '../ui/Shelf.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Icon } from '../ui/Icon.tsx';
import { setTab, openPage } from '../nav/router.ts';
import { diagnosticsPage } from './Settings.tsx';

export function Home() {
  return (
    <div class="screen">
      <div
        class="backdrop"
        style="background: radial-gradient(1200px 620px at 78% 20%, #17435a 0%, rgba(14,16,19,0) 70%), radial-gradient(800px 500px at 100% 0%, #1e2b52 0%, rgba(14,16,19,0) 70%);"
      />
      <PageScroll>
        <section class="hero" data-scroll-anchor="0">
          <div class="hero-eyebrow hstack">
            <span class="chip">Version {__APP_VERSION__}</span>
          </div>
          <div class="hero-title">Welcome to FBTV</div>
          <div class="hero-meta">
            Live TV, football, news and sports from public sources, in one place. The channel catalogue is
            loaded from your configured sources; until then the sections below explain what each one needs.
          </div>
          <div class="hero-actions hstack" data-focus-group>
            <button class="btn" data-focusable data-focus-default data-focus-id="home:live" onClick={() => setTab('live')}>
              <Icon name="tv" />
              <span>Browse Live TV</span>
            </button>
            <button
              class="btn"
              data-focusable
              data-focus-id="home:diagnostics"
              onClick={() => openPage(diagnosticsPage())}
            >
              <Icon name="info" />
              <span>Check this TV</span>
            </button>
          </div>
        </section>

        <Shelf id="favourites" title="Favourite channels">
          <EmptyState id="home:fav-empty" title="No favourites yet">
            Press the red button on any channel to keep it here.
          </EmptyState>
        </Shelf>

        <Shelf id="recent" title="Recently watched">
          <EmptyState id="home:recent-empty" title="Nothing watched yet">
            Channels you play appear here so you can get back to them quickly.
          </EmptyState>
        </Shelf>

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
