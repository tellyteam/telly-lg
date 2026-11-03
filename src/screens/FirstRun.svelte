<script lang="ts">
  import { onDestroy } from "svelte";
  import { isWebOS, syncTransport } from "../lib/backend";
  import { app, RELAY } from "../lib/state.svelte";
  import { collectJoin, joinLink, newJoin } from "../lib/sync/join";
  import Wordmark from "../components/Wordmark.svelte";
  import QrCode from "../components/QrCode.svelte";
  /**
   * telly's first run, the same on every device: Welcome, then joining the household's other
   * devices (if there are any). [onSetUp] goes on to the provider. Joining waits with Sync for the
   * hidden switch until telly Plus is on sale.
   */
  let { onSetUp }: { onSetUp: () => void } = $props();

  let step = $state<"welcome" | "join">("welcome");
  let join = $state(newJoin());
  let typing = $state(false);
  let code = $state("");
  let linking = $state(false);
  let error = $state<string | null>(null);
  const device = isWebOS ? "TV" : "computer";

  async function link(withCode: string) {
    linking = true;
    error = null;
    try {
      // Linked: the first run goes on to the provider by itself.
      await app.startSync(withCode);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      linking = false;
    }
  }

  // While the QR code shows, the relay is asked every few seconds whether a code has been left.
  let timer: ReturnType<typeof setInterval> | undefined;
  let asks = 0;
  $effect(() => {
    clearInterval(timer);
    if (step !== "join") return;
    const current = join;
    asks = 0;
    timer = setInterval(async () => {
      if (linking) return;
      if (++asks > 300) { join = newJoin(); return; }
      try {
        const found = await collectJoin(syncTransport, RELAY, current);
        if (found) { clearInterval(timer); await link(found); }
      } catch (e) {
        error = (e as Error).message;
        join = newJoin();
      }
    }, 3000);
    if (import.meta.env.DEV) console.info("join QR:", encodeURIComponent(joinLink(current)));
  });
  onDestroy(() => clearInterval(timer));

  /** Back (the remote's, or Esc) from Join returns to Welcome. */
  function onkeydowncapture(e: KeyboardEvent) {
    if (e.key === "Escape" && step === "join" && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      e.stopPropagation();
      step = "welcome";
    }
  }
</script>

<svelte:window {onkeydowncapture} />

<div class="setup">
  <div class="card-form">
    {#if step === "welcome"}
      <div class="wordmark big"><Wordmark height={44} /></div>
      <h1>Welcome to telly</h1>
      <p class="lead">Watch the TV you already pay for, on all your devices.</p>
      <ul>
        <li>No ads, no accounts, no tracking.</li>
        <li>Your login stays on this {device}.</li>
        <li>Pick up where you left off on your other devices.</li>
      </ul>
      <div class="btns">
        <button class="btn primary" type="button" data-autofocus onclick={onSetUp}>Set up telly</button>
        {#if app.syncShown}<button class="btn" type="button" onclick={() => (step = "join")}>I use telly on another device</button>{/if}
      </div>
      <p class="hint">telly doesn't come with any channels: you'll need a TV provider.</p>
    {:else}
      <h1>Join your other devices</h1>
      <p class="lead">Syncing is part of telly Plus. Without it, each device keeps its own progress.</p>
      <div class="pair">
        <QrCode text={joinLink(join)} />
        <div>
          <p class="lead">On your iPhone or iPad, open telly and go to Settings → Sync → Scan a new device's QR code.</p>
          <p class="hint">{linking ? "Linking…" : "Waiting for your other device…"}</p>
        </div>
      </div>
      <p class="hint">Or use another device's code, from Settings → Sync → Show code.</p>
      <div class="btns">
        <button class="btn" type="button" data-autofocus onclick={() => (typing = !typing)}>I have a code</button>
        <button class="btn" type="button" onclick={onSetUp}>Set up without syncing</button>
        <button class="btn" type="button" onclick={() => (step = "welcome")}>Back</button>
      </div>
      {#if typing}
        <div class="btns">
          <input class="code" bind:value={code} placeholder="ABCD-EFGH-JKMN-PQRS" autocomplete="off" spellcheck="false" autocapitalize="characters"
            onkeydown={(e) => { if (e.key === "Enter" && code.trim()) void link(code); }} />
          <button class="btn primary" type="button" disabled={linking || !code.trim()} onclick={() => link(code)}>{linking ? "Linking…" : "Link"}</button>
        </div>
      {/if}
      {#if error}<div class="error">{error}</div>{/if}
      <p class="hint">Provider logins are never shared: you'll sign in on this {device} next.</p>
    {/if}
  </div>
</div>

<style>
  .setup { position: absolute; inset: 0; display: grid; place-items: center; overflow-y: auto; padding: 40px 20px; }
  .card-form { width: min(620px, 100%); display: flex; flex-direction: column; gap: 14px; padding: 30px;
    background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.06); border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,.35); }
  .big { font-size: 46px; padding: 0; }
  h1 { margin: 0; font-size: 30px; }
  .lead { margin: 0; color: var(--muted); }
  .hint { margin: 0; }
  ul { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
  .pair { display: flex; gap: 20px; align-items: center; }
  .pair > div { display: flex; flex-direction: column; gap: 8px; }
  .code { font: inherit; font-family: ui-monospace, monospace; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.15);
    background: rgba(255,255,255,.06); color: var(--text); width: 260px; }
</style>
