/**
 * DOM spatial-navigation engine for TV remotes.
 *
 * Markup contract (all attributes are plain data-* so components stay simple):
 *  - data-focusable          element can receive focus (gets a `data-focused` attribute;
 *                            an attribute, not a class, so re-renders never wipe it)
 *  - data-focus-container    search for candidates inside this container first
 *                            (scroll viewports are containers automatically)
 *  - data-focus-id="…"       stable id, used to restore focus when returning to a screen
 *  - data-focus-default      preferred first focus inside a scope
 *  - data-focus-up|down|left|right="selector|none"   explicit override / block
 *  - data-focus-group        groups children; with data-focus-memory, re-entering the
 *                            group restores its last focused child
 *  - data-focus-enter="selector"        entering the group from outside focuses this child
 *  - data-focus-boundary="left right"   focus may not leave the group in those directions
 *  - data-focus-trap         overlays/dialogs: navigation stays inside the last open trap
 *  - data-scroll="x|y" on a viewport whose first child carries data-scroll-track;
 *    data-scroll-align="start|nearest", data-scroll-pad="px"
 *  - data-scroll-anchor="pad" on a container: scroll to the container rather than the item
 *
 * Geometry uses layout offsets (not getBoundingClientRect), with scroll tracks' target
 * translation subtracted, so results are stable while CSS transitions are running.
 *
 * Adapted in spirit from the MIT-licensed iptvnator TV prototype (libs/tv/ui/src/focus.ts);
 * see THIRD_PARTY.md.
 */
import { pickCandidate, scrollOffsetFor, type Candidate, type Direction, type Rect } from './geometry.ts';

export type Measure = (el: HTMLElement) => Rect;

const FOCUSABLE = '[data-focusable]';
const FOCUSED_ATTR = 'data-focused';
const CONTAINER = '[data-scroll],[data-focus-container]';

const num = (v: string | undefined): number => (v ? Number(v) || 0 : 0);

/** Element position in app coordinates, ignoring in-flight transitions. */
export function layoutRect(el: HTMLElement): Rect {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node) {
    x += node.offsetLeft - num(node.dataset.tx);
    y += node.offsetTop - num(node.dataset.ty);
    node = node.offsetParent as HTMLElement | null;
  }
  return { left: x, top: y, width: el.offsetWidth, height: el.offsetHeight };
}

function offsetWithin(el: HTMLElement, ancestor: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== ancestor) {
    x += node.offsetLeft - num(node.dataset.tx);
    y += node.offsetTop - num(node.dataset.ty);
    node = node.offsetParent as HTMLElement | null;
  }
  if (node === ancestor) return { x, y };
  // Track was not an offsetParent; fall back to the difference of layout rects.
  const a = layoutRect(el);
  const b = layoutRect(ancestor);
  return { x: a.left - b.left + num(ancestor.dataset.tx), y: a.top - b.top + num(ancestor.dataset.ty) };
}

export interface FocusEngineOptions {
  root: HTMLElement;
  measure?: Measure;
  /** Called after focus changes (id = data-focus-id of the new element). */
  onChange?: (el: HTMLElement | null, id: string | null) => void;
}

export class FocusEngine {
  private current: HTMLElement | null = null;
  private readonly memory = new WeakMap<HTMLElement, HTMLElement>();
  private readonly root: HTMLElement;
  private readonly measure: Measure;
  private readonly onChange?: (el: HTMLElement | null, id: string | null) => void;

  constructor(opts: FocusEngineOptions) {
    this.root = opts.root;
    this.measure = opts.measure || layoutRect;
    this.onChange = opts.onChange;
  }

  get focused(): HTMLElement | null {
    return this.current && this.current.isConnected ? this.current : null;
  }

  /** The active navigation scope: the last open focus trap, or the app root. */
  scope(): HTMLElement {
    const traps = this.root.querySelectorAll<HTMLElement>('[data-focus-trap]');
    for (let i = traps.length - 1; i >= 0; i--) {
      const t = traps[i]!;
      if (this.isVisible(t)) return t;
    }
    return this.root;
  }

