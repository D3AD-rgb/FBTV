import { describe, expect, it } from 'vitest';
import { pickCandidate, scrollOffsetFor, isInDirection, type Rect } from '../src/app/focus/geometry.ts';

const r = (left: number, top: number, width = 100, height = 60): Rect => ({ left, top, width, height });

describe('pickCandidate', () => {
  it('moves to the adjacent card in a row', () => {
    const from = r(0, 0);
    const cands = [
      { rect: r(124, 0), item: 'b' },
      { rect: r(248, 0), item: 'c' },
    ];
    expect(pickCandidate(from, 'right', cands)).toBe('b');
    expect(pickCandidate(from, 'left', cands)).toBeNull();
  });

  it('prefers the nearest row over a farther in-beam row', () => {
    const from = r(300, 0);
    const cands = [
      { rect: r(0, 100), item: 'row2-offset' }, // nearest row, but not under `from`
      { rect: r(300, 400), item: 'row3-under' }, // in beam, two rows away
    ];
    expect(pickCandidate(from, 'down', cands)).toBe('row2-offset');
  });

  it('within the nearest row, picks the card closest on the cross axis', () => {
    const from = r(260, 0);
    const cands = [
      { rect: r(0, 100), item: 'a' },
      { rect: r(124, 100), item: 'b' },
      { rect: r(248, 100), item: 'c' },
      { rect: r(372, 100), item: 'd' },
    ];
    expect(pickCandidate(from, 'down', cands)).toBe('c');
  });

  it('only counts candidates whose leading edge is past the current centre', () => {
    const from = r(0, 0, 200, 60);
    expect(isInDirection(from, r(50, 0, 200, 60), 'right')).toBe(false);
    expect(isInDirection(from, r(150, 0, 200, 60), 'right')).toBe(true); // slight overlap, e.g. a scaled card
    expect(isInDirection(from, r(210, 0), 'right')).toBe(true);
  });

  it('left/right stays on the current row over a closer diagonal neighbour', () => {
    const from = r(100, 200, 240, 135);
    const cands = [
      { rect: r(628, 200, 240, 135), item: 'same-row-far' },
      { rect: r(364, 400, 240, 135), item: 'next-row-near' },
    ];
    expect(pickCandidate(from, 'right', cands)).toBe('same-row-far');
  });

  it('left/right falls back to the nearest element when nothing lines up', () => {
    const from = r(100, 200, 240, 135);
    expect(pickCandidate(from, 'right', [{ rect: r(364, 400, 240, 135), item: 'only' }])).toBe('only');
  });

  it('moves from a tall panel to the list row nearest its centre', () => {
    const panel = r(0, 0, 900, 500);
    const rows = [0, 110, 220, 330].map((top, i) => ({ rect: r(1000, top, 700, 100), item: `row${i}` }));
    expect(pickCandidate(panel, 'right', rows)).toBe('row2');
  });
});

describe('scrollOffsetFor', () => {
  it('start alignment keeps the item at the leading edge, clamped to the content', () => {
    expect(scrollOffsetFor(500, 240, 1728, 4000, 0, 'start')).toBe(500);
    expect(scrollOffsetFor(3800, 200, 1728, 4000, 0, 'start')).toBe(4000 - 1728);
    expect(scrollOffsetFor(0, 240, 1728, 4000, 300, 'start')).toBe(0);
  });

  it('nearest alignment only scrolls when the item would leave the viewport', () => {
    expect(scrollOffsetFor(100, 100, 1000, 3000, 0, 'nearest')).toBe(0);
    expect(scrollOffsetFor(950, 100, 1000, 3000, 0, 'nearest')).toBe(50);
    expect(scrollOffsetFor(200, 100, 1000, 3000, 500, 'nearest')).toBe(200);
  });

  it('never scrolls when content fits', () => {
    expect(scrollOffsetFor(400, 100, 1000, 800, 0, 'start')).toBe(0);
  });
});
