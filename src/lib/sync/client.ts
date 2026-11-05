/** Talking to the relay. Only sealed parcels ever leave the device. */
import { bundleJson, mergeBundles, parseBundle, type Bundle } from "./bundle";
import { open, seal, type Keys } from "./crypto";

export interface RelayRequest {
  method: "GET" | "PUT" | "POST" | "DELETE";
  url: string;
  auth: string;
  body?: Uint8Array;
}

export interface RelayResponse {
  status: number;
  /** JSON responses only. */
  text: string;
}

/** How requests are sent (fetch everywhere; tests use their own). */
export type Transport = (r: RelayRequest) => Promise<RelayResponse>;

export const fetchTransport: Transport = async (r) => {
  const res = await fetch(r.url, {
    method: r.method,
    headers: { Authorization: `Bearer ${r.auth}`, ...(r.body ? { "Content-Type": "application/octet-stream" } : {}) },
    body: r.body as BodyInit | undefined,
    cache: "no-store",
  });
  return { status: res.status, text: await res.text() };
};

export class SyncError extends Error {}

/** The relay wants telly Plus for this household before it syncs (402). */
export class PlusNeededError extends SyncError {
  constructor() {
    super("Sync needs telly Plus for this household.");
  }
}

/** The household's telly Plus, as the relay has it: the last day it's paid for, and whether it's on sale here. */
export interface PlusStatus {
  until: number | null;
  onSale: boolean;
}

function check(res: RelayResponse) {
  if (res.status === 401) throw new SyncError("This sync code is no longer valid on the relay.");
  if (res.status === 402) throw new PlusNeededError();
  if (res.status === 503) throw new SyncError("telly Plus isn't on sale here yet.");
  if (res.status === 409) throw new SyncError("Too many devices are linked to this code (12 at most).");
  if (res.status < 200 || res.status >= 300) throw new SyncError(`The sync relay answered ${res.status}.`);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const base = (relay: string) => relay.replace(/\/+$/, "");

/**
 * Every other device's parcel that opens with our key; anything else is ignored. [current] is the
 * tag a version 1 parcel is read as (null: ignored).
 */
export async function pull(transport: Transport, relay: string, keys: Keys, device: string, current: string | null): Promise<Bundle[]> {
  const res = await transport({ method: "GET", url: `${base(relay)}/v1/${keys.mailbox}`, auth: keys.auth });
  check(res);
  const { parcels } = JSON.parse(res.text) as { parcels: { device: string; body: string }[] };
  const result: Bundle[] = [];
  for (const p of parcels ?? []) {
    if (p.device === device) continue;
    const text = open(keys, p.device, fromBase64(p.body));
    const bundle = text === null ? null : parseBundle(text, current);
    if (bundle) result.push(bundle);
  }
  return result;
}

export async function push(transport: Transport, relay: string, keys: Keys, device: string, bundle: Bundle): Promise<void> {
  const body = seal(keys, device, bundleJson(bundle));
  check(await transport({ method: "PUT", url: `${base(relay)}/v1/${keys.mailbox}/${device}`, auth: keys.auth, body }));
}

/** The household's telly Plus, from the relay: only told to one of its devices, or [device] if there's room for it to join. */
export async function plus(transport: Transport, relay: string, keys: Keys, device: string): Promise<PlusStatus> {
  const res = await transport({ method: "GET", url: `${base(relay)}/v1/${keys.mailbox}/${device}/plus`, auth: keys.auth });
  check(res);
  const o = JSON.parse(res.text) as { until?: unknown; onSale?: unknown };
  return { until: typeof o.until === "number" ? o.until : null, onSale: o.onSale === true };
}

/** A checkout link for this household, to open on a phone: Paddle takes the payment. */
export async function checkout(transport: Transport, relay: string, keys: Keys): Promise<string> {
  const res = await transport({ method: "POST", url: `${base(relay)}/v1/${keys.mailbox}/plus/checkout`, auth: keys.auth });
  check(res);
  const url = (JSON.parse(res.text) as { url?: unknown }).url;
  if (typeof url !== "string") throw new SyncError("The sync relay didn't give a checkout link.");
  return url;
}

/** Whether telly Plus can be bought here, for a TV with no household yet. Needs no token. */
export async function onSale(transport: Transport, relay: string): Promise<boolean> {
  try {
    const res = await transport({ method: "GET", url: `${base(relay)}/v1/plus`, auth: "" });
    return res.status === 200 && (JSON.parse(res.text) as { onSale?: unknown }).onSale === true;
  } catch {
    return false;
  }
}

/** Takes this device's parcel off the relay (the others keep theirs). */
export async function leave(transport: Transport, relay: string, keys: Keys, device: string): Promise<void> {
  check(await transport({ method: "DELETE", url: `${base(relay)}/v1/${keys.mailbox}/${device}`, auth: keys.auth }));
}

/** One round: fetch the others, combine with [own], share the result. Returns the combined state. */
export async function syncOnce(
  transport: Transport, relay: string, keys: Keys, device: string, own: Bundle, current: string | null, now = Date.now(),
): Promise<Bundle> {
  const others = await pull(transport, relay, keys, device, current);
  const merged = mergeBundles(own, others, now);
  await push(transport, relay, keys, device, merged);
  return merged;
}
