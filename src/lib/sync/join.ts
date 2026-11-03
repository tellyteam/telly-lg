/**
 * Joining by QR code from the new device (telly-sync PROTOCOL.md): a TV that isn't linked shows
 * `telly://join?id=…&key=…`; an iPhone or iPad in the household scans it and leaves its link code
 * in the relay's join box, sealed with the key, for this TV to collect. The key is only ever in the
 * QR code.
 */
import type { Transport } from "./client";
import { SyncError } from "./client";
import { hex, normaliseCode, openBox, randomBytes, sealBox } from "./crypto";

export interface Join {
  id: string;
  key: Uint8Array;
}

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function unb64url(text: string): Uint8Array | null {
  try {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export const newJoin = (random = randomBytes): Join => ({ id: hex(random(16)), key: random(32) });

export const joinLink = (j: Join) => `telly://join?id=${j.id}&key=${b64url(j.key)}`;

/** The join from a scanned link, or null if it isn't one. */
export function parseJoinLink(text: string): Join | null {
  const m = text.trim().match(/^telly:\/\/join\?(.*)$/i);
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const id = q.get("id")?.toLowerCase() ?? "";
  const key = unb64url(q.get("key") ?? "");
  return /^[0-9a-f]{32}$/.test(id) && key?.length === 32 ? { id, key } : null;
}

const aad = (j: Join) => new TextEncoder().encode(`telly-join v1|${j.id}`);

/** The household's link code, sealed for this join's box. */
export const sealJoin = (j: Join, code: string, nonce = randomBytes(12)) => sealBox(j.key, aad(j), JSON.stringify({ code }), nonce);

/** The link code in a box, or null if it isn't for this join or was altered. */
export function openJoin(j: Join, box: Uint8Array): string | null {
  const text = openBox(j.key, aad(j), box);
  if (!text) return null;
  try {
    return normaliseCode(String((JSON.parse(text) as { code?: unknown }).code ?? ""));
  } catch {
    return null;
  }
}

/** The code another device left in [j]'s box, once; null while it's still empty. Needs no token. */
export async function collectJoin(transport: Transport, relay: string, j: Join): Promise<string | null> {
  let res;
  try {
    res = await transport({ method: "GET", url: `${relay.replace(/\/+$/, "")}/v1/join/${j.id}`, auth: "" });
  } catch {
    throw new SyncError("Couldn't reach the sync relay.");
  }
  if (res.status !== 200) return null;
  const body = (JSON.parse(res.text) as { body?: string }).body ?? "";
  const code = openJoin(j, Uint8Array.from(atob(body), (c) => c.charCodeAt(0)));
  if (!code) throw new SyncError("That code couldn't be read. Scan the QR code again.");
  return code;
}
