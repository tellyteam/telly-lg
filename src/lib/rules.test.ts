import { describe, expect, it } from "vitest";
import cases from "./playback-cases.json";
import * as P from "./playback";

/** telly-sync's playback-cases.json (copied beside this file): every app runs the same cases. */
describe("PLAYBACK.md", () => {
  it.each(cases.prompt)("prompt: $name", (c) => {
    expect(P.promptSeconds(c.durationMs, c.positionMs, c.hasNext, c.autoNext, c.dismissed, c.live)).toBe(c.seconds);
  });
  it.each(cases.atEnd)("at the end: $name", (c) => {
    expect(P.advanceAtEnd(c.hasNext, c.autoNext, c.dismissed)).toBe(c.advance);
  });
  it.each(cases.watched)("watched: $name", (c) => {
    expect(P.watched(c.positionMs, c.durationMs)).toBe(c.watched);
  });
  it.each(cases.resume)("resume: $name", (c) => {
    expect(P.startAt(c.positionMs, c.durationMs)).toBe(c.startAt);
  });
  it.each(cases.continue)("continue watching: $name", (c) => {
    const watched = (i: number) => c.watched.includes(i);
    expect(P.continueAt(c.index, c.items, watched)).toBe(c.continueIndex);
    expect(P.shownInContinue(c.index, c.items, watched)).toBe(c.shown);
  });
  it.each(cases.nextPlayable)("next playable: $name", (c) => {
    expect(P.nextPlayable(c.index, c.items, (i) => c.downloaded.includes(i), c.online)).toBe(c.next);
  });
  it.each(cases.seriesNext)("series next: $name", (c) => {
    const seasons = c.seasons.map((ids, n) => ({ name: `Season ${n + 1}`, episodes: ids.map((id) => ({ id, name: id, group: "", url: `http://host/series/u/p/${id}.mkv` })) }));
    const next = P.episodeAfter(seasons, c.episode);
    expect(next && [seasons.findIndex((s) => s.episodes === next.episodes), next.index]).toEqual(c.next);
  });
  it.each(cases.myList)("My List: $name", (c) => {
    expect(P.myListOrder(c.list, (k) => c.watched.includes(k))).toEqual(c.order);
  });
  it.each(cases.leavesMyList)("leaves My List: $name", (c) => {
    expect(P.leavesMyList(c.kind)).toBe(c.leaves);
  });
  it("finds a film's id in its progress key", () => {
    expect(P.filmId("movie/4567.mkv")).toBe("4567");
    expect(P.filmId("series/1234.mkv")).toBeNull();
  });
});
