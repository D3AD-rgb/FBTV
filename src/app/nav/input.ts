/**
 * Global key dispatcher. Screen-level handlers (e.g. the player) get first refusal,
 * then directions go to the focus engine, OK activates, and Back goes to the router.
 */
import { toAction, isDirection, type KeyAction } from '../platform/keys.ts';
import type { FocusEngine } from '../focus/engine.ts';
import { back } from './router.ts';

export type KeyHandler = (a: KeyAction, e: KeyboardEvent) => boolean;

const handlers: KeyHandler[] = [];

/** Registers a handler on top of the stack; returns an unregister function. */
export function pushKeyHandler(h: KeyHandler): () => void {
  handlers.push(h);
  return () => {
    const i = handlers.lastIndexOf(h);
    if (i >= 0) handlers.splice(i, 1);
  };
}

/** Minimum interval between repeated direction moves while a key is held. */
export const REPEAT_INTERVAL_MS = 90;

export function isTextInput(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

export interface InputDeps {
  engine: FocusEngine;
  root: HTMLElement;
  onExit: () => void;
  now?: () => number;
}

export function installInput(deps: InputDeps): () => void {
  const now = deps.now || (() => Date.now());
  let lastMove = 0;

  const onKey = (e: KeyboardEvent) => {
    const a = toAction(e);
    if (!a) return;

    const active = document.activeElement;
    if (isTextInput(active)) {
      // Let the field (and the webOS virtual keyboard) handle typing and caret movement.
      const leaves = a.action === 'up' || a.action === 'down' || (a.action === 'back' && e.keyCode !== 8);
      if (!leaves) return;
      active.blur();
    }

    if (isDirection(a.action)) {
      const t = now();
      if (e.repeat && t - lastMove < REPEAT_INTERVAL_MS) {
        e.preventDefault();
        return;
      }
      lastMove = t;
    }
    e.preventDefault();

    for (let i = handlers.length - 1; i >= 0; i--) {
      if (handlers[i]!(a, e)) return;
    }

    if (isDirection(a.action)) deps.engine.move(a.action);
    else if (a.action === 'ok') deps.engine.select();
    else if (a.action === 'back') {
      if (back() === 'exit') deps.onExit();
    }
  };

  // Magic Remote / mouse: hovering a focusable focuses it; clicks reach onClick natively.
  const onOver = (e: MouseEvent) => {
    const target = e.target as Element | null;
    const el = target && target.closest ? (target.closest('[data-focusable]') as HTMLElement | null) : null;
    if (el && deps.engine.scope().contains(el)) deps.engine.focus(el, { scroll: false });
  };

  document.addEventListener('keydown', onKey, true);
  deps.root.addEventListener('mouseover', onOver);
  return () => {
    document.removeEventListener('keydown', onKey, true);
    deps.root.removeEventListener('mouseover', onOver);
  };
}
