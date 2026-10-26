<script lang="ts">
  /** Drawn icons, sized to the text: some TVs' fonts lack symbols like ⌕ (webOS 5 shows a box). */
  let { name }: { name: "search" | "expand" } = $props();
</script>

<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
  {#if name === "search"}
    <circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" />
  {:else}
    <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
  {/if}
</svg>

<style>
  .icon-svg { width: 1em; height: 1em; vertical-align: -0.125em; flex: none; }
</style>
