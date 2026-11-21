# Getting telly into LG's Content Store

A plan, written November 2026. LG's process: register in **LG Seller Lounge**, submit the `.ipk`
with store assets, a **UX scenario** and a filled-in **App Self Checklist**, then LG QA runs a
pretest (app info), a function test and a content test. A rejection comes back with the issues;
every later update goes through QA again.

- [App approval process](https://webostv.developer.lge.com/distribute/app-approval-process)
- [App Self Checklist](https://webostv.developer.lge.com/distribute/app-self-checklist) (the full
  checklist is a download there: get the current one before filling it in)
- [App ecosystem / seller types](https://webostv.developer.lge.com/distribute/app-ecosystem)

## 1. Questions to settle with LG first (Seller Lounge → 1:1 Q&A)

These can sink a submission outright, so ask before doing the work.

1. **telly Plus bought outside LG.** LG's [In-App Purchase guide](https://webostv.developer.lge.com/develop/guides/in-app-purchase)
   says paid content in an app needs in-app purchase, and LG's own billing is gone in favour of
   webOS Pay or a third-party biller (Paymentwall). telly Plus is a Paddle checkout opened by QR
   code on a phone. Ask whether that's allowed for a sync add-on (the player itself is free), and
   if not, which of webOS Pay / 3rd-party billing they'd accept.
   - Fallback: ship the store build without telly Plus (sync hidden is already the default; a
     build flag would remove the unlock too, so QA never meets an undisclosed payment path), and
     add it in an update once LG has answered.
2. **A player with no content.** Ask whether a "bring your own provider" IPTV player is accepted,
   and what they need to test it. Others are on the store (IPTV Smarters, SS IPTV), but LG has
   pulled players before, so get it in writing.

## 2. Accounts and decisions

- [ ] **LG account + Seller Lounge registration** as an Individual Seller (the name shown in the
      store is the seller name) or as the company. A company account is the safer choice if telly
      Plus will be sold through it.
- [ ] **App ID, for good.** It can't change after launch, and the TV keeps an app's data under its
      ID. `io.github.tellyteam.telly` works; if the store app should be `app.gettelly.telly` (say),
      change it now: sideloaded installs would start fresh, which is fine while there are few.
- [ ] **Countries** to launch in (UK first?), and the store category (Entertainment / Video).
- [ ] **Privacy policy URL.** Required for the listing; telly-site has none yet. Same content as
      the README's Privacy section plus the relay's no-logs policy.
- [ ] **Support contact** (email or a page) for the listing.

## 3. App changes before submitting

Mandatory checklist items:

- [x] **Back on the first screen goes to the TV's Home** (webOS 23–25). Done: Back on Live,
      Series, Films, My List or Settings goes to Home; on Home, Welcome or the first setup step it
      calls the platform's Back (`exitToTv` in `backend.ts`). Still to confirm on a real TV.
- [ ] **Everything works with the Magic Remote pointer**, not only arrows + OK: go through every
      screen with the pointer (See all appears on hover, the player's controls, Setup's steps,
      the ★ on a channel, the telly Plus offer).
- [ ] **A visible selection effect on everything focusable** (check the small `.btn.small`
      buttons, chips and the ★).

Privacy and credentials (LG scans the source):

- [ ] **Provider logins and the sync code are kept in plain `localStorage`** on the TV. The
      checklist asks for sensitive values to be encrypted at rest; encrypt them (a per-install key
      via the TV's device ID or LS2 secure storage) or be ready to explain why not.
- [ ] Words like `password` and `token` in variable and file names are flagged. They're for the
      user's own provider login, entered on screen, never hard-coded; say so in the checklist.
      Make sure the build has no dev leftovers (`provider.local.properties` is dev-only and
      git-ignored; check the `.ipk` doesn't contain it or the fake provider).

Recommended items worth meeting:

- [ ] 1920×1080 (already set), text ≥ 20 px at 1080p (the 960-wide layout at zoom 2 makes 11 px
      CSS 22 px: check the smallest captions), a spinner instead of a blank screen while lists load
      (already there), Play/Pause toggle on one button.
- [ ] Magic Remote wheel scrolls lists the same way as a mouse wheel.

## 4. Something for QA to watch

QA needs a provider to sign in to. Deploy the dev fake provider (`dev/fake`) at a stable HTTPS
address with a handful of freely licensed streams and posters (e.g. Blender open films, public
test HLS streams), so QA meets no plain-HTTP warning and no third-party content. Put its address,
username and password in the UX scenario. Keep it up for as long as the app is listed: every
update is tested again.

## 5. Testing on real TVs

- [ ] webOS 5 (2020) through the current year, on real TVs where possible, else the
      [webOS TV Simulator](https://webostv.developer.lge.com/develop/tools/simulator-introduction)
      for each version: install from the `.ipk` as a store user would, not with Dev Mode tricks.
- [ ] Run LG's webOS TV App CTS (compatibility test suite) if Seller Lounge offers it for the
      chosen versions.
- [ ] Fill in the Self Checklist with the actual results (it's rejected without them).

## 6. Store listing

- [ ] Name ("telly"), short and long description in each launch language. Say plainly: telly
      contains no channels or content; you need your own subscription from a provider.
- [ ] Screenshots at 1920×1080 using the QA demo provider's content only (no real channels),
      plus the store icon and any banner sizes Seller Lounge asks for (telly-brand draws the icons;
      `webos/` has 80×80, 130×130 and the 1920×1080 splash).
- [ ] Age rating questionnaire, privacy policy URL, support contact.

## 7. Submit, and after

- [ ] Version `1.0.0` in `appinfo.json` and `package.json`; build with `npm run build`; upload
      the `.ipk`, assets, UX scenario and checklist.
- [ ] Fix and resubmit until approved. Each resubmission and every update needs a higher version.
- [ ] Once live: change the README's Install section to the Content Store, keep the GitHub `.ipk`
      for Developer Mode users, and add store submission to the release steps.
