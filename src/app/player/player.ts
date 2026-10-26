/**
 * Player controller: one <video> element, one active engine. play() walks the engine
 * plan in order with a start-up timeout, remembers which engine worked per stream, and
 * exposes state as signals. A newer play() call always supersedes an older one.
 */
import { signal } from '@preact/signals';
import type { Engine, EngineId, PlaybackInfo, PlayerError, PlayerStatus, StreamSource, Track } from './types.ts';
import { planEngines, shouldTryNextEngine, type Capabilities } from './policy.ts';
import { createEngine, resetVideo } from './engines.ts';
import { readJSON, writeJSON } from '../platform/storage.ts';

const MEMORY_KEY = 'player:engines';
const MEMORY_LIMIT = 400;

/** Remembers the engine that last played each URL (bounded, most recent last). */
export class EngineMemory {
  private entries: [string, EngineId][];
  constructor() {
    this.entries = readJSON<[string, EngineId][]>(MEMORY_KEY, []);
  }
  get(url: string): EngineId | null {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i]![0] === url) return this.entries[i]![1];
    return null;
  }
  set(url: string, engine: EngineId): void {
    this.entries = this.entries.filter((e) => e[0] !== url);
    this.entries.push([url, engine]);
    if (this.entries.length > MEMORY_LIMIT) this.entries = this.entries.slice(-MEMORY_LIMIT);
    writeJSON(MEMORY_KEY, this.entries);
  }
}

export function detectCapabilities(): Capabilities {
  return { mse: typeof (window as unknown as { MediaSource?: unknown }).MediaSource !== 'undefined' };
}

export interface PlayerOptions {
  startupTimeoutMs?: number;
  capabilities?: Capabilities;
  memory?: EngineMemory | null;
  /** Restrict to these engines (used by the playback probe). */
  only?: EngineId[];
  /** Engine factory; tests inject fakes. */
  engineFactory?: (id: EngineId) => Engine;
}

export class Player {
  readonly status = signal<PlayerStatus>('idle');
  readonly error = signal<PlayerError | null>(null);
  readonly info = signal<PlaybackInfo>({});
  readonly source = signal<StreamSource | null>(null);

  private readonly video: HTMLVideoElement;
  private readonly opts: PlayerOptions;
  private readonly memory: EngineMemory | null;
  private engine: Engine | null = null;
  private token = 0;
  private readonly onWaiting = () => {
    if (this.status.value === 'playing') this.status.value = 'loading';
  };
  private readonly onPlaying = () => {
    if (this.status.value === 'loading' && this.engine) this.status.value = 'playing';
  };
  private readonly onResize = () => {
    if (this.engine) this.info.value = { ...this.info.value, width: this.video.videoWidth, height: this.video.videoHeight };
  };

  constructor(video: HTMLVideoElement, opts: PlayerOptions = {}) {
    this.video = video;
    this.opts = opts;
    this.memory = opts.memory === undefined ? new EngineMemory() : opts.memory;
    video.addEventListener('waiting', this.onWaiting);
    video.addEventListener('playing', this.onPlaying);
    video.addEventListener('resize', this.onResize);
    video.addEventListener('loadedmetadata', this.onResize);
  }

  /** Resolves true once something is playing, false on failure or when superseded. */
  async play(src: StreamSource): Promise<boolean> {
    const token = ++this.token;
    this.teardown();
    this.source.value = src;
    this.error.value = null;
    this.info.value = {};
    this.status.value = 'loading';

    const caps = this.opts.capabilities || detectCapabilities();
    const plan = planEngines(src, caps, this.memory ? this.memory.get(src.url) : null);
    if (plan.blocked) return this.fail(token, plan.blocked);
    const only = this.opts.only;
    const engines = only ? plan.engines.filter((e) => only.indexOf(e) >= 0) : plan.engines;

    let last: PlayerError = { code: 'unsupported-format' };
    for (const id of engines) {
      if (token !== this.token) return false;
      const result = await this.attempt(id, src, token);
      if (result === true) {
        if (this.memory) this.memory.set(src.url, id);
        if (src.subtitles && src.subtitles.length) this.addSidecars(src.subtitles);
        return true;
      }
      if (result.code === 'aborted') return false;
      last = result;
      if (!shouldTryNextEngine(result.code)) break;
    }
    return this.fail(token, last);
  }

