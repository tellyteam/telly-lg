/**
 * Remote-control support for LG and Samsung TVs: the arrow keys move focus to the nearest thing in that
 * direction, OK presses it, and the remote's Back, channel and media keys become the keys the
 * rest of telly already understands (Escape, PageUp/PageDown, space…).
 */

// Not things marked tabindex="-1": the rows' scroll arrows are for a mouse, and invisible on a TV.
// (Spelled out: :is() needs Chromium 88.)
const FOCUSABLE = ["button:not([disabled])", "a[href]", "input:not([disabled])", "select", "textarea", "[tabindex]"]
  .map((s) => `${s}:not([tabindex="-1"])`).join(", ");

/** LG and Samsung remote key codes, as the keys the app already handles. */
const KEYS: Record<number, string> = {
  461: "Escape", // Back (LG)
  10009: "Escape", // Back (Samsung)
  33: "PageUp", // Channel up (LG)
  34: "PageDown", // Channel down (LG)
  427: "PageUp", // Channel up (Samsung)
  428: "PageDown", // Channel down (Samsung)
  415: " ", // Play
  19: " ", // Pause
  10252: " ", // Play/pause (Samsung)
  412: "ArrowLeft", // Rewind
  417: "ArrowRight", // Fast forward
};

type Dir = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && !el.closest("[inert], [aria-hidden=true]");
}

/** The nearest focusable in [dir] from [from], preferring things in line with it. */
export function nearest(from: DOMRect, dir: Dir, candidates: HTMLElement[]): HTMLElement | undefined {
  const cx = from.left + from.width / 2, cy = from.top + from.height / 2;
  let best: HTMLElement | undefined, bestScore = Infinity;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    let along: number, across: number;
    switch (dir) {
      case "ArrowRight": along = r.left - from.right; across = Math.abs(y - cy); if (x <= cx + 1) continue; break;
      case "ArrowLeft": along = from.left - r.right; across = Math.abs(y - cy); if (x >= cx - 1) continue; break;
      case "ArrowDown": along = r.top - from.bottom; across = Math.abs(x - cx); if (y <= cy + 1) continue; break;
      case "ArrowUp": along = from.top - r.bottom; across = Math.abs(x - cx); if (y >= cy - 1) continue; break;
    }
    // Overlapping in the cross direction (same row or column) counts as perfectly in line.
    const overlaps = dir === "ArrowLeft" || dir === "ArrowRight"
      ? r.bottom > from.top && r.top < from.bottom
      : r.right > from.left && r.left < from.right;
    // Off the row (or column), only things wholly past this one: ▶ from a button at the right edge
    // shouldn't drop to a switch below that sits a few points further right.
    if (!overlaps && along < 0) continue;
    const score = Math.max(0, along) + (overlaps ? 0 : across * 3) + (overlaps ? 0 : 1000);
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

/**
 * Everything the remote can land on. Buttons inside a card (the ♥) aren't separate stops on a TV:
 * the card is one stop, and My List is on its page.
 */
function focusables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((el) => el.classList.contains("card") || !el.closest(".card"))
    .filter(visible);
}

/** The nearest ancestor that scrolls in [axis]. */
function scroller(el: HTMLElement, axis: "x" | "y"): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const style = getComputedStyle(p);
    const overflow = axis === "x" ? style.overflowX : style.overflowY;
    if ((overflow === "auto" || overflow === "scroll") && (axis === "x" ? p.scrollWidth > p.clientWidth : p.scrollHeight > p.clientHeight)) return p;
  }
  return null;
}

/**
 * Moves focus to [el] and brings it into view a section at a time, as the Fire TV app does: in a
 * row, about a card's width of room stays ahead (22%) and the first card keeps the page margin;
 * down the page, the whole row shows, heading and all, and the billboard brings back the top.
 */
