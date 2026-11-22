<script lang="ts">
  import { onDestroy } from "svelte";
  import TopBar from "../components/TopBar.svelte";
  import { isTV, syncTransport } from "../lib/backend";
  import { ago, app, RELAY } from "../lib/state.svelte";
  import { collectJoin, joinLink, newJoin, type JoinMessage } from "../lib/sync/join";
  import { syncIdentity } from "../lib/model";
  import { formatCode } from "../lib/sync/crypto";
  import { syncLink } from "../lib/sync/link";
  import { dayText } from "../lib/plus";
  import { connections, summary } from "../lib/account";
  import QrCode from "../components/QrCode.svelte";
  import PlainHttpSwitch from "../components/PlainHttpSwitch.svelte";
  import PlusPanel from "../components/PlusPanel.svelte";
  import CategoryManager from "../components/CategoryManager.svelte";
  import { arrangementText, CATEGORY_KINDS, type CategoryKind } from "../lib/categories";

  /** The kind of category being arranged, which takes over the page until Done. */
  let managing = $state<CategoryKind | null>(null);

  let confirmRemove = $state(false);
  let clearing = $state(false);
  let confirmClearProgress = $state(false);

  let joining = $state(false);
  let joinCode = $state("");
  let showCode = $state(true);
  let linking = $state(false);
  let syncError = $state<string | null>(null);

  async function link(code?: string) {
    linking = true;
    syncError = null;
    try {
      await app.startSync(code);
      joining = false;
      joinCode = "";
      showCode = true;
    } catch (e) {
      syncError = (e as Error).message;
      if (!app.syncStatus.at) await app.stopSync();
    } finally {
      linking = false;
    }
  }

  /**
   * Scan to link: the first run's join QR code, here too, for a device already set up. telly on a
   * phone or tablet in the household scans it (Settings → Set up a TV) and leaves what it sends in the
   * relay's join box, sealed so only this device can read it. Like every QR code telly shows, it takes
   * whatever comes: a link code links; a provider this device doesn't have goes to Add provider,
   * filled in to check (which links with the code first, if one came too); one it has already is
   * left alone.
   */
  async function received(m: JoinMessage) {
    const isNew = m.provider && !app.providers.some((s) => syncIdentity(s.provider) === syncIdentity(m.provider!));
    if (isNew) {
      scanning = false;
      app.received = { provider: m.provider!, code: m.code };
      app.go({ name: "setup", adding: true });
    } else if (m.code) {
      scanning = false;
      await link(m.code);
    } else {
      syncError = `This ${isTV ? "TV" : "browser"} already has that provider. To link it, send it from a phone with telly Plus.`;
    }
  }
  let scanning = $state(false);
  let scanJoin = $state(newJoin());
  let scanTimer: ReturnType<typeof setInterval> | undefined;
  $effect(() => {
    clearInterval(scanTimer);
    if (!scanning) return;
    const current = scanJoin;
    let asks = 0;
    // Asked every 3 seconds; one code is kept for 9 minutes, inside the box's 10.
    scanTimer = setInterval(async () => {
      if (linking) return;
      if (++asks > 180) { scanJoin = newJoin(); return; }
      try {
        const found = await collectJoin(syncTransport, RELAY, current);
        if (!found) return;
        clearInterval(scanTimer);
        scanJoin = newJoin();
        await received(found);
      } catch (e) {
        syncError = (e as Error).message;
        scanJoin = newJoin();
      }
    }, 3000);
    if (import.meta.env.DEV) console.info("settings join QR:", encodeURIComponent(joinLink(current)));
  });
  onDestroy(() => clearInterval(scanTimer));

  // Seven clicks on the version in a row show (or hide) the Sync section.
  let versionClicks = 0;
  let versionTimer: ReturnType<typeof setTimeout> | undefined;
  let unlockNote = $state<string | null>(null);
  function clickVersion() {
    clearTimeout(versionTimer);
    versionTimer = setTimeout(() => (versionClicks = 0), 3000);
    if (++versionClicks < 7) return;
    versionClicks = 0;
    unlockNote = app.toggleSyncUnlocked() ? "Sync is now in Settings." : "Sync hidden.";
    setTimeout(() => (unlockNote = null), 3000);
  }

  const p = $derived(app.provider!);
  // The subscription's details afresh each time Settings opens, as on Fire TV.
  $effect(() => { if (p.kind === "xtream") void app.loadAccount(); });
  const toggle = (key: "autoNext") => { app.settings[key] = !app.settings[key]; app.saveSettings(); };
</script>

