import { fetchTransport, type Transport } from "./sync/client";

/**
 * Everything outside the page, behind one small surface. On an LG TV (webOS) the TV itself
 * fetches and plays everything directly; under `npm run dev` in a browser it's the Vite dev
 * server's relay (browsers block providers' cross-origin answers) plus localStorage, so the UI
 * can be worked on without a TV.
 */

/** Built for LG TVs (`npm run build`). */
export const isWebOS = import.meta.env.VITE_TARGET === "webos";
/** Built for Samsung TVs (`npm run build:tizen`). */
export const isTizen = import.meta.env.VITE_TARGET === "tizen";
/** On a TV, LG or Samsung: the remote drives everything, and the TV fetches and plays directly. */
export const isTV = isWebOS || isTizen;

let relayBase = "";
let cleartext = false;

export async function initBackend(): Promise<void> {
  relayBase = isTV ? "" : `${location.origin}/__relay/dev`;
}

/** Follows the active provider's "allow plain HTTP" setting. */
export function setAllowCleartext(allow: boolean) {
  cleartext = allow;
}

function b64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The relay address for a provider URL. `hls` asks the relay to rewrite playlists (for playback). */
export function relayUrl(target: string, opts: { hls?: boolean } = {}): string {
  // The TV needs no relay: packaged TV apps may fetch and play from any address.
  if (isTV) return target;
  const flags = (cleartext ? "c" : "") + (opts.hls ? "h" : "") || "-";
  let name = "x";
  try {
    name = new URL(target).pathname.split("/").pop()?.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 60) || "x";
  } catch {
    /* keep "x" */
  }
  return `${relayBase}/${flags}/${b64url(target)}/${name}`;
}

/** Artwork goes through the relay too: providers serve it over plain HTTP from all sorts of hosts. */
export function img(url: string | undefined): string | undefined {
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  if (url.startsWith("http:") && !cleartext) return undefined;
  return relayUrl(url);
}

/** Error messages name only the host, because Xtream URLs carry the login. */
function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "The provider";
  }
}

/** How long a provider may take to start answering, and how long it may then go quiet. */
const FIRST_BYTE_MS = 45_000;
const QUIET_MS = 30_000;

/**
 * A provider's answer, read in full. A provider that stops answering (or never starts) is given up
 * on, so a refresh can't run for ten minutes; one that's slow but still sending is waited for, however
 * long its list takes.
 */
async function get(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  if (url.startsWith("http:") && !cleartext) {
    throw new Error(`Unencrypted HTTP to ${host(url)} is turned off. If your provider has no HTTPS, allow it in Settings.`);
  }
  const watchdog = new AbortController();
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => { stalled = true; watchdog.abort(); }, ms);
  };
  const onAbort = () => watchdog.abort();
  signal?.addEventListener("abort", onAbort);
  const why = (e: unknown, fallback: string) => {
    if ((e as Error).name !== "AbortError") return new Error(fallback);
    return stalled ? new Error(`${host(url)} stopped answering.`) : e;
  };
  try {
    wait(FIRST_BYTE_MS);
    let res: Response;
    try {
      res = await fetch(relayUrl(url), { signal: watchdog.signal });
    } catch (e) {
      throw why(e, `Couldn't reach ${host(url)}.`);
    }
    // A web app can't see a redirect before it's followed, so one to plain HTTP is only caught here,
    // and its answer isn't used. (The dev relay refuses it before it goes.)
    if (isTV && res.url.startsWith("http:") && !cleartext) {
      throw new Error(`${host(url)} redirected to unencrypted HTTP, which is turned off. If your provider has no HTTPS, allow it in Settings.`);
    }
    if (res.status === 502 || res.status === 403) throw new Error(await res.text());
    if (!res.ok) throw new Error(`${host(url)} returned HTTP ${res.status}.`);
    try {
      return await readAll(res, () => wait(QUIET_MS));
    } catch (e) {
      throw why(e, `${host(url)} stopped part-way through.`);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** The whole body, calling [progress] as each part arrives. */
async function readAll(res: Response, progress: () => void): Promise<Uint8Array> {
  progress();
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
    progress();
  }
  if (parts.length === 1) return parts[0];
  const all = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { all.set(part, at); at += part.length; }
  return all;
}

export async function getText(url: string, signal?: AbortSignal): Promise<string> {
  return new TextDecoder().decode(await get(url, signal));
}

/** The answer undecoded, for a worker to read: decoding tens of megabytes here would stall the screen. */
export async function getBytes(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const bytes = await get(url, signal);
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer as ArrayBuffer : bytes.slice().buffer;
}

export async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const text = await getText(url, signal);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The provider did not return valid JSON. Check the server address.");
  }
}

