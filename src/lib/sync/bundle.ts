/**
 * A whole parcel (version 2): a section for each provider the device has, under its provider tag
 * (telly-sync PROTOCOL.md). Never holds provider logins: a `logins` field from older apps is
 * ignored. Reads version 1 parcels too, as one section for the provider the reader says (its only
 * one: with several it can't tell whose a version 1 parcel is).
 */
import { isTime, merge, parseSection, sectionObject, trim, type Parcel } from "./parcel";

export interface Bundle {
  at: number;
  sections: Record<string, Parcel>;
}

export const MAX_SECTIONS = 20;

const TAG = /^[0-9a-f]{16}$/;
export const isTag = (t: string) => TAG.test(t);

export function bundleJson(b: Bundle): string {
  const providers = Object.fromEntries(
    Object.entries(b.sections)
      .sort((x, y) => y[1].at - x[1].at)
      .slice(0, MAX_SECTIONS)
      .map(([tag, section]) => [tag, sectionObject(trim(section, b.at))]),
  );
  return JSON.stringify({ v: 2, at: b.at, providers });
}

/** Another device's parcel. [current] is the tag a version 1 parcel is read as (null: it's ignored). */
export function parseBundle(text: string, current: string | null): Bundle | null {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const at = isTime(raw.at) ? raw.at : 0;
  if (raw.v === 1) return { at, sections: current ? { [current]: parseSection(raw, at) } : {} };
  if (raw.v !== 2) return null;
  const sections: Record<string, Parcel> = {};
  for (const [tag, value] of Object.entries(raw.providers ?? {})) {
    if (isTag(tag) && value && typeof value === "object" && Object.keys(sections).length < MAX_SECTIONS) sections[tag] = parseSection(value, at);
  }
  return { at, sections };
}

/** [own] combined with others, section by section, for the providers [own] has. */
export function mergeBundles(own: Bundle, others: Bundle[], now: number): Bundle {
  const sections: Record<string, Parcel> = {};
  for (const [tag, section] of Object.entries(own.sections)) {
    sections[tag] = merge(section, others.flatMap((o) => (o.sections[tag] ? [o.sections[tag]] : [])), now);
  }
  return { at: now, sections };
}
