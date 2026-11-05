<script lang="ts">
  import { onMount, tick } from "svelte";
  import { app } from "../lib/state.svelte";
  import { pollPlus } from "../lib/plus";
  import QrCode from "../components/QrCode.svelte";

  /**
   * telly Plus, offered once after the first proper watch (or from Home's reminder), over Home. The
   * TV shows a QR code for the checkout on a phone, and closes itself once telly Plus is on.
   */
  let link = $state<string | null>(null);
  let asking = $state(false);
  let error = $state<string | null>(null);
  let first = $state<HTMLButtonElement>();
  let done = $state<HTMLButtonElement>();

  const close = () => (app.plusOffer = false);

  onMount(() => {
    const before = document.activeElement as HTMLElement | null;
    first?.focus();
    return () => before?.isConnected && before.focus({ preventScroll: true });
  });
  $effect(() => {
    if (app.plus?.until != null) close();
  });
  $effect(() => {
    if (!link) return;
    return pollPlus(() => app.refreshPlus());
  });

  async function get() {
    if (asking) return;
    asking = true;
    error = null;
    try {
      link = await app.plusCheckout();
      // Get telly Plus has gone: focus moves to Done.
      await tick();
      done?.focus();
    } catch (e) {
      error = (e as Error).message || "Couldn't get a link.";
    } finally {
      asking = false;
    }
  }

  /** Back (the remote's, or Esc) closes it, rather than going back a page underneath. */
  function onkeydowncapture(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }
</script>

<svelte:window {onkeydowncapture} />

<div class="offer" data-focus-scope role="dialog" aria-modal="true" aria-label="telly Plus">
  <div class="card-form">
    <h1>telly Plus</h1>
    <p class="lead">Pick up where you left off on your other devices: your phone, tablet and other TVs.</p>
    <p>Free for 3 days, then £4.99 a year, for every device in your household. Everything else in telly stays free.</p>
    {#if link}
      <div class="pair">
        <QrCode text={link} size={170} label="QR code to get telly Plus" />
        <p class="lead">Scan with your phone to get telly Plus. Paddle takes your card; you're not charged until the 3 days are up. telly turns on here once it's done.</p>
      </div>
    {/if}
    <div class="btns">
      {#if !link}<button class="btn primary" type="button" bind:this={first} disabled={asking} onclick={get}>{asking ? "Getting a link…" : "Get telly Plus"}</button>{/if}
      <button class="btn" type="button" bind:this={done} onclick={close}>{link ? "Done" : "Not now"}</button>
    </div>
    {#if error}<div class="error">{error}</div>{/if}
    <p class="hint">You'll find it later in Settings → Sync.</p>
  </div>
</div>

<style>
  .offer { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; overflow-y: auto; padding: 40px 20px; background: var(--bg); }
  .card-form { width: min(620px, 100%); display: flex; flex-direction: column; gap: 14px; padding: 30px;
    background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.06); border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,.35); }
  h1 { margin: 0; font-size: 34px; }
  p { margin: 0; }
  .lead { color: var(--muted); }
  .hint { margin: 0; }
  .pair { display: flex; gap: 24px; align-items: center; }
</style>
