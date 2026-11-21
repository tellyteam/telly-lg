# telly on Samsung TVs

The same app as on LG, built for Samsung's Tizen (2020 TVs and later, Tizen 5.5+): `npm run
build:tizen` makes `build-tizen/telly_<version>.wgt`. It isn't in Samsung's store, so for now it's
installed from a Mac with the TV in Developer Mode. Store plans: STORE.md (LG) has the shape;
Samsung needs partner status to launch outside the US.

| Path | What's there |
|---|---|
| `tizen/config.xml` | The app's description: ids, privileges (internet, the remote's media keys) |
| `tizen/icon.png` | The 512×423 Smart Hub icon (drawn by telly-brand) |
| `scripts/tizen-pack.mjs` | Signs and packs `dist-tizen` into a `.wgt` with Tizen Studio |
| `.env.tizen` | `VITE_TARGET=tizen`: `isTizen` / `isTV` in `src/lib/backend.ts` |

## One-time setup

### 1. Tizen Studio

1. Install [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)
   to `~/tizen-studio` (the default; elsewhere, set `TIZEN_STUDIO`).
2. In its Package Manager, under **Extension SDK**, install **TV Extensions** (the newest) and
   **Samsung Certificate Extension**.

### 2. The TV in Developer Mode

1. Note your Mac's IP address (System Settings → Wi-Fi → Details).
2. On the TV: **Apps**, then press **1 2 3 4 5** on the remote. Turn **Developer mode** on, enter
   the Mac's IP address, OK, then restart the TV (hold the power button until it restarts).
3. Note the TV's IP address (Settings → General → Network → Network Status → IP Settings).
4. Connect to it from the Mac:
   ```bash
   ~/tizen-studio/tools/sdb connect TV_IP_ADDRESS
   ```
   ```bash
   ~/tizen-studio/tools/sdb devices
   ```
   The second lists the TV with a name like `QE55Q80T` or `TV_IP:26101`: that's `TV_NAME` below.

### 3. A Samsung certificate, with this TV in it

A Samsung TV only installs apps signed with a Samsung distributor certificate that names it (its
DUID), so make the certificate with the TV connected.

1. Open Tizen Studio's **Certificate Manager** (Tools → Certificate Manager), **+**, choose
   **Samsung**, device type **TV**.
2. Profile name: **telly** (the pack script uses it; or set `TIZEN_PROFILE`).
3. Create a **new author certificate** (name telly, a password you keep) and sign in with your
   Samsung account when asked.
4. Distributor certificate: the default privilege level (**Public**). The connected TV's DUID is
   filled in: keep it. Finish.

Back up `~/SamsungCertificate/telly` and its passwords: an app in Samsung's store only takes
updates signed with the same author certificate, forever.

## Each time

```bash
npm run build:tizen
```

```bash
~/tizen-studio/tools/ide/bin/tizen install -n build-tizen/telly_1.0.0.wgt -t TV_NAME
```

```bash
~/tizen-studio/tools/ide/bin/tizen run -p TellyTV001.telly -t TV_NAME
```

telly then stays among the TV's apps. Installing a newer `.wgt` the same way keeps everything set up.

To see the console and network: in Tizen Studio, import `dist-tizen` as a project and **Debug As →
Tizen Web Application**, which opens Chrome's inspector on the TV's page.

## Speed

The Samsung is the slowest TV telly runs on so far. SPEED.md has the rules that keep telly quick
on it, and `npm run speed` measures it.

## What to try first

In this order: each one depends on the one before.

1. **telly opens**: Welcome, then Set up telly with the remote (arrows, OK, Back).
2. **Your provider signs in and lists load.** This is the one real unknown: telly fetches the
   provider straight from the TV, and `config.xml`'s `<access origin="*">` should let a Samsung app
   do that without the provider's say-so (CORS). If it fails with "Couldn't reach …", that's it:
   note the message and check the inspector's console.
3. **Live TV plays**, both HLS (`.m3u8`) and MPEG-TS channels; CH + / − change channel.
4. **A film and an episode play**, MP4 and MKV, with seeking (◀ ▶ and the remote's rewind and fast
   forward), audio and subtitle tracks, and aspect ratio.
5. **The remote's keys**: play/pause, Back out of the player, Back on Home leaves telly.
6. **Coming back**: press Home while something plays, then reopen telly from the apps row.

## Known gaps

- **MKV, HEVC and 4K** go through the TV's `<video>` element (and hls.js / mpegts.js), not Samsung's
  AVPlay player. If MKV or HEVC files don't play, an AVPlay path in `src/lib/video.ts` is next.
- **Leaving with Home while playing**: the player doesn't yet pause when the TV hides telly
  (`visibilitychange`); Samsung's certification requires it.
- **telly Plus** is offered as on LG (Paddle by QR code). Samsung may require Samsung Checkout for
  its store; this is fine for testing.
- Not yet tried on any Samsung TV.
