# QA · wave 2 (branch `ux-redesign` @ db7a4cb, 2026-10-15)

**Verdict: PASS with 3 medium + 6 low bugs.** All audit items to verify (#2 #4 #5 #6 #8 #11 #12 #13 #26) are fixed.
Builds are green with no new warnings. No console errors came from the game itself, except ResizeObserver noise (bug B4).

**Setup.** Port 5190 was already taken by another agent's dev server (`Desktop\lbux-ds`, pid 26512), which I left running. My first
navigation landed on it with `?slot=qa2`, so that origin (localhost:5190) now has a throwaway `qa2` slot. All testing was on my own
`npx vite --port 5199 --strictPort`, in my own tab, with `?slot=qa2&debug` (fresh) and `?slot=qa2mid&debug` (e10-seed1 imported).
The default save was never touched. Afterwards I reset the viewport to desktop, closed the tab and stopped the server.
**Note:** a background tab does not run rAF, so the game loop stalls there. Timing checks (#5, #6, perf) were run with the tab fronted.
Tablet screenshots are scaled-to-fit by the pane, so tablet checks rely on the DOM measurements.

## 1 · Build

| Check | Result |
|---|---|
| `npm run check:full` | **PASS** exit 0. New vs w1: `popup-test OK` and 1765 i18n keys (was 1672). Glossary still has the same 29 warnings in other data files (baseline) |
| `npx vite build` | **PASS** exit 0. Warnings: chunk > 1200 kB (baseline) and `./fonts/fonts.css doesn't exist at build time` (present since w1). **No new warning** |
| Bundle size | index.js 1,357 kB (baseline 1,313; w1 1,316). index.css **163 kB (baseline 121; w1 135, +34% since baseline)**. Worth a look once the dead HUD CSS listed in LEFTOVERS is removed |

## 2 · Fixed audit items

| # | Check | Result | Evidence |
|---|---|---|---|
| 2 | No dead-end Build | **PASS** | Fresh game, Build: every card with no free slot shows "No space: restore the wrecked Farm on B2 →" (or "clear the rubble on B1 →") instead of Build. Tapping the Farm card opened "Wrecked Farm · B2" |
| 3 | (bonus) Recommended ranks the crisis first | PASS | "Recommended now: Wrecked Water Pump (Water runs out in 3:50), Wrecked Farm (7:05), Wrecked Canteen" |
| 4 | Modal tap guard | **PASS** | 3 fast taps through the last comic panel (one landed on the Warden button at y≈440). The difficulty modal stayed open and nothing was picked |
| 5 | No tap-stealing dialogs | **PASS** | Mid save: a queued "Save battery?" dialog waited through 6 taps 1 s apart and opened **1600 ms** after the last one. No dialog ever opened under a tap. A dialog may land on an open sheet after 20 s untouched (by design, `SHEET_IDLE_MS`) |
| 6 | No false save warning on reload | **PASS** | 3 reloads (fresh slot) plus 1 reload (mid save): no "closed in the middle of saving" toast |
| 8 | HUD 2 rows | **PASS** | Fresh 375x812: rows 8–56 and 64–112, a "+3 more" pill (hit area 46 px via ::after), HUD 124 px. Act III: still 124 px (was 159). At 360x640 a compact 103 px. Capped stores show "FULL" instead of a rate (#31) |
| 11 | Warnings | **PASS** | "Water is running low: act now" fired at about 3 min to empty, with one icon (no "⚠ ⚠"). No food warning while food was +0.20/s. No warnings mid-game with stores full |
| 12 | One toast | **PASS** (note) | Only one toast at a time in every sample. On a mid-game return 4 toasts came one after another over 8 s. The outgoing toast stays in the DOM for ~430 ms while the next fades in (a crossfade, not a stack) |
| 13 | Research reason | **PASS** | Disabled card reads "Need 10 Knowledge: build a Laboratory →", plus a top hint "Build a Laboratory (Engineering level) …" |
| 26 | Resize shrink | **PASS** | 768x1024 → 360x640: canvas CSS 360x640 (backing 630x1120), no horizontal scroll, `visualViewport.scale` 1 |
| 16 | (bonus) Restore shows power | PASS | "Uses 1 power · you have +4.6" |
| 15 | (bonus) Surface in Act I | PASS | Small locked card "Opens with Hazmat Suits" plus a route button, no full-screen dead end |
| 19 | (bonus) Stash | PASS | One choice ("Take everything"), no second modal |
| 25 | (bonus) Settings | PASS | Game / Display / Saves / More / About groups, Language first |

## 3 · Regression

| Check | Result |
|---|---|
| Fresh game → splash → 4-panel intro → difficulty (Warden) | PASS |
| Restore loop, about 8 min: objective → Wrecked Generator → Start restoring (crew auto, 9 s) → found tape → rubble B1 → Farm → Water Pump | PASS. Time-to-empty is on the tiles ("⌛ 4:14") |
| Reload: fresh game resumes | PASS (each reload loses about 10 s of play; see N1) |
| Old save e10 imported → reload → loads (65 people, Act III), clock runs, panels open | PASS |
| Back/Escape | Sheets close on Escape. The "You found something" (Read now / Later) modal did **not** close on Escape (see B6) |

## 4 · Layout sweep (JS: visible interactive elements, hit area including the ::after expander; clipped text; off-screen; RTL direction and alignment)

Screens: HUD, Build, People, Research, Surface, Menu/Settings, Command, Alerts popover, Shop, Room panel, modal, toast.

| Viewport | en | he | Findings |
|---|---|---|---|
| 19.5:9 375x812 | PASS* | PASS* | Act chip name clipped (B1). Surface Close 36x44 (B3). he: Menu tab "עוד" 37x44 (B5) |
| 16:9 360x640 | PASS* | PASS* | Compact HUD 103 px. Surface Close 36x44. Mid save: the "more" pill overlaps the info row by 4 px (B7) |
| 21:9 360x840 | PASS* | PASS* | Act chip name 55–61 px of 85–90 (B1) |
| 4:3 768x1024 | PASS* | PASS* | Sheets centred 520 px wide. Surface Close 36x44 |

No horizontal scroll, nothing off-screen, and no LTR/left-aligned Hebrew text in any sheet. RTL mirroring is correct:
food is rightmost, the close button is on the left, the alerts popover is anchored under the bell. Nav buttons have no gap (#37).
Safe-area insets read 0 in the emulator; their `env()` use was checked in the wave-1 audit.

## 5 · Perf (375x812, fresh game, tab fronted)

| Metric | Result |
|---|---|
| HUD DOM mutations while idle (MutationObserver on `.hud-top`, 5 s) | **3/s** (audit baseline 414/s). Only value text and aria-label change |
| rAF frame interval | p50 16.7 ms, p95 16.7 ms (steady 60 fps) |
| `__perf()` | 6.42 ms render per frame at 375x812, res 2 |

## 6 · Bugs

| ID | Sev | Bug | Repro | File guess |
|---|---|---|---|---|
| B1 | **medium** | The act chip name is ellipsized until it can't be read. At 375 he Act III it gets 38 px of 109 px, so only "מער…" shows; Act I in en shows "Act I · Surv…"; at 360x840 en it shows "Act I · …". #8's goal (a labelled Act) is lost on phones. The population caption "No bed" / "מגבלת המער…" takes the room | Load e10 in he at 375x812 and look at the info row. Or a fresh game at 360x840 en | `src/styles/hud.css:213-227` (`.hx-act` min-width / `.hx-act__name` ellipsis; the stat chip captions take the space); `HUD.ts` |
| B2 | **medium** | A story overlay (z 60) can draw on top of an open Modal (z 40). The Modal marked the story inert when it opened, so the story on top takes no taps and the dimmed modal underneath still does. The player sees a story they can't advance | Open any modal via a direct `app.modal.show(...)` (not via the queue) while a chapter is pending, or open a modal while a story is up. The queue itself never opens a modal while a story is open (`app.ts:545`); it is the direct `modal.show` callers that can | `src/styles/story.css:58` vs the modal z-index; `Modal.ts:147` inert walk; story controller does not check `modal.isVisible` |
| B3 | low | Surface locked-card Close button hit area 36x44 (< 44 wide; the brief wants 48) | Act I, tap Surface, then run the sweep | `SurfacePanel.ts:69` (`.surface-close`, kit close variant without a hit expander) |
| B4 | low | `ResizeObserver loop completed with undelivered notifications` logged **as a crash** by crashGuard (3 times) on viewport changes with the mid save | e10 save, resize 375 → 360x640 with the alerts popover recently open; check the console / crash log | `HUD.ts:191` (observer callback calls `setHudInsets` and `placePop`, which re-layout the observed nodes). Defer it with rAF, or ignore this message in `crashGuard.ts:201` |
| B5 | low | Menu group tab "עוד" (More) is 37x44: a short Hebrew label makes the tab narrower than 44 | he, Menu → Settings | `MenuPanel.ts` / kit tab (min-inline-size) |
| B6 | low | Info modal "You found something" (Read now / Later) ignores Escape (#20 says Later should be the dismiss) | Fresh game, finish the generator, press Escape on the find modal | the lore/find controller does not pass `dismiss` to `modal.show` |
| B7 | low | At 360x640 (compact HUD) the "+N more" pill (89–113) overlaps the bottom of the info row (53–93). Its ::after hit area (−12 px) also takes about 10 px of the population chip at 375 | Look at the HUD at 360x640 on e10 | `hud.css` `.hx-more` |
| B8 | low | Build filter says "Can build 9" while every one of those 9 cards is "No space …" | Fresh game at about minute 3, open Build | `BuildMenu.ts` (count should exclude cards with no slot, or relabel) |
| B9 | low | Level-up toasts still show in the first minutes ("Oliver reached level 3!") (#22, not in wave 2) | Fresh game, about minute 8 | `controllers/feedback.ts` |

**Notes (not bugs in wave 2):**
- **N1:** a reload loses about 10 s of play (playtime 514.0 → 503.8). The `pagehide` autosave (`GameEngine.ts:872`) is async and does not finish before navigation; this happened before wave 2 too.
- **N2:** on a mid-game return, 4 info toasts arrive in 8 s, then "The bunker can grow", then a "Save battery?" offer. That is better than the old modal pile, but still a lot.
- **N3:** the Menu shows a "Genesis" tab in Act I (#14 jargon).

## 7 · Screenshots (described; taken at scale 0.4–0.5 in the pane)

1. Fresh 375x812 en, first HUD frame: 4 tiles (food 149 −0.19, water 99 −0.19, power 6 "⚠ ⌛ 7s" red border, materials 105). Info row: "Act I • Survive 0%", "3/4 ⌛56s", "72% Morale", bell with badge 1. A "+3 more" pill, the banner "Power is running low: act now", and the objective card above a 5-tab nav.
2. Difficulty modal after the fast taps: still open, with three cards (Settler / Warden / The Last).
3. Build sheet: "Recommended now" chips for Water Pump and Farm with countdowns; each room card has an orange "No space: clear the rubble on B1 →" button.
4. Research: "Insulated Wiring" card with "Need 10 Knowledge: build a Laboratory →".
5. he 375x812 Build: fully mirrored, and the act chip reads "…מערכה I · ל".
6. e10 he HUD: all tiles "מלא" (FULL), act chip "38% …מער" (B1), "65/65 מגבלת המער…", "97% מורל", bell with 4. Then the "The bunker can grow" modal.
7. e10 Command → Now tab: "What to do now" plus a "Take me there" button, and the act goals with progress bars.

No new tests were written; the existing `popup-test.mjs` already covers the gate and toast rules.
