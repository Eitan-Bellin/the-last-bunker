# QA final regression: ux-redesign (waves 1-5)

Date 2026-10-15 · branch `ux-redesign` @ 4553b75 · tester: qa-tester agent · no game code changed.

**Verdict: NOT READY TO MERGE. One blocker (F1).** In a fresh game, the "supply crate" tutorial step leaves the whole page inert.
The crate dialog then cannot be tapped, and neither can any dialog after it until the page is reloaded.
I reproduced it in he (375x812) and in en (360x640).
Everything else holds up: build, tests, prod fonts, service worker, reload, welcome-back, old saves, tablet layout and perf.
The open issues are medium or low.

## 1 · Build and tests vs baseline

| Item | Baseline (`baseline-*.log`) | Now | Note |
|---|---|---|---|
| `npm run check:full` | pass | **pass**, exit 0 | |
| Tests | smoke, lint, glossary, migrate, placement, infra, routes, rooms, openings, daily, foreman (11) | the same 11 + tokens, format, popup, advisor, onboarding-copy, countup, i18n-plural (**18**) | Every test added by the waves is in `check:full` |
| i18n keys | 1656 per language | 1928 per language | lint OK, the glossary is clean |
| Warnings | glossary "29 warning(s) in other data files"; rolldown chunk > 1200 kB | **the same two**, nothing new | |
| `index.js` | 1,312.64 kB / gzip 428.19 | 1,402.93 kB / gzip 457.01 | +90 kB (+6.9 %), gzip +28.8 kB |
| `index.css` | 121.47 kB / gzip 24.73 | 176.43 kB / gzip 32.89 | +55 kB, gzip +8.2 kB (tokens, kit, fx) |
| `he.js` / `en.js` | 107.56 / 87.37 kB | 124.62 / 100.98 kB | new strings |
| pixi, ArtLibrary, book | — | unchanged | |
| Build time | 8.2 s | 7.7 s | |

## 2 · PASS/FAIL

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | check:full + vite build | PASS | above |
| 2 | Prod: fonts are local | PASS | 5 woff2 files from `/fonts/`, 0 requests to googleapis/gstatic (pane and headless Edge) |
| 3 | Prod: no console errors | PASS | headless Edge: 0 errors. In the pane the only errors are the SW fetch (see 4) |
| 4 | Prod: service worker registers | PASS (headless Edge) | `activated`, controls the page after a reload, cache `lastbunker-v4`, build meta `03531c7512`. **The Claude browser pane cannot fetch any SW script** ("unknown error when fetching the script"), even a probe on the dev origin. That is an environment limit, not the game |
| 5 | Splash, intro, difficulty | PASS | he and en. The intro Skip works |
| 6 | Difficulty tap guard | PASS | I set `openedAt` ahead and tapped "Warden" 30 ms later: ignored, the dialog stayed. A normal tap after that went through |
| 7 | Spotlight tutorial | **FAIL (F1)**, plus F3 | Generator, rubble, journal, farm and drain steps work. The crate step blocks |
| 8 | 14 min of play (restore gen/pump/farm, drain, build Quarters, assign, research, all 5 nav tabs, Menu and all 10 sub-tabs, Command, Shop) | PASS with F2 and F4 | 0 JS errors in the whole session |
| 9 | Reload | PASS | No save warning. One dialog only (a pipe burst game event, no pile). The tutorial did not repeat; onboarding stayed `done:true` |
| 10 | 30-min absence, cold start (save `timestamp` −30 min, autosave stubbed, reload) | PASS | "Welcome back · away 30 min 7 s", food +873, water +689. No other dialog behind it |
| 11 | 30-min absence in session (`__engine.comeBack(1800)`) | PASS with F6 | Welcome came, but after knock → knock result → battery-saver offer |
| 12 | English 360x640, first 3 min | FAIL (F1, F3) | Text fits, difficulty dialog fits, no overflow |
| 13 | Old save c-seed1 (Act II, 38/34) | PASS | 0 errors, HUD sane, advisor "Decisions waiting: 2", Command and Shop OK |
| 14 | Old save e55-seed1 (Act VII, 190/190) | PASS | 0 errors, HUD sane, Command OK, rAF 16.7 ms median / p95 |
| 15 | 768x1024 | PASS | Full-width HUD with credits chip and clock. The Build sheet is centred, no overflow |
| 16 | 360x840 + text 1.6 + high contrast | PASS with F5 | `scrollWidth` 360, nothing past the edge. `data-contrast=high` applies. People chip clipped (F5) |

