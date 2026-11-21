import { describe, expect, it } from "vitest";
import { nearest } from "./tv";

/** A stand-in element at a position, for nearest(). */
const box = (name: string, left: number, top: number, width: number, height: number) =>
  ({ name, getBoundingClientRect: () => rect(left, top, width, height) }) as unknown as HTMLElement & { name: string };

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

describe("nearest", () => {
  it("moves along a row to the next item", () => {
    const a = box("a", 300, 0, 100, 40);
    expect((nearest(rect(100, 0, 100, 40), "ArrowRight", [a]) as typeof a)?.name).toBe("a");
  });

  it("doesn't step diagonally to something off the row that isn't wholly past this one", () => {
    // Edit at the right edge; a switch below it whose centre is a little further right (Settings).
    const sw = box("switch", 780, 140, 45, 30);
    expect(nearest(rect(750, 0, 70, 38), "ArrowRight", [sw])).toBeUndefined();
  });

  it("still moves off the row to something wholly past this one", () => {
    const next = box("next", 400, 100, 100, 40);
    expect((nearest(rect(100, 0, 100, 40), "ArrowRight", [next]) as typeof next)?.name).toBe("next");
  });

  it("moves down to the next row even when it starts further left", () => {
    const below = box("below", 0, 200, 300, 100);
    expect((nearest(rect(100, 0, 100, 40), "ArrowDown", [below]) as typeof below)?.name).toBe("below");
  });
});
