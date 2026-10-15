# QA · wave 3 (branch `ux-redesign` @ 68b4c62, 2026-10-15)

**Verdict: PASS with 1 medium and 6 low bugs.** Every wave-3 feature works on a phone in he and en. These all pass: the first-session
spotlight (only the target responds, Skip works), the idle hand, advisor ordering with a real crisis, no replay on reload, "Tutorial again",
goals ≤ 3, edge arrows, "To the bunker" and the Surface lock popover. Builds are green with no new code warnings. There were no console errors.

**Setup.** I ran my own `npx vite --port 5194 --strictPort --force` in my own tab. Slots used: `?slot=qa3&debug` (fresh, he),
`?slot=qa3en&debug` (fresh, en; an extra throwaway slot, needed for a second fresh FTUE without deleting a save) and `?slot=qa3mid&debug`
(e10-seed1 imported). The default save was never touched. Before each fresh run I removed only `lastbunker_onboarding`.
`lastbunker_lang` was `en` on this origin when I started. I switched it to he for the Hebrew runs and set it back to `en` at the end.
I removed `lastbunker_onboarding` again at the end, because it was absent at the start. Afterwards I reset the viewport, closed the tab and stopped the server.
**Debug-only state changes** (in the test tab, no code edits): to make a food crisis I took the farm's workers off for one minute,
then put them back. Fires in e10 are put out in about 3 s by a 65-person crew, so for the arrow and layout checks I stubbed
`incidentSystem.advance` for a few seconds, then restored it.

## 1 · Build

| Check | Result |
|---|---|
| `npm run check:full` | **PASS** exit 0. 1828 i18n keys (w2 1766). `advisor-test OK`. Glossary: same 29 baseline warnings. Log: `w3-check.log` |
| `npx vite build` | **PASS** exit 0. Same 2 warnings as w2 (chunk > 1200 kB; `./fonts/fonts.css doesn't exist at build time`). A new `[PLUGIN_TIMINGS]` note is build-time profiling only (the build ran next to a dev server), not a code warning. Log: `w3-build.log` |
| Bundle | index.js **1,392.7 kB** (w2 1,359.6, +33 kB). index.css **172.5 kB** (w2 156.7, +16 kB; baseline 121, now +43%). Still worth the dead-CSS pass in LEFTOVERS |
| New test | `tools/sim/onboarding-copy-test.mjs` (added to `check:full`): all 54 short onboarding lines (spot, walk, unlock, guide, crisis, collect, rec, obj, skip, next, done, arrows, home) have ≤ 8 words in he and en, matching `{placeholders}`, and a line for every step in advisor.ts `SHORT`. **OK** |

