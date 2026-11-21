# telly for LG and Samsung TVs

A small, fast IPTV player for LG smart TVs (webOS 5 and later) and Samsung smart TVs (Tizen 5.5 and
later), both from 2020 onwards, driven entirely by the remote. It's the same app on both.
Bring your own provider (Xtream Codes or an M3U playlist); telly gives you a clean way to watch it.

- **Home** with Pick up where you left off, Continue watching, My List and recently added titles
- **Live TV** with categories, a live preview and the programme guide (now and next); CH+ and CH−
  change channel while you watch
- **Series and films** in rows, detail pages, seasons and episodes
- **Picks up where you left off**, including the next episode once the credits roll
- **My List** for films, series and channels
- **Aspect ratio** per channel or title, including a custom size
- **Set up from your phone:** scan the QR code on the TV and type your provider's details there
- **Remove…** at the end of Continue watching and the favourites rows, using only the remote's
  arrows, OK and Back
- Plays with the TV's own media player and hardware decoding (HLS, MPEG-TS, MKV, MP4)

telly contains no channels or content. You need your own subscription from an IPTV provider.

telly is also on [Android TV and Fire TV](https://github.com/tellyteam/telly-android) and
[iPad and Mac](https://github.com/tellyteam/telly-apple).

## Install

telly isn't in LG's or Samsung's store yet, so it's installed from a computer with the TV in
Developer Mode.

### LG

1. On the TV, install **Developer Mode** from the LG Content Store and sign in with a (free)
   [LG developer account](https://webostv.developer.lge.com). Turn on **Dev Mode Status** (the TV
   restarts), then **Key Server**. Note the TV's IP address and the passphrase it shows.
2. On your computer (with [Node](https://nodejs.org)), install LG's tools and add the TV:
   ```bash
   npm install -g @webos-tools/cli
   ares-setup-device --add tv --info "{'host':'TV_IP_ADDRESS','port':'9922','username':'prisoner'}"
   ares-novacom --device tv --getkey       # asks for the passphrase the TV shows
   ```
3. Download the latest `.ipk` from [Releases](https://github.com/tellyteam/telly-lg/releases/latest) and install it:
   ```bash
   ares-install --device tv io.github.tellyteam.telly_*.ipk
   ```

telly then appears with your other apps. Developer Mode lasts 50 hours at a time: open the
Developer Mode app and choose **Extend** now and then, or apps installed this way stop opening.
To update, install the new `.ipk` the same way; everything you've set up is kept.

### Samsung

A Samsung TV only installs apps signed with a Samsung certificate that names that TV, so there's no
ready-made download: you build telly and sign it for your TV. [SAMSUNG.md](SAMSUNG.md) has the
details. In short:

1. Install [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)
   with its **TV Extensions** and **Samsung Certificate Extension**.
2. On the TV, open **Apps**, then **App Settings** (on older TVs, the Apps page itself), and enter
   **1 2 3 4 5** on the remote. Turn **Developer mode** on with your computer's IP address, then
   restart the TV fully (unplug it for a minute).
3. Connect to the TV, then make a Samsung certificate profile named `telly` in Tizen Studio's
   Certificate Manager, with the TV connected so its ID is included. This needs a Samsung account.
4. Build, sign and install:
   ```bash
   npm install && npm run build:tizen
   ~/tizen-studio/tools/ide/bin/tizen install -n build-tizen/telly_*.wgt -t TV_NAME
   ```

Samsung's Developer Mode doesn't run out like LG's. The certificate lasts about a year; renew it
in Certificate Manager to keep installing updates.

## Privacy

- telly talks only to your provider, and to telly's relay while Setup shows its QR code. No accounts,
  analytics, adverts or tracking.
- Your provider login, history, progress and My List stay on the TV, in telly's own storage.
- Your login is never part of sync. If you send it from your phone to the QR code on Setup,
  it's sealed so only this TV can read it, and the TV shows it to you to check before it connects.
- Plain HTTP is refused unless you allow it for your provider (some providers have no HTTPS).

## How it works

The interface is Svelte and TypeScript, built as one classic script for the TV's web engine
(Chromium 68 on webOS 5 and 79 on webOS 6; 69 on Tizen 5.5. `src/lib/polyfills.ts` fills in what's
newer). Packaged webOS and Tizen apps may fetch from any address, so the TV talks to the provider
directly. One build serves both: `VITE_TARGET` (`.env.tizen`) picks Samsung's keys and app calls. Playback uses the TV's own player whenever it says it can play a stream, and
[hls.js](https://github.com/video-dev/hls.js) or [mpegts.js](https://github.com/xqq/mpegts.js)
otherwise. The remote moves focus spatially (`src/lib/tv.ts`).

TVs have a fraction of a computer's power, so telly animates only what a TV's GPU can, and rows
slide rather than scroll. [SPEED.md](SPEED.md) has the rules, which the TV builds enforce, and
`npm run speed` measures a real TV against its baseline.

| Path | What's there |
|---|---|
| `src/lib/` | Provider parsing (Xtream, M3U, guide), catalogue cache, playback rules, state, remote control |
| `src/screens/`, `src/components/` | The interface |
| `webos/` | The app's `appinfo.json`, icons and splash (drawn by [telly-brand](https://github.com/tellyteam/telly-brand)) |
| `tizen/` | The Samsung app's `config.xml` and icon |
| `scripts/webos-pack.mjs` | Packs the build into an `.ipk` |
| `scripts/tizen-pack.mjs` | Signs and packs the Samsung build into a `.wgt` |
| `scripts/tv-speed.mjs`, `scripts/speed/` | The speed test on a real TV, and each TV's baseline |
| `dev/` | `npm run dev` helpers: a relay for the browser and a fake provider |

## Building from source

Requires Node 22+.

```bash
npm install
npm test           # unit tests
npm run build      # build-webos/io.github.tellyteam.telly_<version>_all.ipk
npm run build:tizen  # build-tizen/telly_<version>.wgt, for Samsung TVs: see SAMSUNG.md
npm run speed -- --inspector <url>   # speed on a real TV: see SPEED.md
```

LG's [webOS TV Simulator](https://webostv.developer.lge.com/develop/tools/simulator-introduction)
runs the build without a TV: `npx ares-launch -s 26 -sp <path to the Simulator> dist-webos`.

`npm run dev` runs the interface in an ordinary browser at http://localhost:5173, with a relay
standing in for the TV's direct access. To try it without a real provider, use the built-in fake
one: server `http://localhost:5173/__dev/fake`, any username and password, and allow plain HTTP.
A git-ignored `provider.local.properties` (`server`, `username`, `password`, or `type=m3u` with
`url`) pre-fills the setup screen in development only.

## Releasing

Push a version tag. GitHub Actions tests, builds the LG `.ipk` and attaches it to a draft release;
write the notes, then publish it. There's no Samsung download, since each `.wgt` is signed for
particular TVs.

```bash
git tag v1.0.0 && git push origin v1.0.0
```

## Licence

telly is free for personal, non-commercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use, including selling telly or bundling it with a paid service, needs permission: ask through GitHub.