export function focus(el: HTMLElement) {
  el.focus({ preventScroll: true });
  const track = el.closest<HTMLElement>(".track, .chips");
  if (track && getComputedStyle(track).overflowX === "visible") slide(track, el);
  else if (track && scroller(el, "x") === track) {
    const t = track.getBoundingClientRect(), r = el.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(track).paddingLeft) || 0, ahead = t.width * 0.22;
    let dx = 0;
    if (r.right > t.right - ahead) dx = r.right - (t.right - ahead);
    else if (r.left < t.left + pad) dx = r.left - (t.left + pad);
    if (dx) track.scrollBy({ left: dx, behavior: "smooth" });
  }
  const page = scroller(el, "y");
  if (!page) return el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  if (el.closest(".hero")) return page.scrollTo({ top: 0, behavior: "smooth" });
  const section = el.closest<HTMLElement>(".row, .detail-hero, .chips, .eps") ?? el;
  const v = page.getBoundingClientRect(), r = section.getBoundingClientRect();
  if (r.top < v.top) page.scrollBy({ top: r.top - v.top, behavior: "smooth" });
  else if (r.bottom > v.bottom) page.scrollBy({ top: Math.min(r.bottom - v.bottom, r.top - v.top), behavior: "smooth" });
}

/**
 * A row on a TV: it slides with a transform (app.css), by the same rule as scrolling: about a
 * card's width of room ahead, the first card at the page margin, and no further than its last card.
 */
function slide(track: HTMLElement, el: HTMLElement) {
  const box = track.parentElement!.getBoundingClientRect(), t = track.getBoundingClientRect(), r = el.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(track).paddingLeft) || 0, ahead = box.width * 0.22;
  const x = Number(track.dataset.x ?? 0);
  let dx = 0;
  if (r.right > box.right - ahead) dx = r.right - (box.right - ahead);
  else if (r.left < box.left + pad) dx = r.left - (box.left + pad);
  if (!dx) return;
  const last = track.lastElementChild?.getBoundingClientRect();
  const end = last ? last.right - t.left + pad : 0; // where the strip ends, unmoved
  const next = Math.max(0, Math.min(x + dx, end - box.width));
  track.dataset.x = String(next);
  track.style.transform = next ? `translateX(${-next}px)` : "";
}

/** Where focus was on a screen, so Back can put it there again: which stop it was, and how far down. */
export type FocusMark = { index: number; scroll: number };

export function markFocus(): FocusMark | undefined {
  const main = document.querySelector<HTMLElement>("main");
  const active = document.activeElement as HTMLElement | null;
  if (!main || !active || !main.contains(active)) return;
  const index = focusables(main).indexOf(active);
  return index < 0 ? undefined : { index, scroll: main.querySelector(".screen")?.scrollTop ?? 0 };
}

/**
 * Back on a screen: focus returns to where it was, with the page scrolled as it was. Rows render as
 * the page scrolls, so this keeps trying for a moment until the stop is there again.
 */
export function restoreFocus(mark: FocusMark) {
  let tries = 0;
  const step = () => {
    const main = document.querySelector<HTMLElement>("main");
    const page = main?.querySelector<HTMLElement>(".screen");
    if (page) page.scrollTop = mark.scroll;
    const el = main ? focusables(main)[mark.index] : undefined;
    if (el) return focus(el);
    if (++tries < 30) setTimeout(step, 50);
  };
  setTimeout(step);
}

/** Puts focus on the first thing in [root] when nothing has it (a new screen opened). */
export function focusFirst(root: ParentNode = document) {
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body && visible(active) && document.contains(active)) return;
  const main = (root as Document).querySelector?.("main") ?? root;
  // A page's main action first (Play on a film), then the first thing in it.
  const primary = [...main.querySelectorAll<HTMLElement>("[data-autofocus], .btn.primary:not([disabled])")].find(visible);
  const first = primary ?? focusables(main)[0] ?? focusables(root)[0];
  if (first) first.focus({ preventScroll: true });
}

/**
 * Starts remote-control handling. [suspended] says when something else (the player) handles the
 * arrow keys itself.
 */
