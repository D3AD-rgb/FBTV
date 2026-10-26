/**
 * Pure playback policy: stream kind detection, which engines to try (in order), and
 * user-facing error messages. No DOM, so it is unit tested.
 */
import type { EngineId, PlayerError, PlayerErrorCode, StreamKind, StreamSource } from './types.ts';

const UNSUPPORTED_PROTOCOLS = /^(rtmp|rtmps|rtsp|rtp|udp|igmp|mms|srt):/i;

export function detectKind(url: string): StreamKind {
  const path = url.split(/[?#]/)[0]!.toLowerCase();
  if (/\.m3u8$/.test(path) || /\/(hls|playlist)\b/.test(path) && /m3u8/.test(url)) return 'hls';
  if (/\.mpd$/.test(path)) return 'dash';
  if (/\.(ts|mts|m2ts)$/.test(path)) return 'ts';
  if (/\.(mp4|m4v|mov)$/.test(path)) return 'mp4';
  if (/\.flv$/.test(path)) return 'flv';
  if (/m3u8/i.test(url)) return 'hls';
  return 'unknown';
}

export interface Capabilities {
  /** MediaSource is available (hls.js / mpegts.js can run). */
  mse: boolean;
}

export interface EnginePlan {
  engines: EngineId[];
  /** Set when nothing can be tried; the reason is shown to the user. */
  blocked?: PlayerError;
}

/**
 * Engine order: the engine that last worked for this URL first, then native (hardware
 * player, no CORS needed), then the MSE engine that fits the container.
 */
export function planEngines(src: StreamSource, caps: Capabilities, remembered?: EngineId | null): EnginePlan {
  if (UNSUPPORTED_PROTOCOLS.test(src.url)) {
    return { engines: [], blocked: { code: 'unsupported-protocol', detail: src.url.split(':')[0] } };
  }
  if (!/^https?:\/\//i.test(src.url)) {
    return { engines: [], blocked: { code: 'unsupported-protocol', detail: 'not http(s)' } };
  }
  if (src.userAgent || src.referrer) {
    return { engines: [], blocked: { code: 'needs-headers' } };
  }
  const kind = src.kind || detectKind(src.url);
  let order: EngineId[];
  switch (kind) {
    case 'hls':
      order = caps.mse ? ['native', 'hlsjs'] : ['native'];
      break;
    case 'ts':
      order = caps.mse ? ['native', 'mpegts'] : ['native'];
      break;
    case 'flv':
      order = caps.mse ? ['mpegts'] : [];
      break;
    case 'mp4':
      order = ['native'];
      break;
    case 'dash':
      return { engines: [], blocked: { code: 'unsupported-format', detail: 'MPEG-DASH' } };
    default:
      order = caps.mse ? ['native', 'hlsjs', 'mpegts'] : ['native'];
  }
  if (remembered && order.indexOf(remembered) > 0) {
    order = [remembered].concat(order.filter((e) => e !== remembered));
  }
  if (!order.length) return { engines: [], blocked: { code: 'unsupported-format', detail: kind } };
  return { engines: order };
}

/** Errors worth trying the next engine for (others won't be fixed by another engine). */
export function shouldTryNextEngine(code: PlayerErrorCode): boolean {
  return code === 'decode' || code === 'unsupported-format' || code === 'timeout' || code === 'network';
}

/** Maps an HTTP status from a loader to an error code. */
export function httpStatusToCode(status: number): PlayerErrorCode {
  if (status === 401 || status === 403 || status === 451) return 'forbidden';
  if (status === 404 || status === 410) return 'not-found';
  if (status === 0) return 'cors';
  return 'network';
}

/** Maps HTMLMediaElement MediaError codes. */
export function mediaErrorToCode(code: number | undefined): PlayerErrorCode {
  switch (code) {
    case 1:
      return 'aborted';
    case 2:
      return 'network';
    case 3:
      return 'decode';
    case 4:
      return 'unsupported-format';
    default:
      return 'network';
  }
}

const MESSAGES: Record<PlayerErrorCode, { title: string; hint: string }> = {
  'needs-headers': {
    title: "This stream can't play on the TV",
    hint: 'It requires special request headers that the TV player cannot send.',
  },
  'unsupported-protocol': {
    title: 'Stream type not supported',
    hint: 'Only HTTP and HTTPS streams can play on the TV.',
  },
  'unsupported-format': {
    title: 'Format not supported',
    hint: 'None of the players on this TV accept this stream format.',
  },
  network: { title: "Can't reach the stream", hint: 'The server did not respond. It may be offline; try again later.' },
  forbidden: {
    title: 'Access refused by the provider',
    hint: 'The stream may be limited to some countries or need a subscription. FBTV does not bypass this.',
  },
  'not-found': { title: 'Stream not found', hint: 'The link no longer works. The channel may have moved.' },
  cors: {
    title: "The stream server blocked this player",
    hint: 'Only the TV’s built-in player can open this stream, and it could not decode it.',
  },
  decode: { title: "The TV can't decode this stream", hint: 'Its video or audio codec is not supported on this TV.' },
  timeout: { title: 'The stream took too long to start', hint: 'It may be overloaded or offline. Try again.' },
  aborted: { title: 'Playback stopped', hint: '' },
};

export function describeError(e: PlayerError): { title: string; hint: string } {
  return MESSAGES[e.code] || MESSAGES.network;
}
