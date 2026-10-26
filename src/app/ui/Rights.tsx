/**
 * Who shows a competition, worldwide: every rights holder by country (home country first), with
 * free-to-air channels marked and a Play shelf for channels whose own public stream is in the
 * library. Rights data never says which channel carries a particular match.
 */
import type { CatalogueChannel } from '../../shared/model.ts';
import type { LibChannel } from '../data/sourceLibrary.ts';
import { highlightsOnly, playableFromRights, sortRights, type CompetitionRights, type RightsChannel, type RightsEntry } from '../data/football.ts';
import { prefs } from '../data/library.ts';
import { Shelf } from './Shelf.tsx';
import { ChannelTile } from './ChannelTile.tsx';
import { watchFrom } from '../screens/Collection.tsx';

const ROWS_PER_PANEL = 12;

const typeLabel = (c: RightsChannel) => (c.type === 'free-to-air' ? 'free' : c.type === 'free-stream' ? 'free stream' : c.type === 'streaming' ? 'streaming' : 'pay TV');

export function RightsSection(props: { id: string; title: string; rights?: CompetitionRights; map: Map<string, LibChannel> | null; extra?: LibChannel[]; label: string }) {
  const home = prefs.value.homeCountry || 'UK';
  const r = props.rights;
  const play = playableFromRights(r, props.map, home);
  for (const c of props.extra || []) if (c.playable && play.indexOf(c) < 0) play.push(c);
  if (!r) {
    return play.length ? <PlayShelf id={props.id} channels={play} label={props.label} /> : null;
  }
  const rows = sortRights(r.broadcasters, home);
  const free = rows.reduce((n, b) => n + b.channels.filter((c) => c.freeToAir).length, 0);
  const panels: RightsEntry[][] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PANEL) panels.push(rows.slice(i, i + ROWS_PER_PANEL));
  return (
    <>
      <PlayShelf id={props.id} channels={play} label={props.label} />
      {panels.map((chunk, pi) => (
        <div key={pi} class="panel card rights" data-focusable data-focus-id={`${props.id}:rights:${pi}`} style="margin-top:24px">
          {pi === 0 ? (
            <>
              <h3>{props.title}</h3>
              <p class="muted-text">
                {rows.length} countries and regions · {free} free-to-air · season {r.season}, checked {r.retrieved}. These
                broadcasters hold the rights; which of them shows a given match varies.
                {r.notes ? ` ${r.notes}` : ''}
              </p>
            </>
          ) : null}
          <table class="kv">
            <tbody>
              {chunk.map((b) => (
                <tr key={`${b.code}:${b.country}`}>
                  <td>{b.country}</td>
                  <td>
                    {b.channels.map((c, i) => (
                      <span key={c.name}>
                        {i ? ', ' : ''}
                        {c.name}
                        <span class={'rights-tag' + (c.freeToAir ? ' free' : '')}>
                          {' '}
                          {typeLabel(c)}
                          {c.freeToAir && highlightsOnly(c, b) ? ' · highlights' : ''}
                        </span>
                        {c.library && c.library.some((l) => l.playable) ? <span class="rights-tag play"> ▶ in library</span> : null}
                      </span>
                    ))}
                    {b.note ? <div class="rights-note">{b.note}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function PlayShelf({ id, channels, label }: { id: string; channels: LibChannel[]; label: string }) {
  if (!channels.length) {
    return (
      <div class="panel card" data-focusable data-focus-id={`${id}:play:none`} style="margin-top:24px">
        <h3>Watch now</h3>
        <p class="muted-text">
          None of the rights holders below has a public stream in your library. Paid broadcasters need their own app
          and subscription; FBTV does not offer unofficial relays of paid channels.
        </p>
      </div>
    );
  }
  return (
    <Shelf id={`${id}:play`} title="Watch now — rights holders with a public stream in your library" count={`${channels.length}`}>
      {channels.map((c) => (
        <ChannelTile key={c.id} channel={c} focusId={`${id}:play:${c.id}`} onSelect={() => watchFrom(c, channels as CatalogueChannel[], label)} />
      ))}
    </Shelf>
  );
}
