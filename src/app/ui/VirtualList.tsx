/**
 * Windowed vertical list for long channel lists. Only the visible rows (plus a small
 * buffer) exist in the DOM. The list is a single focus target: while it has focus it owns
 * Up/Down and CH+/−, and hands focus back to the engine at its edges (Up on the first row,
 * Left/Right always), so it composes with the rest of the screen.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pushKeyHandler } from '../nav/input.ts';
import { focusedId, getEngine } from '../focus/index.ts';

export interface VirtualListProps<T> {
  id: string;
  items: T[];
  rowHeight: number;
  height: number;
  /** Initial / externally controlled index. */
  index?: number;
  renderRow: (item: T, index: number, current: boolean, focused: boolean) => ComponentChildren;
  onSelect?: (item: T, index: number) => void;
  onIndexChange?: (item: T, index: number) => void;
  empty?: ComponentChildren;
}

const BUFFER = 2;

/** First visible row so `index` stays in view (scroll only when needed). Pure, exported for tests. */
export function windowStart(index: number, currentStart: number, visible: number, total: number): number {
  let start = currentStart;
  if (index < start) start = index;
  else if (index >= start + visible) start = index - visible + 1;
  return Math.max(0, Math.min(start, Math.max(0, total - visible)));
}

export function VirtualList<T>(props: VirtualListProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(props.index || 0);
  const [start, setStart] = useState(0);
  const visible = Math.max(1, Math.floor(props.height / props.rowHeight));
  const total = props.items.length;
  const focusId = `vlist:${props.id}`;
  const hasFocus = focusedId.value === focusId;

  // Keep the index valid when the list changes (filters, catalogue updates).
  useEffect(() => {
    const next = Math.min(props.index !== undefined ? props.index : index, Math.max(0, total - 1));
    setIndex(next);
    setStart((s) => windowStart(next, s, visible, total));
  }, [total, props.index]);

  const latest = useRef({ index, start, props });
  latest.current = { index, start, props };

  const go = (next: number) => {
    const p = latest.current.props;
    const n = Math.max(0, Math.min(p.items.length - 1, next));
    setIndex(n);
    setStart((s) => windowStart(n, s, visible, p.items.length));
    const item = p.items[n];
    if (item !== undefined && p.onIndexChange) p.onIndexChange(item, n);
  };

  useEffect(
    () =>
      pushKeyHandler((a) => {
        const el = ref.current;
        if (!el || getEngine().focused !== el) return false;
        const { index: i, props: p } = latest.current;
        const count = p.items.length;
        if (!count) return false;
        switch (a.action) {
          case 'up':
            if (i === 0) return false; // let focus leave upwards
            go(i - 1);
            return true;
          case 'down':
            if (i >= count - 1) return true; // stay on the last row
            go(i + 1);
            return true;
          case 'channelUp':
            go(i - visible);
            return true;
          case 'channelDown':
            go(i + visible);
            return true;
          case 'ok': {
            const item = p.items[i];
            if (item !== undefined && p.onSelect) p.onSelect(item, i);
            return true;
          }
          default:
            return false;
        }
      }),
    [],
  );

  if (!total) {
    return (
      <div class="vlist" ref={ref} style={`height:${props.height}px`}>
        {props.empty}
      </div>
    );
  }

  const first = Math.max(0, start - BUFFER);
  const last = Math.min(total, start + visible + BUFFER);
  const rows: ComponentChildren[] = [];
  for (let i = first; i < last; i++) {
    const item = props.items[i]!;
    rows.push(
      <div
        key={i}
        class={'vrow' + (i === index ? ' current' : '') + (i === index && hasFocus ? ' focused' : '')}
        style={`top:${(i - start) * props.rowHeight}px;height:${props.rowHeight - 10}px`}
        onMouseOver={() => go(i)}
        onClick={() => props.onSelect && props.onSelect(item, i)}
      >
        {props.renderRow(item, i, i === index, i === index && hasFocus)}
      </div>,
    );
  }
  return (
    <div
      class="vlist"
      ref={ref}
      data-focusable
      data-focus-id={focusId}
      style={`height:${props.height}px`}
      role="listbox"
      aria-activedescendant={`${focusId}:${index}`}
    >
      {rows}
      {total > visible ? (
        <div class="vlist-scroll">
          <i style={`top:${(start / total) * 100}%;height:${Math.max(4, (visible / total) * 100)}%`} />
        </div>
      ) : null}
    </div>
  );
}
