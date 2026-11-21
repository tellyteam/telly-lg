// An hour (or less) of telly on a Samsung TV, driven through its web inspector with the remote's own
// key codes: cold starts, remote-press speed (tv-speed.mjs, three times), a usability sweep of every
// screen (focus, Back, readability), live TV, a film and an episode (start time, stalls, seeking,
// tracks, pause, resume), and a long loop round the app watching memory. Everything goes in --out
// (log.jsonl, shots/, speed-*.txt, summary.json). SPEED.md says how to connect to the TV.
//
//   node scripts/tv-soak.mjs --tv TV_IP [--minutes 60] [--out DIR] [--mac TV_MAC]
//   … --phases "live TV,film,episode"   just those (cold starts, speed start, screen sweep, live TV,
//                                        speed after live, film, episode, endurance, speed end,
//                                        final cold start)
//   … --attach      use the telly already open on port 9333 rather than launching it
//   … --keep-open   leave telly open (and port 9333 forwarded) at the end
//   … --category "Free To Air"  the Live TV category to watch (not the provider's Info list)
//   … --live-ms 60000 --vod-ms 60000 --zaps 6
//
// It plays live TV, a film and an episode (with sound), so they appear in Continue watching. It needs
// telly installed from build-tizen/ (it reinstalls that .wgt to close telly when `debug` hangs). With
// --mac it wakes the TV with Wake-on-LAN when it's in standby (the TV's Power On with Mobile).

