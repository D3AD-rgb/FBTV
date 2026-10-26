/**
 * Public test streams published by video vendors for player testing. Used only by the
 * Playback test screen to learn what this TV can play. Verified reachable 2026-10-25.
 */
import type { EngineId } from './types.ts';

export interface TestStream {
  id: string;
  label: string;
  provider: string;
  url: string;
  expect: string;
  engines: EngineId[];
}

export const TEST_STREAMS: TestStream[] = [
  {
    id: 'mux-bbb',
    label: 'Big Buck Bunny (on demand)',
    provider: 'Mux test streams',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    expect: 'HLS · MPEG-TS segments · H.264 up to 1080p · AAC',
    engines: ['native', 'hlsjs'],
  },
  {
    id: 'akamai-live',
    label: 'Akamai live test channel',
    provider: 'Akamai',
    url: 'https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8',
    expect: 'Live HLS · H.264 1080p · HE-AAC',
    engines: ['native', 'hlsjs'],
  },
  {
    id: 'apple-dv-atmos',
    label: 'Apple advanced example (HEVC, Dolby)',
    provider: 'Apple HLS examples',
    url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/adv_dv_atmos/main.m3u8',
    expect: 'HLS · fMP4 · H.264 / HEVC / Dolby Vision up to 4K · AAC, AC-3, E-AC-3',
    engines: ['native', 'hlsjs'],
  },
];