<div class="screen">
  <TopBar search={false} />
  <div class="page-head" style="padding-bottom:14px"><h2>Settings</h2></div>
  <div class="settings">
    {#if managing}
    <CategoryManager kind={managing} onDone={() => (managing = null)} />
    {:else}
    <div class="panel"><h4>{app.providers.length > 1 ? "Providers" : "Provider"}</h4>
      {#each app.providers as saved (saved.id)}
        {@const inUse = saved.id === app.activeId}
        <div class="line"><div>{inUse && app.providers.length > 1 ? "✓ " : ""}{saved.provider.name}<small>{saved.provider.kind === "xtream" ? "Username and password" : "Playlist link"} · login kept {isTV ? "on this TV" : "in this browser (development)"}</small></div>
          <div class="btns">{#if !inUse}<button class="btn small" onclick={() => app.switchProvider(saved.id)}>Use</button>{/if}
            <button class="btn small" onclick={() => app.go({ name: "setup", editing: saved.id })}>Edit</button></div></div>
      {/each}
      <div class="line"><div>{app.providers.length > 1 ? "Each provider keeps its own My List, progress and Continue watching." : ""}</div>
        <div class="btns"><button class="btn small" onclick={() => app.go({ name: "setup", adding: true })}>Add another provider</button>
          {#if confirmRemove}<button class="btn small" onclick={() => { confirmRemove = false; if (app.activeId) void app.removeProvider(app.activeId); }}>Remove {p.name}</button><button class="btn small" onclick={() => (confirmRemove = false)}>Cancel</button>
          {:else}<button class="btn small" onclick={() => (confirmRemove = true)}>Remove {p.name}…</button>{/if}</div></div>
      {#if p.kind === "xtream"}
        {@const details = app.account?.details}
        <div class="line"><div>{details ? `Subscription: ${summary(details, Date.now())}` : app.account?.error ?? "Checking your subscription…"}{#if details && connections(details)}<small>{connections(details)}</small>{/if}</div></div>
      {/if}
      <PlainHttpSwitch title="Allow plain HTTP for this provider" on={p.allowCleartext} onchange={(on) => app.setAllowCleartext(on)} />
    </div>
    <div class="panel"><h4>Playback</h4>
      <div class="line"><div>Play the next episode automatically<small>When the credits start, a countdown offers the next one</small></div>
        <button class="switch" class:on={app.settings.autoNext} aria-label="Play the next episode automatically" onclick={() => toggle("autoNext")}></button></div>
      {#if !isTV}
      <div class="line"><div>Keyboard<small>Space pause · ← → 10 seconds · ↑ ↓ volume · F full screen · N next episode · M mute · Esc back</small></div></div>
      {:else}
      <div class="line"><div>Remote<small>OK play or pause · ◀ ▶ 10 seconds · CH + / − change channel · Back to leave</small></div></div>
      {/if}
    </div>
    <div class="panel"><h4>Categories</h4>
      <div class="line"><div><small>Pin the categories you use most to the top, and hide the ones you never watch. Hidden categories also stay out of Home and Search.</small></div>
        <div class="btns">{#each CATEGORY_KINDS.filter((k) => app.allCategories(k.kind).length) as k (k.kind)}
          {@const extra = arrangementText(app.categories[k.kind])}
          <button class="btn small" onclick={() => (managing = k.kind)}>{extra ? `${k.label} · ${extra}` : k.label}</button>{/each}</div></div>
    </div>
    {#if app.syncShown}
    <div class="panel"><h4>Sync</h4>
      {#if app.sync && app.plus?.until != null}
        <div class="line"><div>Keeping your place in sync<small>{app.syncStatus.busy ? "Syncing now…" : `Last synced ${ago(app.syncStatus.at)}`} · telly Plus until {dayText(app.plus.until)}{app.syncStatus.error ? ` · ${app.syncStatus.error}` : ""}</small></div>
          <div class="btns"><button class="btn small" disabled={app.syncStatus.busy} onclick={() => app.syncNow()}>Sync now</button>
            <button class="btn small" onclick={() => app.stopSync()}>Stop syncing on this {isTV ? "TV" : "browser"}</button></div></div>
        <div class="line"><div>Link another device<small>Scan the QR code with your other device's camera, or enter the code in Settings → Sync on your other devices. Keep it private: anyone with it can see what you've watched.</small></div>
          <button class="btn small" onclick={() => (showCode = !showCode)}>{showCode ? "Hide code" : "Show code"}</button></div>
        {#if showCode}
          <div class="line sync-link"><QrCode text={syncLink(app.sync.code)} /><code class="sync-code">{formatCode(app.sync.code)}</code></div>
        {/if}
        <div class="line"><div>Provider logins are never part of sync<small>Sign in on each device, or send yours from your phone to the QR code on Setup.</small></div></div>
      {:else if app.sync && !app.plus}
        <div class="line"><div>Checking this household's telly Plus…</div></div>
      {:else}
        <!-- Sync is part of telly Plus, so it starts one of two ways: buying it (a household is made
             for it and linked once it's paid), or the code of a household that has it. A household
             whose telly Plus has run out gets the same, and its code stays hidden. -->
        <div class="line"><div>{app.sync ? "Sync is off: this household's telly Plus has run out" : "Pick up where you left off on your other devices"}<small>{app.sync ? "" : "Shares progress, Continue watching and My List, end-to-end encrypted. Provider logins are never part of sync, and the relay keeps no logs. "}Sync is part of telly Plus: free for 3 days, then £4.99 a year, for every device in your household.</small></div></div>
        <PlusPanel />
        <div class="line"><div></div>
          <div class="btns"><button class="btn small" disabled={linking} onclick={() => { scanning = !scanning; joining = false; syncError = null; }}>{scanning ? "Hide QR code" : "Scan to link"}</button>
            <button class="btn small" disabled={linking} onclick={() => { joining = !joining; scanning = false; }}>I already have telly Plus</button>
            {#if app.sync}<button class="btn small" onclick={() => { joining = false; scanning = false; app.stopSync(); }}>Unlink this {isTV ? "TV" : "browser"}</button>{/if}</div></div>
        {#if scanning}
          <div class="line sync-link"><QrCode text={joinLink(scanJoin)} size={150} label="QR code to link this {isTV ? 'TV' : 'browser'} from your phone" />
            <div><b>Scan with telly on your phone or tablet</b>
              <small>In telly on it, go to Settings → Set up a TV and scan this. It links this {isTV ? "TV" : "browser"} to your household's telly Plus, and can send a provider it doesn't have yet, with nothing to type. {linking ? "Linking…" : "Waiting for your phone…"}</small></div></div>
        {/if}
        {#if joining}
          <div class="line"><div class="field" style="flex:1"><input placeholder="ABCD-EFGH-JKMN-PQRS" bind:value={joinCode} maxlength="19" spellcheck="false" autocomplete="off" /><small class="hint">The code from Settings → Sync on one of your other devices.</small></div>
            <button class="btn small primary" disabled={linking || !joinCode.trim()} onclick={() => link(joinCode)}>{linking ? "Linking…" : "Link"}</button></div>
        {/if}
        {#if syncError}<div class="notice">{syncError}</div>{/if}
      {/if}
    </div>
    {/if}
    <div class="panel"><h4>About</h4>
      <!-- On a TV the whole row is the remote's target (seven presses of OK show Sync). -->
      <div class="line" role={isTV ? "button" : undefined} tabindex={isTV ? 0 : -1} onclick={isTV ? clickVersion : undefined} onkeydown={() => {}}><div><span role="presentation" onclick={isTV ? undefined : clickVersion}>telly {app.version}</span>{#if unlockNote} <span class="hint">· {unlockNote}</span>{/if}<small>{isTV ? "Installed from your computer in Developer Mode" : "Development build"}</small></div></div>
    </div>
    <div class="panel"><h4>Data</h4>
      <div class="line"><div>Refresh lists<small>{app.refreshing ? "Refreshing now…" : `Films, series and channels were updated ${ago(app.meta.updatedAt)}`}</small></div>
        <button class="btn small" disabled={app.refreshing} onclick={() => app.refresh()}>Refresh</button></div>
      <div class="line"><div>Clear saved lists<small>Downloads everything afresh. Your login, My List and progress are kept.</small></div>
        <button class="btn small" disabled={clearing || app.refreshing} onclick={async () => { clearing = true; await app.clearSavedData(); clearing = false; }}>{clearing ? "Clearing…" : "Clear"}</button></div>
      <div class="line"><div>Clear watch progress<small>Forgets where you got to in every film and episode, and empties Continue watching. My List is kept.{app.sync ? " Your linked devices are cleared too." : ""}</small></div>
        {#if confirmClearProgress}<div class="btns"><button class="btn small" onclick={() => { app.clearProgress(); confirmClearProgress = false; }}>Clear it all</button><button class="btn small" onclick={() => (confirmClearProgress = false)}>Cancel</button></div>
        {:else}<button class="btn small" onclick={() => (confirmClearProgress = true)}>Clear</button>{/if}</div>
    </div>
    {/if}
    <p class="hint">telly is free for personal use (PolyForm Noncommercial licence). It talks only to your provider, and to telly's relay while a setup QR code shows{app.syncShown ? " or if you turn on sync" : ""}. No accounts, analytics or tracking.</p>
  </div>
</div>
