# QA · wave 4 (branch `ux-redesign` @ f423645, 2026-10-15)

**Verdict: PASS with 1 medium bug and 4 low ones.** Goods fly from the right place to the right tile in he and en, and every reward
is credited exactly once. Reduced motion, "no flashes", the landing buzz and the combo pitch all work. A paused tab leaves no stale
particles behind. Idle DOM churn went down from wave 3. The medium bug is that the count-up mostly does not show: the number jumps at
the landing (C1).

**Setup.** `npm run check:full` and `npx vite build` ran in the repo. **The repo's `node_modules` broke during the session** (at 06:45:33:
`node_modules/.bin`, `.package-lock.json` and `@rolldown/binding-win32-x64-msvc/package.json` disappeared; no npm log for it, see E1).
So I served from an isolated copy: `git archive HEAD` into my scratchpad, plus `npm ci`. The command was `npx vite --port 5197 --strictPort --force`.
Same commit, same origin. Slots used: `?slot=qa4mid&debug` (e10-seed1 imported) and `?slot=qa4&debug` (fresh). The default save was never
touched. **Debug-only state changes** (in the test tab): I spent stores below their caps so gains would show, set a `stash` activeEvent,
marked the day's orders done to open the chest, and started ruins with `restorationSystem.start`. Another agent kept fronting its own
pane tab (tab-16), so before each animation or frame-time measurement I fronted my tab again. At the end the origin's
`lastbunker_a11y` and `lastbunker_onboarding` keys were removed (they were absent at the start) and `lastbunker_lang` was set back to `en`.
After that I reset the viewport, closed the tab and stopped the server.

## 1 · Build

| Check | Result |
|---|---|
| `npm run check:full` | **PASS** exit 0. Glossary: the same 29 baseline warnings as w3b. Every test OK |
| `npx vite build` | **PASS** exit 0. Same warnings as w3b (chunk > 1200 kB; `./fonts/fonts.css doesn't exist at build time`) |
| Bundle vs w3b | index.js **1,402.9 kB** (w3b 1,395.6, **+7.3 kB**; gzip +2.8). index.css **175.5 kB** (+3.0 kB). synth.js 23.7 (+0.4, the crisis siren). Everything else is unchanged |
| New test | `tools/sim/countup-test.mjs` (in `check:full`): a jump counts up monotonically and ends exactly on the target; a drop counts down; a hold waits, then counts; release; a hold never freezes a drop; reduced motion jumps at once; small changes roll; it follows a ticking target; a second jump mid-count; 0→n. It also prints a **KNOWN BUG** line for C1 (fails only with `COUNTUP_STRICT=1`). OK |

