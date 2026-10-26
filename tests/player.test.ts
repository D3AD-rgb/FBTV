import { describe, expect, it, vi } from 'vitest';
import { describeError, detectKind, planEngines, httpStatusToCode, mediaErrorToCode } from '../src/app/player/policy.ts';
import { Player } from '../src/app/player/player.ts';
import type { Engine, EngineId, PlayerError, StreamSource } from '../src/app/player/types.ts';

const MSE = { mse: true };
const NO_MSE = { mse: false };

describe('detectKind', () => {
  it('recognises containers from the URL path, ignoring query strings', () => {
    expect(detectKind('https://x.test/live/index.m3u8?token=1')).toBe('hls');
    expect(detectKind('https://x.test/a/manifest.mpd')).toBe('dash');
    expect(detectKind('https://x.test/stream.ts')).toBe('ts');
    expect(detectKind('https://x.test/movie.mp4')).toBe('mp4');
    expect(detectKind('https://x.test/play?format=m3u8')).toBe('hls');
    expect(detectKind('https://x.test/channel/1')).toBe('unknown');
  });
});

describe('planEngines', () => {
  it('tries native first, then hls.js for HLS when MSE exists', () => {
    expect(planEngines({ url: 'https://x.test/a.m3u8' }, MSE).engines).toEqual(['native', 'hlsjs']);
    expect(planEngines({ url: 'https://x.test/a.m3u8' }, NO_MSE).engines).toEqual(['native']);
  });

  it('uses mpegts.js as the fallback for raw MPEG-TS', () => {
    expect(planEngines({ url: 'https://x.test/a.ts' }, MSE).engines).toEqual(['native', 'mpegts']);
  });

  it('moves the remembered engine to the front', () => {
    expect(planEngines({ url: 'https://x.test/a.m3u8' }, MSE, 'hlsjs').engines).toEqual(['hlsjs', 'native']);
  });

  it('blocks streams that need headers, other protocols, and DASH', () => {
    expect(planEngines({ url: 'https://x.test/a.m3u8', referrer: 'https://site.test' }, MSE).blocked?.code).toBe(
      'needs-headers',
    );
    expect(planEngines({ url: 'rtmp://x.test/live' }, MSE).blocked?.code).toBe('unsupported-protocol');
    expect(planEngines({ url: 'udp://239.0.0.1:1234' }, MSE).blocked?.code).toBe('unsupported-protocol');
    expect(planEngines({ url: 'https://x.test/a.mpd' }, MSE).blocked?.code).toBe('unsupported-format');
  });
});

describe('error mapping', () => {
  it('maps HTTP and media errors to user-facing codes', () => {
    expect(httpStatusToCode(403)).toBe('forbidden');
    expect(httpStatusToCode(404)).toBe('not-found');
    expect(httpStatusToCode(0)).toBe('cors');
    expect(httpStatusToCode(502)).toBe('network');
    expect(mediaErrorToCode(3)).toBe('decode');
    expect(mediaErrorToCode(4)).toBe('unsupported-format');
  });

  it('never blames the user and never suggests bypassing restrictions', () => {
    const msg = describeError({ code: 'forbidden' });
    expect(msg.hint).toMatch(/does not bypass/);
  });
});

/** Fake engine: plays (dispatches 'playing') or fails after a tick, per scenario. */
function fakeFactory(outcomes: Record<EngineId, 'play' | PlayerError | 'hang'>, calls: EngineId[]) {
  return (id: EngineId): Engine => ({
    id,
    async load(_src: StreamSource, video: HTMLVideoElement, onError: (e: PlayerError) => void) {
      calls.push(id);
      const outcome = outcomes[id];
      setTimeout(() => {
        if (outcome === 'play') video.dispatchEvent(new Event('playing'));
        else if (outcome !== 'hang') onError(outcome);
      }, 1);
    },
    audioTracks: () => [],
    setAudioTrack: () => undefined,
    subtitleTracks: () => [],
    setSubtitleTrack: () => undefined,
    destroy: () => undefined,
  });
}

function makeVideo(): HTMLVideoElement {
  const v = document.createElement('video');
  v.play = vi.fn(() => Promise.resolve());
  v.pause = vi.fn();
  v.load = vi.fn();
  return v;
}

describe('Player', () => {
  it('falls back to the next engine after a decode error and remembers nothing on failure', async () => {
    const calls: EngineId[] = [];
    const player = new Player(makeVideo(), {
      capabilities: MSE,
      memory: null,
      engineFactory: fakeFactory({ native: { code: 'decode' }, hlsjs: 'play', mpegts: 'hang' }, calls),
    });
    const ok = await player.play({ url: 'https://x.test/a.m3u8' });
    expect(ok).toBe(true);
    expect(calls).toEqual(['native', 'hlsjs']);
    expect(player.status.value).toBe('playing');
    expect(player.info.value.engine).toBe('hlsjs');
  });

  it('moves on when the TV player rejects the source (fMP4/HEVC on webOS 22, FND-010)', async () => {
    const calls: EngineId[] = [];
    const player = new Player(makeVideo(), {
      capabilities: MSE,
      memory: null,
      engineFactory: fakeFactory({ native: { code: 'rejected' }, hlsjs: 'play', mpegts: 'hang' }, calls),
    });
    expect(await player.play({ url: 'https://x.test/hevc/master.m3u8' })).toBe(true);
    expect(calls).toEqual(['native', 'hlsjs']);
  });

  it('stops at errors another engine cannot fix (403)', async () => {
    const calls: EngineId[] = [];
    const player = new Player(makeVideo(), {
      capabilities: MSE,
      memory: null,
      engineFactory: fakeFactory({ native: { code: 'forbidden' }, hlsjs: 'play', mpegts: 'hang' }, calls),
    });
    expect(await player.play({ url: 'https://x.test/a.m3u8' })).toBe(false);
    expect(calls).toEqual(['native']);
    expect(player.error.value?.code).toBe('forbidden');
  });

  it('reports a timeout when nothing starts', async () => {
    const player = new Player(makeVideo(), {
      capabilities: NO_MSE,
      memory: null,
      startupTimeoutMs: 20,
      engineFactory: fakeFactory({ native: 'hang', hlsjs: 'hang', mpegts: 'hang' }, []),
    });
    expect(await player.play({ url: 'https://x.test/a.m3u8' })).toBe(false);
    expect(player.error.value?.code).toBe('timeout');
  });

  it('shows the reason immediately for streams that need headers', async () => {
    const calls: EngineId[] = [];
    const player = new Player(makeVideo(), { capabilities: MSE, memory: null, engineFactory: fakeFactory({ native: 'play', hlsjs: 'play', mpegts: 'play' }, calls) });
    expect(await player.play({ url: 'https://x.test/a.m3u8', userAgent: 'Custom' })).toBe(false);
    expect(calls).toEqual([]);
    expect(player.error.value?.code).toBe('needs-headers');
  });

  it('a newer play() supersedes an older one (fast channel switching)', async () => {
    const calls: EngineId[] = [];
    const player = new Player(makeVideo(), {
      capabilities: NO_MSE,
      memory: null,
      startupTimeoutMs: 50,
      engineFactory: fakeFactory({ native: 'play', hlsjs: 'play', mpegts: 'play' }, calls),
    });
    const first = player.play({ url: 'https://x.test/one.m3u8' });
    const second = player.play({ url: 'https://x.test/two.m3u8' });
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(player.source.value?.url).toBe('https://x.test/two.m3u8');
  });
});
