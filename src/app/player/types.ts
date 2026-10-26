export type EngineId = 'native' | 'hlsjs' | 'mpegts';

export type StreamKind = 'hls' | 'ts' | 'mp4' | 'dash' | 'flv' | 'unknown';

export interface StreamSource {
  url: string;
  /** Detected from the URL when not given. */
  kind?: StreamKind;
  /** Header requirements copied from the source metadata (never set by the user). */
  userAgent?: string | null;
  referrer?: string | null;
}

export type PlayerErrorCode =
  | 'needs-headers' // stream requires User-Agent/Referer the TV cannot send
  | 'unsupported-protocol' // rtmp/rtsp/udp/...
  | 'unsupported-format' // e.g. DASH, or no engine accepted the media
  | 'network' // server unreachable, connection dropped
  | 'forbidden' // HTTP 401/403 (often geo-blocked or protected)
  | 'not-found' // HTTP 404/410
  | 'cors' // MSE engine blocked by the server's CORS policy
  | 'decode' // codec not supported / corrupted media
  | 'timeout' // nothing played within the start-up window
  | 'aborted'; // superseded by another play request

export interface PlayerError {
  code: PlayerErrorCode;
  engine?: EngineId;
  detail?: string;
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface Track {
  id: string;
  label: string;
  language?: string;
  active: boolean;
}

export interface PlaybackInfo {
  engine?: EngineId;
  width?: number;
  height?: number;
  /** Time from play() to the first frame, in ms. */
  startupMs?: number;
}

/** One playback engine bound to a <video> element. */
export interface Engine {
  readonly id: EngineId;
  /** Starts loading; resolves when the engine has attached (not when playing). */
  load(src: StreamSource, video: HTMLVideoElement, onError: (e: PlayerError) => void): Promise<void>;
  audioTracks(): Track[];
  setAudioTrack(id: string): void;
  subtitleTracks(): Track[];
  setSubtitleTrack(id: string | null): void;
  destroy(): void;
}
