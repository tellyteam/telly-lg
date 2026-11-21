// How quickly telly answers the remote on a real TV: presses keys through the TV's web inspector,
// records Chromium's timeline, and reports per press how long the page's main thread was busy and how
// much drawing (raster) it caused. Fails when a scenario is over budget, so a slow change shows up
// before a release. SPEED.md says how to connect to each TV and what the numbers mean.
//
//   node scripts/tv-speed.mjs --inspector http://127.0.0.1:9333       (Samsung, after `sdb forward`)
//   node scripts/tv-speed.mjs --inspector http://192.168.1.170:9998   (LG, while `ares-inspect` runs)
//   … --only rows,menu     just those scenarios
//   … --baseline scripts/speed/samsung-qe32ls03c.json   fail if anything is over 25% slower than it
//   … --record scripts/speed/samsung-qe32ls03c.json     save this run as that TV's baseline
//   … --save /tmp/trace    also writes each scenario's raw trace, to open in Chrome's Performance panel
//
// It moves around the app (Home, Live TV, Films) but plays nothing and changes no settings.

const args = Object.fromEntries(process.argv.slice(2).join(" ").split(/\s*--/).filter(Boolean).map((a) => {
  const [k, ...v] = a.split(/\s+/);
  return [k, v.join(" ") || "true"];
}));
const inspector = (args.inspector ?? "http://127.0.0.1:9333").replace(/\/$/, "");
// Without a baseline: a flat budget of main-thread time per press.
const budget = Number(args.budget ?? 100);
/** How much slower than its baseline a scenario may get before the run fails. */
const SLACK = 1.25;
const fs = await import("node:fs");
const baseline = args.baseline ? JSON.parse(fs.readFileSync(args.baseline, "utf8")) : null;
const only = args.only?.split(",");

const pages = await (await fetch(`${inspector}/json`)).json().catch(() => null);
const page = pages?.find((p) => p.type === "page" && /telly/i.test(p.title));
if (!page) {
  console.error(`No telly page at ${inspector}/json. Is telly open on the TV with its inspector linked? See SPEED.md.`);
  process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0, done;
const pending = new Map(), events = [];
const call = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.method === "Tracing.dataCollected") events.push(...d.params.value);
  else if (d.method === "Tracing.tracingComplete") done?.();
  else if (d.id) { pending.get(d.id)?.(d); pending.delete(d.id); }
};
await new Promise((r) => (ws.onopen = r));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => (await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const CODES = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
async function press(key) {
  const k = { key, code: key, windowsVirtualKeyCode: CODES[key], nativeVirtualKeyCode: CODES[key] };
  await call("Input.dispatchKeyEvent", { ...k, type: "rawKeyDown" });
  await call("Input.dispatchKeyEvent", { ...k, type: "keyUp" });
}
/** Opens a section from the side menu, as OK on it would. */
const open = (label) => evaluate(`(() => { const n = [...document.querySelectorAll('.rail .nav')].find((n) => n.textContent.includes(${JSON.stringify(label)})); n?.click(); return !!n; })()`);

/** Each scenario gets the page ready, then its presses are traced. */
const scenarios = [
  { name: "rows", what: "▶ along a row of posters on Home", keys: Array(7).fill("ArrowRight"), gap: 800,
    async setup() {
      await open("Home"); await sleep(2000);
      return evaluate(`(() => { const t = [...document.querySelectorAll('.row .track')].find((t) => t.querySelectorAll('.card').length >= 8);
        if (!t) return false; t.style.transform = ''; t.dataset.x = '0'; t.querySelector('.card').focus(); return true; })()`);
    } },
  { name: "rows-down", what: "▼ from row to row on Home", keys: Array(3).fill("ArrowDown"), gap: 900,
    async setup() { return evaluate(`(() => { const b = document.querySelector('.hero .btn'); b?.focus(); return !!b; })()`); } },
  { name: "menu", what: "◀ opens the side menu, ▶ closes it", keys: ["ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight"], gap: 1200,
    async setup() { return evaluate(`(() => { const b = document.querySelector('.hero .btn'); b?.focus(); return !!b; })()`); } },
  { name: "live", what: "▼ down Live TV's channel list", keys: Array(8).fill("ArrowDown"), gap: 700,
    async setup() {
      await open("Live TV"); await sleep(3000);
      return evaluate(`(() => { const c = document.querySelector('.ch'); c?.focus(); return !!c; })()`);
    } },
  { name: "films", what: "▼ through Films' category rows", keys: Array(4).fill("ArrowDown"), gap: 900,
    async setup() {
      await open("Films"); await sleep(3000);
      return evaluate(`(() => { const c = document.querySelector('.screen .track .card'); c?.focus(); return !!c; })()`);
    } },
  { name: "chips", what: "▶ along Films' category chips", keys: Array(6).fill("ArrowRight"), gap: 800,
    async setup() { return evaluate(`(() => { const c = document.querySelector('.chips .chip, .chips button'); c?.focus(); return !!c; })()`); } },
];

const CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "toplevel", "v8.execute"];

