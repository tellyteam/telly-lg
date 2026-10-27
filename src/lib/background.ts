import type { Channel, Group, Series } from "./model";
import { run, type Job, type Result } from "./lists";
import ListsWorker from "./lists.worker?worker&inline";

/**
 * Runs lists.ts's jobs in a web worker, putting the list back together as its parts arrive. Where
 * there are no workers (unit tests), or the worker won't start, the job runs here instead.
 */
let worker: Worker | null | undefined;
let nextId = 0;

interface Pending {
  groups: Group<Channel | Series>[];
  resolve: (r: Result) => void;
  reject: (e: Error) => void;
}
const pending = new Map<number, Pending>();

function start(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === "undefined" ? null : new ListsWorker();
  } catch {
    worker = null;
  }
  if (!worker) return null;
  worker.onmessage = (e) => {
    const m = e.data as { id: number; unchanged?: true; groups?: Group<Channel | Series>[]; done?: true; packed?: string; fingerprint?: string; error?: string };
    const p = pending.get(m.id);
    if (!p) return;
    if (m.error !== undefined) {
      pending.delete(m.id);
      return p.reject(new Error(m.error));
    }
    if (m.unchanged) {
      pending.delete(m.id);
      return p.resolve({ unchanged: true });
    }
    for (const g of m.groups ?? []) {
      // A big category arrives in parts.
      const last = p.groups[p.groups.length - 1];
      if (last?.name === g.name) for (const item of g.items) last.items.push(item);
      else p.groups.push(g);
    }
    if (m.done) {
      pending.delete(m.id);
      p.resolve({ groups: p.groups, packed: m.packed, fingerprint: m.fingerprint });
    } else afterPaint(() => worker?.postMessage({ id: m.id, more: true }));
  };
  worker.onerror = (e) => {
    console.warn("The lists' worker stopped", e.message);
    e.preventDefault();
    worker?.terminate();
    worker = null;
    for (const p of pending.values()) p.reject(new Error("Couldn't load your lists."));
    pending.clear();
  };
  return worker;
}

/** Once the screen has drawn (or soon, if it isn't drawing). */
function afterPaint(fn: () => void) {
  let done = false;
  const once = () => { if (!done) { done = true; setTimeout(fn, 0); } };
  requestAnimationFrame(once);
  setTimeout(once, 100);
}

export function inBackground(job: Job): Promise<Result> {
  const w = start();
  if (!w) return run(job);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { groups: [], resolve, reject });
    // The provider's answer is handed over, not copied.
    w.postMessage({ id, job }, job.op === "convert" ? [job.bytes] : []);
  });
}