  isVisible(el: HTMLElement): boolean {
    if (el.closest('[hidden],[aria-hidden="true"],[data-focus-skip]')) return false;
    const r = this.measure(el);
    return r.width > 0 && r.height > 0;
  }

  focusables(scope: HTMLElement = this.scope()): HTMLElement[] {
    const out: HTMLElement[] = [];
    scope.querySelectorAll<HTMLElement>(FOCUSABLE).forEach((el) => {
      if (this.isVisible(el)) out.push(el);
    });
    return out;
  }

  focus(el: HTMLElement | null, opts: { scroll?: boolean } = {}): void {
    if (!el) return;
    if (el === this.current) {
      if (opts.scroll !== false) this.ensureVisible(el);
      return;
    }
    if (this.current) this.current.removeAttribute(FOCUSED_ATTR);
    el.setAttribute(FOCUSED_ATTR, '');
    this.current = el;
    // Remember this element in every memory group it belongs to.
    let g: HTMLElement | null = el.parentElement ? el.parentElement.closest<HTMLElement>('[data-focus-memory]') : null;
    while (g && this.root.contains(g)) {
      this.memory.set(g, el);
      g = g.parentElement ? g.parentElement.closest<HTMLElement>('[data-focus-memory]') : null;
    }
    if (opts.scroll !== false) this.ensureVisible(el);
    if (this.onChange) this.onChange(el, el.dataset.focusId || null);
  }

  blur(): void {
    if (this.current) this.current.removeAttribute(FOCUSED_ATTR);
    this.current = null;
    if (this.onChange) this.onChange(null, null);
  }

  /** Focuses the scope's default element, else its first focusable. */
  focusFirst(scope: HTMLElement = this.scope()): boolean {
    const list = this.focusables(scope);
    const preferred = list.filter((el) => el.hasAttribute('data-focus-default'))[0] || list[0];
    if (!preferred) return false;
    this.focus(preferred);
    return true;
  }

  /** Restores focus by data-focus-id (e.g. when returning to a screen). */
  restore(id: string | null | undefined): boolean {
    if (id) {
      const scope = this.scope();
      const list = this.focusables(scope);
      for (const el of list) {
        if (el.dataset.focusId === id) {
          this.focus(el);
          return true;
        }
      }
    }
    return this.focusFirst();
  }

  /** Re-validates focus after a re-render: keeps it if still present, otherwise restores. */
  sync(): void {
    const cur = this.focused;
    const scope = this.scope();
    if (cur && scope.contains(cur) && this.isVisible(cur)) return;
    const id = this.current ? this.current.dataset.focusId : undefined;
    this.restore(id);
  }

  move(dir: Direction): boolean {
    const from = this.focused;
    const scope = this.scope();
    if (!from || !scope.contains(from) || !this.isVisible(from)) return this.focusFirst(scope);

    const override = from.dataset['focus' + dir.charAt(0).toUpperCase() + dir.slice(1)];
    if (override === 'none') return false;
    if (override) {
      const target = scope.querySelector<HTMLElement>(override);
      if (target && this.isVisible(target)) {
        this.focus(this.enterGroup(target, from));
        return true;
      }
    }

    // Search the innermost container first (row, then page, …), widening only when it has
    // nothing in that direction. Elements in one scroller share its translation, so they are
    // compared consistently; content scrolled behind the nav bar can't steal focus.
    const fromRect = this.measure(from);
    let container = this.containerOf(from, scope);
    let picked: HTMLElement | null = null;
    for (;;) {
      const candidates: Candidate<HTMLElement>[] = [];
      for (const el of this.focusables(container || scope)) {
        if (el !== from) candidates.push({ rect: this.measure(el), item: el });
      }
      picked = pickCandidate(fromRect, dir, candidates);
      if (picked || !container) break;
      container = this.containerOf(container, scope);
    }
    if (!picked) return false;
    if (this.crossesBoundary(from, picked, dir)) return false;
    this.focus(this.enterGroup(picked, from));
    return true;
  }