import dgram from "node:dgram";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  args[a.slice(2)] = next === undefined || next.startsWith("--") ? "true" : (i++, next);
}
if (!args.tv) {
  console.error("Which TV? node scripts/tv-soak.mjs --tv TV_IP (SPEED.md says how to connect to it)");
  process.exit(2);
}
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
const WGT = path.join(REPO, "build-tizen", `telly_${version}.wgt`);
const STUDIO = process.env.TIZEN_STUDIO ?? path.join(os.homedir(), "tizen-studio");
const SDB = path.join(STUDIO, "tools", "sdb");
const TIZEN = path.join(STUDIO, "tools", "ide", "bin", "tizen");
const TV_IP = args.tv, TV = `${TV_IP}:26101`, MAC = args.mac?.replace(/[:-]/g, "");
const OUT = args.out ?? path.join(os.tmpdir(), `tv-soak-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
const MINUTES = Number(args.minutes ?? 60);
const DRY = args.dry === "true";
const APP = "TellyTV001.telly";
const PORT = 9333;
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });

const T0 = Date.now();
const deadline = T0 + MINUTES * 60_000;
const left = () => deadline - Date.now();
const mins = () => ((Date.now() - T0) / 60_000).toFixed(1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logFile = fs.createWriteStream(path.join(OUT, "log.jsonl"), { flags: "a" });
function log(type, data = {}) {
  const rec = { t: new Date().toISOString(), min: Number(mins()), type, ...data };
  logFile.write(JSON.stringify(rec) + "\n");
  console.log(`[${mins().padStart(5)}m] ${type} ${JSON.stringify(data).slice(0, 300)}`);
}
const run = (cmd, args, timeout = 40_000) => new Promise((res) => execFile(cmd, args, { timeout }, (err, stdout, stderr) => res({ ok: !err, out: `${stdout}${stderr}` })));
const sdb = (...a) => run(SDB, ["-s", TV, ...a]);

// ---------- The TV and its inspector ----------

function wol() {
  if (!MAC) return;
  const pkt = Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(Buffer.from(MAC, "hex"))]);
  const sock = dgram.createSocket("udp4");
  sock.bind(() => {
    sock.setBroadcast(true);
    for (const a of ["255.255.255.255", TV_IP]) for (const p of [9, 7]) sock.send(pkt, p, a);
    setTimeout(() => sock.close(), 500);
  });
}

async function tvUp() {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const c = await run(SDB, ["connect", TV_IP], 15_000);
    const d = await run(SDB, ["devices"], 10_000);
    if (d.out.includes(TV) && /\bdevice\b/.test(d.out.split("\n").find((l) => l.includes(TV)) ?? "")) return true;
    log("tv-unreachable", { attempt, connect: c.out.trim().slice(0, 120) });
    wol();
    await sleep(15_000);
  }
  return false;
}

let ws, page, msgId = 0;
const pending = new Map();
const listeners = new Set();
let consoleErrors = [], netFails = [], exceptions = [];

/** (Re)launches telly in debug mode, forwards its inspector and connects. Returns ms the launch took. */
async function launch(reason) {
  try { ws?.close(); } catch {}
  ws = null;
  const t = Date.now();
  let r;
  // ATTACH=1: the first connection uses the telly already open on port 9333 instead of relaunching it.
  if (args.attach === "true" && !attached) { attached = true; return connect(reason, t, "attached"); }
  if (!(await tvUp())) throw new Error("TV unreachable after Wake-on-LAN");
  for (let i = 0; i < 3; i++) {
    r = await run(SDB, ["-s", TV, "shell", "0", "debug", APP], 30_000);
    if (/port:\s*\d+/.test(r.out)) break;
    // A debug launch can hang with telly stuck running; reinstalling closes it (and keeps its data).
    log("debug-launch-retry", { out: r.out.trim().slice(0, 200), reinstalling: true });
    const inst = await run(TIZEN, ["install", "-n", WGT, "-s", TV], 120_000);
    log("reinstalled", { ok: /successfully installed/.test(inst.out) });
    await sleep(2000);
  }
  const port = r.out.match(/port:\s*(\d+)/)?.[1];
  if (!port) throw new Error(`debug launch failed: ${r.out}`);
  await sdb("forward", "--remove-all");
  await sdb("forward", `tcp:${PORT}`, `tcp:${port}`);
  return connect(reason, t, port);
}
let attached = false;
async function connect(reason, t, port) {
  let pages;
  for (let i = 0; i < 20 && !pages?.length; i++) {
    pages = await fetch(`http://127.0.0.1:${PORT}/json`).then((x) => x.json()).catch(() => null);
    if (!pages?.length) await sleep(500);
  }
  page = pages?.find((p) => p.type === "page");
  if (!page) throw new Error("no page in inspector");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id) { pending.get(d.id)?.(d); pending.delete(d.id); return; }
    for (const l of listeners) l(d);
    if (d.method === "Runtime.exceptionThrown") exceptions.push({ min: Number(mins()), text: d.params.exceptionDetails?.exception?.description?.slice(0, 300) ?? d.params.exceptionDetails?.text });
    else if (d.method === "Runtime.consoleAPICalled" && (d.params.type === "error" || d.params.type === "warning")) consoleErrors.push({ min: Number(mins()), type: d.params.type, text: d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300) });
    else if (d.method === "Log.entryAdded" && d.params.entry.level === "error") consoleErrors.push({ min: Number(mins()), type: "log", text: `${d.params.entry.text} ${d.params.entry.url ?? ""}`.slice(0, 300) });
    else if (d.method === "Network.loadingFailed" && !d.params.canceled) netFails.push({ min: Number(mins()), err: d.params.errorText, id: d.params.requestId, url: reqUrls.get(d.params.requestId) });
    else if (d.method === "Network.requestWillBeSent") reqUrls.set(d.params.requestId, d.params.request.url.replace(/(password|username|token)=[^&]*/gi, "$1=…").slice(0, 160));
    else if (d.method === "Network.responseReceived" && d.params.response.status >= 400) netFails.push({ min: Number(mins()), status: d.params.response.status, url: d.params.response.url.replace(/(password|username|token)=[^&]*/gi, "$1=…").slice(0, 160) });
  };
  ws.onclose = () => { log("inspector-closed"); ws = null; };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(() => rej(new Error("ws timeout")), 10_000); });
  for (const d of ["Runtime.enable", "Log.enable", "Network.enable", "Performance.enable"]) await call(d);
  log("launched", { reason, ms: Date.now() - t, port });
  return Date.now() - t;
}
const reqUrls = new Map();

function call(method, params = {}, timeout = 15_000) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState !== 1) return resolve({ error: { message: "no inspector" } });
    const i = ++msgId;
    const timer = setTimeout(() => { pending.delete(i); resolve({ error: { message: `timeout ${method}` } }); }, timeout);
    pending.set(i, (d) => { clearTimeout(timer); resolve(d); });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
async function ev(expression, timeout) {
  const r = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeout);
  if (r.error) throw new Error(r.error.message);
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.slice(0, 200) ?? "eval exception");
  return r.result?.result?.value;
}
/** Is telly still there and answering? If not, note it and relaunch. */
async function healthy(where) {
  try { if ((await ev("1+1", 8000)) === 2) return true; } catch {}
  log("UNRESPONSIVE", { where });
  try { await launch(`recover after ${where}`); await sleep(8000); await installProbes(); return false; } catch (e) { log("relaunch-failed", { e: String(e) }); return false; }
}

