/** Loads a vendor script (classic, from the app package) once. Works under file://. */
const cache = new Map<string, Promise<void>>();

export function loadScript(src: string, timeoutMs = 15000): Promise<void> {
  const existing = cache.get(src);
  if (existing) return existing;
  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    const timer = setTimeout(() => reject(new Error(`Timed out loading ${src}`)), timeoutMs);
    el.src = src;
    el.async = true;
    el.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    el.onerror = () => {
      clearTimeout(timer);
      cache.delete(src);
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(el);
  });
  cache.set(src, p);
  return p;
}
