/**
 * Playback test (v0.2.0): plays each public test stream with each engine separately and
 * records what this TV actually does. Results set the player's defaults and are logged
 * as `[fbtv] probe` lines for ares-inspect.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { PageScroll } from '../ui/Shelf.tsx';
import { Player } from '../player/player.ts';
import { TEST_STREAMS, type TestStream } from '../player/testStreams.ts';
import type { EngineId, PlayerError } from '../player/types.ts';
import { describeError } from '../player/policy.ts';
import { readJSON, writeJSON } from '../platform/storage.ts';
import type { PageEntry } from '../nav/router.ts';
import '../styles/probe.css';

export interface ProbeResult {
  stream: string;
  engine: EngineId;
  ok: boolean;
  startupMs?: number;
  width?: number;
  height?: number;
  audioTracks?: number;
  error?: PlayerError;
  at: string;
}

const RESULTS_KEY = 'probe:results';
const ENGINE_LABEL: Record<EngineId, string> = { native: 'TV player', hlsjs: 'hls.js', mpegts: 'mpegts.js' };
/** How long a stream plays before being judged a success (lets decoding errors surface). */
const SETTLE_MS = 4000;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function probeOne(video: HTMLVideoElement, s: TestStream, engine: EngineId): Promise<ProbeResult> {
  const player = new Player(video, { only: [engine], memory: null, startupTimeoutMs: 15000 });
  const at = new Date().toISOString();
  try {
    const ok = await player.play({ url: s.url });
    if (!ok) return { stream: s.id, engine, ok: false, error: player.error.value || { code: 'timeout' }, at };
    await wait(SETTLE_MS);
    const err = player.status.value === 'error' ? player.error.value : null;
    const info = player.info.value;
    return {
      stream: s.id,
      engine,
      ok: !err,
      startupMs: info.startupMs,
      width: video.videoWidth || info.width,
      height: video.videoHeight || info.height,
      audioTracks: player.audioTracks().length,
      error: err || undefined,
      at,
    };
  } finally {
    player.destroy();
  }
}

function Cell({ r }: { r?: ProbeResult }) {
  if (!r) return <td class="maybe">Not run</td>;
  if (r.ok) {
    const res = r.width && r.height ? `${r.width}×${r.height}` : 'size not reported';
    const audio = r.audioTracks ? ` · ${r.audioTracks} audio` : '';
    return (
      <td class="ok">
        Plays · {res} · {Math.round((r.startupMs || 0) / 100) / 10}s{audio}
      </td>
    );
  }
  const e = r.error || { code: 'timeout' as const };
  return (
    <td class="no">
      {describeError(e).title}
      {e.detail ? ` (${e.detail})` : ''}
    </td>
  );
}

function PlaybackTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [results, setResults] = useState<ProbeResult[]>(() => readJSON<ProbeResult[]>(RESULTS_KEY, []));
  const [running, setRunning] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  const find = (stream: string, engine: EngineId) =>
    results.filter((r) => r.stream === stream && r.engine === engine)[0];

  const run = async (streams: TestStream[]) => {
    const video = videoRef.current;
    if (!video || running) return;
    let current = results.slice();
    for (const s of streams) {
      for (const engine of s.engines) {
        if (cancelled.current) return;
        setRunning(`${s.label} · ${ENGINE_LABEL[engine]}`);
        const r = await probeOne(video, s, engine);
        console.info('[fbtv] probe', JSON.stringify(r));
        current = current.filter((x) => !(x.stream === r.stream && x.engine === r.engine)).concat([r]);
        setResults(current);
        writeJSON(RESULTS_KEY, current);
      }
    }
    setRunning(null);
  };

  return (
    <div class="screen">
      <div class="probe-video">
        <video ref={videoRef} muted playsInline />
        <div class="probe-status">{running ? `Testing: ${running}` : 'Idle'}</div>
      </div>
      <PageScroll align="nearest">
        <section data-scroll-anchor="0" class="probe-intro">
          <div class="breadcrumb">
            Settings › Diagnostics › <b>Playback test</b>
          </div>
          <div class="page-sub" style="margin-top:16px">
            Plays public test streams from video vendors with each player engine, to learn what this TV can
            decode. Each test takes up to about 20 seconds.
          </div>
          <div class="hstack" style="--stack-gap:18px">
            <button class="btn" data-focusable data-focus-default data-focus-id="probe:all" onClick={() => run(TEST_STREAMS)}>
              {running ? 'Testing…' : 'Run all tests'}
            </button>
            <button
              class="btn"
              data-focusable
              data-focus-id="probe:clear"
              onClick={() => {
                setResults([]);
                writeJSON(RESULTS_KEY, []);
              }}
            >
              Clear results
            </button>
          </div>
        </section>
        <div class="vstack" style="--stack-gap:20px;margin-top:28px">
          {TEST_STREAMS.map((s) => (
            <div
              key={s.id}
              class="panel probe-panel card"
              data-focusable
              data-focus-id={`probe:${s.id}`}
              onClick={() => run([s])}
            >
              <h3>{s.label}</h3>
              <div class="probe-meta">
                {s.provider} · {s.expect}
              </div>
              <table class="kv">
                <tbody>
                  {s.engines.map((e) => (
                    <tr key={e}>
                      <td>{ENGINE_LABEL[e]}</td>
                      <Cell r={find(s.id, e)} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </PageScroll>
    </div>
  );
}

export function playbackTestPage(): PageEntry {
  return { key: 'playback-test', title: 'Playback test', render: () => <PlaybackTest /> };
}
