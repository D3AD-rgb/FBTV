import { describe, expect, it } from 'vitest';
import { toAction } from '../src/app/platform/keys.ts';

const k = (keyCode: number, key = '') => toAction({ keyCode, key });

describe('toAction', () => {
  it('maps the LG remote keys', () => {
    expect(k(461)).toEqual({ action: 'back' });
    expect(k(13)).toEqual({ action: 'ok' });
    expect(k(415)).toEqual({ action: 'play' });
    expect(k(19)).toEqual({ action: 'pause' });
    expect(k(33)).toEqual({ action: 'channelUp' });
    expect(k(34)).toEqual({ action: 'channelDown' });
    expect(k(403)).toEqual({ action: 'red' });
    expect(k(406)).toEqual({ action: 'blue' });
  });

  it('maps arrows and digits (top row and keypad)', () => {
    expect(k(37)).toEqual({ action: 'left' });
    expect(k(40)).toEqual({ action: 'down' });
    expect(k(55)).toEqual({ action: 'digit', digit: 7 });
    expect(k(96)).toEqual({ action: 'digit', digit: 0 });
  });

  it('maps desktop stand-ins and ignores unknown keys', () => {
    expect(k(27)).toEqual({ action: 'back' });
    expect(k(112, 'F1')).toEqual({ action: 'red' });
    expect(k(65, 'a')).toBeNull();
  });
});
