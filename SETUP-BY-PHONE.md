# Setting up a TV from a phone: design

Typing a provider's server, username and password with a TV remote is the hardest part of telly.
This design lets the TV show one QR code, and the details arrive from a phone:

- **From a web page** (any phone, no app): the phone's camera opens `tv.gettelly.app`, the user
  types or pastes the details there.
- **From the telly app** (iPhone and iPad first): the app scans the same code and sends a provider
  it already has, with nothing to type.

Both use the relay's existing **join box** (telly-sync PROTOCOL.md, "Joining by QR code from the
new device"): a random id and key in the QR code, a sealed message left on the relay, collected
once by the TV. The relay can't open it.

This file is the shared contract for four repositories. Where it and a repo's code disagree about
the wire format, this file wins; everything else (naming, layout, wording) follows each repo's own
conventions.

| Repo | Work |
|------|------|
| `telly-sync` | Protocol and privacy text, larger box, 10-minute expiry, the web page |
| `telly-lg` (LG and Samsung) | Show the code on Setup, receive a provider |
| `telly-apple` | "Set up a TV": scan, choose what to send |
| `telly-android` | Receive on Fire TV / Android TV; later, send from a phone |

## 1. The link in the QR code

```
https://tv.gettelly.app/#id=<id>&key=<key>
```

