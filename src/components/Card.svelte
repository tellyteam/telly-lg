<script lang="ts">
  import Art from "./Art.svelte";
  import { app, type FavKind } from "../lib/state.svelte";

  let {
    variant = "poster", title, image, onclick, badge, progress, playable = false, fav, caption = true, onremove, dimmed = false, autofocus = false,
    removing = false,
  }: {
    variant?: "poster" | "landscape" | "chan";
    title: string;
    image?: string;
    onclick: () => void;
    badge?: string;
    progress?: number;
    playable?: boolean;
    fav?: { kind: FavKind; id: string };
    caption?: boolean;
    /** Shows a ✕ on hover (Continue watching). */
    onremove?: () => void;
    /** In My List a watched poster is dimmed a little; the label and title stay at full strength. */
    dimmed?: boolean;
    /** The stop a new screen starts on (See all's first title). */
    autofocus?: boolean;
    /** Its row is in Remove mode (TVs): a ✕ shows, and OK takes it off the row. */
    removing?: boolean;
  } = $props();

  const on = $derived(fav ? app.isFavourite(fav.kind, fav.id) : false);
  // ✓ Watched in place of a progress bar (PLAYBACK.md, Watched titles).
  const watched = $derived(fav && fav.kind !== "live" ? app.isWatched(fav.kind, fav.id) : false);
  let broken = $state(false);
  // Some providers use widescreen pictures rather than logos for channels: those fill the tile.
  let picture = $state(false);
</script>

<div class="card {variant}" class:removing class:picture class:faded={watched && dimmed} role="button" tabindex="0" data-autofocus={autofocus || undefined} {onclick} onkeydown={(e) => e.key === "Enter" && !e.defaultPrevented && onclick()} title={title}>
  <div class="art">
    {#if variant === "chan"}
      <Art src={image} {title} fit={picture ? "cover" : "contain"} onsize={(r) => (picture = r >= 1.55 && r <= 2.1)} />
    {:else}
      <Art src={image} {title} onfail={() => (broken = true)} />
      <!-- The title is written on the picture only when there's no picture; it's always below too. -->
      {#if !image || broken}<div class="shade"></div><div class="ttl">{title}</div>{/if}
    {/if}
  </div>
  {#if badge}<div class="badge">{badge}</div>{:else if watched}<div class="badge">✓ Watched</div>{/if}
  {#if progress !== undefined && !watched}<div class="bar"><div class="progress"><i style:width="{Math.round(progress * 100)}%"></i></div></div>{/if}
  {#if playable}<div class="play"><b>▶</b></div>{/if}
  {#if fav}
    <button class="heart" class:on title={on ? "Remove from My List" : "Add to My List"}
      onclick={(e) => { e.stopPropagation(); app.toggleFavourite(fav.kind, fav.id); }}>♥</button>
  {/if}
  {#if onremove}
    <button class="heart remove" title="Remove from Continue watching" aria-label="Remove {title} from Continue watching"
      onclick={(e) => { e.stopPropagation(); onremove(); }}>✕</button>
  {/if}
  {#if removing}<span class="x" aria-hidden="true">✕</span>{/if}
  {#if caption}<div class="cap">{title}</div>{/if}
</div>
