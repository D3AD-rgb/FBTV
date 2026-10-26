/**
 * Minimal polyfills for older webOS web engines (webOS 4.x = Chromium 53).
 * Only APIs the app actually uses are covered; syntax is lowered by the build.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const O = Object as any;
if (!O.entries) {
  O.entries = (o: Record<string, unknown>) => Object.keys(o).map((k) => [k, o[k]]);
}
if (!O.values) {
  O.values = (o: Record<string, unknown>) => Object.keys(o).map((k) => o[k]);
}
if (!O.fromEntries) {
  O.fromEntries = (pairs: Iterable<[string, unknown]>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Array.from(pairs)) out[k] = v;
    return out;
  };
}
const AP = Array.prototype as any;
if (!AP.flat) {
  AP.flat = function flat(this: unknown[], depth = 1): unknown[] {
    return depth > 0
      ? this.reduce<unknown[]>((acc, v) => acc.concat(Array.isArray(v) ? (v as any).flat(depth - 1) : [v]), [])
      : this.slice();
  };
}
if (!AP.flatMap) {
  AP.flatMap = function flatMap(this: unknown[], fn: (v: unknown, i: number) => unknown) {
    return this.map(fn).flat();
  };
}
const SP = String.prototype as any;
if (!SP.padStart) {
  SP.padStart = function padStart(this: string, len: number, fill = ' ') {
    let s = String(this);
    while (s.length < len) s = fill + s;
    return s.slice(s.length - Math.max(len, this.length));
  };
}
const PP = Promise.prototype as any;
if (!PP.finally) {
  PP.finally = function fin(this: Promise<unknown>, cb: () => void) {
    return this.then(
      (v) => {
        cb();
        return v;
      },
      (e) => {
        cb();
        throw e;
      },
    );
  };
}
export {};
