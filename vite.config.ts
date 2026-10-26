import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { devRelay } from "./dev/relay";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

/**
 * LG TVs load the app from local files, where module scripts don't run: the TV build is one
 * classic script, with relative paths.
 */
function classicScript(): Plugin {
  return {
    name: "telly-classic-script",
    enforce: "post",
    transformIndexHtml: (html) => html.replace(/<script type="module" crossorigin/g, "<script defer").replace(/ crossorigin/g, ""),
  };
}

/**
 * Chromium 79 (webOS 6) ignores `gap` in flex layouts, which arrived in Chromium 84. For the TV
 * build, each flex rule's gap also becomes a margin between its children. (Grid gaps work.)
 */
interface CssRule {
  selectors: string[];
  nodes: { type: string; prop?: string; value?: string }[];
  cloneAfter(overrides: { selectors: string[]; nodes: [] }): CssRule;
  append(decl: { prop: string; value: string }): CssRule;
}

/**
 * Svelte scopes nested selectors as `.a .b:where(.svelte-x)`, and TVs before Chromium 88 drop any
 * rule with :where(). For the TV build it becomes a plain class (a little more specific, the same match).
 */
const unwrapWhere = {
  postcssPlugin: "telly-unwrap-where",
  Rule(rule: { selector: string }) {
    if (rule.selector.includes(":where(")) rule.selector = rule.selector.replace(/:where\((\.svelte-[\w-]+)\)/g, "$1");
  },
};

/**
 * CSS min(), max() and clamp() need Chromium 79 (webOS 5 runs 68): each such value gets a plain
 * fallback before it, which older TVs use and newer ones override. The fallback is the function's
 * first fixed (px) argument, or for clamp() its preferred value when that's fixed.
 */
const MATH = /(?<![\w-])(min|max|clamp)\(([^()]*)\)/;
function mathFallback(value: string): string {
  let v = value;
  for (let m = v.match(MATH); m; m = v.match(MATH)) {
    const args = m[2].split(",").map((a) => a.trim());
    const fixed = args.filter((a) => /^-?[\d.]+px$/.test(a));
    const pick = m[1] === "clamp" && fixed.includes(args[1]) ? args[1] : fixed[0] ?? args[0];
    v = v.replace(m[0], pick);
  }
  return v;
}
const mathFallbacks = {
  postcssPlugin: "telly-math-fallbacks",
  Declaration(decl: { prop: string; value: string; cloneBefore(o: object): unknown; prev(): { type?: string; prop?: string } | undefined }) {
    if (!MATH.test(decl.value)) return;
    const before = decl.prev();
    if (before?.type === "decl" && before.prop === decl.prop) return; // already has one
    decl.cloneBefore({ value: mathFallback(decl.value) });
  },
};

/** Fails the TV build on CSS webOS 5 (Chromium 68) can't read, so it can't creep back in. */
const tvCheck = {
  postcssPlugin: "telly-tv-check",
  Rule(rule: { selector: string }) {
    const bad = rule.selector.match(/:(is|where|has)\(/);
    if (bad) throw new Error(`CSS for older TVs: "${rule.selector}" uses :${bad[1]}(), which Chromium 68 drops`);
  },
  Declaration(decl: { prop: string; value: string }) {
    if (decl.prop === "aspect-ratio" || /mask-composite/.test(decl.prop)) {
      throw new Error(`CSS for older TVs: ${decl.prop} doesn't work on Chromium 68; size it, or use one mask layer`);
    }
  },
};

const flexGap = {
  postcssPlugin: "telly-flex-gap",
  Rule(rule: CssRule) {
    const decl = (prop: string) => rule.nodes.find((n) => n.type === "decl" && n.prop === prop)?.value;
    const gap = decl("gap");
    if (!gap || decl("display")?.includes("grid")) return;
    const [row, col = row] = gap.split(/\s+/);
    const add = (children: string, prop: string, value: string) =>
      rule.cloneAfter({ selectors: rule.selectors.map((s) => `${s} > ${children}`), nodes: [] }).append({ prop, value });
    if (decl("flex-direction")?.startsWith("column")) return void add("* + *", "margin-top", row);
    if (decl("flex-wrap") === "wrap") add("*", "margin-bottom", row);
    add("* + *", "margin-left", col);
  },
};

export default defineConfig(({ mode }) => mode === "webos" ? {
  plugins: [svelte(), classicScript()],
  css: { postcss: { plugins: [unwrapWhere, mathFallbacks, flexGap, tvCheck] } },
  define: { __APP_VERSION__: JSON.stringify(version) },
  base: "./",
  build: {
    outDir: "dist-webos",
    // webOS 5 (2020 TVs) runs Chromium 68, webOS 6 (2021) Chromium 79. Newer APIs: lib/polyfills.ts.
    target: ["chrome68"],
    modulePreload: false,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { output: { format: "iife", inlineDynamicImports: true } },
  },
} : {
  // `npm run dev`: the app in a browser, with a relay for providers' cross-origin answers.
  plugins: [svelte(), devRelay()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { port: 5173, strictPort: true },
});