## 2 · Wave-4 features

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Stash (en, 375x812): fly, land, credit | **PASS** (see C1) | `+600.0K` materials from the screen middle (188,406) to the materials tile (142,32), `+3.0K` scrap to the "+4 more" handle (no scrap tile). Of 14 particles, 14 landed exactly on the tile centre (±1 px). One gain call. Materials +600,498 (600k plus production). The HUD reads `1.10M`, the state is 1,104,844 |
| 2 | Day chest, 6 stores | **PASS** | It flies from `.daily-chest`. 4 bursts fly. Scrap and components are dropped by the 40-particle cap and land at once (designed: "thinned, never queued"). The HUD equals the state after 2 s (food 27.0K = 27000, materials 1.25M = 1,251,305). No errors |
| 3 | Bonus bubble (tap) | **PASS** | Tap collected ×3 → `scrap 182,206 → 188,124` ("more" handle pulses, `hx-more pulse`). 7 particles, 0 off-target. Scrap +768 credited once |
| 4 | Restore finds (fresh he) | **PASS** | An on-screen ruin r_5 flies from its own spot (122,485), 6 particles, one gain call `{scrap:5}`. An off-screen ruin r_3 (x 722) falls back to the middle, as designed |
| 5 | Hebrew 375x812 | **PASS** | Stash: materials → (233,32), the RTL tile position. +400,260 credited once. HUD `966K` = 966,492 |
| 6 | Popup motion and taps during it | **PASS** | `fx-modal-in` runs on open. A tap 45 ms after "Continue" landed on `sheet-close` (the sheet closed). A tap on a decision row during the row stagger opened its dialog. "Take everything" during the dialog's entrance credited once |
| 7 | Toasts | **PASS** | `opacity/transform 0.2s ease-out`, in from -8 px. The next toast follows |
| 8 | Sheet row stagger | **PASS** (see C3) | People: 4 rows `fx-row-in`, `.fx-stagger` removed at about 530 ms. Decisions: rows caught mid-stagger on screen |
| 9 | Reduced motion | **PASS** | `fly()` returns 1, a single icon at the tile (142,32) fades 0→1→hold→0 over 750 ms, nothing moves. The number jumps at once (461K→961K). No row or dialog animations |
| 10 | "No flashes" | **PASS** | `data-flash=safe`: the sheet has no `crt-on`; the dialog has only `fx-modal-in`. The rows still stagger. The raid flash is behind `flashOk('cer-raid')` (code) |
| 11 | Console | **PASS** | No errors in the game. The only lines were vite 504s from the first, broken server start, plus 2 PixiJS `BindGroup` warnings right after `importState` (pre-existing, not W4) |
| 12 | Frame time: burst vs idle (tab fronted, desktop) | **PASS** | Idle: frame 9.1 ms med / 14.6 p95, rAF 16.6 ms med. Burst (3× six-store flyGoods, peak 26 in the air): frame 13.2 / 23.0, rAF 17.6 med / 54.8 p95, **0 long tasks**. The pool stays at 40 nodes, parked nodes are `visibility:hidden`, the rAF stops when idle (`raf 0`) |
| 13 | DOM mutations idle, 5 s | **PASS** | **1.2/s** whole body minus canvas (w3 5.4/s). One run showed 6.6/s, but 5/s of that was `night-overlay style` during a day/night fade (pre-existing). The fx layer adds 0 |
| 14 | Background 30 s during rewards | **PASS** | The rAF froze with 28 particles in the air. On fronting, all were parked before the first sampled frame (act 0, vis 0); no stuck `.fx-fly`. `flyGoods` returns early on `document.hidden` (code) |
| 15 | Landing buzz / haptics map | **PASS** | 3 stores landing within 250 ms gave **one** buzz. `feel()`: tap 8, collect/upgrade 16, warning [24,50,24], raid/explosion 32, error pattern ("light" setting) |
| 16 | Combo pitch / ±5 % | **PASS** | collect every 200 ms: 1.01 → 1.07 → … → 1.37 (6 steps cap). After a 1.6 s gap it resets to step 0. click 0.962..1.048. Story sounds (`era`) are not repitched |
| 17 | 360x640 he | **PASS** | Arcs over an open sheet land on (224,28) / "more" (180,104). No horizontal scroll (scrollWidth 360) |

## 3 · Bugs

