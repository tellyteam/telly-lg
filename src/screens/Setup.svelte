<script lang="ts">
  import { isWebOS } from "../lib/backend";
  import type { Provider } from "../lib/model";
  import { app } from "../lib/state.svelte";
  import Wordmark from "../components/Wordmark.svelte";

  /**
   * Signing in, one thing at a time, so the TV's keyboard stays up for one field and OK (or the
   * keyboard's Enter) goes on to the next: the kind of provider, then each detail, then a summary to
   * check and connect. Back goes back a step. Changing a saved provider starts at the summary.
   *
   * [editing]: the saved provider being changed; [adding]: another one, over the browse screens.
   */
  let { editing, adding = false }: { editing?: string; adding?: boolean } = $props();

  type Step = "kind" | "server" | "username" | "password" | "url" | "review";

  const existing = editing ? app.providers.find((s) => s.id === editing)?.provider ?? null : null;
  const inApp = !!existing || adding;
  let showPassword = $state(false);
  let kind = $state<"xtream" | "m3u">(existing?.kind ?? "xtream");
  let name = $state(existing?.name ?? "");
  let server = $state(existing?.kind === "xtream" ? existing.server : "");
  let username = $state(existing?.kind === "xtream" ? existing.username : "");
  let password = $state(existing?.kind === "xtream" ? existing.password : "");
  let url = $state(existing?.kind === "m3u" ? existing.url : "");
  let allowCleartext = $state(existing?.allowCleartext ?? false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let step = $state<Step>(existing ? "review" : "kind");
  /** Steps taken, for Back. */
  let trail = $state<Step[]>([]);
  /** Changing one detail from the summary: Next returns there. */
  let fromReview = $state(false);

  // Development only: a git-ignored provider.local.properties pre-fills the first sign-in under `npm run dev`.
  if (import.meta.env.DEV && !inApp && !app.providers.length) {
    fetch("/__dev/provider").then((r) => r.json()).then((p: Record<string, string>) => {
      if (p.type === "m3u") { kind = "m3u"; url = p.url ?? ""; }
      else if (p.server) { kind = "xtream"; server = p.server; username = p.username ?? ""; password = p.password ?? ""; }
      name = p.name ?? name;
      allowCleartext = p.allowCleartext === "true";
    }).catch(() => {});
  }

  const plainHttp = $derived((kind === "xtream" ? server : url).trim().toLowerCase().startsWith("http://"));
  const ready = $derived(kind === "xtream" ? !!(server.trim() && username.trim() && password) : !!url.trim());
  const fields: Record<"server" | "username" | "password" | "url", { label: string; hint: string; placeholder: string }> = {
    server: { label: "Server address", hint: "As your provider gave it, with its port: for example example.com:8080.", placeholder: "example.com:8080" },
    username: { label: "Username", hint: "Your provider's username for you.", placeholder: "" },
    password: { label: "Password", hint: "It stays on this TV, and is sent only to your provider.", placeholder: "" },
    url: { label: "Playlist address", hint: "The M3U link your provider gave you.", placeholder: "https://example.com/playlist.m3u" },
  };
  const order: Record<"xtream" | "m3u", Step[]> = { xtream: ["server", "username", "password", "review"], m3u: ["url", "review"] };

  function go(next: Step) {
    trail = [...trail, step];
    step = next;
    error = null;
  }

  function back(): boolean {
    if (!trail.length) return false;
    step = trail[trail.length - 1];
    trail = trail.slice(0, -1);
    fromReview = false;
    error = null;
    return true;
  }

  function choose(k: "xtream" | "m3u") {
    kind = k;
    go(order[k][0]);
  }

  /** On from a detail: to the next one, or back to the summary when changing one from there. */
  function next() {
    if (step === "kind" || step === "review" || !valueOf(step).trim()) return;
    if (fromReview) {
      fromReview = false;
      trail = trail.slice(0, trail.lastIndexOf("review"));
      step = "review";
      return;
    }
    const steps = order[kind];
    go(steps[steps.indexOf(step) + 1]);
  }

  function change(s: Step) {
    fromReview = true;
    go(s);
  }

  function valueOf(s: "server" | "username" | "password" | "url"): string {
    return s === "server" ? server : s === "username" ? username : s === "password" ? password : url;
  }

  function setValue(s: "server" | "username" | "password" | "url", v: string) {
    if (s === "server") server = v;
    else if (s === "username") username = v;
    else if (s === "password") password = v;
    else url = v;
  }

  /** Back (the remote's, or Esc) steps back before it leaves, even from a field. */
  function onkeydowncapture(e: KeyboardEvent) {
    if (e.key === "Escape" && back()) {
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === "Enter" && e.target instanceof HTMLInputElement && step !== "review") {
      e.preventDefault();
      next();
    }
  }

  async function connect() {
    if (!ready || busy) return;
    if (plainHttp && !allowCleartext) {
      error = "This address uses plain HTTP. Turn on “Allow plain HTTP” above if your provider has no HTTPS.";
      return;
    }
    busy = true;
    error = null;
    const label = name.trim() || "Your provider";
    const p: Provider = kind === "xtream"
      ? { kind, name: label, server: server.trim(), username: username.trim(), password, allowCleartext }
      : { kind, name: label, url: url.trim(), allowCleartext };
    try {
      await app.saveProvider(p, editing);
    } catch (err) {
      error = (err as Error).message || "Couldn't connect.";
    } finally {
      busy = false;
    }
  }

  const position = $derived(step === "kind" || step === "review" ? null : `${order[kind].indexOf(step) + 1} of ${order[kind].length - 1}`);
</script>

<svelte:window {onkeydowncapture} />

<div class="setup">
  <div class="card-form">
    <div class="wordmark big"><Wordmark height={44} /></div>

    {#if step === "kind"}
      <p class="lead">{adding ? "Add another provider." : "Add your IPTV provider to start watching. telly doesn't come with any channels."}</p>
      <p class="hint">What did your provider give you?</p>
      <div class="choices">
        <button type="button" class="choice" data-autofocus onclick={() => choose("xtream")}><b>Xtream Codes</b><small>A server address, username and password</small></button>
        <button type="button" class="choice" onclick={() => choose("m3u")}><b>M3U playlist</b><small>One playlist link</small></button>
      </div>
      {#if inApp && app.provider}<div class="btns"><button class="btn" type="button" onclick={() => app.goBack() || app.go({ name: "home" })}>Cancel</button></div>{/if}

    {:else if step !== "review"}
      {@const detail = step}
      {@const f = fields[detail]}
      <p class="step">{position}</p>
      <div class="field">
        <label for="detail">{f.label}</label>
        {#key step}
          <input id="detail" data-autofocus value={valueOf(step)} oninput={(e) => setValue(detail, e.currentTarget.value)}
            type={step === "password" && !showPassword ? "password" : "text"} placeholder={f.placeholder}
            autocomplete="off" spellcheck="false" autocapitalize="off" enterkeyhint="next" />
        {/key}
      </div>
      <p class="hint">{f.hint}</p>
      <div class="btns">
        <button class="btn primary" type="button" disabled={!valueOf(step).trim()} onclick={next}>{fromReview ? "Done" : "Next"}</button>
        {#if step === "password"}<button type="button" class="btn" onclick={() => (showPassword = !showPassword)}>{showPassword ? "Hide password" : "Show password"}</button>{/if}
        <button class="btn" type="button" onclick={back}>Back</button>
      </div>

    {:else}
      <p class="lead">{existing ? "Your provider" : "Check your details, then connect."}</p>
      <div class="summary">
        {#if kind === "xtream"}
          <button type="button" class="line" onclick={() => change("server")}><div>Server address<small>{server}</small></div><span class="edit">Change</span></button>
          <button type="button" class="line" onclick={() => change("username")}><div>Username<small>{username}</small></div><span class="edit">Change</span></button>
          <button type="button" class="line" onclick={() => change("password")}><div>Password<small>{"•".repeat(Math.min(password.length, 12))}</small></div><span class="edit">Change</span></button>
        {:else}
          <button type="button" class="line" onclick={() => change("url")}><div>Playlist address<small class="long">{url}</small></div><span class="edit">Change</span></button>
        {/if}
        <div class="field"><label for="name">Name (optional)</label><input id="name" bind:value={name} placeholder="Your provider" autocomplete="off" spellcheck="false" /></div>
        <div class="line">
          <div>Allow plain HTTP<small>{plainHttp ? "This address uses plain HTTP: turn this on if your provider has no HTTPS." : "Only if your provider has no HTTPS. Traffic to it won't be encrypted."}</small></div>
          <button type="button" class="switch" class:on={allowCleartext} aria-label="Allow plain HTTP" onclick={() => (allowCleartext = !allowCleartext)}></button>
        </div>
      </div>
      {#if error}<div class="error">{error}</div>{/if}
      <div class="btns">
        <button class="btn primary" type="button" data-autofocus disabled={!ready || busy} onclick={connect}>{busy ? "Connecting…" : existing ? "Save" : "Connect"}</button>
        {#if trail.length}<button class="btn" type="button" onclick={back}>Back</button>{/if}
        {#if inApp && app.provider}<button class="btn" type="button" onclick={() => app.goBack() || app.go({ name: "home" })}>Cancel</button>{/if}
      </div>
    {/if}

    {#if !inApp && app.sync && step === "kind"}
      <div class="join">
        <h4>This {isWebOS ? "TV" : "browser"} is still linked for sync</h4>
        <p class="hint">Add a provider to pick up where you left off on your other devices.</p>
        <div class="btns"><button class="btn small" type="button" onclick={() => app.stopSync()}>Stop syncing on this {isWebOS ? "TV" : "browser"}</button></div>
      </div>
    {/if}
    {#if step === "kind" || step === "review"}
      <p class="hint">{isWebOS ? "Your login stays on this TV. telly only talks to your provider." : "Your login stays on this computer, in the macOS Keychain. telly only talks to your provider, and to GitHub once a week to check for updates."}</p>
    {/if}
  </div>
</div>

<style>
  .setup { position: absolute; inset: 0; display: grid; place-items: center; overflow-y: auto; padding: 40px 20px; }
  .card-form { width: min(560px, 100%); display: flex; flex-direction: column; gap: 14px; padding: 30px;
    background: rgba(255,255,255,.035); border: 1px solid rgba(255,255,255,.06); border-radius: 18px; box-shadow: 0 30px 80px rgba(0,0,0,.35); }
  .big { font-size: 46px; padding: 0; }
  .lead { margin: 0; color: var(--muted); }
  .hint { margin: 0; }
  .step { margin: 0; color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: .06em; }
  .choices { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .choice { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 18px; text-align: left; cursor: pointer;
    border-radius: 14px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.08); color: var(--text); font: inherit; }
  .choice b { font-size: 18px; }
  .choice small { color: var(--muted); }
  .summary { display: flex; flex-direction: column; gap: 8px; }
  .summary .line { width: 100%; text-align: left; font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
  .summary small { overflow-wrap: anywhere; }
  .edit { color: var(--accent); font-size: 13px; font-weight: 600; }
  .join { display: flex; flex-direction: column; gap: 8px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,.08); }
  .join h4 { margin: 0; }
</style>
