/**
 * Catalogues saved as telly uses them, not as the provider sent them: only the fields shown, in
 * arrays rather than objects, so a TV reads tens of thousands of films in a fraction of the time
 * (parsing the provider's own answer was the slowest part of opening telly).
 *
 * Stream addresses are left out and rebuilt on reading: they carry the login, and the saved
 * catalogues never do.
 */
import type { Channel, Group, Series } from "./model";
import { streamUrl } from "./xtream";

const VERSION = 1;

type PackedChannel = [id: string, name: string, logo: string | null, added: number, epgId: string | null, ext: string];
type PackedSeries = [id: string, name: string, cover: string | null, plot: string | null, added: number];

export function packChannels(groups: Group<Channel>[]): string {
  return JSON.stringify({
    v: VERSION,
    g: groups.map((g) => [g.name, g.items.map((c): PackedChannel =>
      [c.id, c.name, c.logo ?? null, c.added ?? 0, c.epgId ?? null, c.url.slice(c.url.lastIndexOf(".") + 1)])]),
  });
}

/** The groups again, with each stream's address for [kind] ("live" or "movie"); undefined if it isn't a packed catalogue. */
export function unpackChannels(text: string, server: URL, kind: string, username: string, password: string): Group<Channel>[] | undefined {
  const data = parse(text);
  if (!data) return undefined;
  return (data.g as [string, PackedChannel[]][]).map(([name, items]) => ({
    name,
    items: items.map(([id, title, logo, added, epgId, ext]) => {
      const c: Channel = { id, name: title, group: name, url: streamUrl(server, kind, username, password, id, ext) };
      if (logo) c.logo = logo;
      // Films always carry it (0 when the provider gives none), as the provider's answer parses to.
      if (kind === "movie" || added) c.added = added;
      if (epgId) c.epgId = epgId;
      return c;
    }),
  }));
}

export function packSeries(groups: Group<Series>[]): string {
  return JSON.stringify({
    v: VERSION,
    g: groups.map((g) => [g.name, g.items.map((s): PackedSeries => [s.id, s.name, s.cover ?? null, s.plot ?? null, s.added ?? 0])]),
  });
}

export function unpackSeries(text: string): Group<Series>[] | undefined {
  const data = parse(text);
  if (!data) return undefined;
  return (data.g as [string, PackedSeries[]][]).map(([name, items]) => ({
    name,
    items: items.map(([id, title, cover, plot, added]) => {
      const s: Series = { id, name: title, group: name };
      if (cover) s.cover = cover;
      if (plot) s.plot = plot;
      s.added = added;
      return s;
    }),
  }));
}

function parse(text: string): { v: number; g: unknown[] } | undefined {
  try {
    const data = JSON.parse(text);
    return data?.v === VERSION && Array.isArray(data.g) ? data : undefined;
  } catch {
    return undefined;
  }
}
