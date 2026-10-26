/**
 * Pure spatial-navigation geometry. Kept DOM-free so it can be unit tested.
 *
 * Strategy: among candidates that lie in the requested direction, find the nearest
 * "line" (smallest gap along the movement axis, within a tolerance band), then pick
 * the candidate in that line closest to the current element on the cross axis.
 * This behaves predictably for rows, grids, lists and mixed layouts.
 */
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Candidate<T> {
  rect: Rect;
  item: T;
}

const right = (r: Rect) => r.left + r.width;
const bottom = (r: Rect) => r.top + r.height;
const cx = (r: Rect) => r.left + r.width / 2;
const cy = (r: Rect) => r.top + r.height / 2;

/** Band tolerance (px at 1080p) for treating candidates as being on the same line. */
export const BAND_TOLERANCE = 24;

export function isInDirection(from: Rect, to: Rect, dir: Direction): boolean {
  switch (dir) {
    case 'right':
      return cx(to) > cx(from) && to.left >= cx(from);
    case 'left':
      return cx(to) < cx(from) && right(to) <= cx(from);
    case 'down':
      return cy(to) > cy(from) && to.top >= cy(from);
    case 'up':
      return cy(to) < cy(from) && bottom(to) <= cy(from);
  }
}

/** Gap along the movement axis (0 when touching/overlapping). */
export function primaryGap(from: Rect, to: Rect, dir: Direction): number {
  switch (dir) {
    case 'right':
      return Math.max(0, to.left - right(from));
    case 'left':
      return Math.max(0, from.left - right(to));
    case 'down':
      return Math.max(0, to.top - bottom(from));
    case 'up':
      return Math.max(0, from.top - bottom(to));
  }
}

/** Distance on the cross axis: 0 when the ranges overlap, otherwise the edge gap. */
export function crossGap(from: Rect, to: Rect, dir: Direction): number {
  if (dir === 'left' || dir === 'right') {
    const overlap = Math.min(bottom(from), bottom(to)) - Math.max(from.top, to.top);
    return overlap > 0 ? 0 : -overlap;
  }
  const overlap = Math.min(right(from), right(to)) - Math.max(from.left, to.left);
  return overlap > 0 ? 0 : -overlap;
}

export function crossCenterDistance(from: Rect, to: Rect, dir: Direction): number {
  return dir === 'left' || dir === 'right' ? Math.abs(cy(to) - cy(from)) : Math.abs(cx(to) - cx(from));
}

export function pickCandidate<T>(from: Rect, dir: Direction, candidates: Candidate<T>[]): T | null {
  let valid = candidates.filter((c) => isInDirection(from, c.rect, dir));
  if (!valid.length) return null;
  // Rows are horizontal on TV layouts: Left/Right stays on the current row whenever
  // anything on it lines up, even if a diagonal neighbour on another row is closer.
  // Up/Down always goes to the nearest row (never skips one).
  if (dir === 'left' || dir === 'right') {
    const inBeam = valid.filter((c) => crossGap(from, c.rect, dir) === 0);
    if (inBeam.length) valid = inBeam;
  }
  let minGap = Infinity;
  for (const c of valid) minGap = Math.min(minGap, primaryGap(from, c.rect, dir));
  const band = valid.filter((c) => primaryGap(from, c.rect, dir) <= minGap + BAND_TOLERANCE);
  band.sort((a, b) => {
    const ga = crossGap(from, a.rect, dir);
    const gb = crossGap(from, b.rect, dir);
    if (ga !== gb) return ga - gb;
    const da = crossCenterDistance(from, a.rect, dir);
    const db = crossCenterDistance(from, b.rect, dir);
    if (da !== db) return da - db;
    return primaryGap(from, a.rect, dir) - primaryGap(from, b.rect, dir);
  });
  return band[0] ? band[0].item : null;
}

/**
 * Offset a scroll track should have so `item` is visible inside a viewport.
 * `align: 'start'` keeps the focused item at the leading edge (Google TV rows);
 * `'nearest'` only scrolls when the item would leave the viewport (lists).
 */
export function scrollOffsetFor(
  itemStart: number,
  itemSize: number,
  viewportSize: number,
  contentSize: number,
  currentOffset: number,
  align: 'start' | 'nearest',
  padding = 0,
): number {
  const max = Math.max(0, contentSize - viewportSize);
  let next = currentOffset;
  if (align === 'start') {
    next = itemStart - padding;
  } else {
    if (itemStart - padding < currentOffset) next = itemStart - padding;
    else if (itemStart + itemSize + padding > currentOffset + viewportSize) {
      next = itemStart + itemSize + padding - viewportSize;
    }
  }
  return Math.min(max, Math.max(0, Math.round(next)));
}