| ID | Sev | Bug | Repro | File guess |
|---|---|---|---|---|
| C1 | **medium** | **The count-up mostly does not show: at the landing the number jumps about 94 % of the way in one frame.** The gain lands in state first. `fly()` runs later from a `setTimeout` (0 or i×90 ms). A HUD frame in between already starts the tween; then `hold()` hides it, but the tween's clock keeps running. When the hold is released 600 ms later, `easeOut(0.6)` = 0.94. Seen live: 504K held … then **1.07M** in the first frame after the landing, 1.10M by +250 ms | e10, a stash of 600k materials: sample `__hv('materials')` per frame. Unit: `countup-test` KNOWN BUG line (`COUNTUP_STRICT=1` fails) | `src/ui/fx/countUp.ts` `hold()`: drop the key's tween (or, in `step()` while held, keep pushing `tw.t0 = now`). Also `release()`: restart the tween at release time. A HUD-side alternative: call `holdCount` before the gain (the caller knows) |
| C2 | low | **Particles land on a stale tile when the tiles reorder mid-flight.** `fly()` reads the target rect once. The chest overfilled food, `pickTiles` swapped water out for power, and the water particles landed on the power tile (325,32), while the pulse went to "more" | e10, open the day chest with food and water full | `flyToHud.ts`: re-read `host.target(r)` in `tick` (cheap: one rect per burst per frame), or blend the end point toward the fresh rect |
| C3 | low | **The row stagger is invisible in most sheets.** It animates `.sheet-body > :nth-child(-n+8)`, but Build (`.bm`), Research and Menu have a single wrapper child, so the whole panel fades as one block (250 ms). It works in People and Decisions | Open Build or Menu; `sheet-body.children.length` is 1 | `Sheet.ts staggerRows` / `fx.css`: target `.sheet-body > :only-child > *` as well, or let panels mark their list container (`data-stagger`) |
| C4 | low (cosmetic) | **The particle label reads "+600.0K", "+3.0K", "+2.0K"** while the HUD says "504K" / "1.10M". The stash toast and the chest dialog show raw "400000 2000" / "+137695" (pre-existing `gainsText`, now next to the formatted flying label) | Any stash | `flyGoods`/`events.ts` labels use `i18n.formatCompact` (always 1 decimal). Use the HUD's `fmtNum`; `StoryDialog.gainsText` → `fmtNum` too |
| C5 | low | **The collect buzz plays when nothing flew.** When the 40-particle cap drops a whole burst, `fly()` calls `land()` at once, so that store's pulse and buzz come about 600 ms *before* the bursts that actually fly (the chest: scrap and components landed at 479/598 ms, food at 744 ms) | The day chest with 6 stores | `flyToHud.ts fly()` with `n === 0`: delay `land` to `FLY_MS`, or add the store to the last flying burst |

Environment, not the game:
- **E1 (blocker for every agent using the main checkout):** `node_modules` in the main repo is broken. `npx vite` gives "'vite' is not
  recognized". rolldown says "Cannot find native binding" (the `.node` file is there, its `package.json` is gone). The worktrees
  `lbux-*` link their `node_modules` to this one. No `npm install` log matches 06:45. `npm ci` in the main repo (with no dev
  servers running from it) should restore it. I did not touch it. Note: `check:full` ran before the breakage and passed.
- Running several `vite --force` servers on the shared `node_modules/.vite` gives "504 Outdated Optimize Dep" (the deps cache is
  rewritten under the other servers). Give each agent its own `--force`-free start, or a `cacheDir` per port.
- In this pane a background tab keeps `visibilityState: visible` but freezes rAF and compositor animations. A dialog that was already
  closed still showed in screenshots, and taps went "through" it. It reproduced only while another tab was fronted, so it is not a game bug.

Observations (pre-existing, not W4): in he at 375 the Act and population tiles truncate ("מערכ…", "מגבלת המע…"). In a scrolled
Accessibility tab the sheet's ? / ✕ float over the rows (the "Light" button sits under ✕). The 'pulse' class stays on tiles after the
animation, so a tile that is hidden and then shown again replays its pulse.

## 4 · Owner's phone checklist (2 minutes, he and en)

1. Tap a bubble 5 times in a row (1 s apart): each "collect" should sound a little higher, and after a pause it starts low again. One soft buzz per tap, never a burst of buzzes.
2. Take a hidden stash and the day chest: watch the materials number. It should **count up** after the icons arrive. If it snaps, that is C1.
3. Turn on Accessibility › Reduced motion: no icons fly; a single icon fades on the tile and the number changes at once. Rows appear without sliding.
4. Accessibility › Flashes › "No flashes": open a sheet and a dialog; no bright CRT flicker.
5. Press and hold any old-style button (`.btn`): it sinks and darkens fast and springs back on release; the tap still fires.
6. Fire or flood: one soft two-tone siren (not two alarms), and the music dips for about 2 s. A raid warning gives one heavy buzz.
7. Collect, then lock the phone for 30 s and come back: no icons stuck on screen, and the numbers are right.
8. Upgrade a room (medium knock) vs a level up / victory (double tick) vs an error (pattern): the three should feel different.

## 5 · Files

- New: `tools/sim/countup-test.mjs`; `package.json` `check:full` now runs it.
- This report. Logs were not copied: check and build output match `w4-check.log` / `w4-build.log`.
- `.claude/launch.json` was already modified by another agent; I did not touch it.
