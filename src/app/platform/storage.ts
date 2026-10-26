/**
 * Small, versioned localStorage wrapper for user preferences, favourites and history.
 * Every access is guarded: storage can be unavailable or full on TVs.
 */
const PREFIX = 'fbtv:';

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw) as { v: number; data: T };
    return parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON<T>(key: string, data: T): boolean {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify({ v: 1, data }));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable */
  }
}

export function clearAll(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.indexOf(PREFIX) === 0) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
}
