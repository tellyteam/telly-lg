<script lang="ts">
  import { untrack } from "svelte";
  import { isTV, syncTransport } from "../lib/backend";
  import type { Provider } from "../lib/model";
  import { app, RELAY } from "../lib/state.svelte";
  import { collectJoin, joinLink, newJoin, type JoinMessage } from "../lib/sync/join";
  import Wordmark from "../components/Wordmark.svelte";
  import PlainHttpSwitch from "../components/PlainHttpSwitch.svelte";
  import QrCode from "../components/QrCode.svelte";

  /**
   * Signing in, one thing at a time, so the TV's keyboard stays up for one field and OK (or the
   * keyboard's Enter) goes on to the next: the kind of provider, then each detail, then a summary to
   * check and connect. Back goes back a step. Changing a saved provider starts at the summary.
   *
   * The first step also shows a QR code, so the details can be typed on a phone instead (or sent
   * from telly on it): they arrive sealed in the relay's join box and go to the summary, where
   * nothing is saved or contacted until Connect. Anyone who can see the screen could send details,
   * so the summary is the boundary.
   *
   * [editing]: the saved provider being changed; [adding]: another one, over the browse screens;
   * [onBack]: on the first run, back to Welcome.
   */
  let { editing, adding = false, onBack }: { editing?: string; adding?: boolean; onBack?: () => void } = $props();

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
  /** The QR code shows when signing in or adding a provider, not when changing a saved one. */
  const showsCode = !existing;
  /** One code is kept for 9 minutes (inside the box's 10), since typing on a phone takes a while. */
  const JOIN_LIFE = 9 * 60_000;
  let join = $state.raw(newJoin());
  let joinMade = Date.now();
  let linking = $state(false);
  /** The details on the summary came from a phone. */
  let sent = $state(false);

  // Development only: a git-ignored provider.local.properties pre-fills the first sign-in under `npm run dev`.
  if (import.meta.env.DEV && !inApp && !app.providers.length) {
    fetch("/__dev/provider").then((r) => r.json()).then((p: Record<string, string>) => {
      if (p.type === "m3u") { kind = "m3u"; url = p.url ?? ""; }
      else if (p.server) { kind = "xtream"; server = p.server; username = p.username ?? ""; password = p.password ?? ""; }
      name = p.name ?? name;
      allowCleartext = p.allowCleartext === "true";
    }).catch(() => {});
  }

  function renewJoin() {
    join = newJoin();
    joinMade = Date.now();
  }

  /** Details from a phone: link with a code sent with them (where joining is offered), then fill in the summary. */
  async function receive(m: JoinMessage) {
    renewJoin();
    error = null;
    if (m.code && app.syncShown && !app.sync) {
      linking = true;
      try {
        await app.startSync(m.code);
      } catch (e) {
        error = (e as Error).message;
      } finally {
        linking = false;
      }
    }
    const p = m.provider;
    if (!p) return;
    const failed = error;
    kind = p.kind;
    name = p.name;
    server = p.kind === "xtream" ? p.server : "";
    username = p.kind === "xtream" ? p.username : "";
    password = p.kind === "xtream" ? p.password : "";
    url = p.kind === "m3u" ? p.url : "";
    allowCleartext = p.allowCleartext;
    showPassword = false;
    fromReview = false;
    trail = ["kind"];
    sent = true;
    step = "review";
    error = failed;
  }

  // Sent from a phone to the first run's QR code: taken from memory, once.
  $effect(() => {
    const r = app.received;
    if (!r || !showsCode) return;
    app.received = null;
    untrack(() => void receive(r));
  });

  // While the first step shows, the relay is asked every 3 seconds whether details have been left.
  $effect(() => {
    if (step !== "kind" || !showsCode) return;
    const current = join;
    if (Date.now() - joinMade > JOIN_LIFE) { renewJoin(); return; }
    const timer = setInterval(async () => {
      if (linking) return;
      if (Date.now() - joinMade > JOIN_LIFE) { renewJoin(); return; }
      try {
        const found = await collectJoin(syncTransport, RELAY, current);
        if (found && current === join) { clearInterval(timer); await receive(found); }
      } catch (e) {
        if (current !== join) return;
        error = (e as Error).message;
        renewJoin();
      }
    }, 3000);
    if (import.meta.env.DEV) console.info("setup QR:", encodeURIComponent(joinLink(current)));
    return () => clearInterval(timer);
  });

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
    sent = false;
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
    if (e.key === "Escape" && (back() || (onBack && !(e.target instanceof HTMLInputElement) && (onBack(), true)))) {
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

<!-- Pieces the TV and the larger screens arrange differently. -->
{#snippet choiceButtons()}
  <button type="button" class="choice" data-autofocus onclick={() => choose("xtream")}><b>Username and password</b><small>With a server address</small></button>
  <button type="button" class="choice" onclick={() => choose("m3u")}><b>Playlist link</b><small>One web address, often ending .m3u</small></button>
{/snippet}

{#snippet phone()}
  <div class="phone">
    <QrCode text={joinLink(join)} size={isTV ? 120 : 150} label="QR code to enter your details on your phone" />
    <p class="hint">{linking ? "Linking…" : "Scan with your phone to enter your details there."}</p>
  </div>
{/snippet}

{#snippet lead()}
  {#if step === "kind"}
    <p class="lead">{adding ? "Add another provider." : "Sign in with the details your TV provider gave you. telly doesn't come with any channels."}</p>
  {:else if step === "review"}
    <p class="lead">{existing ? "Your provider" : sent ? "Sent from your phone. Check the details, then connect: nothing is saved until you do." : "Check your details, then connect."}</p>
  {/if}
{/snippet}

{#snippet privacy()}
  {#if step === "kind" || step === "review"}
    <p class="hint">{isTV ? "Typed here, your login stays on this TV and goes only to your provider. Sent from your phone, it's sealed so only this TV can read it." : "Typed here, your login stays on this computer, in the macOS Keychain, and goes only to your provider. Sent from your phone, it's sealed so only this computer can read it."}</p>
  {/if}
{/snippet}

{#snippet body()}
  {#if step === "kind"}
    {#if showsCode && !isTV}
      <div class="pair">
        {@render phone()}
        <div class="here">
          <p class="hint">Or enter what your TV provider gave you here:</p>
          {@render choiceButtons()}
        </div>
      </div>
    {:else if showsCode}
      <div class="here">
        <p class="hint">Or enter what your TV provider gave you here:</p>
        {@render choiceButtons()}
      </div>
    {:else}
      <p class="hint">What did your provider give you?</p>
      <div class="choices">{@render choiceButtons()}</div>
    {/if}
    {#if error}<div class="error">{error}</div>{/if}
    {#if inApp && app.provider}<div class="btns"><button class="btn" type="button" onclick={() => app.goBack() || app.go({ name: "home" })}>Cancel</button></div>{/if}
    {#if onBack}<div class="btns"><button class="btn" type="button" onclick={onBack}>Back</button></div>{/if}

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
    <div class="summary">
      {#if kind === "xtream"}
        <button type="button" class="line" onclick={() => change("server")}><div>Server address<small>{server}</small></div><span class="edit">Change</span></button>
        <button type="button" class="line" onclick={() => change("username")}><div>Username<small>{username}</small></div><span class="edit">Change</span></button>
        <button type="button" class="line" onclick={() => change("password")}><div>Password<small>{"•".repeat(Math.min(password.length, 12))}</small></div><span class="edit">Change</span></button>
      {:else}
        <button type="button" class="line" onclick={() => change("url")}><div>Playlist address<small class="long">{url}</small></div><span class="edit">Change</span></button>
      {/if}
      <div class="field"><label for="name">Name (optional)</label><input id="name" bind:value={name} placeholder="Your provider" autocomplete="off" spellcheck="false" /></div>
      <PlainHttpSwitch title="Allow plain HTTP" on={allowCleartext} onchange={(on) => (allowCleartext = on)}
        hint={plainHttp ? "This address uses plain HTTP: turn this on only if your provider has no HTTPS. Your login and what you watch would be sent unencrypted." : undefined} />
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
      <h4>This {isTV ? "TV" : "browser"} is linked with your other devices</h4>
      <p class="hint">Add your provider to pick up where you left off on them: the same one, signed in the same way.</p>
      <div class="btns"><button class="btn small" type="button" onclick={() => app.stopSync()}>Stop syncing on this {isTV ? "TV" : "browser"}</button></div>
    </div>
  {/if}
{/snippet}

<!-- On a TV the whole card fits the 960×540 screen: telly, the intro and the QR code on the left, the
     step on the right. While typing, it sits at the top, above the TV's on-screen keyboard. -->
<div class="setup" class:typing={step !== "kind" && step !== "review"}>
  {#if isTV}
    <div class="card-form split">
      <div class="aside">
        <div class="wordmark big"><Wordmark height={32} /></div>
        {@render lead()}
        {#if step === "kind" && showsCode}{@render phone()}{/if}
        {@render privacy()}
      </div>
      <div class="main">{@render body()}</div>
    </div>
  {:else}
    <div class="card-form">
      <div class="wordmark big"><Wordmark height={44} /></div>
      {@render lead()}
      {@render body()}
      {@render privacy()}
    </div>
  {/if}
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
  .pair { display: flex; gap: 20px; align-items: flex-start; }
  .phone { flex: none; width: 150px; display: flex; flex-direction: column; gap: 8px; }
  .here { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
  .here .choice { padding: 14px 18px; }
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
  .split { width: 100%; max-width: 880px; display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 36px; align-items: start; padding: 22px 30px; }
  .aside, .main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .split .big { font-size: 32px; }
  .split .phone { width: 120px; margin-top: 4px; }
  /* flex-direction again with each gap: the build turns gap into margins for older TVs, rule by rule. */
  .split .here { flex-direction: column; gap: 10px; }
  .split .here .choice, .split .choice { padding: 12px 16px; flex-direction: column; gap: 4px; }
  .split .choice b { font-size: 16px; }
  .split .summary { gap: 2px; }
  .split .summary .line { padding-top: 2px; padding-bottom: 2px; }
  .split .error { padding: 7px 12px; }
  .split .btns { margin-top: 0; }
  .split .join { padding-top: 10px; }
</style>
