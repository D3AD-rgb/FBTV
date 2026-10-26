/**
 * Live Football hub. Fixtures (openfootball + TheSportsDB) ordered by competition tier and
 * big clubs; football channels by role. A match never implies a stream: TV listings are
 * third-party, and channel matches by name are labelled unverified.
 */
import { useEffect, useState } from 'preact/hooks';
import type { CatalogueChannel } from '../../shared/model.ts';
import {
  allMatches,
  isAhead,
  channelsById,
  clubViews,
  football,
  teamsByCompetition,
  footballStatus,
  footballViews,
  kickoffLabel,
  loadFootball,
  matchState,
  timeKey,
  type Competition,
  type Fixture,
  whereToWatch,
  type FootballData,
} from '../data/football.ts';
import { SERVICES, detectApps, installedApps, launchApp, shortName } from '../platform/apps.ts';
import { followedClubs, isFollowedClub, prefs, toggleClub } from '../data/library.ts';
import { sameTeam } from '../../shared/teams.ts';
import { VirtualList } from '../ui/VirtualList.tsx';
import { showToast } from '../ui/toast.tsx';
import { includeUnreviewed, library, type LibChannel } from '../data/sourceLibrary.ts';
import { openPage, type PageEntry } from '../nav/router.ts';
import { PageScroll, Shelf } from '../ui/Shelf.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { MatchCard, StateChip } from '../ui/MatchCard.tsx';
import { RightsSection } from '../ui/Rights.tsx';
import { ChannelTile } from '../ui/ChannelTile.tsx';
import { watchFrom } from './Collection.tsx';

function useFootball() {
  useEffect(() => {
    if (library.value.status === 'ready') loadFootball();
  }, [library.value.status]);
  return football.value;
}

function useChannels(includeSecondary: boolean) {
  const [map, setMap] = useState<Map<string, LibChannel> | null>(null);
  useEffect(() => {
    if (library.value.status !== 'ready') return;
    let alive = true;
    channelsById(includeSecondary).then((m) => alive && setMap(m));
    return () => {
      alive = false;
    };
  }, [library.value.status, includeSecondary]);
  return map;
}

function MatchShelf(props: { id: string; title: string; note?: string; fixtures: Fixture[] }) {
  if (!props.fixtures.length) return null;
  return (
    <Shelf id={props.id} title={props.title} count={props.note ? `${props.fixtures.length} · ${props.note}` : `${props.fixtures.length}`}>
      {props.fixtures.map((f) => (
        <MatchCard key={f.id} f={f} focusId={`${props.id}:${f.id}`} onSelect={() => openPage(matchPage(f))} />
      ))}
    </Shelf>
  );
}

function FootballChannels({ map }: { map: Map<string, LibChannel> }) {
  const data = football.value;
  if (!data) return null;
  const groups: [string, string][] = [
    ['dedicated', 'Football & league channels'],
    ['club', 'Club TV'],
    ['broadcaster-brand', 'Broadcasters with football rights (rights vary)'],
    ['tagged-by-name', 'Other football-tagged channels'],
  ];
  return (
    <>
      {groups.map(([role, title]) => {
        const list = data.channels
          .filter((c) => c.role === role)
          .map((c) => map.get(c.id))
          .filter(Boolean) as LibChannel[];
        list.sort((a, b) => Number(b.playable) - Number(a.playable));
        if (!list.length) return null;
        const playable = list.filter((c) => c.playable);
        return (
          <Shelf key={role} id={`fb:ch:${role}`} title={title} count={`${playable.length} playable of ${list.length}`}>
            {list.slice(0, 60).map((c) => (
              <ChannelTile
                key={c.id}
                channel={c}
                focusId={`fb:ch:${role}:${c.id}`}
                offline={!c.playable}
                onSelect={() => c.playable && watchFrom(c, playable, title)}
              />
            ))}
          </Shelf>
        );
      })}
    </>
  );
}

