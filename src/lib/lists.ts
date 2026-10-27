import { sha256 } from "@noble/hashes/sha2.js";
import * as C from "./compact";
import { groupInOrder, type Channel, type Group, type Series } from "./model";
import * as X from "./xtream";

/**
 * The heavy part of loading a catalogue: reading the provider's answer (which can run to tens of
 * megabytes), converting it and packing it to save, or unpacking a saved copy. It runs in a web
 * worker (lists.worker.ts), so the TV's screen never stalls while lists load (telly-sync
 * PLAYBACK.md, Lists).
 */
export type Kind = "live" | "films" | "series";

interface Login {
  kind: Kind;
  /** The server's address, as X.serverUrl gives it. */
  server: string;
  username: string;
  password: string;
}

/** The provider's answer for [kind]: converted, or nothing when its fingerprint is [saved]. */
export interface Convert extends Login {
  op: "convert";
  bytes: ArrayBuffer;
  /** Category ids and names, in the provider's order. */
  cats: [string, string][];
  /** Live channels' stream format. */
  format?: string;
  saved?: string;
}

/** A saved copy, as compact.ts packed it. */
export interface Unpack extends Login {
  op: "unpack";
  text: string;
}

export type Job = Convert | Unpack;
export type Result =
  | { unchanged: true }
  | { unchanged?: false; groups: Group<Channel | Series>[]; packed?: string; fingerprint?: string };

export async function run(job: Job): Promise<Result> {
  const server = X.serverUrl(job.server);
  const path = job.kind === "live" ? "live" : "movie";
  if (job.op === "unpack") {
    const groups = job.kind === "series" ? C.unpackSeries(job.text) : C.unpackChannels(job.text, server, path, job.username, job.password);
    if (!groups) throw new Error("Not a saved catalogue");
    return { groups };
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(job.bytes));
  } catch {
    throw new Error("The provider did not return valid JSON. Check the server address.");
  }
  const cats = new Map(job.cats);
  const order = [...cats.values()];
  let groups: Group<Channel | Series>[], packed: string;
  if (job.kind === "series") {
    // No plots, as when saved (see compact.ts).
    const series = groupInOrder(X.series(cats, json).map(({ plot: _, ...s }) => s), order, (s) => s.group);
    groups = series;
    packed = C.packSeries(series);
  } else {
    const items = job.kind === "live"
      ? X.liveChannels(server, job.username, job.password, job.format ?? "ts", cats, json)
      : X.films(server, job.username, job.password, cats, json);
    const channels = groupInOrder(items, order, (c) => c.group);
    groups = channels;
    packed = C.packChannels(channels);
  }
  // Of the list as telly keeps it, not the provider's answer: some providers' answers differ every
  // time (in fields telly doesn't use) though the list is the same.
  const fingerprint = await fingerprintOf(new TextEncoder().encode(packed));
  return fingerprint === job.saved ? { unchanged: true } : { groups, packed, fingerprint };
}

/** The TV's own SHA-256 where it has one. */
async function fingerprintOf(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  let digest: Uint8Array;
  try {
    digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  } catch {
    digest = sha256(bytes);
  }
  return [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