export function startTv(suspendedBase: () => boolean) {
  // The player handles its own keys, except while the remote is in its control bar or a menu.
  const suspended = () => suspendedBase() && !(document.activeElement as HTMLElement | null)?.closest?.(".ctrls, .menu, .back");
  document.documentElement.classList.add("tv");

  window.addEventListener("keydown", (e) => {
    const mapped = KEYS[e.keyCode];
    if (mapped && e.key !== mapped) {
      // Re-send as the key telly understands; the original stops here.
      e.preventDefault();
      e.stopImmediatePropagation();
      (e.target ?? window).dispatchEvent(new KeyboardEvent("keydown", { key: mapped, bubbles: true, cancelable: true }));
      return;
    }
    if (suspended()) return;
    const dir = e.key as Dir;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(dir)) {
      // OK on something that only reacts to clicks. preventDefault marks it handled: an element's own
      // Enter handler checks e.defaultPrevented, so OK acts once, not twice.
      if (e.key === "Enter") {
        const t = e.target as HTMLElement;
        if (t?.getAttribute?.("role") === "button" || (t?.tabIndex >= 0 && !(t instanceof HTMLButtonElement || t instanceof HTMLInputElement || t instanceof HTMLAnchorElement))) {
          e.preventDefault();
          t.click();
        }
      }
      return;
    }
    const target = e.target as HTMLElement;
    // In a text field, Left and Right move the cursor until it reaches the end; then they leave it.
    if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && (dir === "ArrowLeft" || dir === "ArrowRight")) {
      const atEdge = dir === "ArrowRight" ? target.selectionEnd === target.value.length : target.selectionStart === 0;
      if (!atEdge) return;
    }
    if (target instanceof HTMLSelectElement) return;
    const active = document.activeElement as HTMLElement | null;
    const from = active && active !== document.body ? active.getBoundingClientRect() : new DOMRect(0, 0, 0, 0);
    const scope = active?.closest<HTMLElement>("[data-focus-scope]") ?? document;
    let candidates = focusables(scope).filter((el) => el !== active);
    // Up and Down stay on the page: past its last row they stop, rather than land in the side menu.
    // Left (from the first thing in a row) is the way to the menu.
    // Up and Down in the side menu stay in it, too.
    // So do Live TV's columns (data-focus-column): Down from the last channel stops there.
    if ((dir === "ArrowUp" || dir === "ArrowDown") && active) {
      const COLUMN = ".rail, [data-focus-column]";
      const column = active.closest(COLUMN);
      candidates = candidates.filter((el) => el.closest(COLUMN) === column);
    }
    // …and Left and Right leave the column (not to the filter box above the first channel), except to
    // something level with this in it (Watch → Favourite beside the preview).
    const ownColumn = active?.closest("[data-focus-column]");
    if (ownColumn && (dir === "ArrowLeft" || dir === "ArrowRight")) {
      const level = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.bottom > from.top && r.top < from.bottom; };
      candidates = candidates.filter((el) => !ownColumn.contains(el) || level(el));
    }
    // Left and Right stay in a row: past its end they stop, rather than land in another row.
    // Left from its first card still goes to the side menu.
    const track = active?.closest(".track");
    if (track && (dir === "ArrowLeft" || dir === "ArrowRight")) {
      candidates = candidates.filter((el) => track.contains(el) || (dir === "ArrowLeft" && !!el.closest(".rail")));
    }
    let next = nearest(from, dir, candidates);
    // Into the side menu: always its current page's item, not whichever is level with the card.
    if (next?.closest(".rail") && !active?.closest(".rail")) next = document.querySelector<HTMLElement>(".rail .nav.current") ?? next;
    // Into a list that names its way in (data-focus-enter, selectors tried in turn, e.g. the selected
    // channel, then the first): that, not whichever item is level with where focus was.
    const list = next?.closest<HTMLElement>("[data-focus-enter]");
    if (list && !list.contains(active)) {
      const way = list.dataset.focusEnter!.split(";").map((s) => focusables(list).find((el) => el.matches(s.trim()))).find(Boolean);
      if (way) next = way;
    }
    e.preventDefault();
    if (next) focus(next);
  }, true);

  // The TV's on-screen keyboard covers the bottom half: keep the field being typed in above it.
  window.addEventListener("focusin", (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
      // The whole field, so its label shows too.
      setTimeout(() => (t.closest(".field") ?? t).scrollIntoView({ block: "start", behavior: "smooth" }), 50);
    }
  });

  // A new screen (or its contents) appeared: make sure something has focus.
  new MutationObserver(() => {
    if (!suspended()) setTimeout(() => focusFirst());
  }).observe(document.body, { childList: true, subtree: true });
  // …and for the first screen, which may already be there.
  setTimeout(() => focusFirst());
}