/** Main-thread time, drawing and full-screen repaints for each press. */
function measure(ev) {
  const keydowns = ev.filter((e) => e.name === "EventDispatch" && e.args?.data?.type === "keydown").sort((a, b) => a.ts - b.ts);
  if (!keydowns.length) return null;
  const { pid, tid } = keydowns[0];
  // Top-level tasks only: Chromium nests a RunTask inside ThreadControllerImpl::RunTask.
  const outer = ev.some((e) => e.name === "ThreadControllerImpl::RunTask") ? "ThreadControllerImpl::RunTask" : "RunTask";
  const tasks = ev.filter((e) => e.pid === pid && e.tid === tid && e.ph === "X" && e.name === outer);
  const raster = ev.filter((e) => e.name === "RasterTask" && e.ph === "X");
  // Repainted area: what has to be redrawn (and then rastered) because of the press.
  const paints = ev.filter((e) => e.name === "Paint" && e.args?.data?.clip && Math.abs(e.args.data.clip[0]) < 1e6);
  return keydowns.map((k, i) => {
    const end = keydowns[i + 1]?.ts ?? k.ts + 1.2e6;
    const within = (e) => e.ts >= k.ts && e.ts < end;
    const t = tasks.filter(within);
    return {
      main: sum(t) / 1000,
      longest: Math.max(0, ...t.map((e) => e.dur)) / 1000,
      raster: sum(raster.filter(within)) / 1000,
      repainted: paints.filter(within).reduce((n, e) => n + area(e.args.data.clip), 0) / 1e6,
    };
  });
}
const sum = (list) => list.reduce((n, e) => n + (e.dur ?? 0), 0);
const area = (q) => Math.abs((q[2] - q[0]) * (q[5] - q[3]));
const avg = (rows, k) => rows.reduce((n, r) => n + r[k], 0) / rows.length;

const results = [];
for (const s of scenarios.filter((s) => !only || only.includes(s.name))) {
  if (!(await s.setup())) { console.log(`${s.name.padEnd(10)} skipped: nothing to try it on (no provider, or an empty list)`); continue; }
  await sleep(1500);
  events.length = 0;
  await call("Tracing.start", { transferMode: "ReportEvents", traceConfig: { includedCategories: CATEGORIES } });
  for (const k of s.keys) { await press(k); await sleep(s.gap); }
  const finished = new Promise((r) => (done = r));
  await call("Tracing.end");
  await finished;
  if (args.save) fs.writeFileSync(`${args.save}-${s.name}.json`, JSON.stringify(events));
  const rows = measure(events);
  if (!rows) { console.log(`${s.name.padEnd(10)} no key presses were recorded`); continue; }
  const r = { name: s.name, what: s.what, main: avg(rows, "main"), longest: Math.max(...rows.map((x) => x.longest)), raster: avg(rows, "raster"), repainted: avg(rows, "repainted") };
  results.push(r);
}
await open("Home");
ws.close();

const limit = (r) => (baseline?.scenarios?.[r.name] ? baseline.scenarios[r.name].main * SLACK : budget);
console.log(`\n${"scenario".padEnd(10)} ${"main ms/press".padStart(14)} ${"limit".padStart(6)} ${"longest task".padStart(13)} ${"raster ms/press".padStart(16)} ${"repainted Mpx".padStart(14)}`);
for (const r of results) {
  const over = r.main > limit(r) ? "  TOO SLOW" : "";
  console.log(`${r.name.padEnd(10)} ${r.main.toFixed(0).padStart(14)} ${limit(r).toFixed(0).padStart(6)} ${r.longest.toFixed(0).padStart(13)} ${r.raster.toFixed(0).padStart(16)} ${r.repainted.toFixed(2).padStart(14)}  ${r.what}${over}`);
}
if (args.record) {
  const ua = page.title;
  fs.mkdirSync((await import("node:path")).dirname(args.record), { recursive: true });
  fs.writeFileSync(args.record, JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), page: ua, scenarios: Object.fromEntries(results.map((r) => [r.name, { main: Math.round(r.main), raster: Math.round(r.raster) }])) }, null, 2) + "\n");
  console.log(`\nSaved as the baseline in ${args.record}.`);
  process.exit(0);
}
const failed = results.filter((r) => r.main > limit(r));
const against = baseline ? `its baseline (${args.baseline}) by more than ${Math.round((SLACK - 1) * 100)}%` : `the ${budget} ms budget`;
if (failed.length) { console.log(`\n${failed.map((r) => r.name).join(", ")}: slower than ${against}.`); process.exit(1); }
console.log(`\nNothing slower than ${against}.`);
process.exit(0);