  /** Clicking activates components that handle onClick (works for remote OK and pointer). */
  select(): boolean {
    const el = this.focused;
    if (!el) return false;
    el.click();
    return true;
  }

  /** Nearest container strictly above `el` and inside the scope, or null for the scope itself. */
  private containerOf(el: HTMLElement, scope: HTMLElement): HTMLElement | null {
    const parent = el.parentElement;
    const c = parent ? parent.closest<HTMLElement>(CONTAINER) : null;
    return c && c !== scope && scope.contains(c) ? c : null;
  }

  private crossesBoundary(from: HTMLElement, to: HTMLElement, dir: Direction): boolean {
    let g: HTMLElement | null = from.closest<HTMLElement>('[data-focus-boundary]');
    while (g && this.root.contains(g)) {
      const dirs = (g.dataset.focusBoundary || '').split(/\s+/);
      if (dirs.indexOf(dir) >= 0 && !g.contains(to)) return true;
      g = g.parentElement ? g.parentElement.closest<HTMLElement>('[data-focus-boundary]') : null;
    }
    return false;
  }

  /**
   * When entering a group from outside: a `data-focus-enter="selector"` group focuses its
   * matching child (e.g. the nav bar's active tab); a memory group restores its last child.
   */
  private enterGroup(target: HTMLElement, from: HTMLElement): HTMLElement {
    const entry = target.closest<HTMLElement>('[data-focus-enter]');
    if (entry && !entry.contains(from) && this.root.contains(entry)) {
      const preferred = entry.querySelector<HTMLElement>(entry.dataset.focusEnter || '');
      if (preferred && preferred.hasAttribute('data-focusable') && this.isVisible(preferred)) return preferred;
    }
    let group = target.closest<HTMLElement>('[data-focus-memory]');
    let result = target;
    // Outermost group that `from` is not part of decides.
    while (group && this.root.contains(group)) {
      if (!group.contains(from)) {
        const remembered = this.memory.get(group);
        if (remembered && remembered.isConnected && group.contains(remembered) && this.isVisible(remembered)) {
          result = remembered;
        }
      }
      group = group.parentElement ? group.parentElement.closest<HTMLElement>('[data-focus-memory]') : null;
    }
    return result;
  }

  /** Moves scroll tracks so the element (or its scroll anchor) is inside every viewport. */
  ensureVisible(el: HTMLElement): void {
    let viewport: HTMLElement | null = el.closest<HTMLElement>('[data-scroll]');
    while (viewport && this.root.contains(viewport)) {
      const track = viewport.firstElementChild as HTMLElement | null;
      if (track && track.hasAttribute('data-scroll-track')) {
        const axis = viewport.dataset.scroll === 'x' ? 'x' : 'y';
        const align = viewport.dataset.scrollAlign === 'start' ? 'start' : 'nearest';
        let target: HTMLElement = el;
        let pad = num(viewport.dataset.scrollPad);
        const anchor = el.closest<HTMLElement>('[data-scroll-anchor]');
        if (anchor && track.contains(anchor) && anchor !== track) {
          target = anchor;
          if (anchor.dataset.scrollAnchor !== '') pad = num(anchor.dataset.scrollAnchor);
        }
        const pos = offsetWithin(target, track);
        const current = num(track.dataset[axis === 'x' ? 'tx' : 'ty']);
        const next =
          axis === 'x'
            ? scrollOffsetFor(pos.x, target.offsetWidth, viewport.clientWidth, track.scrollWidth, current, align, pad)
            : scrollOffsetFor(pos.y, target.offsetHeight, viewport.clientHeight, track.scrollHeight, current, align, pad);
        if (next !== current) {
          track.dataset[axis === 'x' ? 'tx' : 'ty'] = String(next);
          track.style.transform = axis === 'x' ? `translate3d(${-next}px,0,0)` : `translate3d(0,${-next}px,0)`;
        }
      }
      viewport = viewport.parentElement ? viewport.parentElement.closest<HTMLElement>('[data-scroll]') : null;
    }
  }
}