/** Followed clubs first: every match across all competitions, plus the club's own TV channel. */
function MyClubs({ data, map }: { data: FootballData; map: Map<string, LibChannel> | null }) {
  const views = clubViews(data, followedClubs.value);
  const clubTv = (club: string) =>
    map
      ? (data.channels
          .filter((c) => c.role === 'club')
          .map((c) => map.get(c.id))
          .filter((c) => !!c && sameTeam(club, c.name)) as LibChannel[])
      : [];
  return (
    <>
      {views.map((v) => {
        const cards = v.upcoming.slice(0, 12).concat(v.results.slice(0, 8));
        const tv = clubTv(v.club);
        return (
          <Shelf key={v.club} id={`fb:club:${v.club}`} title={`★ ${v.club}`} count={`${v.upcoming.length} upcoming · ${v.results.length} results`}>
            <ClubServices club={v.club} matches={v.upcoming} />
            {cards.map((f) => (
              <MatchCard key={f.id} f={f} focusId={`fb:club:${v.club}:${f.id}`} onSelect={() => openPage(matchPage(f))} />
            ))}
            {tv.map((c) => (
              <ChannelTile key={c.id} channel={c} focusId={`fb:club:${v.club}:ch:${c.id}`} offline={!c.playable} onSelect={() => c.playable && watchFrom(c, tv.filter((x) => x.playable), v.club)} />
            ))}
            {!cards.length && !tv.length ? (
              <div class="country-card card" data-focusable data-focus-id={`fb:club:${v.club}:none`}>
                <span class="cname">No matches found</span>
                <span class="ccount">Not in any competition in the library</span>
              </div>
            ) : null}
          </Shelf>
        );
      })}
      <Shelf id="fb:myclubs" title="My clubs">
        <button class="country-card card" data-focusable data-focus-id="fb:myclubs:manage" onClick={() => openPage(clubsPage())}>
          <span class="ccode">★</span>
          <span class="cname">Follow clubs</span>
          <span class="ccount">{followedClubs.value.length ? followedClubs.value.join(', ') : 'None followed'}</span>
        </button>
        <button class="country-card card" data-focusable data-focus-id="fb:myclubs:all" onClick={() => openPage(allMatchesPage())}>
          <span class="ccode">ALL</span>
          <span class="cname">All matches</span>
          <span class="ccount">{data.fixtures.filter((f) => f.sport === 'football').length.toLocaleString()} fixtures, by date</span>
        </button>
      </Shelf>
    </>
  );
}