## 3 · Bugs

| ID | Sev | Bug | Repro | File guess / fix |
|---|---|---|---|---|
| **F1** | **BLOCKER** | **A dialog that opens while the tutorial spotlight is up stays inert, and the inert flag leaks for the rest of the session.** The spotlight (`inertAround`) marks every body child inert, the *closed* `.modal-overlay` included (`data-ob-inert`). `Modal.show` skips `this.overlay` in its inert walk, so it never clears the overlay's own `inert`. Then `releaseInert()` runs with a dialog up: it only removes the attribute and keeps `inert` on body children. The overlay stays inert for good, `elementFromPoint` on its buttons returns BODY, and nothing can be tapped. On iPhone there is no Escape or back key: the player is stuck until a reload. Every later dialog in that session is dead too (seen: knock, stash) | Fresh game, he or en: restore the generator, then the step "Supply crate ready: open it". Tap the strip. The crate dialog shows and "Continue" does nothing. 2/2 fresh runs. Programmatic: while a spotlight is up, `__app.modal.show({...})` gives `.modal-overlay.inert === true` | `src/ui/components/Modal.ts show()`: always `setInert(this.overlay,false)` and remove `data-ob-inert` from it. And/or `src/ui/onboarding/spotlight.ts`: add `.modal-overlay` (and `.story-overlay`, `.lore-overlay`) to `KEEP_LIVE`. Worth a DOM unit test |
| F2 | medium | **"Assign" in People shows nothing.** The job chooser renders under the expanded card at y≈895–1128 on an 812-px screen. There is no `scrollIntoView`, so to the player the button looks dead | People → tap a survivor (the card expands) → Assign | `PeoplePanel.ts` (`choosingFor` → `renderJobChooser`): scroll the chooser into view after `refresh` |
| F3 | medium | **The spotlight points at a button hidden under the bottom nav.** At 360x640 the room sheet's "Start restoring" sits at y 594–638, under the nav (z 22 over the sheet's z 20, nav top 591). The ring and the "Tap to start the work" bubble circle the nav bar. A tap there does reach the button (the nav is inert), but the player sees nav icons | en, 360x640, step 1: tap the generator strip | `spotlight.ts`: scroll the target into the visible area above `.hud-bottom` first. Or give sheets a bottom inset equal to the nav height |
| F4 | low | Dialogs that open on their own take the tap meant for the tutorial strip: a cassette "Found something!" and a knock both opened in place of the crate / rubble sheet. A "Found something!" for the note came right after the player read it | Hebrew run, steps 2–3 | `app.ts` dialogSources: hold auto dialogs while a spotlight step is active; drop the lore-found popup when it is already read |
| F5 | low | At text size 1.6 and 360 px, the population chip reads "0/190" (the leading digits are clipped). The Act chip reads "מער…" | e55, Accessibility text 1.6 | `hud.css` `.hx-stat__value`: allow a wrap or a smaller value font at `--fs ≥ 1.4` |
| F6 | low | Order of popups after an in-session return: a lowest-tier battery-saver offer opened before the pending offline-tier welcome-back, during an active generator fire | `__engine.comeBack(1800)` with low fps | `popupRules`/dialog gate: check the welcome snooze; never show `pwa`-tier offers while a crisis (fire) is active |
| F7 | low | Two duration styles side by side: seconds "8 ש׳" / "58שנ׳", while the kit uses "4ש" for **hours**. Hebrew text mixes "B1/B3" with "קומה 3" (research toast, welcome "to do", lore note) | Room sheet, research, welcome card | `he.json` `time.s` vs `kit.dur.*`; floor labels → `floorTag` |
| F8 | low (perf) | Idle DOM churn is up from W4 (1.2/s): `ob-spot is-lost` toggles class and `hidden` 4/s each while a dialog covers the step. HUD tile `aria-label` rewrites run 7/s in the early game. Depth-ruler ticks run 2.6/s in c-seed1 | MutationObserver on body, 5–10 s | `spotlight.ts` (write only on change); `HUD.ts` (compare before setting `aria-label`) |

