/**
 * The address a QR code carries to link another device: `telly://sync?code=…`. Sync always uses
 * telly's relay, so a `relay` an older app added is ignored.
 */
import { normaliseCode } from "./crypto";

export const syncLink = (code: string) => `telly://sync?code=${code}`;

/** The code from a link, or null if it isn't one. */
export function parseSyncLink(text: string): string | null {
  const m = text.trim().match(/^telly:\/\/sync\?(.*)$/i);
  return m ? normaliseCode(new URLSearchParams(m[1]).get("code") ?? "") : null;
}