- `id`: 16 random bytes as 32 lowercase hex characters (the box's address on the relay).
- `key`: 32 random bytes as base64url without padding.
- Both are in the **fragment**, which browsers never send to a server.
- Parsers accept the parameters in either order, ignore unknown ones, lowercase the id, and accept
  the host case-insensitively. Nothing but `https://tv.gettelly.app/` with an empty path.
- The old form `telly://join?id=…&key=…` is still **parsed** by every scanner (TVs on old versions
  show it). A device that shows the old form only understands a link code; a device that shows the
  new form understands everything in section 2. Senders use this to decide what they may send.
- New TV builds show only the new form, on every screen that shows a join code.

**Never from an opened link.** An app only acts on this link when its own in-app scanner read it
off a screen. It must not register `tv.gettelly.app` as a universal link or app link, and must
ignore the link if the system hands it over. The reason is the one telly-apple already gives for
`telly://join`: a link in a message or on a web page could otherwise ask a user to send their
link code, or now their provider login, to a stranger's box.

## 2. The message

Sealed exactly as today: `0x01 | nonce (12 bytes) | AES-256-GCM ciphertext and tag`, with the join
key and the aad `telly-join v1|<id>` (UTF-8). The plaintext is UTF-8 JSON:

```json
{
  "code": "0123456789ABCDEF",
  "provider": {
    "kind": "xtream",
    "name": "My TV",
    "server": "example.com:8080",
    "username": "me",
    "password": "secret",
    "allowCleartext": true
  }
}
```

or, for a playlist, `"provider": {"kind": "m3u", "name": "", "url": "https://…", "allowCleartext": false}`.

- `code` and `provider` are each optional; at least one must be present. Unknown fields are ignored.
- `code` is a normalised link code, as today.
- `name` may be empty or missing (the receiver uses its usual default). `allowCleartext` missing
  means `false`.
- Limits, enforced by the **receiver** (a longer value makes the whole message unreadable):
  `server`, `username`, `password` at most 255 characters each; `url` at most 2,048; `name` at most
  60. `server` and `url` are trimmed; `username` is trimmed; `password` is taken as it is.
- The sealed box is at most **4,096 bytes** (was 1,024).

The receiver treats a message as untrusted input: anyone who could see the TV's screen could have
sent it. See section 4 for what that means on the TV.

### Test vectors

Every client must open these (and the existing code-only vector, which is unchanged).

| Field | Value |
|-------|-------|
| link | `https://tv.gettelly.app/#id=00112233445566778899aabbccddeeff&key=AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8` |
| nonce (hex) | `0102030405060708090a0b0c` |

Vector A, a provider alone. Plaintext:

```
{"provider":{"kind":"xtream","name":"My TV","server":"example.com:8080","username":"me","password":"p@ss wörd","allowCleartext":true}}
```

Sealed (hex):

```
010102030405060708090a0b0c7ec82aa783e299e229d0417d6b3181412c27c3c4b51524b7c43e9406b29418a4e981b9e54cf895bfe4fa98c9e7a89d2fe8933dc2eebb530957107ca10a2f57631a47331387c17fcc6967c31f895662cab8120a0a8f4cdcec58e6f77853894f51f3e4565fcf047d16d5a15293d9923ae0bae54bb4be0ed202164c83b2d9e959163a1370d08fa409c4f0c60f71f75a4cbbac013310a3aa08
```

Vector B, a code and a playlist. Plaintext:

```
{"code":"0123456789ABCDEF","provider":{"kind":"m3u","name":"","url":"https://example.com/list.m3u","allowCleartext":false}}
```

Sealed (hex):

```
010102030405060708090a0b0c7ec839ba88f1d2bc6e9252752327df1e757bd8bfd52e1480e77dd506eec419b3ed80fead4c8f97bddbc5d481e7e1da30ad836dccf6f7571c535f36ef4d2d1679051129199d9929943b618a55d45d7bc6b0405c4dcc4a91ad55faff7854d04d10e2e4405fde28620a8295fd40ca846ca9e0f005e2b718fd1d16508cffebfa6ed7ea178a5377d65ad6f4018d
```

Clients test **opening** these to the right fields. JSON key order differs between platforms, so
only a client that can fix its key order need test that sealing reproduces the bytes.

## 3. The relay (`telly-sync`)

### Join boxes

- `MAX_JOIN` becomes 4,096.
- **A box lasts 10 minutes.** A new migration adds when a box lapses (seconds since 1970).
  `PUT` stores now + 600 and first deletes any lapsed boxes; `GET` never returns a lapsed box, and
  deletes it. The daily job keeps clearing leftovers. A lapsed id can be filled again.
- Everything else about `PUT` and `GET /v1/join/{id}` is unchanged, including `409` for a full box.
  CORS already allows any origin to `PUT`.

This is the one place the relay keeps a time of day, which PRIVACY.md says it never does. The
reason: a box may now hold a provider login, and one that sits uncollected until the next day ends
is a needless exposure if someone photographed the TV's screen. PRIVACY.md must say so in plain
words **before** the relay changes (that file's own rule): under "What the relay keeps", the join
box entry says it may hold a link code, a provider login or both, sealed, and is deleted when
collected or ten minutes after it's filled; under "never keeps", times of day gains that single
exception.

### Documents

- **PROTOCOL.md:** rewrite "Joining by QR code from the new device" from sections 1 and 2 above,
  add the test vectors, update the endpoint table and "What the relay keeps". The opening section
  ("Never synced or stored … There are no exceptions") stays true of **sync parcels** and should
  say that plainly, then point to the join box as the one place a login can pass through the
  relay: sealed, once, only when the user sends it to a device in front of them.
- **PRIVACY.md:** as above, plus a short section on the web page (below): what it does, that it
  loads nothing from anywhere else, and that the login is sealed in the browser.

### The web page

Served by the same Worker on its own hostname, `tv.gettelly.app`, so it shares no origin with the
Paddle checkout page (which loads Paddle's script).

- **Routing:** on `tv.gettelly.app`, `GET /` returns the page and everything else is `404`; the
  page is not served on `sync.gettelly.app`. Add the custom-domain route to `wrangler.jsonc` and a
  variable for the hostname. For `wrangler dev`, serve the same page at `GET /tv` on localhost.
- **One response, nothing external:** HTML with inline CSS and one inline script. No fonts, images,
  analytics, cookies or storage. The wordmark is inline SVG (see `telly-brand`), the look follows
  the checkout page and the apps (dark, system font).
- **Headers:**
  - `Content-Security-Policy: default-src 'none'; script-src 'nonce-…'; style-src 'nonce-…'; connect-src <the relay's origin>; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
    with a fresh nonce per response;
  - `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`,
    `X-Robots-Tag: noindex`.
- **Crypto:** WebCrypto (`crypto.subtle`, AES-GCM, `crypto.getRandomValues` for the nonce). The
  page is always HTTPS, so no library is needed. WebCrypto returns ciphertext and tag together,
  which is the box's layout after the version byte and nonce.

What the page does:

1. Reads `id` and `key` from the fragment, then removes the fragment from the address bar
   (`history.replaceState`). Without a valid pair: "Scan the code on your TV again."
2. Asks what the provider gave: **Username and password** (server address, username, password) or
   **Playlist link**. Same words as the TV's Setup screen.
3. Offers **Paste a link instead**: one field. If the text is a URL whose path ends in `get.php` or
   `player_api.php` and has both `username` and `password` in its query, it becomes a
   username-and-password provider with the URL's origin as the server. Any other `http(s)` URL
   becomes a playlist link. The result is shown in the fields for the user to check.
4. An optional name, and **Allow plain HTTP** with the TV's warning, shown when the address starts
   `http://` or has no scheme.
5. Fields don't capitalise, correct or spell-check; the password is shown as typed (it's being
   copied from an email) and the form opts out of the browser's password saving.
6. **Send to TV** seals the message and sends `PUT /v1/join/{id}`:
   - `204`: "Sent. Look at your TV to check the details and connect." The fields and key are cleared.
   - `409`: "This code has already been used. Go back on your TV for a new code and scan that."
   - anything else, or no connection: a plain message, with the fields kept.
7. One quiet line for people who have the app: "Have telly on this phone? Open it and choose
   Settings → Set up a TV to send your provider without typing."

Tests: the box lasting 10 minutes (taken, lapsed, refilled), the larger limit, the page's routing
and headers. The page's sealing is checked against vector A by running its function in the test.

**Not part of this work:** deploying, or creating the `tv.gettelly.app` domain. Those wait for the
owner.

## 4. Receiving on a TV (`telly-lg`, `telly-android`)

The same behaviour on LG, Samsung, Fire TV and Android TV.

### Where the code shows

- **Setup's first step** ("What did your provider give you?"), for a first provider and when adding
  another, but not when changing a saved one. The code sits beside the two choices: "Scan with your
  phone to enter your details there", and under it the choices as "Or enter them here".
- **The join screen** on first run ("I use telly on another device") keeps its code, now in the new
  form, since the app can answer it with a link code, a provider or both.

While a code shows, the TV asks `GET /v1/join/{id}` every 3 seconds, as the join screen does today.
Someone may be typing on a phone for a while, so the TV keeps one code for **9 minutes** (inside
the box's 10) before making a new id and key; it also makes a new one after any error. Asking
stops when the screen goes.

### When a message arrives

1. Open it with the key. If it can't be opened, or breaks section 2's limits: "That couldn't be
   read. Scan the code again", and a new code.
2. A `code`: link with it as if typed, but only where joining is offered today (LG's `syncShown`,
   and the same switch on Android). Otherwise ignore it.
3. A `provider`: go to the existing **summary** ("Check your details, then connect") with every
   field filled in, including the name and Allow plain HTTP. Nothing is saved and the provider is
   not contacted until the user presses **Connect**. Back returns to the first step with a new
   code.
4. Both: link first, then the summary. If linking fails, show the error and still offer the
   summary.

The summary step is the security boundary: a stranger who saw the code can put details on the
screen, but can't make the TV use them. Received details live only in memory until Connect, then
are stored exactly as typed ones are.

### Wording

Two lines stop being true as written and need new words in each app's own voice:

- Join screen: "Provider logins are never shared: you'll sign in on this TV next." → the login
  isn't part of sync; it can be sent from the phone when linking, or entered on the TV next.
- Setup: "Your login stays on this TV. telly only talks to your provider." → still true when typed
  on the TV; sent from a phone, it travels sealed so only this TV can read it.

README and store text that make the same promises follow.

### `telly-lg` specifics

- `src/lib/sync/join.ts`: `joinLink` returns the new form; `parseJoinLink` accepts both;
  `openJoin` returns `{ code?, provider? }` after validating; `sealJoin` takes the same shape (the
  tests and dev tools need it). `collectJoin` returns that shape.
- `src/screens/Setup.svelte`: the code and polling on the `kind` step; a received provider fills
  the fields and jumps to `review`.
- `src/screens/FirstRun.svelte`: handles a provider arriving with (or without) a code. The received
  provider has to survive the move from FirstRun to Setup: hold it in memory on `app` (never
  persisted) for Setup to take on mount.
- Tests in `src/lib/sync/sync.test.ts`: both link forms, vectors A and B, the limits, a message
  with neither field.
- In development the link is logged (as the join link is now), so the flow can be driven from a
  browser without a camera.
- The Samsung build shares all of this; no separate work.

### `telly-android` specifics

- `SyncJoin.kt`, `FirstRun.kt` (JoinScreen), `SetupScreen.kt` / `SetupSteps.kt`, with tests in
  `SyncTest.kt`. On a phone or tablet the first step shows the same code (someone may have the
  details on another device), below the choices rather than beside them.

## 5. Sending from the telly app (`telly-apple` first)

- **Entry:** a new row in Settings, **Set up a TV**, outside the Sync section and shown whether or
  not the household has telly Plus. It opens the existing scanner. The scanner buttons already in
  Sync lead to the same sheet. (iPhone and iPad only: the Mac has no scanner today.)
- **Parsing:** `SyncJoin.parse` accepts both link forms and remembers which one it was.
- **The sheet** replaces today's "Link your new device?" alert:
  - **Link it for sync**: shown when this device can link another one today (the existing rules in
    `sendJoin`, including starting a household and the telly Plus offer). On by default, as now.
  - **Send a provider**: shown only for the new link form, and only when this device has a provider.
    **Off by default, every time.** With several providers, the user picks one. Under it: what will
    be sent (the provider's name, its server or playlist address, the username, not the password)
    and one sentence: it is sealed so only the TV showing the code can read it, and telly's relay
    can't.
  - **Send** is disabled until something is chosen. The existing warning stays: only do this for a
    device of your own that is showing the code in front of you.
- **Sending:** one message with what was chosen (section 2), `PUT` as today. `409` keeps its
  message. On success: "Sent. Check the details on your TV and connect."
- The password is read from the Keychain only when Send is pressed.
- The alert text "Provider logins are never shared" and PRIVACY.md / README lines like it are
  reworded: logins are never part of sync, and are sent to a TV only when you choose to.
- Tests in `SyncTests.swift`: both link forms, opening vectors A and B, sealing then opening each
  combination.

### Android phones and tablets (after the TV work)

The same sheet, behind **Set up a TV** in Settings on touch devices. It needs an in-app scanner,
which the app doesn't have: CameraX with ZXing's decoder (ZXing is already a dependency for drawing
codes, and needs no Google Play services, so it works on Fire tablets). The camera permission is
asked for only when the scanner opens. Until this ships, Android phone users have the web page.

## 6. Compatibility and order

| Sender → receiver | Result |
|---|---|
| New app → old TV (`telly://join`) | The app offers linking only, as today. |
| New app or web page → new TV | Everything. |
| Old app scanning a new TV's code | The old app doesn't recognise the link, so it can't link for sync until it's updated. The web page still works. |

So, to keep the last row rare:

1. Relay: documents, then code. Backward compatible; old clients are unaffected.
2. Apps that scan (Apple) ship support for both link forms and for sending.
3. TV apps switch their code to the new form.

Development can run in parallel, since the wire format and vectors are fixed here. Only the
releases need that order.

## 7. What this changes about risk

- The relay still only holds sealed boxes, now sometimes with a login inside, for at most 10
  minutes.
- The web page is the new thing to protect: it handles a login in plain text in the browser, so
  whoever controls what `tv.gettelly.app` serves could read logins typed there. Hence one static
  response, no third-party code, a strict content security policy, and its own hostname.
- Someone who photographs the TV's code can collect a box before the TV does (the TV then shows
  nothing, and the user scans again) or put their own details on the TV (the user sees them on the
  summary and need not connect). The 10-minute life and the confirm step bound both.
- The apps' promises change from "your login never leaves this device" to "your login is never
  synced, and is sent to another of your devices only when you choose". Every place that says the
  former is reworded as part of this work.
