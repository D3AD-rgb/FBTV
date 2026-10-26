import { signal } from '@preact/signals';
import { FocusEngine } from './engine.ts';

/** data-focus-id of the focused element; read it only in panels that react to focus. */
export const focusedId = signal<string | null>(null);

let engine: FocusEngine | null = null;

export function initFocus(root: HTMLElement): FocusEngine {
  engine = new FocusEngine({
    root,
    onChange: (_el, id) => {
      focusedId.value = id;
    },
  });
  return engine;
}

export function getEngine(): FocusEngine {
  if (!engine) throw new Error('Focus engine not initialised');
  return engine;
}

/** Re-checks focus after the DOM changed (call from effects after route/overlay changes). */
export function syncFocus(): void {
  if (engine) engine.sync();
}
