/**
 * Maps raw key events (LG remote, desktop keyboard) to app actions.
 * LG key codes: webOS TV developer guide "Magic Remote" key codes.
 */
export type Action =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'ok'
  | 'back'
  | 'play'
  | 'pause'
  | 'playPause'
  | 'stop'
  | 'rewind'
  | 'fastForward'
  | 'channelUp'
  | 'channelDown'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'info'
  | 'digit';

export interface KeyAction {
  action: Action;
  /** 0–9 for `digit` actions. */
  digit?: number;
}

const BY_CODE: Record<number, Action> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  13: 'ok',
  461: 'back', // webOS Back
  8: 'back', // Backspace (desktop)
  27: 'back', // Escape (desktop)
  415: 'play',
  19: 'pause',
  463: 'playPause',
  413: 'stop',
  412: 'rewind',
  417: 'fastForward',
  33: 'channelUp', // CH+ arrives as PageUp
  34: 'channelDown', // CH- arrives as PageDown
  403: 'red',
  404: 'green',
  405: 'yellow',
  406: 'blue',
  457: 'info',
};

/** Desktop stand-ins for colour keys when testing in a browser. */
const BY_KEY: Record<string, Action> = {
  F1: 'red',
  F2: 'green',
  F3: 'yellow',
  F4: 'blue',
  MediaPlayPause: 'playPause',
  MediaPlay: 'play',
  MediaPause: 'pause',
  MediaStop: 'stop',
  MediaTrackNext: 'channelUp',
  MediaTrackPrevious: 'channelDown',
};

export function toAction(e: Pick<KeyboardEvent, 'keyCode' | 'key'>): KeyAction | null {
  const code = e.keyCode;
  if (code >= 48 && code <= 57) return { action: 'digit', digit: code - 48 };
  if (code >= 96 && code <= 105) return { action: 'digit', digit: code - 96 };
  const byCode = BY_CODE[code];
  if (byCode) return { action: byCode };
  const byKey = e.key ? BY_KEY[e.key] : undefined;
  return byKey ? { action: byKey } : null;
}

export function isDirection(a: Action): a is 'up' | 'down' | 'left' | 'right' {
  return a === 'up' || a === 'down' || a === 'left' || a === 'right';
}
