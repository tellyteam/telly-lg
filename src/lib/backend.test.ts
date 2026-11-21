import { afterEach, describe, expect, it, vi } from "vitest";

import { getText } from "./backend";

/** A response whose body sends [parts], each [gapMs] after the last, then stops (or hangs, with [hang]). */
function slowResponse(parts: string[], gapMs: number, hang = false): Response {
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(ctl) {
      return new Promise((resolve) => {
        if (i < parts.length) setTimeout(() => { ctl.enqueue(enc.encode(parts[i++])); resolve(); }, gapMs);
        else if (!hang) { ctl.close(); resolve(); }
        // hang: never resolves, never closes
      });
    },
  });
  return new Response(body, { status: 200 });
}

/** fetch that honours its abort signal the way the browser's does. */
function mockFetch(make: () => Response, delayMs = 0) {
  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    init?.signal?.addEventListener("abort", abort);
    setTimeout(() => {
      if (init?.signal?.aborted) return;
      const res = make();
      // An aborted fetch also errors its body.
      const reader = res.body!.getReader();
      const body = new ReadableStream({
        pull: (ctl) => new Promise<void>((done, fail) => {
          init?.signal?.addEventListener("abort", () => fail(Object.assign(new Error("aborted"), { name: "AbortError" })));
          reader.read().then(({ done: end, value }) => { if (end) ctl.close(); else ctl.enqueue(value); done(); });
        }),
      });
      resolve(new Response(body, { status: 200 }));
    }, delayMs);
  }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("provider downloads", () => {
  it("wait for a provider that's slow but keeps sending", async () => {
    vi.useFakeTimers();
    mockFetch(() => slowResponse(["a", "b", "c", "d"], 20_000));
    const text = getText("https://provider.example/list");
    await vi.advanceTimersByTimeAsync(100_000);
    await expect(text).resolves.toBe("abcd");
  });

  it("give up on a provider that goes quiet part-way through", async () => {
    vi.useFakeTimers();
    mockFetch(() => slowResponse(["a"], 1000, true));
    const text = getText("https://provider.example/list");
    const result = expect(text).rejects.toThrow("provider.example stopped answering.");
    await vi.advanceTimersByTimeAsync(40_000);
    await result;
  });

  it("give up on a provider that never starts answering", async () => {
    vi.useFakeTimers();
    mockFetch(() => slowResponse(["a"], 0), 10 * 60_000);
    const text = getText("https://provider.example/list");
    const result = expect(text).rejects.toThrow("provider.example stopped answering.");
    await vi.advanceTimersByTimeAsync(50_000);
    await result;
  });

  it("still lets the caller cancel", async () => {
    vi.useFakeTimers();
    mockFetch(() => slowResponse(["a"], 1000, true));
    const ctl = new AbortController();
    const text = getText("https://provider.example/list", ctl.signal);
    const result = expect(text).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(2000);
    ctl.abort();
    await result;
  });
});
