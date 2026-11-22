import { describe, expect, it } from "vitest";
import { arrange, arrangementText, noPrefs, toggleHidden, togglePinned } from "./categories";

const groups = ["News", "Sport", "Kids", "Films"].map((name) => ({ name }));
const names = (g: { name: string }[]) => g.map((x) => x.name);

describe("category arrangement", () => {
  it("keeps the provider's order until something is pinned or hidden", () => {
    expect(arrange(groups, noPrefs())).toBe(groups);
    expect(arrange(groups, undefined)).toBe(groups);
  });

  it("puts pinned first in the order pinned, and leaves hidden out", () => {
    let p = togglePinned(noPrefs(), "Kids");
    p = togglePinned(p, "Sport");
    p = toggleHidden(p, "Films");
    expect(names(arrange(groups, p))).toEqual(["Kids", "Sport", "News"]);
    expect(arrangementText(p)).toBe("2 pinned, 1 hidden");
  });

  it("pinning shows a hidden one, hiding unpins, and both toggle back", () => {
    let p = toggleHidden(noPrefs(), "News");
    p = togglePinned(p, "News");
    expect(p).toEqual({ pinned: ["News"], hidden: [] });
    p = toggleHidden(p, "News");
    expect(p).toEqual({ pinned: [], hidden: ["News"] });
    expect(toggleHidden(p, "News")).toEqual(noPrefs());
    expect(togglePinned(togglePinned(noPrefs(), "A"), "A")).toEqual(noPrefs());
  });

  it("ignores a pinned category the provider no longer has", () => {
    expect(names(arrange(groups, { pinned: ["Gone", "Films"], hidden: [] }))).toEqual(["Films", "News", "Sport", "Kids"]);
  });
});