// Remote keys as the TV sends them (keyCode is what tv.ts reads).
const KEYS = {
  ArrowLeft: [37, "ArrowLeft"], ArrowUp: [38, "ArrowUp"], ArrowRight: [39, "ArrowRight"], ArrowDown: [40, "ArrowDown"],
  Enter: [13, "Enter"], Back: [10009, "XF86Back"], ChUp: [427, "XF86RaiseChannel"], ChDown: [428, "XF86LowerChannel"],
  PlayPause: [10252, "MediaPlayPause"], FF: [417, "MediaFastForward"], RW: [412, "MediaRewind"],
};
async function press(name, gap = 0) {
  const [code, key] = KEYS[name];
  const k = { key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
  await call("Input.dispatchKeyEvent", name === "Enter" ? { ...k, type: "keyDown", text: "\r", unmodifiedText: "\r" } : { ...k, type: "rawKeyDown" });
  await call("Input.dispatchKeyEvent", { ...k, type: "keyUp" });
  if (gap) await sleep(gap);
}

/** In-page probes: key-to-frame latency for every press, long tasks, video events. */
async function installProbes() {
  await ev(`(() => {
    if (window.__soak) return;
    window.__soak = { lat: [], longTasks: [], video: [] };
    addEventListener('keydown', (e) => { if (!e.isTrusted) return; const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => __soak.lat.push(Math.round(performance.now() - t)))); }, true);
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) __soak.longTasks.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch {}
    for (const type of ['waiting','stalled','playing','error','seeked','seeking','loadstart','canplay']) document.addEventListener(type, (e) => { if (e.target.tagName === 'VIDEO') __soak.video.push([type, Math.round(performance.now()), e.target.currentTime]); }, true);
  })()`).catch((e) => log("probe-install-failed", { e: String(e) }));
}
async function drainProbes() {
  return ev(`(() => { const s = window.__soak; if (!s) return null; const r = { lat: s.lat.splice(0), longTasks: s.longTasks.splice(0), video: s.video.splice(0) }; return r; })()`).catch(() => null);
}
const latAll = [], longAll = [];
async function collect(phase) {
  const p = await drainProbes();
  if (!p) return;
  for (const l of p.lat) latAll.push({ phase, ms: l });
  for (const l of p.longTasks) longAll.push({ phase, ms: l });
  return p;
}

async function metrics() {
  await call("HeapProfiler.collectGarbage");
  const m = await call("Performance.getMetrics");
  const o = Object.fromEntries((m.result?.metrics ?? []).map((x) => [x.name, x.value]));
  return { heapMB: +(o.JSHeapUsedSize / 1e6).toFixed(1), totalMB: +(o.JSHeapTotalSize / 1e6).toFixed(1), nodes: o.Nodes, listeners: o.JSEventListeners, docs: o.Documents, layoutObjects: o.LayoutObjects };
}
let shotN = 0;
async function shot(name) {
  const s = await call("Page.captureScreenshot", { format: "jpeg", quality: 55 }, 20_000);
  if (s.result?.data) { const f = `${String(++shotN).padStart(3, "0")}-${name}.jpg`; fs.writeFileSync(path.join(OUT, "shots", f), Buffer.from(s.result.data, "base64")); return f; }
  return null;
}
const route = () => ev(`(() => { const c = document.querySelector('.rail .nav.current'); return { section: c?.textContent.replace(/⌘.*/, '').trim() ?? null, player: !!document.querySelector('.player'), detail: !!document.querySelector('.detail-hero'), title: document.querySelector('.title-xl')?.textContent ?? null }; })()`).catch(() => null);
const openSection = (label) => ev(`(() => { const n = [...document.querySelectorAll('.rail .nav')].find((n) => n.textContent.includes(${JSON.stringify(label)})); n?.click(); return !!n; })()`).catch(() => false);
/** Waits for something on screen; ms it took, or null. */
async function waitFor(expr, timeout = 20_000, step = 150) {
  const t = Date.now();
  while (Date.now() - t < timeout) { try { if (await ev(`!!(${expr})`, 5000)) return Date.now() - t; } catch {} await sleep(step); }
  return null;
}

/** Focus check after a press: is something focused, on screen and visibly marked? */
const FOCUS_CHECK = `(() => {
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return { ok: false, why: 'nothing focused' };
  const r = a.getBoundingClientRect();
  const on = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
  const fully = r.left >= -2 && r.top >= -2 && r.right <= innerWidth + 2 && r.bottom <= innerHeight + 2;
  const cs = getComputedStyle(a);
  const marked = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none' || cs.transform !== 'none' || a.matches(':focus-visible');
  return { ok: on, fully, marked, el: a.tagName.toLowerCase() + (a.className && typeof a.className === 'string' ? '.' + a.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''), text: (a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 40), rect: [r.left, r.top, r.width, r.height].map(Math.round) };
})()`;

/** Text a TV viewer may struggle to read: small font sizes and low contrast, on what's on screen now. */
const READABILITY = `(() => {
  const small = new Map(); let lowContrast = 0, samples = [];
  const lum = (c) => { const m = c.match(/[\\d.]+/g); if (!m) return null; const [r, g, b] = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return { l: 0.2126 * r + 0.7152 * g + 0.0722 * b, a: m[3] === undefined ? 1 : +m[3] }; };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const x = lum(c); if (x && x.a > 0.5) return x.l; } return lum('rgb(15,20,30)').l; };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n; const seen = new Set();
  while ((n = walker.nextNode())) {
    const el = n.parentElement; if (!el || seen.has(el) || !n.textContent.trim()) continue; seen.add(el);
    const r = el.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const px = parseFloat(cs.fontSize);
    if (px < 22) small.set(px, (small.get(px) ?? 0) + 1);
    const fg = lum(cs.color); if (fg) { const bg = bgOf(el); const ratio = (Math.max(fg.l, bg) + 0.05) / (Math.min(fg.l, bg) + 0.05); if (ratio < 4.5 && fg.a > 0.3) { lowContrast++; if (samples.length < 6) samples.push([n.textContent.trim().slice(0, 30), +ratio.toFixed(2), px]); } }
  }
  const overflowX = document.scrollingElement.scrollWidth > innerWidth + 2;
  return { smallText: Object.fromEntries([...small].sort((a, b) => a[0] - b[0])), lowContrast, lowContrastSamples: samples, overflowX };
})()`;

// ---------- Phases ----------

const summary = { coldStarts: [], speed: [], screens: [], monkey: [], live: null, zaps: [], film: null, episode: null, memory: [], incidents: [] };

async function coldStart(label) {
  try {
    const launchMs = await launch(`cold start ${label}`);
    // Page timings come from the new document's own clock, so the debugger's attach time doesn't count.
    const t = Date.now();
    const cardsMs = await waitFor(`document.querySelectorAll('.row .card').length >= 5`, 45_000, 100);
    const postersMs = await waitFor(`[...document.querySelectorAll('.row .card img')].slice(0, 5).filter((i) => i.complete && i.naturalWidth).length >= 5`, 45_000, 200);
    const nav = await ev(`(() => { const n = performance.getEntriesByType('navigation')[0]; const p = performance.getEntriesByType('paint'); return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fp: Math.round(p.find((x) => x.name === 'first-paint')?.startTime ?? -1), fcp: Math.round(p.find((x) => x.name === 'first-contentful-paint')?.startTime ?? -1), now: Math.round(performance.now()) }; })()`).catch(() => null);
    await installProbes();
    const rec = { label, launchMs, nav, cardsAfterAttachMs: cardsMs, postersAfterAttachMs: postersMs, cardsSincePageStartMs: nav && cardsMs != null ? nav.now - (Date.now() - t - cardsMs) : null, mem: await metrics() };
    summary.coldStarts.push(rec);
    log("cold-start", rec);
    await shot(`coldstart-${label}`);
  } catch (e) { log("cold-start-failed", { label, e: String(e) }); summary.incidents.push({ min: +mins(), what: `cold start ${label} failed: ${e}` }); }
}

async function speed(label) {
  if (!(await healthy("speed"))) await sleep(5000);
  await openSection("Home"); await sleep(3000);
  const res = await new Promise((resolve) => {
    const p = spawn(process.execPath, ["scripts/tv-speed.mjs", "--inspector", `http://127.0.0.1:${PORT}`, "--baseline", "scripts/speed/samsung-qe32ls03c.json"], { cwd: REPO });
    let out = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    const kill = setTimeout(() => p.kill(), 6 * 60_000);
    p.on("close", (code) => { clearTimeout(kill); resolve({ code, out }); });
  });
  fs.writeFileSync(path.join(OUT, `speed-${label}.txt`), res.out);
  const rows = Object.fromEntries([...res.out.matchAll(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)/gm)].map((m) => [m[1], { main: +m[2], limit: +m[3], longest: +m[4], raster: +m[5], mpx: +m[6] }]));
  summary.speed.push({ label, code: res.code, rows });
  log("speed", { label, code: res.code, rows });
  await installProbes();
}

