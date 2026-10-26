/**
 * Live Football hub. Fixtures (openfootball + TheSportsDB) ordered by competition tier and
 * big clubs; football channels by role. A match never implies a stream: TV listings are
 * third-party, and channel matches by name are labelled unverified.
 */
import { useEffect, useState } from 'preact/hooks';
import type { CatalogueChannel } from '../../shared/model.ts';
import {
  channelsById,
  football,
  footballStatus,
  footballViews,
  kickoffLabel,
  loadFootball,
  matchState,
  timeKey,
  type Competition,
  type Fixture,
} from '../data/football.ts';
import { includeUnreviewed, library, type LibChannel } from '../data/sourceLibrary.ts';
import { openPage, type PageEntry } from '../nav/router.ts';
import { PageScroll, Shelf } from '../ui/Shelf.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { MatchCard, StateChip } from '../ui/MatchCard.tsx';
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
