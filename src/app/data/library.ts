/**
 * The viewer's own data on this TV: favourites (ordered), recently watched, preferences.
 * Small, so it lives in localStorage; everything is guarded by the storage wrapper.
 */
import { signal } from '@preact/signals';
import { readJSON, writeJSON } from '../platform/storage.ts';

export interface RecentEntry {
  id: string;
  at: number;
}

export interface Preferences {
  /** iptv-org country code used for "home" collections and numbering. */
  homeCountry: string;
  /** Preferred audio/content languages (ISO 639-3), in order. */
  languages: string[];
  /** Start previewing the focused channel in the Live deck after a short pause. */
  previewOnFocus: boolean;
  /** Swap Up/Down channel direction in the player. */
  reverseChannelKeys: boolean;
}

const DEFAULT_PREFS: Preferences = {
  homeCountry: 'UK',
  languages: ['eng'],
  previewOnFocus: true,
  reverseChannelKeys: false,
};

const RECENT_LIMIT = 40;

export const favourites = signal<string[]>(readJSON<string[]>('favourites', []));
export const recents = signal<RecentEntry[]>(readJSON<RecentEntry[]>('recents', []));
export const prefs = signal<Preferences>({ ...DEFAULT_PREFS, ...readJSON<Partial<Preferences>>('prefs', {}) });

export function isFavourite(id: string): boolean {
  return favourites.value.indexOf(id) >= 0;
}

/** Adds or removes a favourite; returns the new state. */
export function toggleFavourite(id: string): boolean {
  const list = favourites.value;
  const next = list.indexOf(id) >= 0 ? list.filter((x) => x !== id) : list.concat([id]);
  favourites.value = next;
  writeJSON('favourites', next);
  return next.indexOf(id) >= 0;
}

export function moveFavourite(id: string, delta: number): void {
  const list = favourites.value.slice();
  const i = list.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  list.splice(i, 1);
  list.splice(j, 0, id);
  favourites.value = list;
  writeJSON('favourites', list);
}

export function recordWatched(id: string, now = Date.now()): void {
  const next = [{ id, at: now }].concat(recents.value.filter((r) => r.id !== id)).slice(0, RECENT_LIMIT);
  recents.value = next;
  writeJSON('recents', next);
}

export function clearRecents(): void {
  recents.value = [];
  writeJSON('recents', []);
}

export function setPrefs(patch: Partial<Preferences>): void {
  const next = { ...prefs.value, ...patch };
  prefs.value = next;
  writeJSON('prefs', next);
}

/** Test helper: re-reads everything from storage. */
export function reloadLibrary(): void {
  favourites.value = readJSON<string[]>('favourites', []);
  recents.value = readJSON<RecentEntry[]>('recents', []);
  prefs.value = { ...DEFAULT_PREFS, ...readJSON<Partial<Preferences>>('prefs', {}) };
}