/** Every screen: how long until it shows something, focus behaviour, readability, Back. */
async function sweep() {
  const SECTIONS = [
    ["Home", `document.querySelectorAll('.row .card').length > 3`],
    ["Live TV", `document.querySelectorAll('.ch').length > 3`],
    ["Series", `document.querySelectorAll('.screen .card').length > 3`],
    ["Films", `document.querySelectorAll('.screen .card').length > 3`],
    ["My List", `document.querySelector('.screen .card, .screen .empty, .empty')`],
    ["Search", `document.querySelector('input')`],
    ["Settings", `document.querySelector('.screen button, .screen .btn')`],
  ];
  for (const [label, ready] of DRY ? SECTIONS.filter((s) => ["Home", "Films"].includes(s[0])) : SECTIONS) {
    if (left() < 5 * 60_000) return;
    await healthy(`sweep ${label}`);
    await openSection("Home"); await sleep(2500);
    // Into the side menu with ◀, then down to the section and OK, the way a person would.
    await ev(`document.querySelector('.rail .nav.current')?.focus()`).catch(() => {});
    const t = Date.now();
    await openSection(label);
    const readyMs = await waitFor(ready, 20_000, 100);
    await sleep(2500);
    const file = await shot(`screen-${label.replace(/\s/g, "")}`);
    const read = await ev(READABILITY).catch((e) => ({ error: String(e) }));
    // Into the content with ▶, then 30 random presses: focus must stay visible and on screen.
    await press("ArrowRight", 700);
    const problems = []; let moves = 0, stuck = 0, prev = null;
    const dirs = ["ArrowDown", "ArrowRight", "ArrowRight", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    for (let i = 0; i < (DRY ? 4 : 30); i++) {
      const d = dirs[Math.floor(Math.random() * dirs.length)];
      await press(d, 650);
      const r = await route();
      if (r?.player) { log("monkey-opened-player", { label }); await press("Back", 1500); continue; }
      const f = await ev(FOCUS_CHECK).catch(() => ({ ok: false, why: "eval failed" }));
      const key = `${f.el}|${f.rect}`;
      if (key === prev) stuck++; else moves++;
      prev = key;
      if (!f.ok || !f.fully) problems.push({ press: i, dir: d, ...f });
    }
    const lat = (await collect(`sweep-${label}`))?.lat ?? [];
    // OK on a poster, then Back: does focus come back to the same poster?
    let backCheck = null;
    if (["Home", "Films", "Series"].includes(label)) {
      const before = await ev(`(() => { const c = document.querySelector('.screen .card, .row .card'); c?.focus(); c?.scrollIntoView({ block: 'nearest' }); return c?.title ?? null; })()`).catch(() => null);
      await sleep(800);
      const tOk = Date.now();
      await press("Enter");
      const detailMs = await waitFor(`document.querySelector('.detail-hero')`, 15_000, 100);
      await sleep(1500);
      const detailShot = await shot(`detail-from-${label.replace(/\s/g, "")}`);
      const tBack = Date.now();
      await press("Back");
      const backMs = await waitFor(`!document.querySelector('.detail-hero')`, 10_000, 100);
      await sleep(1200);
      const after = await ev(`document.activeElement?.title ?? document.activeElement?.textContent?.trim().slice(0, 40) ?? null`).catch(() => null);
      backCheck = { poster: before, detailMs, backMs, focusAfterBack: after, focusRestored: !!before && before === after, detailShot };
    }
    const rec = { label, readyMs, shot: file, readability: read, monkey: { moves, stuck, problems: problems.slice(0, 8), problemCount: problems.length }, keyLatency: stats(lat), backCheck, mem: await metrics() };
    summary.screens.push(rec);
    log("screen", rec);
  }
}

async function streams() {
  return ev(`(() => { const k = {}; for (const e of performance.getEntriesByType('resource')) { const m = e.name.split('?')[0].match(/\\.(m3u8|ts|mp4|mkv|m4s|aac|vtt|srt)$/i); if (m) k[m[1].toLowerCase()] = (k[m[1].toLowerCase()] ?? 0) + 1; } const v = document.querySelector('.player video'); return { resources: k, src: v?.currentSrc?.slice(0, 5) ?? null }; })()`).catch(() => null);
}
async function videoState() {
  return ev(`(() => { const v = document.querySelector('.player video'); if (!v) return null; const q = v.getVideoPlaybackQuality?.(); let ahead = 0; for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) > v.currentTime) ahead = v.buffered.end(i) - v.currentTime;
    return { t: +v.currentTime.toFixed(2), paused: v.paused, rs: v.readyState, ns: v.networkState, w: v.videoWidth, h: v.videoHeight, dur: isFinite(v.duration) ? Math.round(v.duration) : null, dropped: q?.droppedVideoFrames ?? null, total: q?.totalVideoFrames ?? null, ahead: +ahead.toFixed(1), err: v.error?.message || v.error?.code || null,
      spinner: !!document.querySelector('.player .spinner'), failure: document.querySelector('.player .failure')?.textContent?.trim().slice(0, 120) ?? null, title: document.querySelector('.player .ov-top .t')?.textContent ?? null }; })()`).catch(() => null);
}
/** ms until the video is actually advancing, or null. */
async function untilPlaying(timeout = 30_000) {
  const t = Date.now(); let first = null;
  while (Date.now() - t < timeout) {
    const s = await videoState();
    if (s?.failure) return { ms: null, failure: s.failure };
    if (s && s.rs >= 3 && s.t > 0) { if (first === null) first = s.t; else if (s.t > first) return { ms: Date.now() - t, state: s }; }
    await sleep(150);
  }
  return { ms: null, state: await videoState() };
}
/** Watches for [ms], sampling every 5 s: smoothness, stalls, buffer, memory. */
async function watch(label, ms) {
  const samples = []; const end = Date.now() + ms; let lastT = null, frozen = 0;
  while (Date.now() < end && left() > 60_000) {
    await sleep(5000);
    const s = await videoState();
    if (!s) { if (!(await healthy(`${label} playback`))) return { samples, crashed: true }; samples.push({ gone: true }); break; }
    if (lastT !== null && s.t <= lastT + 0.5 && !s.paused) frozen++;
    lastT = s.t;
    samples.push({ at: Math.round((ms - (end - Date.now())) / 1000), ...s });
  }
  const p = await collect(label);
  const waits = (p?.video ?? []).filter((v) => v[0] === "waiting").length;
  const first = samples.find((s) => s.total != null), last = [...samples].reverse().find((s) => s.total != null);
  const dropped = first && last ? last.dropped - first.dropped : null, total = first && last ? last.total - first.total : null;
  const fps = first && last && last.t > first.t ? +(total / (last.t - first.t)).toFixed(1) : null;
  return { seconds: samples.length * 5, frozenSamples: frozen, waitingEvents: waits, droppedFrames: dropped, frames: total, droppedPct: total ? +((dropped / total) * 100).toFixed(2) : null, fps, res: last ? `${last.w}x${last.h}` : null, minAhead: Math.min(...samples.filter((s) => s.ahead != null).map((s) => s.ahead)), mem: await metrics(), videoEvents: p?.video?.slice(0, 40), lastSample: samples.at(-1) };
}

async function live() {
  await healthy("live");
  await openSection("Live TV");
  await waitFor(`document.querySelectorAll('.ch').length > 3`, 20_000);
  await sleep(2000);
  const category = await ev(`(() => { const cats = [...document.querySelectorAll('.cat')]; const c = cats.find((b) => /${args.category ?? "Free To Air"}/i.test(b.textContent)) ?? cats.find((b) => !/Favourites|All channels|Info|Status/i.test(b.textContent)); c?.click(); return c?.textContent.trim() ?? null; })()`).catch(() => null);
  log("live-category", { category });
  await sleep(2500);
  await ev(`document.querySelector('.ch')?.focus()`);
  await sleep(500);
  const channel = await ev(`document.querySelector('.ch .nm')?.firstChild?.textContent ?? null`).catch(() => null);
  await press("Enter");
  const start = await untilPlaying(30_000);
  await sleep(1500);
  await shot("live-playing");
  log("live-start", { channel, ...start });
  const w = await watch("live", Number(args["live-ms"] ?? 60_000));
  w.streams = await streams();
  summary.live = { channel, ttffMs: start.ms, failure: start.failure, ...w };
  log("live-watch", summary.live);
  // Channel changes with CH + (and back with CH −).
  const ZAPS = Number(args.zaps ?? 6);
  for (let i = 0; i < ZAPS; i++) {
    const key = i < ZAPS - 2 ? "ChUp" : "ChDown";
    await press(key);
    await sleep(300);
    const z = await untilPlaying(25_000);
    const rec = { n: i + 1, key, ms: z.ms, failure: z.failure ?? null, title: z.state?.title ?? (await videoState())?.title };
    summary.zaps.push(rec);
    log("zap", rec);
    if (i === 2) await shot("live-after-zap");
    await sleep(4000);
  }
  // Pause and resume with the remote's play/pause key, then OK (Enter) toggles too.
  await press("PlayPause", 2500); const paused = (await videoState())?.paused;
  await press("PlayPause", 2500); const resumed = (await videoState())?.paused === false;
  summary.live.pauseKeyWorks = paused === true && resumed;
  await collect("live-zap");
  await press("Back", 1500);
  let r = await route();
  if (r?.player) { await press("Back", 1500); r = await route(); }
  summary.live.backLeavesPlayer = !r?.player;
  log("live-done", { pauseKeyWorks: summary.live.pauseKeyWorks, backLeavesPlayer: summary.live.backLeavesPlayer });
}

async function vod(kind) {
  await healthy(kind);
  await openSection(kind === "film" ? "Films" : "Series");
  await waitFor(`document.querySelectorAll('.screen .card').length > 3`, 20_000);
  await sleep(2500);
  // Not the first poster on the page, which is often a CAM or a placeholder: the third of the first row.
  const name = await ev(`(() => { const c = document.querySelectorAll('.screen .track .card, .screen .card')[2]; c?.focus(); return c?.title ?? null; })()`).catch(() => null);
  await sleep(600);
  await press("Enter");
  if ((await waitFor(`document.querySelector('.detail-hero, .screen .btn.primary')`, 15_000)) == null) { log(`${kind}-no-detail`); return; }
  await sleep(2500);
  await ev(`document.querySelector('.screen .btn.primary')?.focus()`);
  await sleep(500);
  await press("Enter");
  await sleep(2500);
  if (await ev(`!!document.querySelector('.plus-offer, .offer') || /Get telly Plus/.test(document.body.innerText)`).catch(() => false)) {
    log(`${kind}-plus-offer`);
    await ev(`[...document.querySelectorAll('button')].find((b) => /Not now/.test(b.textContent))?.click()`);
    await sleep(2000);
    await ev(`document.querySelector('.screen .btn.primary')?.focus()`);
    await press("Enter");
  }
  const start = await untilPlaying(40_000);
  await sleep(2000);
  await shot(`${kind}-playing`);
  log(`${kind}-start`, { name, ...start });
  if (start.ms == null) { summary[kind] = { name, ttffMs: null, failure: start.failure ?? "never started", state: start.state }; await press("Back", 1500); await press("Back", 1500); return; }
  const w = await watch(kind, Number(args["vod-ms"] ?? 60_000));
  w.streams = await streams();
  // Seeking: ▶ ▶ ▶ (+10 s each), then fast-forward and rewind keys; time until playing again.
  const seeks = [];
  for (const key of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowLeft", "FF", "RW"]) {
    const before = (await videoState())?.t;
    const t = Date.now();
    await press(key);
    await sleep(400);
    const z = await untilPlaying(20_000);
    const after = (await videoState())?.t;
    seeks.push({ key, ms: z.ms != null ? z.ms + 400 : null, moved: before != null && after != null ? +(after - before).toFixed(1) : null });
    await sleep(2500);
    void t;
  }
  // Controls: ▼ shows the bar; the tracks menu lists audio and subtitles.
  await press("ArrowDown", 1200);
  const controls = await ev(`(() => ({ shown: !!document.querySelector('.player.awake'), focused: document.activeElement?.getAttribute('aria-label') ?? null }))()`).catch(() => null);
  await shot(`${kind}-controls`);
  await ev(`document.querySelector('.ctrls [aria-label="Audio & subtitles"]')?.click()`).catch(() => {});
  await sleep(1500);
  const tracks = await ev(`(() => [...document.querySelectorAll('.player .menu .opt')].map((o) => o.textContent.trim()))()`).catch(() => null);
  await shot(`${kind}-tracks`);
  await press("Back", 1200);
  await press("PlayPause", 2000); const paused = (await videoState())?.paused;
  await press("PlayPause", 2000); const resumed = (await videoState())?.paused === false;
  await press("Back", 1500);
  let r = await route();
  if (r?.player) { await press("Back", 1500); r = await route(); }
  await sleep(1500);
  const resumeOffered = await ev(`[...document.querySelectorAll('.screen .btn')].some((b) => /Resume/.test(b.textContent))`).catch(() => null);
  summary[kind] = { name, ttffMs: start.ms, ...w, seeks, controls, tracks, pauseKeyWorks: paused === true && resumed, backLeavesPlayer: !r?.player, resumeOffered };
  log(`${kind}-done`, summary[kind]);
  await press("Back", 1500);
}

/** The rest of the hour: round and round the app, with memory after every lap. */
async function endurance(untilLeft) {
  const loop = ["Home", "Live TV", "Series", "Films", "My List", "Home"];
  let lap = 0;
  while (left() > untilLeft) {
    lap++;
    for (const s of loop) {
      if (!(await healthy(`endurance lap ${lap}`))) summary.incidents.push({ min: +mins(), what: `unresponsive during endurance lap ${lap} (${s})` });
      await openSection(s);
      await sleep(2500);
      await press("ArrowRight", 600);
      for (let i = 0; i < 6; i++) await press(["ArrowDown", "ArrowRight", "ArrowRight", "ArrowDown", "ArrowUp", "ArrowRight"][i], 600);
    }
    await collect("endurance");
    const m = await metrics();
    summary.memory.push({ lap, min: +mins(), ...m });
    log("lap", { lap, ...m });
  }
}

const stats = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, p50: q(0.5), p90: q(0.9), max: s.at(-1) }; };

