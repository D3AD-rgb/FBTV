/**
 * Other sports: one chip per sport (F1 & motorsport, rally, NBA, cricket, UFC & MMA, boxing,
 * wrestling, tennis, golf, rugby, NFL, MLB, NHL, …). Each shows upcoming events (schedule data
 * from TheSportsDB) and every channel tagged with that sport — playable first, unavailable
 * ones kept and marked. Tags come from channel names/groups/categories and can be corrected.
 */
import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { loadFootball, sportsData, channelsById, matchState, kickoffLabel, type Fixture } from '../data/football.ts';
import { includeUnreviewed, library, setIncludeUnreviewed, type LibChannel } from '../data/sourceLibrary.ts';
import { PageScroll, Shelf } from '../ui/Shelf.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { ChannelTile } from '../ui/ChannelTile.tsx';
import { watchFrom } from './Collection.tsx';

/** Which sports' events come from which competitions in the fixtures catalog. */
const SPORT_EVENTS: Record<string, string[]> = {
  motorsport: ['formula-1', 'motogp'],
  rally: ['wrc'],
  basketball: ['nba'],
  cricket: ['ipl'],
  combat: ['ufc'],
  'american-football': ['nfl'],
  baseball: ['mlb'],
  'ice-hockey': ['nhl'],
};

const selected = signal<string>('motorsport');

function EventCard({ f, id }: { f: Fixture; id: string }) {
  const title = f.event || (f.home && f.away ? `${f.home} v ${f.away}` : f.home || f.competition);
  return (
    <div class="event card" data-focusable data-focus-id={id} role="note">
      <div class="comp">
        <i style="background:#F5A524" />
        <span>{f.competition}</span>
      </div>
      <div class="event-title">{title}</div>
      <div class="mfoot">
        <span>{kickoffLabel(f)}</span>
        <span>{matchState(f) === 'finished' && f.score ? `${f.score.home} – ${f.score.away}` : ''}</span>
      </div>
    </div>
  );
}

export function Sports() {
  const [map, setMap] = useState<Map<string, LibChannel> | null>(null);
  const withSecondary = includeUnreviewed.value;
  const lib = library.value;
  useEffect(() => {
    if (lib.status !== 'ready') return;
    loadFootball();
    let alive = true;
    channelsById(withSecondary).then((m) => alive && setMap(m));
    return () => {
      alive = false;
    };
  }, [lib.status, withSecondary]);
  const data = sportsData.value;
  if (lib.status !== 'ready' || !data) {
    return (
      <div class="screen">
        <PageScroll>
          <section data-scroll-anchor="0">
            <div class="page-title">Sports</div>
          </section>
          <EmptyState id="sp:none" title={lib.status === 'loading' || !data ? 'Loading sports…' : 'No source library on this TV'} wide>
            {lib.status === 'missing' ? lib.reason : 'Sports channels and events come from the library on the PC.'}
          </EmptyState>
        </PageScroll>
      </div>
    );
  }
  const sports = data.sports.filter((s) => s.id !== 'football' && s.channels.length);
  const current = sports.filter((s) => s.id === selected.value)[0] || sports[0];
  const now = Date.now();
  const comps = current ? SPORT_EVENTS[current.id] || [] : [];
  const events = data.events
    .filter((e) => comps.indexOf(e.competitionId) >= 0 && (!e.kickoffUtc || Date.parse(e.kickoffUtc) > now - 6 * 3600000))
    .sort((a, b) => (a.kickoffUtc || '9').localeCompare(b.kickoffUtc || '9'));
  const channels = current && map ? (current.channels.map((c) => map.get(c.id)).filter(Boolean) as LibChannel[]).sort((a, b) => Number(b.playable) - Number(a.playable)) : [];
  const playable = channels.filter((c) => c.playable);
  return (
    <div class="screen">
      <PageScroll>
        <section data-scroll-anchor="0">
          <div class="page-title">Sports</div>
          <div class="sport-chips hstack" data-focus-group data-focus-enter=".is-selected">
            {sports.map((s) => (
              <button
                key={s.id}
                class={'chip selectable' + (current && s.id === current.id ? ' is-selected' : '')}
                data-focusable
                data-focus-id={`sp:chip:${s.id}`}
                onClick={() => (selected.value = s.id)}
              >
                {s.name} · {s.channels.length}
              </button>
            ))}
          </div>
        </section>
        {events.length ? (
          <Shelf id={`sp:${current!.id}:events`} title="Upcoming" count={`${events.length} · schedule only`}>
            {events.slice(0, 30).map((e) => (
              <EventCard key={e.id} f={e} id={`sp:ev:${e.id}`} />
            ))}
          </Shelf>
        ) : null}
        {current ? (
          <Shelf id={`sp:${current.id}:channels`} title={`${current.name} channels`} count={`${playable.length} playable of ${current.channels.length}`}>
            {channels.slice(0, 80).map((c) => (
              <ChannelTile key={c.id} channel={c} focusId={`sp:ch:${c.id}`} offline={!c.playable} onSelect={() => c.playable && watchFrom(c, playable, current.name)} />
            ))}
          </Shelf>
        ) : null}
        <Shelf id="sp:more" title="More">
          <button class="country-card card more" data-focusable data-focus-id="sp:secondary" onClick={() => setIncludeUnreviewed(!withSecondary)}>
            <span class="cname">{withSecondary ? 'Hide unreviewed lists' : 'Include unreviewed lists'}</span>
            <span class="ccount">Tvlist, fanmingming, HerbertHe</span>
          </button>
        </Shelf>
      </PageScroll>
    </div>
  );
}
