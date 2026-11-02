<script lang="ts">
  import { img } from "../lib/backend";

  /** Provider artwork through the relay, with a calm generated gradient when there's none. */
  let { src, fallback, title, fit = "cover", onfail, onsize }: {
    src?: string;
    /** Shown when [src] gives no picture (missing, empty or broken). */
    fallback?: string;
    title: string; fit?: "cover" | "contain"; onfail?: () => void;
    /** The image's natural width ÷ height, once it has loaded. */
    onsize?: (ratio: number) => void;
  } = $props();
  // The addresses that gave no picture: src, then fallback, then the generated tile.
  let failedSrc = $state<string | undefined>();
  let failedFallback = $state<string | undefined>();
  const pick = $derived(img(src) && failedSrc !== src ? src : img(fallback) && failedFallback !== fallback ? fallback : undefined);
  const url = $derived(img(pick));
  function failed() {
    if (pick === src) failedSrc = src;
    else failedFallback = fallback;
    if (!(pick === src && img(fallback) && failedFallback !== fallback)) onfail?.();
  }

  const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const gradient = $derived.by(() => {
    const h = hue(title);
    return `linear-gradient(150deg, hsl(${h} 38% 42%) 0%, hsl(${(h + 35) % 360} 42% 26%) 55%, hsl(${(h + 60) % 360} 40% 14%) 100%)`;
  });
</script>

{#if url}
  <img src={url} alt="" loading="lazy" decoding="async" draggable="false" style:object-fit={fit} onerror={failed}
    onload={(e) => { const i = e.currentTarget as HTMLImageElement; if (i.naturalHeight) onsize?.(i.naturalWidth / i.naturalHeight); }} />
{:else if fit === "contain"}
  <span>{title.slice(0, 14)}</span>
{:else}
  <div class="fallback" style:background={gradient}></div>
{/if}