  private attempt(id: EngineId, src: StreamSource, token: number): Promise<true | PlayerError> {
    return new Promise((resolve) => {
      const engine = (this.opts.engineFactory || createEngine)(id);
      this.engine = engine;
      const started = Date.now();
      let done = false;
      const video = this.video;
      const finish = (r: true | PlayerError) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.removeEventListener('playing', onFirstFrame);
        if (r !== true) {
          engine.destroy();
          if (this.engine === engine) this.engine = null;
        }
        resolve(r);
      };
      const onFirstFrame = () => {
        if (token !== this.token) return finish({ code: 'aborted' });
        this.info.value = {
          engine: id,
          width: video.videoWidth || undefined,
          height: video.videoHeight || undefined,
          startupMs: Date.now() - started,
        };
        this.status.value = 'playing';
        finish(true);
      };
      video.addEventListener('playing', onFirstFrame);
      const timer = setTimeout(() => finish({ code: 'timeout', engine: id }), this.opts.startupTimeoutMs || 15000);
      const onEngineError = (e: PlayerError) => {
        if (!done) finish({ ...e, engine: id });
        else if (this.engine === engine && token === this.token) {
          // Failure after playback started (stream dropped, decoder error).
          this.error.value = { ...e, engine: id };
          this.status.value = 'error';
        }
      };
      engine
        .load(src, video, onEngineError)
        .then(() => {
          if (token !== this.token) return finish({ code: 'aborted' });
          const p = video.play() as Promise<void> | undefined;
          if (p && typeof p.catch === 'function') p.catch(() => undefined);
        })
        .catch((err: Error) => finish({ code: 'unsupported-format', engine: id, detail: err.message }));
    });
  }

  private fail(token: number, e: PlayerError): false {
    if (token === this.token) {
      this.error.value = e;
      this.status.value = 'error';
    }
    return false;
  }

  retry(): Promise<boolean> {
    const src = this.source.value;
    return src ? this.play(src) : Promise.resolve(false);
  }

  pause(): void {
    if (this.status.value === 'playing') {
      this.video.pause();
      this.status.value = 'paused';
    }
  }

  resume(): void {
    if (this.status.value === 'paused') {
      const p = this.video.play() as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
      this.status.value = 'playing';
    }
  }

  audioTracks(): Track[] {
    return this.engine ? this.engine.audioTracks() : [];
  }
  setAudioTrack(id: string): void {
    if (this.engine) this.engine.setAudioTrack(id);
  }
  subtitleTracks(): Track[] {
    return this.engine ? this.engine.subtitleTracks() : [];
  }
  setSubtitleTrack(id: string | null): void {
    if (this.engine) this.engine.setSubtitleTrack(id);
  }

  /** Seconds into on-demand media (0 for live or before start). */
  position(): number {
    return this.video.currentTime || 0;
  }

  duration(): number {
    const d = this.video.duration;
    return isFinite(d) ? d : 0;
  }

  seek(seconds: number): void {
    try {
      this.video.currentTime = seconds;
    } catch {
      // not seekable (live)
    }
  }

  /** Sidecar WebVTT subtitles; they start hidden. The library server allows cross-origin reads. */
  private addSidecars(list: { url: string; label: string; language?: string }[]): void {
    this.video.crossOrigin = 'anonymous';
    for (const sub of list) {
      const el = document.createElement('track');
      el.kind = 'subtitles';
      el.label = sub.label;
      if (sub.language) el.srclang = sub.language;
      el.src = sub.url;
      el.setAttribute('data-fbtv', '');
      this.video.appendChild(el);
    }
    this.showSidecar(-1);
  }

  /** Labels of the sidecar subtitle files, in order. */
  sidecars(): string[] {
    return Array.from(this.video.querySelectorAll('track[data-fbtv]')).map((t) => (t as HTMLTrackElement).label);
  }

  /** Shows sidecar subtitle `index`, or none for -1. */
  showSidecar(index: number): void {
    const tracks = this.video.textTracks;
    for (let i = 0; i < tracks.length; i++) tracks[i]!.mode = i === index ? 'showing' : 'disabled';
  }

  stop(): void {
    this.token++;
    this.teardown();
    this.status.value = 'idle';
    this.source.value = null;
  }

  private teardown(): void {
    if (this.engine) this.engine.destroy();
    this.engine = null;
    this.video.removeAttribute('crossorigin');
    resetVideo(this.video); // also removes sidecar <track>s
  }

  destroy(): void {
    this.stop();
    this.video.removeEventListener('waiting', this.onWaiting);
    this.video.removeEventListener('playing', this.onPlaying);
    this.video.removeEventListener('resize', this.onResize);
    this.video.removeEventListener('loadedmetadata', this.onResize);
  }
}
