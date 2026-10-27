/**
 * Small fallbacks for older LG TVs, for what telly and Svelte use: webOS 5 (2020) runs Chromium 68
 * and webOS 6 (2021) Chromium 79. The build lowers newer syntax for Chromium 68 (vite.config.ts).
 */

// Chromium 71. First: the fallbacks below, and Svelte, use it. (`self`: the lists' worker loads these too.)
if (typeof globalThis === "undefined") (self as unknown as { globalThis: typeof self }).globalThis = self;

function define(target: object, name: string, value: unknown) {
  if (!(name in target)) Object.defineProperty(target, name, { configurable: true, writable: true, value });
}

// Chromium 73.
define(Object, "fromEntries", (entries: Iterable<readonly [PropertyKey, unknown]>) => {
  const o: Record<PropertyKey, unknown> = {};
  for (const [k, v] of entries) o[k] = v;
  return o;
});
define(String.prototype, "matchAll", function* (this: string, re: RegExp) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (let m; (m = g.exec(this)); ) {
    yield m;
    if (m[0] === "") g.lastIndex++;
  }
});
// Chromium 69.
// In place, not by concat: catalogues flatten tens of thousands of items, and copying each step took seconds.
define(Array.prototype, "flat", function (this: unknown[], depth = 1): unknown[] {
  const out: unknown[] = [];
  const add = (list: unknown[], d: number) => {
    for (const v of list) {
      if (Array.isArray(v) && d > 0) add(v, d - 1);
      else out.push(v);
    }
  };
  add(this, depth);
  return out;
});
define(Array.prototype, "flatMap", function (this: unknown[], fn: (v: unknown, i: number, a: unknown[]) => unknown, self?: unknown) {
  return this.map(fn, self).flat();
});
// Chromium 71 and 76.
define(globalThis, "queueMicrotask", (fn: () => void) => void Promise.resolve().then(fn));
define(Promise, "allSettled", (all: Iterable<unknown>) =>
  Promise.all(Array.from(all, (p) => Promise.resolve(p).then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason }),
  ))));


if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, "at", {
    configurable: true, writable: true,
    value(this: unknown[], i: number) { const n = Math.trunc(i) || 0; return this[n < 0 ? this.length + n : n]; },
  });
}
if (!String.prototype.replaceAll) {
  Object.defineProperty(String.prototype, "replaceAll", {
    configurable: true, writable: true,
    value(this: string, find: string | RegExp, by: string) {
      return find instanceof RegExp ? this.replace(find, by) : this.split(find).join(by);
    },
  });
}
if (!Object.hasOwn) {
  Object.defineProperty(Object, "hasOwn", {
    configurable: true, writable: true,
    value: (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k),
  });
}
for (const name of ["findLast", "findLastIndex"] as const) {
  if (!(Array.prototype as unknown as Record<string, unknown>)[name]) {
    Object.defineProperty(Array.prototype, name, {
      configurable: true, writable: true,
      value(this: unknown[], fn: (v: unknown, i: number, a: unknown[]) => boolean) {
        for (let i = this.length - 1; i >= 0; i--) if (fn(this[i], i, this)) return name === "findLast" ? this[i] : i;
        return name === "findLast" ? undefined : -1;
      },
    });
  }
}
if (typeof globalThis.structuredClone !== "function") {
  (globalThis as { structuredClone?: unknown }).structuredClone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
}
