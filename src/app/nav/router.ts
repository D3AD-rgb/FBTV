/**
 * Navigation state: top-level tab, a stack of detail pages, and a stack of overlays.
 * Back closes the top overlay, then the top page, then returns focus to the nav bar,
 * then goes to Home, and finally asks to exit.
 */
import { signal, computed } from '@preact/signals';
import type { ComponentChildren } from 'preact';

export type TabId = 'home' | 'live' | 'playlists' | 'football' | 'sports' | 'movies' | 'series' | 'kids' | 'search' | 'settings';

export const TABS: { id: TabId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'live', label: 'Live TV' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'football', label: 'Football' },
  { id: 'sports', label: 'Sports' },
  { id: 'movies', label: 'Movies' },
  { id: 'series', label: 'Series' },
  { id: 'kids', label: 'Kids' },
];

export interface PageEntry {
  /** Unique, stable key, e.g. "country:UK". Used for focus memory. */
  key: string;
  title: string;
  render: () => ComponentChildren;
}

export interface OverlayEntry {
  key: string;
  render: () => ComponentChildren;
  /** Return true to keep the overlay open (e.g. the overlay handled Back itself). */
  onBack?: () => boolean;
}

export const tab = signal<TabId>('home');
export const pages = signal<PageEntry[]>([]);
export const overlays = signal<OverlayEntry[]>([]);
export const exitPrompt = signal(false);

export const routeKey = computed(() => {
  const p = pages.value;
  const top = p[p.length - 1];
  return top ? `page:${top.key}` : `tab:${tab.value}`;
});

/** Focus ids remembered per route, restored when the route becomes active again. */
export const focusMemory = new Map<string, string>();

export interface RouterHooks {
  /** Current focus id, saved before a route change. */
  currentFocusId: () => string | null;
  /** True when focus is in the top navigation bar. */
  focusInNav: () => boolean;
  /** Moves focus to the active tab in the nav bar. */
  focusNav: () => void;
}

let hooks: RouterHooks = {
  currentFocusId: () => null,
  focusInNav: () => false,
  focusNav: () => undefined,
};

export function setRouterHooks(h: RouterHooks): void {
  hooks = h;
}

function saveFocus(): void {
  const id = hooks.currentFocusId();
  if (id) focusMemory.set(routeKey.value, id);
}

export function setTab(id: TabId): void {
  if (tab.value === id && !pages.value.length) return;
  saveFocus();
  pages.value = [];
  tab.value = id;
}

export function openPage(entry: PageEntry): void {
  saveFocus();
  pages.value = pages.value.concat([entry]);
}

export function closePage(): void {
  if (!pages.value.length) return;
  pages.value = pages.value.slice(0, -1);
}

export function openOverlay(entry: OverlayEntry): void {
  saveFocus();
  overlays.value = overlays.value.filter((o) => o.key !== entry.key).concat([entry]);
}

export function closeOverlay(key?: string): void {
  const list = overlays.value;
  if (!list.length) return;
  overlays.value = key ? list.filter((o) => o.key !== key) : list.slice(0, -1);
}

/** Handles the Back key. Returns 'exit' when the app should actually close. */
export function back(): 'handled' | 'exit' {
  if (exitPrompt.value) {
    exitPrompt.value = false;
    return 'handled';
  }
  const ov = overlays.value;
  const top = ov[ov.length - 1];
  if (top) {
    if (top.onBack && top.onBack()) return 'handled';
    closeOverlay();
    return 'handled';
  }
  if (pages.value.length) {
    closePage();
    return 'handled';
  }
  if (!hooks.focusInNav()) {
    saveFocus();
    hooks.focusNav();
    return 'handled';
  }
  if (tab.value !== 'home') {
    setTab('home');
    hooks.focusNav();
    return 'handled';
  }
  exitPrompt.value = true;
  return 'handled';
}

/** Test helper: resets all navigation state. */
export function resetRouter(): void {
  tab.value = 'home';
  pages.value = [];
  overlays.value = [];
  exitPrompt.value = false;
  focusMemory.clear();
}
