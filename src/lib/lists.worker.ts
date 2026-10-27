import "./polyfills";
import type { Channel, Group, Series } from "./model";
import { run, type Job } from "./lists";

/**
 * Items per message. The next part goes only when the screen asks for it, once it has drawn: a big
 * list sent all at once kept the screen's thread busy taking it in for seconds on a TV.
 */
const PART = 3000;

const post = (message: unknown) => (self as unknown as Worker).postMessage(message);
const waiting = new Map<number, () => void>();

self.onmessage = async (e: MessageEvent<{ id: number; job?: Job; more?: true }>) => {
  const { id, job } = e.data;
  if (!job) return waiting.get(id)?.();
  try {
    const result = await run(job);
    if (result.unchanged) return post({ id, unchanged: true });
    const parts: Group<Channel | Series>[][] = [];
    let part: Group<Channel | Series>[] = [], size = 0;
    for (const g of result.groups) {
      for (let i = 0; i < g.items.length || i === 0; i += PART) {
        const items = g.items.slice(i, i + PART);
        part.push({ name: g.name, items });
        size += items.length;
        if (size >= PART) {
          parts.push(part);
          part = [];
          size = 0;
        }
      }
    }
    parts.push(part);
    for (const [i, groups] of parts.entries()) {
      if (i === parts.length - 1) post({ id, groups, done: true, packed: result.packed, fingerprint: result.fingerprint });
      else {
        const asked = new Promise<void>((r) => waiting.set(id, r));
        post({ id, groups });
        await asked;
      }
    }
    waiting.delete(id);
  } catch (err) {
    waiting.delete(id);
    post({ id, error: (err as Error).message || "Couldn't load your lists." });
  }
};