Observations, not bugs: the water cap drifted from 5,184 to 5,173 within seconds in a fresh game (`resources.water.cap`, game logic). The c-seed1 save starts at 38/34 people.

## 4 · Performance

| Metric | Earlier reports | Final | Note |
|---|---|---|---|
| `__perf` ms/frame, fresh he game, 375x812 res 2 | — | 7.24 | 60 forced renders |
| `__perf`, c-seed1 | — | 3.05 (608x862, res 1) | The pane had dropped the emulation |
| `__perf`, e55 (190 people), 375x812 res 2 | — | 29.9 | rAF still 16.7 ms median / p95, max 16.9 |
| rAF median (W4: 16.6 idle) | 16.6 | 16.7 | e55 |
| Idle DOM mutations/s, whole body | W2 3 · W3 5.4 · W4 1.2 | spotlight up 45.7 · dialog over spotlight 17 · c-seed1 8.9 · e55 7.1 (5.9 of it is the night-overlay fade, pre-existing) | F8. Audit baseline 414/s |
| JS heap (`performance.memory`) | not measured before | fresh 174 MB · c-seed1 211 MB · e55 238 MB | Dev build |
| DOM nodes | — | fresh 2,432 (tutorial) · c-seed1 1,174 · e55 1,153 | |

## 5 · Owner's phone checklist (10 items)

1. **Fresh install (new browser profile or a cleared site):** play the tutorial to "Supply crate ready: open it", tap it, then tap "Continue". If nothing reacts, that is F1 (a reload frees it).
2. During the tutorial, wait for a knock or a "Found something!" while the bubble is up. The dialog's buttons must react.
3. People → tap a survivor → Assign: the room list should be visible without scrolling (F2).
4. On a short phone (or in landscape), tutorial step 1: the "Start restoring" button must be visible, not under the bottom bar (F3).
5. Close the app for 30+ minutes and reopen it: one "Welcome back" card with the gains, no pile of dialogs behind it.
6. Reload with the game open: no "save problem" warning, and the tutorial does not start again.
7. Install to the home screen, go offline, reopen: the game loads with its own fonts. Menu › About shows a build id.
8. Accessibility › text 1.6 + high contrast: every HUD number is readable (F5 is the population chip).
9. English (Menu › Language): the first three steps read naturally, and nothing is cut off at the edges.
10. A long session (Act II+): the frame rate stays smooth while dialogs and the decision strip come and go. Tap 10 bubbles fast: one buzz each.

## 6 · Notes

- Slots used: `qafinal` (prod 4198), `qafinal1`–`qafinal5` (dev 5179). The default save was never touched. On the dev origin I changed only `lastbunker_lang` and `lastbunker_onboarding`. Accessibility was put back to 1.1 / normal.
- No tests were added: F1 needs a DOM harness, which `tools/sim` does not have. A jsdom or happy-dom test of Modal plus spotlight would lock it.
- The headless Edge SW probe is in my scratchpad (`swcheck.mjs`), not in the repo.
- The viewport, both tabs, both servers and the headless Edge are all closed or stopped.
