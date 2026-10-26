import { useState } from 'preact/hooks';
import { COMPETITION_COLOUR, kickoffLabel, matchState, type Fixture } from '../data/football.ts';

function Crest({ name, badge }: { name: string; badge?: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .replace(/\b(FC|AFC|CF|SC|AC)\b/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase();
  return (
    <div class="crest">
      {badge && !failed ? <img src={`${badge}/tiny`} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span>{initials}</span>}
    </div>
  );
}

export function StateChip({ f }: { f: Fixture }) {
  const s = matchState(f);
  if (s === 'finished') {
    const sc = f.score;
    const label = sc && sc.penalties ? `Pens ${sc.penalties.home}–${sc.penalties.away}` : sc && sc.afterExtraTime ? 'After extra time' : 'Full time';
    return <span class="chip muted">{f.note === 'awarded' ? `${label} · awarded` : label}</span>;
  }
  if (s === 'started') return <span class="chip started">Started · live status not verified</span>;
  if (s === 'awaiting-result') return <span class="chip muted">Result not published yet</span>;
  if (s === 'postponed') return <span class="chip muted">{f.status === 'abandoned' ? 'Abandoned' : f.status === 'cancelled' ? 'Cancelled' : 'Postponed'}</span>;
  if (s === 'tbc') return <span class="chip advertised">{f.kickoffLocal ? 'Time TBC' : 'Date TBC'}</span>;
  return null;
}

/** 520×262 match card (design token --card-match). Data is schedule-only: no stream implied. */
export function MatchCard(props: { f: Fixture; focusId: string; onSelect: () => void }) {
  const f = props.f;
  const s = matchState(f);
  const colour = COMPETITION_COLOUR[f.competitionId] || '#64748B';
  const marquee = f.bigClubs.length === 2;
  return (
    <div class="match card" data-focusable data-focus-id={props.focusId} onClick={props.onSelect} role="button" aria-label={`${f.home} v ${f.away}`}>
      <div class="comp">
        <i style={`background:${colour}`} />
        <span>{f.competition}</span>
        {marquee ? <span class="marquee">★ Big match</span> : null}
      </div>
      <div class="teams">
        <div class="team">
          <Crest name={f.home} badge={f.homeBadge} />
          <span>{f.home}</span>
        </div>
        <div class="score">
          {f.score ? (
            `${f.score.home} – ${f.score.away}`
          ) : (
            <span class="vs">v</span>
          )}
        </div>
        <div class="team">
          <Crest name={f.away} badge={f.awayBadge} />
          <span>{f.away}</span>
        </div>
      </div>
      <div class="mfoot">
        <span>{s === 'finished' ? kickoffLabel(f).split(' · ')[0] : kickoffLabel(f)}</span>
        <span>{f.broadcasts.length ? `${f.broadcasts.length} TV listing${f.broadcasts.length > 1 ? 's' : ''}` : f.round || ''}</span>
      </div>
      <div class="mstate">
        <StateChip f={f} />
      </div>
    </div>
  );
}
