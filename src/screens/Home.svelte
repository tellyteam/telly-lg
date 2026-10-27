<script lang="ts">
  import Art from "../components/Art.svelte";
  import Card from "../components/Card.svelte";
  import Row from "../components/Row.svelte";
  import TopBar from "../components/TopBar.svelte";
  import type { Channel, Series } from "../lib/model";
  import * as P from "../lib/playback";
  import { app } from "../lib/state.svelte";
  import { playChannel, playFilm } from "../lib/actions";

  // Something still to watch: a finished film or series never leads Home (PLAYBACK.md).
  const continuing = $derived(app.history.filter((h) => P.inContinue(h, app.progressOf)));
  const pick = $derived(continuing[0]);
  const pickIndex = $derived(pick ? P.continueIndex(pick, app.progressOf) : 0);
  const pickItem = $derived(pick?.items[pickIndex]);
  const pickProgress = $derived(pickItem ? app.progressOf(pickItem.url) : undefined);
  const pickSeries = $derived(pick?.seriesId ? app.seriesItem(pick.seriesId) : undefined);
  const nextUp = $derived(!!pick && pickIndex !== pick.index);

  const favs = $derived(app.favouriteItems());
  const newFilms = $derived(app.recentlyAdded(app.films));
  const newSeries = $derived(app.recentlyAdded(app.series));
  // Nothing to pick up yet: the billboard features the newest film, as on the Fire TV app.
  const featured = $derived(newFilms[0]);

  const openSeries = (s: Series) => app.go({ name: "seriesDetail", series: s });
  const openFilm = (f: Channel) => app.go({ name: "filmDetail", film: f });
  function badge(h: P.LastWatched) {
    if (h.live) return "Live";
    if (P.isFilm(h)) return "Film";
    if (h.newEpisodes) return "New episodes";
    const c = P.current(h);
    const s = c.group.replace(/^Season /, "S");
    const e = c.name.match(/^E(\d+)/)?.[1];
    return e ? `${s}:E${e}` : s;
  }
</script>

<div class="screen">
  <TopBar />
  {#if pick && pickItem}
    <!-- The billboard, as on the Fire TV app: what to watch next, its place, and Resume. -->
    <section class="hero">
      <div class="art"><div class="fade"><Art src={pickSeries?.cover ?? pick.art ?? pickItem.logo} title={pick.heading} /></div></div>
      <div class="copy">
        <div class="eyebrow">{pick.live ? "Last watched" : pick.newEpisodes ? "New episodes" : nextUp ? "Up next" : "Continue watching"}</div>
        <div class="title-xl">{pick.live || P.isFilm(pick) ? pickItem.name : pick.heading}</div>
        <div class="meta"><span>{pick.live ? "Live TV" : P.isFilm(pick) ? "Film" : `${pickItem.group} · ${pickItem.name}`}</span></div>
        {#if pickProgress && !pick.live && !P.finished(pickProgress)}
          <div class="hero-progress"><div class="progress"><i style:width="{P.fraction(pickProgress) * 100}%"></i></div></div>
        {/if}
        <div class="btns">
          <button class="btn primary" onclick={() => app.resume(pick)}>▶ {pick.live ? "Watch" : pickProgress && P.resumePosition(pickProgress) ? "Resume" : "Play"}</button>
          {#if pickSeries}<button class="btn" onclick={() => openSeries(pickSeries)}>Episodes</button>{/if}
        </div>
      </div>
    </section>
  {:else}
    <section class="hero">
      {#if featured}<div class="art"><div class="fade"><Art src={featured.logo} title={featured.name} /></div></div>{/if}
      <div class="copy">
        <div class="eyebrow">Welcome to telly</div>
        <div class="title-xl">{featured?.name ?? (app.provider?.kind === "m3u" ? "Live TV" : "Live TV, films and series")}</div>
        <div class="meta"><span>{featured ? "Recently added film" : "Pick something below to get started"}</span></div>
        <div style="height:16px"></div>
        {#if featured}<div class="btns"><button class="btn primary" onclick={() => playFilm(featured)}>▶ Play</button></div>{/if}
      </div>
    </section>
  {/if}

  {#if continuing.length}
    <Row title="Continue watching">
      {#each continuing.slice(0, 20) as h (P.slot(h))}
        {@const item = h.items[P.continueIndex(h, app.progressOf)]}
        {@const p = app.progressOf(item.url)}
        <Card variant="landscape" title={h.live ? item.name : P.isFilm(h) ? item.name : h.heading} image={h.art ?? item.logo}
          badge={badge(h)} progress={!h.live && p ? P.fraction(p) : undefined} playable onclick={() => app.resume(h)}
          onremove={() => app.removeFromHistory(h)} />
      {/each}
    </Row>
  {/if}
  {#if favs.series.length || favs.films.length}
    <Row title="My List" onSeeAll={() => app.go({ name: "mylist" })}>
      {#each favs.series as s (s.id)}<Card title={s.name} image={s.cover} fav={{ kind: "series", id: s.id }} dimmed onclick={() => openSeries(s)} />{/each}
      {#each favs.films as f (f.id)}<Card title={f.name} image={f.logo} fav={{ kind: "film", id: f.id }} dimmed onclick={() => openFilm(f)} />{/each}
    </Row>
  {/if}
  {#if favs.live.length}
    <Row title="Favourite channels">
      {#each favs.live as c (c.id)}<Card variant="chan" title={c.name} image={c.logo} playable onclick={() => playChannel(c, favs.live)} />{/each}
    </Row>
  {/if}
  {#if newFilms.length}
    <Row title="Recently added films" onSeeAll={() => app.go({ name: "films" })}>
      {#each newFilms as f (f.id)}<Card title={f.name} image={f.logo} fav={{ kind: "film", id: f.id }} onclick={() => openFilm(f)} />{/each}
    </Row>
  {/if}
  {#if newSeries.length}
    <Row title="Recently updated series" onSeeAll={() => app.go({ name: "series" })}>
      {#each newSeries as s (s.id)}<Card title={s.name} image={s.cover} fav={{ kind: "series", id: s.id }} onclick={() => openSeries(s)} />{/each}
    </Row>
  {/if}
  {#if !app.live && app.refreshing}
    <div class="empty"><b>Loading your lists…</b>The first load can take a minute with a big provider. After that telly opens instantly.</div>
  {/if}
</div>
