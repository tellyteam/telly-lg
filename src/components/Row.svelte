<script lang="ts">
  import type { Snippet } from "svelte";

  import { isTV } from "../lib/backend";

  /**
   * [onRemoving]: a row whose titles can be taken off it (Continue watching, favourites). On a TV the
   * remote can't reach a card's ✕, so the row ends in Remove…: OK on it, then OK on a card takes that
   * card off, and Done (or Back) finishes. [removing] says the row is in that mode.
   */
  let { title, onSeeAll, children, onRemoving, removing = false, variant = "poster" }: {
    title: string; onSeeAll?: () => void; children: Snippet;
    onRemoving?: () => void; removing?: boolean; variant?: "poster" | "landscape" | "chan";
  } = $props();
  let track: HTMLDivElement;
  const scroll = (dir: number) => track.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: "smooth" });
</script>

<section class="row">
  <h3>{title}{#if removing}<span class="removing-hint">OK removes · Back when done</span>{/if}{#if onSeeAll}<button onclick={onSeeAll}>See all ›</button>{/if}</h3>
  <button class="arrow l" aria-label="Scroll left" tabindex="-1" onclick={() => scroll(-1)}>‹</button>
  <div class="track" bind:this={track}>{@render children()}{#if onSeeAll}<div class="card poster seeall" role="button" tabindex="0" onclick={onSeeAll}
    onkeydown={(e) => e.key === "Enter" && !e.defaultPrevented && onSeeAll()}><span>See all ›</span></div>{/if}{#if isTV && onRemoving}<div
    class="card {variant} seeall remove-tile" class:on={removing} role="button" tabindex="0" onclick={onRemoving}
    onkeydown={(e) => e.key === "Enter" && !e.defaultPrevented && onRemoving()}><span>{removing ? "Done" : "Remove…"}</span></div>{/if}</div>
  <button class="arrow r" aria-label="Scroll right" tabindex="-1" onclick={() => scroll(1)}>›</button>
</section>