export function Football() {
  const data = useFootball();
  const map = useChannels(includeUnreviewed.value);
  const lib = library.value;
  if (lib.status !== 'ready') {
    return (
      <div class="screen">
        <PageScroll>
          <section data-scroll-anchor="0">
            <div class="page-title">Live Football</div>
          </section>
          <EmptyState id="fb:nolib" title={lib.status === 'loading' ? 'Loading the source library…' : 'No source library on this TV'} wide>
            {lib.status === 'missing' ? lib.reason : 'One moment.'}
          </EmptyState>
        </PageScroll>
      </div>
    );
  }
  if (!data) {
    return (
      <div class="screen">
        <PageScroll>
          <section data-scroll-anchor="0">
            <div class="page-title">Live Football</div>
          </section>
          <EmptyState id="fb:loading" title={footballStatus.value === 'missing' ? 'No football data in the library' : 'Loading fixtures…'} wide>
            Fixtures come from the library on the PC (openfootball and TheSportsDB). Run "npm run library:refresh" there.
          </EmptyState>
        </PageScroll>
      </div>
    );
  }
  const v = footballViews(data);
  return (
    <div class="screen">
      <PageScroll>
        <section data-scroll-anchor="0">
          <div class="page-title">Live Football</div>
          <div class="page-sub">
            Major competitions and bigger clubs first. Schedules from openfootball and TheSportsDB; “started” means the
            kick-off time has passed — live status and scores need a football-data.org key. No match implies a stream.
          </div>
        </section>
        <MyClubs data={data} map={map} />
        <MatchShelf id="fb:started" title="Started" note="live status not verified" fixtures={v.started} />
        <MatchShelf id="fb:today" title="Today" fixtures={v.today} />
        <MatchShelf id="fb:top" title="Top matches this week" fixtures={v.topWeek} />
        {v.byCompetition.map((c) => (
          <MatchShelf key={c.competition.id} id={`fb:comp:${c.competition.id}`} title={c.competition.name} note="upcoming" fixtures={c.upcoming} />
        ))}
        <MatchShelf id="fb:results" title="Latest results" fixtures={v.results} />
        <Shelf id="fb:competitions" title="All competitions">
          {v.byCompetition.map((c) => (
            <button key={c.competition.id} class="country-card card" data-focusable data-focus-id={`fb:compcard:${c.competition.id}`} onClick={() => openPage(competitionPage(c.competition))}>
              <span class="ccode">{c.competition.country || 'Europe'}</span>
              <span class="cname">{c.competition.name}</span>
              <span class="ccount">{c.competition.fixtures} fixtures</span>
            </button>
          ))}
        </Shelf>
        {map ? <FootballChannels map={map} /> : null}
      </PageScroll>
    </div>
  );
}