// ---------- The hour ----------

log("start", { minutes: MINUTES, out: OUT });
/** Each phase on its own: one that breaks is noted, and the hour goes on. */
async function phase(name, fn) {
  if (args.phases && !args.phases.split(",").map((p) => p.trim()).includes(name)) return;
  if (left() < 60_000) return log("phase-skipped", { name, why: "out of time" });
  log("phase", { name });
  try { await fn(); } catch (e) {
    log("PHASE-FAILED", { name, e: String(e?.stack ?? e).slice(0, 500) });
    summary.incidents.push({ min: +mins(), what: `${name} failed: ${String(e).slice(0, 200)}` });
    try { await press("Back", 1500); await press("Back", 1500); } catch {}
    await healthy(`after ${name}`).catch(() => {});
  }
}
await phase("cold starts", async () => { for (const n of DRY ? [1] : [1, 2, 3]) { await coldStart(`${n}`); await sleep(4000); } });
summary.memory.push({ lap: 0, min: +mins(), ...(await metrics().catch(() => ({}))) });
if (!DRY) await phase("speed start", () => speed("start"));
await phase("screen sweep", sweep);
await phase("live TV", live);
if (!DRY) await phase("speed after live", () => speed("after-live"));
await phase("film", () => vod("film"));
if (!DRY) await phase("episode", () => vod("episode"));
await phase("endurance", () => endurance(DRY ? left() - 20_000 : 7 * 60_000));
if (!DRY) await phase("speed end", () => speed("end"));
await phase("final cold start", () => coldStart("final"));

summary.keyLatency = { all: stats(latAll.map((x) => x.ms)), byPhase: Object.fromEntries([...new Set(latAll.map((x) => x.phase))].map((p) => [p, stats(latAll.filter((x) => x.phase === p).map((x) => x.ms))])) };
summary.longTasks = { count: longAll.length, over200: longAll.filter((x) => x.ms > 200).length, over500: longAll.filter((x) => x.ms > 500).length, max: Math.max(0, ...longAll.map((x) => x.ms)) };
summary.consoleErrors = consoleErrors; summary.exceptions = exceptions;
summary.netFails = netFails.slice(0, 200); summary.netFailCount = netFails.length;
summary.minutes = +mins();
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
log("summary-written", { minutes: summary.minutes });

// Leave telly the way a person would: Back on Home leaves it.
if (args["keep-open"] !== "true") try { await openSection("Home"); await sleep(1500); await ev(`document.querySelector('.rail .nav.current')?.focus()`); await press("Back", 2500); } catch {}
try { ws?.close(); } catch {}
if (args["keep-open"] !== "true") await sdb("forward", "--remove-all");
log("done");
logFile.end();
setTimeout(() => process.exit(0), 500);
