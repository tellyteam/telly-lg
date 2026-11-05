<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "../lib/state.svelte";
  import { pollPlus } from "../lib/plus";
  import QrCode from "./QrCode.svelte";

  /**
   * Get telly Plus: a QR code opens Paddle's checkout on a phone, and the TV waits for the relay to
   * hear of the payment. The household links by itself once it's paid.
   */
  let link = $state<string | null>(null);
  let asking = $state(false);
  let error = $state<string | null>(null);

  onMount(() => void app.refreshPlus());
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
    } catch (e) {
      error = (e as Error).message || "Couldn't get a link.";
    } finally {
      asking = false;
    }
  }
</script>

{#if link}
  <div class="line sync-link"><QrCode text={link} size={150} label="QR code to get telly Plus" />
    <div><b>Scan with your phone to get telly Plus</b>
      <small>Free for 3 days, then £4.99 a year, for every device in your household. Paddle takes your card; you're not charged until the 3 days are up. Sync starts here as soon as it's done.</small></div></div>
{:else}
  <div class="line"><div></div><button class="btn small primary" data-autofocus disabled={asking} onclick={get}>{asking ? "Getting a link…" : "Get telly Plus"}</button></div>
{/if}
{#if error}<div class="notice">{error}</div>{/if}
