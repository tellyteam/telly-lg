/**
 * Joining by QR code from the new device (telly-sync PROTOCOL.md, SETUP-BY-PHONE.md): a TV shows
 * `https://tv.gettelly.app/#id=…&key=…`; a phone leaves a link code, a provider or both in the
 * relay's join box, sealed with the key, for this TV to collect. The key is only ever in the QR
 * code. Older TVs showed `telly://join?id=…&key=…`, which is still read.
 */
import type { Provider } from "../model";
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

export const joinLink = (j: Join) => `https://tv.gettelly.app/#id=${j.id}&key=${b64url(j.key)}`;

/** The join from a scanned link, either form, or null if it isn't one. */
export function parseJoinLink(text: string): Join | null {
  const m = text.trim().match(/^telly:\/\/join\?(.*)$/i) ?? text.trim().match(/^https:\/\/tv\.gettelly\.app\/#(.*)$/i);
  if (!m) return null;
  const q = new URLSearchParams(m[1]);
  const id = q.get("id")?.toLowerCase() ?? "";
  const key = unb64url(q.get("key") ?? "");
  return /^[0-9a-f]{32}$/.test(id) && key?.length === 32 ? { id, key } : null;
}

const aad = (j: Join) => new TextEncoder().encode(`telly-join v1|${j.id}`);

/** What a join box holds: a link code, a provider, or both. */
export interface JoinMessage {
  code?: string;
  provider?: Provider;
}

/** Sealed for this join's box. */
export const sealJoin = (j: Join, message: JoinMessage, nonce = randomBytes(12)) => sealBox(j.key, aad(j), JSON.stringify(message), nonce);

/** The longest each detail may be; a message with a longer one isn't read at all. */
const LIMITS = { server: 255, username: 255, password: 255, url: 2048, name: 60 };

/** A provider from a message, checked as untrusted input, or null if it breaks the limits. */
function readProvider(v: unknown): Provider | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const text = (k: keyof typeof LIMITS, optional = false): string | null => {
    const x = o[k];
    if (x === undefined || x === null) return optional ? "" : null;
    return typeof x === "string" && [...x].length <= LIMITS[k] ? x : null;
  };
  const name = text("name", true);
  const allow = o.allowCleartext;
  if (name === null || (allow !== undefined && typeof allow !== "boolean")) return null;
  const allowCleartext = allow === true;
  if (o.kind === "xtream") {
    const server = text("server"), username = text("username"), password = text("password");
    if (server === null || username === null || password === null) return null;
    if (!server.trim() || !username.trim() || !password) return null;
    return { kind: "xtream", name, server: server.trim(), username: username.trim(), password, allowCleartext };
  }
  if (o.kind === "m3u") {
    const url = text("url");
    if (url === null || !url.trim()) return null;
    return { kind: "m3u", name, url: url.trim(), allowCleartext };
  }
  return null;
}

/** What's in a box, or null if it isn't for this join, was altered, or isn't a message telly reads. */
export function openJoin(j: Join, box: Uint8Array): JoinMessage | null {
  const text = openBox(j.key, aad(j), box);
  if (!text) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const message: JoinMessage = {};
  if (o.code !== undefined) {
    const code = typeof o.code === "string" ? normaliseCode(o.code) : null;
    if (!code) return null;
    message.code = code;
  }
  if (o.provider !== undefined) {
    const provider = readProvider(o.provider);
    if (!provider) return null;
    message.provider = provider;
  }
  return message.code || message.provider ? message : null;
}

/** What another device left in [j]'s box, once; null while it's still empty. Needs no token. */
export async function collectJoin(transport: Transport, relay: string, j: Join): Promise<JoinMessage | null> {
  let res;
  try {
    res = await transport({ method: "GET", url: `${relay.replace(/\/+$/, "")}/v1/join/${j.id}`, auth: "" });
  } catch {
    throw new SyncError("Couldn't reach the sync relay.");
  }
  if (res.status !== 200) return null;
  let message: JoinMessage | null = null;
  try {
    const body = (JSON.parse(res.text) as { body?: string }).body ?? "";
    message = openJoin(j, Uint8Array.from(atob(body), (c) => c.charCodeAt(0)));
  } catch {
    // Unreadable, as below.
  }
  if (!message) throw new SyncError("That couldn't be read. Scan the code again.");
  return message;
}
