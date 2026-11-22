/**
 * How the user arranged Live TV, film and series categories: some pinned to the top (in the order
 * pinned), some hidden. By name, per provider, kept on this TV only. The same rules as on Fire TV
 * (CategoryPrefs there).
 */

export type CategoryKind = "live" | "series" | "films";
export const CATEGORY_KINDS: { kind: CategoryKind; label: string }[] = [
  { kind: "live", label: "Live TV" },
  { kind: "series", label: "Series" },
  { kind: "films", label: "Films" },
];

export interface CategoryPrefs {
  pinned: string[];
  hidden: string[];
}

export type Arrangement = Partial<Record<CategoryKind, CategoryPrefs>>;

export const noPrefs = (): CategoryPrefs => ({ pinned: [], hidden: [] });

/** Pinned categories first in the order they were pinned, then the provider's order; hidden ones left out. */
export function arrange<G extends { name: string }>(groups: G[], prefs: CategoryPrefs | undefined): G[] {
  if (!prefs || (!prefs.pinned.length && !prefs.hidden.length)) return groups;
  const byName = new Map(groups.map((g) => [g.name, g]));
  const top = prefs.pinned.map((n) => byName.get(n)).filter((g): g is G => !!g);
  return [...top, ...groups.filter((g) => !prefs.hidden.includes(g.name) && !prefs.pinned.includes(g.name))];
}

/** Pinning shows a hidden category again; pinning again unpins it. */
export function togglePinned(p: CategoryPrefs, name: string): CategoryPrefs {
  return p.pinned.includes(name)
    ? { ...p, pinned: p.pinned.filter((n) => n !== name) }
    : { pinned: [...p.pinned, name], hidden: p.hidden.filter((n) => n !== name) };
}

/** Hiding also unpins. */
export function toggleHidden(p: CategoryPrefs, name: string): CategoryPrefs {
  return p.hidden.includes(name)
    ? { ...p, hidden: p.hidden.filter((n) => n !== name) }
    : { pinned: p.pinned.filter((n) => n !== name), hidden: [...p.hidden, name] };
}

/** "2 pinned, 1 hidden", or "" when the provider's order stands. */
export function arrangementText(p: CategoryPrefs | undefined): string {
  if (!p) return "";
  return [p.pinned.length ? `${p.pinned.length} pinned` : "", p.hidden.length ? `${p.hidden.length} hidden` : ""].filter(Boolean).join(", ");
}