// ---- Storage: the TV's own, private to the app ----

export async function secretGet(name: string): Promise<string | null> {
  return localStorage.getItem(`telly.secret.${name}`);
}

export async function secretSet(name: string, value: string): Promise<void> {
  localStorage.setItem(`telly.secret.${name}`, value);
}

export async function secretDelete(name: string): Promise<void> {
  localStorage.removeItem(`telly.secret.${name}`);
}

export async function storeRead<T>(name: string): Promise<T | null> {
  try {
    const text = localStorage.getItem(`telly.store.${name}`);
    return text ? (JSON.parse(text) as T) : null;
  } catch (e) {
    console.warn(`Couldn't read ${name}`, e);
    return null;
  }
}

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
const pendingValues = new Map<string, () => void>();

/** Writes are coalesced (progress saves often), and flushed when the app closes. */
export function storeWrite(name: string, value: unknown, delayMs = 400): void {
  clearTimeout(pendingWrites.get(name));
  const write = () => {
    pendingWrites.delete(name);
    pendingValues.delete(name);
    localStorage.setItem(`telly.store.${name}`, JSON.stringify(value));
  };
  if (delayMs <= 0) return write();
  pendingValues.set(name, write);
  pendingWrites.set(name, setTimeout(write, delayMs));
}

export async function storeDelete(name: string): Promise<void> {
  localStorage.removeItem(`telly.store.${name}`);
}

/** Saves anything still waiting, e.g. just before the app closes. */
export function flushWrites(): void {
  for (const write of [...pendingValues.values()]) write();
}

/** Samsung's own web APIs, there on a Samsung TV. */
type Tizen = {
  application: { getCurrentApplication(): { exit(): void } };
  tvinputdevice: { registerKey(name: string): void };
};
const tizen = () => (window as unknown as { tizen?: Tizen }).tizen;

/**
 * Back on telly's first screen: out to the TV's Home, as LG's and Samsung's checklists ask. webOS
 * gives Back to the app (`disableBackHistoryAPI`), so the app hands it on with the platform's own
 * Back; a Samsung app closes itself.
 */
export function exitToTv(): void {
  if (!isTV) return;
  flushWrites();
  if (isTizen) {
    try {
      tizen()!.application.getCurrentApplication().exit();
    } catch {
      window.close();
    }
    return;
  }
  const palm = (window as unknown as { PalmSystem?: { platformBack?: () => void } }).PalmSystem;
  if (palm?.platformBack) palm.platformBack();
  else window.close();
}

/**
 * A Samsung TV keeps the remote's media and channel keys for itself unless the app asks for them
 * (arrows, OK, Back and the numbers always come through). LG sends them all.
 */
export function registerRemoteKeys(): void {
  if (!isTizen) return;
  for (const key of ["MediaPlayPause", "MediaPlay", "MediaPause", "MediaRewind", "MediaFastForward", "ChannelUp", "ChannelDown"]) {
    try {
      tizen()?.tvinputdevice.registerKey(key);
    } catch {
      // An older remote or model without that key.
    }
  }
}

// ---- Sync ----

export const syncTransport: Transport = fetchTransport;

// ---- The rest ----

export async function openExternal(url: string): Promise<void> {
  window.open(url, "_blank", "noopener");
}

export async function setFullscreen(on: boolean): Promise<void> {
  if (isTV) return; // always full screen
  if (on) await document.documentElement.requestFullscreen?.();
  else if (document.fullscreenElement) await document.exitFullscreen();
}

export async function isFullscreen(): Promise<boolean> {
  // A TV is always full screen, so there's never a full screen to leave: Back closes the player.
  return !isTV && !!document.fullscreenElement;
}

export async function appVersion(): Promise<string> {
  return __APP_VERSION__;
}
