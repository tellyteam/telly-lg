<script lang="ts">
  import { app } from "../lib/state.svelte";
  import { CATEGORY_KINDS, type CategoryKind } from "../lib/categories";

  /**
   * Arranging one kind's categories, as on Fire TV: pin the ones used most to the top (in the order
   * pinned), hide the ones never watched. Hidden categories also stay out of Home and Search.
   */
  let { kind, onDone }: { kind: CategoryKind; onDone: () => void } = $props();

  const label = $derived(CATEGORY_KINDS.find((k) => k.kind === kind)!.label);
  const prefs = $derived(app.categories[kind] ?? { pinned: [], hidden: [] });
  const groups = $derived(app.allCategories(kind));
  const changed = $derived(prefs.pinned.length > 0 || prefs.hidden.length > 0);
</script>

<div class="panel"><h4>{label} categories</h4>
  <div class="line"><div><small>Pin a category to put it at the top; pinned categories appear in the order you pin them. Hide the ones you never watch.</small></div>
    <div class="btns"><button class="btn small primary" onclick={onDone}>Done</button>
      {#if changed}<button class="btn small" onclick={() => app.resetCategories(kind)}>Reset to the provider's order</button>{/if}</div></div>
  {#each groups as g (g.name)}
    {@const pinnedAt = prefs.pinned.indexOf(g.name)}
    {@const hidden = prefs.hidden.includes(g.name)}
    <div class="line" class:hidden-row={hidden}><div>{g.name}<small>{g.items.length.toLocaleString()} · {hidden ? "Hidden" : pinnedAt >= 0 ? `Pinned ${pinnedAt + 1}` : "Shown"}</small></div>
      <div class="btns"><button class="btn small" onclick={() => app.togglePinned(kind, g.name)}>{pinnedAt >= 0 ? "Unpin" : "Pin"}</button>
        <button class="btn small" onclick={() => app.toggleHidden(kind, g.name)}>{hidden ? "Show" : "Hide"}</button></div></div>
  {/each}
</div>

<style>
  .hidden-row { opacity: .55; }
</style>