/** Where to watch this match in the viewer's country, with buttons that open the official apps. */
function WatchOn({ f }: { f: Fixture }) {
  const data = football.value;
  useEffect(() => {
    detectApps();
  }, []);
  if (!data) return null;
  const home = prefs.value.homeCountry || 'UK';
  const w = whereToWatch(f, data, home);
  const apps = installedApps.value;
  return (
    <div class="panel card" data-focus-group style="margin-top:24px">
      <h3>Where to watch in {home === 'UK' ? 'the UK' : home}</h3>
      {w.blackout ? (
        <p class="muted-text">Saturday 3pm kick-off: not shown live on UK TV (the blackout). Highlights on BBC Match of the Day.</p>
      ) : w.services.length ? (
        <p class="muted-text">
          {w.exact
            ? `Listed for this match: ${w.channels.join(', ')}.`
            : `Not confirmed yet. ${f.competition} in ${home === 'UK' ? 'the UK' : home} is shown on ${w.channels.join(', ')}; the channel for this match is announced closer to the date.`}
        </p>
      ) : (
        <p class="muted-text">No broadcaster found for {home === 'UK' ? 'the UK' : home} in the library.</p>
      )}
      {!w.blackout && w.services.length ? (
        <div class="hstack" style="--stack-gap:16px;margin-top:16px">
          {w.services.map((label) => {
            const svc = SERVICES.filter((s) => s.label === label)[0]!;
            const id = apps ? apps[label] : undefined;
            return (
              <button
                key={label}
                class={'btn' + (id ? '' : ' muted')}
                data-focusable
                data-focus-id={`watchon:${label}`}
                onClick={() => {
                  if (id) launchApp(id).then((ok) => !ok && showToast(`Could not open ${svc.label}`));
                  else showToast(apps ? `${svc.label} is not installed on this TV. Install it from the LG Content Store.` : 'Checking installed apps…');
                }}
              >
                {id ? `Watch on ${svc.label}` : `${svc.label} (not installed)`}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Next 30 days of a club's matches by UK service, to see which subscriptions or passes are needed. */
function ClubServices({ club, matches }: { club: string; matches: Fixture[] }) {
  const data = football.value;
  if (!data) return null;
  const home = prefs.value.homeCountry || 'UK';
  const soon = matches.filter((f) => f.kickoffUtc && Date.parse(f.kickoffUtc) < Date.now() + 30 * 86400000);
  const count = new Map<string, number>();
  let tbc = 0;
  let blackout = 0;
  for (const f of soon) {
    const w = whereToWatch(f, data, home);
    if (w.blackout) blackout++;
    else if (!w.exact && w.services.length > 1) tbc++;
    else for (const s of w.services) count.set(shortName(s), (count.get(shortName(s)) || 0) + 1);
  }
  const parts = Array.from(count.entries()).map(([s, n]) => `${s} ×${n}`);
  if (tbc) parts.push(`${tbc} not yet assigned`);
  if (blackout) parts.push(`${blackout} not on UK TV`);
  return (
    <div class="country-card card wide-card" data-focusable data-focus-id={`fb:club:${club}:services`}>
      <span class="ccode">NEXT 30 DAYS · {home}</span>
      <span class="cname">{soon.length} matches</span>
      <span class="ccount">{parts.join(' · ') || 'No broadcaster data'}</span>
    </div>
  );
}

function MatchDetail({ f }: { f: Fixture }) {
  const data = football.value;
  const map = useChannels(true);
  const assoc = data ? data.associations.filter((a) => a.fixture === f.id)[0] : undefined;
  const byCountry = new Map<string, string[]>();
  for (const b of f.broadcasts) {
    const k = b.country || 'Other';
    const a = byCountry.get(k);
    if (a) a.push(b.channel);
    else byCountry.set(k, [b.channel]);
  }
  const countries = Array.from(byCountry.keys()).sort((a, b) => (a === 'United Kingdom' ? -1 : b === 'United Kingdom' ? 1 : a.localeCompare(b)));
  const matched = assoc && map
    ? (assoc.nameMatches.flatMap((m) => m.channels.map((c) => map.get(c.id))).filter(Boolean) as LibChannel[]).filter((c, i, arr) => arr.indexOf(c) === i)
    : [];
  return (
    <div class="screen">
      <PageScroll align="nearest">
        <section data-scroll-anchor="0">
          <div class="breadcrumb">
            Live Football › {f.competition} › <b>{f.home} v {f.away}</b>
          </div>
          <div class="match-hero hstack">
            <div class="match-hero-team">{f.home}</div>
            <div class="match-hero-score">{f.score ? `${f.score.home} – ${f.score.away}` : 'v'}</div>
            <div class="match-hero-team">{f.away}</div>
          </div>
          <div class="hstack" style="--stack-gap:12px;margin-top:16px">
            <span class="chip">{kickoffLabel(f)}</span>
            {f.round ? <span class="chip">{f.round}</span> : null}
            <StateChip f={f} />
            {f.bigClubs.length === 2 ? <span class="chip verified">★ Big match</span> : null}
          </div>
          <div class="hstack" style="--stack-gap:16px;margin-top:20px" data-focus-group>
            {[f.home, f.away]
              .filter((t) => t && t !== 'To be decided')
              .map((t) => (
                <button
                  key={t}
                  class={'chip selectable' + (isFollowedClub(t) ? ' is-selected' : '')}
                  data-focusable
                  data-focus-id={`match:follow:${t}`}
                  onClick={() => showToast(toggleClub(t) ? `Following ${t}` : `Unfollowed ${t}`)}
                >
                  {isFollowedClub(t) ? `★ Following ${t}` : `Follow ${t}`}
                </button>
              ))}
          </div>
        </section>
        <div class="panel card" data-focusable data-focus-default data-focus-id="match:listings" style="margin-top:28px">
          <h3>TV listings</h3>
          {countries.length ? (
            <table class="kv">
              <tbody>
                {countries.map((c) => (
                  <tr key={c}>
                    <td>{c}</td>
                    <td>{byCountry.get(c)!.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p class="muted-text">No TV listings in the library for this match. Listings are fetched for the highest-priority upcoming matches.</p>
          )}
          <p class="muted-text">Listings are third-party (TheSportsDB) and may be incomplete or change.</p>
        </div>
        <WatchOn f={f} />
        <RightsSection
          id={`match:${f.id}`}
          title={`Who shows ${f.competition}, by country`}
          rights={data ? (data.competitions.filter((c) => c.id === f.competitionId)[0] || {}).rights : undefined}
          map={map}
          label={`${f.home} v ${f.away}`}
        />
        {matched.length ? (
          <Shelf id="match:matched" title="Channels in your library with a listed name" count="name match — not verified to show this match">
            {matched.map((c) => (
              <ChannelTile key={c.id} channel={c} focusId={`match:ch:${c.id}`} offline={!c.playable} onSelect={() => c.playable && watchFrom(c, matched.filter((x) => x.playable) as CatalogueChannel[], `${f.home} v ${f.away}`)} />
            ))}
          </Shelf>
        ) : null}
      </PageScroll>
    </div>
  );
}

export function matchPage(f: Fixture): PageEntry {
  return { key: `match:${f.id}`, title: `${f.home} v ${f.away}`, render: () => <MatchDetail f={f} /> };
}

function CompetitionView({ c }: { c: Competition }) {
  const data = football.value;
  const map = useChannels(true);
  if (!data) return null;
  const now = Date.now();
  const own = data.fixtures.filter((f) => f.competitionId === c.id);
  const upcoming = own.filter((f) => matchState(f, now) !== 'finished').sort((a, b) => timeKey(a).localeCompare(timeKey(b)));
  const results = own.filter((f) => matchState(f, now) === 'finished').sort((a, b) => timeKey(b).localeCompare(timeKey(a)));
  const byRound = new Map<string, Fixture[]>();
  for (const f of upcoming.slice(0, 200)) {
    const k = f.round || kickoffLabel(f).split(' · ')[0]!;
    const a = byRound.get(k);
    if (a) a.push(f);
    else byRound.set(k, [f]);
  }
  return (
    <div class="screen">
      <PageScroll>
        <section data-scroll-anchor="0">
          <div class="breadcrumb">
            Live Football › <b>{c.name}</b>
          </div>
          <div class="page-sub" style="margin-top:12px">
            {own.length} fixtures · sources: {c.providers.join(', ') || '—'}
            {c.error ? ` · ${c.error}` : ''}
            {c.note ? ` · ${c.note}` : ''}
          </div>
        </section>
        {Array.from(byRound.entries())
          .slice(0, 12)
          .map(([round, list]) => (
            <MatchShelf key={round} id={`comp:${c.id}:${round}`} title={round} fixtures={list} />
          ))}
        <MatchShelf id={`comp:${c.id}:results`} title="Results" fixtures={results.slice(0, 60)} />
        <RightsSection id={`comp:${c.id}`} title={`Who shows ${c.name}, by country`} rights={c.rights} map={map} label={c.name} />
        {!own.length ? (
          <EmptyState id={`comp:${c.id}:empty`} title="No fixtures" wide>
            {c.error || 'This competition has no fixtures in the library yet.'}
          </EmptyState>
        ) : null}
      </PageScroll>
    </div>
  );
}

export function competitionPage(c: Competition): PageEntry {
  return { key: `competition:${c.id}`, title: c.name, render: () => <CompetitionView c={c} /> };
}

function ClubsView() {
  const data = football.value;
  const groups = data ? teamsByCompetition(data) : [];
  const [comp, setComp] = useState(0);
  const g = groups[Math.min(comp, Math.max(0, groups.length - 1))];
  return (
    <div class="screen">
      <PageScroll>
        <section data-scroll-anchor="0">
          <div class="breadcrumb">
            Live Football › <b>Follow clubs</b>
          </div>
          <div class="page-sub" style="margin-top:12px">
            Followed clubs get their own section at the top of Live Football with every match in every competition.
            Following: {followedClubs.value.join(', ') || 'none'}.
          </div>
          <div class="sport-chips hstack" data-focus-group data-focus-enter=".is-selected" style="margin-top:18px">
            {groups.map((x, i) => (
              <button
                key={x.competition.id}
                class={'chip selectable' + (g && x.competition.id === g.competition.id ? ' is-selected' : '')}
                data-focusable
                data-focus-id={`clubs:comp:${x.competition.id}`}
                onClick={() => setComp(i)}
              >
                {x.competition.name}
              </button>
            ))}
          </div>
        </section>
        {g ? (
          <div class="country-grid" data-focus-group data-focus-memory>
            {g.teams.map((t) => {
              const on = isFollowedClub(t);
              return (
                <button
                  key={t}
                  class={'country-card card' + (on ? ' is-selected' : '')}
                  data-focusable
                  data-focus-id={`clubs:${g.competition.id}:${t}`}
                  onClick={() => showToast(toggleClub(t) ? `Following ${t}` : `Unfollowed ${t}`)}
                >
                  <span class="ccode">{on ? '★ FOLLOWING' : 'FOLLOW'}</span>
                  <span class="cname">{t}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState id="clubs:none" title="No fixtures in the library" wide>
            Clubs come from the fixtures in the library on the PC.
          </EmptyState>
        )}
      </PageScroll>
    </div>
  );
}

export function clubsPage(): PageEntry {
  return { key: 'clubs', title: 'Follow clubs', render: () => <ClubsView /> };
}

/** Every football match in the library by date, starting at the next one; Up goes back to results. */
function AllMatchesView() {
  const data = football.value;
  const [mine, setMine] = useState(false);
  if (!data) return null;
  const all = allMatches(data);
  const list = mine ? all.list.filter((f) => isFollowedClub(f.home) || isFollowedClub(f.away)) : all.list;
  const now = Date.now();
  const first = Math.max(
    0,
    list.findIndex((f) => isAhead(f, now)),
  );
  return (
    <div class="screen all-matches">
      <div class="all-matches-head">
        <div class="breadcrumb">
          Live Football › <b>All matches</b>
        </div>
        <div class="hstack" style="--stack-gap:12px;margin-top:16px" data-focus-group data-focus-enter=".is-selected">
          <button class={'chip selectable' + (!mine ? ' is-selected' : '')} data-focusable data-focus-id="all:every" onClick={() => setMine(false)}>
            Every competition · {all.list.length.toLocaleString()}
          </button>
          <button class={'chip selectable' + (mine ? ' is-selected' : '')} data-focusable data-focus-id="all:mine" onClick={() => setMine(true)}>
            ★ My clubs
          </button>
        </div>
      </div>
      <div class="all-matches-list">
        <VirtualList
          id={`all:${mine ? 'mine' : 'every'}`}
          items={list}
          rowHeight={96}
          height={760}
          index={first}
          renderRow={(f) => (
            <div class="lrow">
              <span class="lrow-when">{kickoffLabel(f)}</span>
              <div class="lrow-text">
                <div class="lrow-name">
                  {isFollowedClub(f.home) || isFollowedClub(f.away) ? <span class="lrow-fav">★ </span> : null}
                  {f.home} {f.score ? `${f.score.home} – ${f.score.away}` : 'v'} {f.away}
                </div>
                <div class="lrow-sub">
                  {f.competition}
                  {f.round ? ` · ${f.round}` : ''}
                  {f.broadcasts.length ? ` · ${f.broadcasts.length} TV listing${f.broadcasts.length > 1 ? 's' : ''}` : ''}
                </div>
              </div>
            </div>
          )}
          onSelect={(f) => openPage(matchPage(f))}
          empty={
            <EmptyState id="all:empty" title="No matches">
              {mine ? 'Follow clubs to see their matches here.' : 'The library has no fixtures yet.'}
            </EmptyState>
          }
        />
      </div>
    </div>
  );
}

export function allMatchesPage(): PageEntry {
  return { key: 'all-matches', title: 'All matches', render: () => <AllMatchesView /> };
}
