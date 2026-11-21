# Speed on TVs

A TV's processor is a fraction of a Mac's, and telly draws a 1920×1080 screen (a 960×540 page at
zoom 2). Code that's instant on a Mac can take most of a second per remote press on a TV. Most of
that time is the TV redrawing pixels, not running telly's code. These are the rules that keep it
quick, the check that enforces them, and the test that measures it on a real TV.

## The rules

1. **Animate only `transform` and `opacity`.** A TV can move and fade something already drawn on its
   GPU. Animating a size, position, colour, shadow or glow redraws it every frame.
   - On a TV, `app.css` turns all transitions off (`html.tv * { transition: none !important }`),
     then switches back on a short list of GPU-only ones with `!important`: rows and chips sliding,
     the menu's panel, wordmark and labels, and the player's controls fading.
   - Focus changes on a TV are instant. That's normal for TV apps, and cheap.
2. **Don't scroll sideways.** A TV's Chromium redraws a scrolled row on every frame of the scroll.
   Rows and chips slide with a transform instead (`slide()` in `src/lib/tv.ts`), inside a clipping
   `.row` or `.track-clip`.
3. **Don't change sizes to open things.** The side menu is always its open width. Opening fades and
   slides a panel in; it doesn't resize the menu.
4. **Keep expensive pictures on their own layer.** The billboard's artwork, with its fades, has
   `will-change: transform`, so it's drawn once and not again each time focus moves near it.
5. **No `backdrop-filter`** where a TV shows it. It redraws everything behind it on every frame.
6. **OK acts once.** On a TV, `tv.ts` clicks what OK is pressed on and marks the key handled
   (`preventDefault`). An element's own Enter handler checks `e.defaultPrevented`.

## The check

The TV builds (`npm run build`, `npm run build:tizen`) fail on CSS that breaks rules 1, 2 and 5:

- a transition of a layout property (`width`, `height`, `top`, `left`, `margin…`, `padding…`,
  `font-size`, …)
- an `!important` transition of anything but `transform` or `opacity`, since those are the only
  ones that run on a TV
- `backdrop-filter` anywhere but the top bar's search, which TVs hide

It lives in `vite.config.ts` (`tvCheck`), next to the checks for CSS that 2020 TVs can't read.

## The test

`scripts/tv-speed.mjs` presses the remote through telly's web inspector and records Chromium's
timeline. For each scenario it reports per press:

- **main ms/press:** how long the page's main thread was busy. This includes waiting for drawing to
  finish, so it's the best single measure of lag.
- **longest task:** the longest single stall.
- **raster ms/press:** drawing work on the TV's raster threads.
- **repainted Mpx:** how much of the screen was redrawn. 2 Mpx is a whole screen.

The scenarios are ▶ along a row, ▼ between rows, the side menu, Live TV's channel list, Films'
category rows and its chips. It moves around but plays nothing and changes no settings.

It fails if any scenario is more than 25% slower than that TV's recorded baseline in
`scripts/speed/`. Run it on the slowest TV first. So far that's the Samsung (QE32LS03C, a 2023
32-inch Frame, Tizen 9).

### On the Samsung

With the TV connected (SAMSUNG.md) and telly installed:

```bash
~/tizen-studio/tools/sdb -s TV_IP:26101 shell 0 debug TellyTV001.telly
```

That prints `… debug 1 port: NNNNN`. Forward that port:

```bash
~/tizen-studio/tools/sdb -s TV_IP:26101 forward tcp:9333 tcp:NNNNN
```

```bash
npm run speed -- --inspector http://127.0.0.1:9333 --baseline scripts/speed/samsung-qe32ls03c.json
```

If `sdb connect` is refused while Tizen's Certificate Manager is open, it's running sdb in a
restricted mode. Stop it (`pkill -f "sdb fork-server"`) and start sdb again.

`shell 0 debug` only works when telly isn't running: if it's open (even in the background), the
command waits forever and prints nothing, and sdb's kill commands don't close it. Installing the
`.wgt` again closes it and keeps its data, and then `debug` answers at once:

```bash
~/tizen-studio/tools/ide/bin/tizen install -n build-tizen/telly_1.0.0.wgt -s TV_IP:26101
```

A TV woken from standby (or by Wake-on-LAN, when the TV's **Power On with Mobile** is on) takes
about 10 seconds before `sdb connect` works.

### A longer test on the Samsung

`scripts/tv-soak.mjs` runs telly on the TV for an hour (or `--minutes`) and writes a report folder.
It covers:

- cold starts
- this speed test three times, so a slowdown over the session shows up
- every screen with random remote presses (focus lost or off screen, Back to the same poster, text
  contrast)
- live TV (channel changes with CH + and CH −), a film and an episode: start time, stalls, seeking,
  tracks, pause and resume
- a loop round the app that watches memory

It launches telly itself (reinstalling `build-tizen`'s `.wgt` when `debug` hangs) and closes it at
the end:

```bash
node scripts/tv-soak.mjs --tv TV_IP --minutes 60 --mac TV_MAC
```

`--mac` wakes the TV with Wake-on-LAN if it's in standby. `--phases "live TV,film"` runs just
those. The script's opening comment lists the rest. It plays with sound, and what it watches
appears in Continue watching.

The inspector can't see live TV's picture: Samsung's own player shows MPEG-TS channels outside the
page, where its time stays at 0. Whether a channel shows a picture is for a person to check.

### On the LG

```bash
npx ares-inspect -d lounge -a io.github.tellyteam.telly
```

Leave that running, then:

```bash
npm run speed -- --inspector http://TV_IP:9998
```

The LG has no baseline yet. Record one with `--record scripts/speed/lg-oled42c4.json`.

After a change that's meant to be faster, record a new baseline with `--record` and commit it.
`--save /some/prefix` also writes each scenario's raw trace, which opens in Chrome's Performance
panel.

## Where the time goes now (Samsung, November 2026)

| Scenario | main ms/press | Before this work |
|---|---|---|
| ▶ along a row | ~190 | ~600, blocked |
| ▼ between rows | ~360 | ~810 |
| Side menu | ~280 | ~430, and ~1 s of drawing per open |
| Live TV list | ~130 | ~110 |
| Films rows | ~920–1,030 | ~1,050 |
| Chips | ~200 | ~400 |

What's left is mostly **posters being drawn for the first time** as they come into view. Each is a
600×900 JPEG scaled to 236×354, in software. That's why ▼ into Films, where each step brings a new
row of posters, costs the most.

**Measured and not done:** fetching each poster, scaling it once off the main thread and drawing it
into a `<canvas>` cut drawing along a row by about a third (94 → 61 ms per press). It needs a second
fetch of every poster, which made the provider briefly refuse images when 48 were fetched at once.
It also costs canvas memory, and it only works in a canvas: this Samsung won't show `data:` or
`blob:` images. Worth revisiting with limited fetching if posters become the main complaint.