## 2 · Wave-3 features

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Fresh game, he 375x812: splash → 4-panel intro → difficulty → spotlight | **PASS** | The spotlight comes up only after the difficulty pick. It never showed over the modal, the story scene, the found-item modal or the reader (`calm()`) |
| 2 | Only the target responds | **PASS** (see B3) | Taps on the bell, the Build tab and a room hit `.ob-spot__block`, so nothing opened. A drag and a wheel did not move the camera (worldContainer unchanged). Tapping the strip went on to the step |
| 3 | Steps 1-5 | **PASS** | Step 0 strip → wrecked Generator sheet, then a second spotlight on "Start restoring". Step 1 "Supply crate ready" (collect correctly ranks above the goal), then the rubble on floor 1 → Start. Step 2 "Read the note" → journal. Step 3 Water Pump → Start (the goal took the water countdown, no second line). Step 4 Farm → Start. At step ≥ 5 the profile became `{done:true}` and the spotlight stopped |
| 4 | Bubble ≤ 8 words | **PASS** | "הקישו כאן: הצעד הבא" (4), "הקישו כדי להתחיל בעבודה" (4); en "Tap here: your next step" (5). Static test above covers all lines |
| 5 | Skip tutorial | **PASS** | In a real en FTUE and in a replay: the profile becomes `{done:true, skipped:true}`, the spotlight goes away and stays away, and nothing under the button gets the tap. Hit area 124x48 at the inline end of the top row |
| 6 | No other dialog on top | **PASS** | Toasts can show above the dim, but they are not dialogs. Modals that queued during the FTUE (door knock, stash, found tape) opened only when the spotlight was down |
| 7 | Idle hand | **PASS** | Appears **9.2 s** after the last touch, centred on the target, `pointer-events:none`. It went away on the next pointerdown. It never showed while a sheet was open (0/28 samples). After the FTUE it shows only for a crisis (food crisis: 9.1 s) |
| 8 | Advisor order with a crisis | **PASS** | Farm crew removed, food 20 → strip "מלאי אוכל אוזל 1:54", `data-kind=crisis`, pick `store:food`; a tap opens the Food sheet. Put back → pick `goal:drain`. Mid save: no crisis → `collect:inbox` ("3 decisions waiting") above the goal; fire → `incident` ("Room trouble: deal with it") above everything |
| 9 | Reload: spotlight not again | **PASS** | Reload of qa3: no spotlight (only an ordinary tip card) |
| 10 | Settings > More > "Tutorial again" | **PASS** | Toast "The tutorial will guide you again", then a 6-step walk with a Next button: strip → Build → People → Research → Surface → bell ("הבנתי" on the last). Bubbles stay on screen and never cover the hole |
| 11 | Day 10: advisor next step | **PASS** | e10: strip shows the 3 waiting decisions; the goals key shows "3" |
| 12 | Goals key ≤ 3 | **PASS** | The list shows exactly 3: project archive 0/4, dig 11 floors 8/11, Act project 2/5. `aria-expanded=true` |
| 13 | Edge arrows | **PASS** (see B1) | A fire on B8 off screen gives one danger chip on the bottom edge, 48x48, label "שריפה: הראו לי". A tap glides the camera there (zoom 1.02 → 1.43), the chip hides and no sheet opens. With "To the bunker" showing, the chip sits above it (y 581-629 vs the button's top at 637) |
| 14 | "To the bunker" | **PASS** | Far west: a 109x48 button at bottom, inline end (left in RTL). A tap glides back to the home view and the button hides. Not shown on the deep floors while rooms are visible |
| 15 | Escape / back order | **PASS** (see B2) | Sheet open: browser back and Escape close the sheet and stay on the page. Decisions stay (popup-test). The goals list, lock popover and spotlight are not part of `backAction` (B2) |
| 16 | Surface lock popover (fresh) | **PASS** | The tab has a lock badge and `aria-description`. One tap shows "🔒 Opens with research 'Hazmat Suits'" and a "Show me" button (44 high), RTL, anchored over the tab. It closes by itself after 6 s. A second tap opens the Surface panel (the way there) |
| 17 | Layout 360x640 / 768x1024 | **PASS** | Spotlight: hole fits the strip, bubble on screen and clear of the hole, Skip clear of both, at both sizes. Mid save: strip, goals key, arrow and home button do not overlap each other, the HUD or the nav. No horizontal scroll, and the strip text is not clipped |
| 18 | Console | **PASS** | No errors or warnings in the session. No crash-log keys |
| 19 | HUD idle DOM mutations (MutationObserver 5 s) | **PASS** (see B4) | `.hud-top` (the w2 scope): **1/s** (w2 3/s). Whole body minus canvas: **5.4/s** idle. **+60/s while a spotlight is up** (B4) |

## 3 · Bugs

| ID | Sev | Bug | Repro | File guess |
|---|---|---|---|---|
| B1 | **medium** | **A tap meant for an edge arrow lands on the room behind it.** A big crew puts out a fire in about 3 s. The arrow hides at the next 250 ms look. A player who taps when it is about to go hits the canvas, so whatever room is under the chip opens and the camera jumps there. It happened once: the Generator on B3 opened in place of going to the fire on B8. A second time the tap reached the canvas but missed a room | e10 at 375x812, home view. Run `__engine.incidentSystem.start('fire', <waterPurifier id>)`, wait about 3 s, tap the bottom-centre arrow (≈168,665) just as it vanishes | `src/ui/edgeArrows.ts` `setChip(…null)` hides at once. Keep a vanishing chip on screen (fading, still taking touches) for about 300 ms, or swallow the next click on the canvas for that long after a hide |
| B2 | low | **Back/Escape ignores the new layers.** `backAction` (popupRules.ts) only knows tour/modal/placement/reader/surface/sheet. With the goals list open, Escape does nothing on the web. On Android `nativeBack` would show "Leave the game?" over the open list (same for the lock popover and the spotlight). Expected: the top layer (list or popover) closes first | e10: open the goals key and press Escape. The list stays open; `backAction` returns `leave` | `src/ui/popupRules.ts:108` BackInput needs `goalsOpen` / `popOpen` / `spotlight`. Wire in `app.ts:374` (native) and the popstate/Escape handler; `HUD.closeGoals`, `OnboardingController.closePop` |
| B3 | low | **Keyboard gets past the spotlight.** The blockers stop pointer input only, so nav tabs stay focusable. Focus People and press Enter: the People sheet opens and the spotlight hides (it comes back when the sheet closes) | Fresh FTUE, with the spotlight up: `Tab` to a nav tab (or `.focus()` it) and press Enter | `src/ui/onboarding/spotlight.ts`: while it is shown, mark everything except the target and `.ob-spot` `inert` (Modal.ts already has an inert walk), or trap focus |
| B4 | low | **The spotlight writes `data-side` on the bubble every frame**, which is 60 DOM mutations/s while it is up (the `style.transform` writes are deduped by the browser, the dataset write is not). The HUD also writes the same value each second to `.objective[data-kind]`, `.objective-meta[hidden]`, `.adv-bar[hidden]` and the hidden tab badges (about 4 of the 5.4/s idle mutations) | Spotlight up: MutationObserver on body shows `ob-bubble|attributes:data-side` 301 in 5 s | `spotlight.ts` `place()` (write only on change). `HUD.ts:585-596` `setObjective` and `HUD.ts:792` `setBadge` (compare before set; `el.hidden = true` on an already-hidden element still fires a mutation) |
| B5 | low | **The "Skip tutorial" pill covers the power tile at step 1**, just when power is the crisis (en: "⚡ 5 · 6s"; he: the ⚡ tile with "9 s"). The player can't see the countdown the strip refers to | Fresh game, step 1 spotlight at 375x812 in he or en | `src/styles/onboarding.css` `.ob-skip`: put it in the bubble, or bottom-start above the nav. Or move it under the HUD's top row |
| B6 | low | **The same fire is reported twice.** The incident banner ("שריפה · מטהר מים · קומה 8 · הקישו לעזור") and a toast ("שריפה במטהר מים · קומה 8! הקישו על האזעקה…") are up together, and the strip says "Room trouble". At 360x640 this fills the top of the world band | e10, start a fire | the incident toast in `controllers/danger.ts` or `events.ts`. Drop the toast while `HUD.incidentBanner` shows the same incident |
| B7 | low (cosmetic) | Hebrew lines wrap with the floor number alone on its own line: strip "שקמו את הגנרטור בקומה / 3" (375 px) and sheet title "תקרה שקרסה - קומה / 1". The isolate marks (`⁨קומה 3⁩`) do not stop a break between "קומה" and the number | Fresh he game, step 0 strip and the rubble sheet title | `src/ui/floorTag.ts` `floorTagIso`: use a no-break space between the word and the number |

Observations, not bugs:
- At 768x1024, "To the bunker" shows while the bunker's edge still covers about 20% of the screen. The room-area share is below `AWAY_SHARE` 8% because the shaft and floor bands are not counted. This is fine as a threshold, but the button could be seen as early there.
- During the FTUE the supply crate (collect) took the strip ahead of the tutorial step at step 1. That matches the rule order, and the spotlight led to it fine.

## 4 · Files

- New: `tools/sim/onboarding-copy-test.mjs`. `package.json` `check:full` now runs it (full run exit 0).
- Logs: `store/ux-redesign/w3-check.log`, `w3-build.log` (git-ignored, like w2's).
- `.claude/launch.json` shows a change (world-L/world-T entries) from another agent. I did not touch it.
