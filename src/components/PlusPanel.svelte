<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "../lib/state.svelte";
  import { dayText, pollPlus } from "../lib/plus";
  import QrCode from "./QrCode.svelte";

  /**
   * Settings → Sync's telly Plus: on (until when), or Get telly Plus. Buying happens on a phone: a
   * QR code opens Paddle's checkout for this household, and the TV waits for the relay to hear of
   * it. [onLink]: the payment's QR code is up, so the sync code's can go (one code to scan).
   */
  let { onLink }: { onLink: () => void } = $props();

  let link = $state<string | null>(null);
  let asking = $state(false);
  let error = $state<string | null>(null);

  onMount(() => void app.refreshPlus());
  $effect(() => {
    if (!link || app.plus?.until != null) return;
    return pollPlus(() => app.refreshPlus());
  });
  $effect(() => {
    if (app.plus?.until != null) link = null;
  });

  async function get() {
    if (asking) return;
    asking = true;
    error = null;
    try {
      link = await app.plusCheckout();
      onLink();
    } catch (e) {
      error = (e as Error).message || "Couldn't get a link.";
    } finally {
      asking = false;
    }
  }
</script>

{#if app.plus?.until != null}
  <div class="line"><div>telly Plus is on for this household<small>Until {dayText(app.plus.until)}.</small></div></div>
{:else if app.plus?.onSale && link}
  <div class="line sync-link"><QrCode text={link} size={150} label="QR code to get telly Plus" />
    <div><b>Scan with your phone to get telly Plus</b>
      <small>Free for 3 days, then £4.99 a year, for every device in this household. Paddle takes your card; you're not charged until the 3 days are up.</small>
      <small>Already have telly Plus? Scan it too, and paste the transaction number from your Paddle receipt to move it here.</small></div></div>
{:else if app.plus?.onSale}
  <div class="line"><div>telly Plus<small>Sync is part of telly Plus: free for 3 days, then £4.99 a year, for every device in this household. Already have it, from a TV you've reset? Get telly Plus lets you move it here too.</small></div>
    <button class="btn small primary" disabled={asking} onclick={get}>{asking ? "Getting a link…" : "Get telly Plus"}</button></div>
{/if}
{#if error}<div class="notice">{error}</div>{/if}
