import { describe, expect, it } from 'vitest';
import { ukBlackout, whereToWatch, type Fixture, type FootballData } from '../src/app/data/football.ts';
import { servicesFor } from '../src/app/platform/apps.ts';

const fx = (over: Partial<Fixture>): Fixture => ({
  id: 'x',
  sport: 'football',
  competitionId: 'english-premier-league',
  competition: 'Premier League',
  timeKnown: true,
  home: 'Manchester City FC',
  away: 'Brighton & Hove Albion FC',
  status: 'scheduled',
  priority: 100,
  bigClubs: [],
  broadcasts: [],
  ...over,
});

const data: FootballData = {
  notes: [],
  channels: [],
  fixtures: [],
  associations: [],
  competitions: [
    {
      id: 'english-premier-league',
      name: 'Premier League',
      sport: 'football',
      tier: 96,
      providers: [],
      fixtures: 380,
      verified: true,
      rights: {
        competitionId: 'english-premier-league',
        season: '2026-27',
        retrieved: '2026-10-26',
        sources: [],
        broadcasters: [
          {
            country: 'United Kingdom',
            code: 'UK',
            channels: [
              { name: 'Sky Sports', type: 'pay-tv', freeToAir: false },
              { name: 'TNT Sports', type: 'pay-tv', freeToAir: false },
              { name: 'BBC One - Match of the Day (highlights only)', type: 'free-to-air', freeToAir: true },
            ],
          },
        ],
      },
    },
  ],
};

describe('where to watch', () => {
  it('flags the Saturday 3pm UK blackout (GMT and BST)', () => {
    expect(ukBlackout(fx({ kickoffUtc: '2026-10-31T15:00:00.000Z' }))).toBe(true);
    expect(ukBlackout(fx({ kickoffUtc: '2026-08-22T14:00:00.000Z' }))).toBe(true);
    expect(ukBlackout(fx({ kickoffUtc: '2026-10-31T12:30:00.000Z' }))).toBe(false);
    expect(ukBlackout(fx({ kickoffUtc: '2026-11-01T15:00:00.000Z' }))).toBe(false);
  });

  it('uses the match listing when there is one, else the rights holders without highlights-only channels', () => {
    const listed = whereToWatch(fx({ kickoffUtc: '2026-10-31T12:30:00.000Z', broadcasts: [{ country: 'United Kingdom', channel: 'TNT Sports 1' }] }), data, 'UK');
    expect([listed.exact, listed.services]).toEqual([true, ['HBO Max (TNT Sports)']]);
    const open = whereToWatch(fx({ kickoffUtc: '2026-11-08T16:30:00.000Z' }), data, 'UK');
    expect([open.exact, open.services]).toEqual([false, ['NOW (Sky Sports)', 'HBO Max (TNT Sports)']]);
  });

  it('maps broadcaster names to their streaming apps', () => {
    expect(servicesFor(['Sky Sports Main Event', 'Amazon Prime Video', 'ITV1']).map((s) => s.label)).toEqual(['NOW (Sky Sports)', 'Prime Video', 'ITVX']);
  });
});
