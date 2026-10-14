# 02 · UX/UI Audit: The Last Bunker (branch `ux-redesign`, 2026-10-15)

**Method.** Played a fresh game in slot `?slot=uxaudit&debug` (Warden, English, 375x812) for about 10 minutes. Then loaded the day-10 sim save (`store/sim/saves-v6/e10-seed1.json`) into slot `uxaudit10` for the mid-game screens (Act III, 65 people). I measured with JS in the built-in browser pane at 375x812, 360x640, 360x840 and 768x1024, in Hebrew and English. The default save was not touched. The language was set back to English (`lastbunker_lang=en`) and the viewport reset to desktop.
**Screenshots:** about 30 were taken at scale 0.5 (they are in the session tool-results). The pane tool cannot write image files, so `shots/` stays empty. Each finding below says what was seen.

**Status of the 2026-10-09 review (store/ux-review):**

| Old ID | Issue | Now |
|---|---|---|
| P1 / clarity F1 | Difficulty asked before the intro | **FIXED** (now after the comic). New problem: see A1 |
| P3 | Floor labels cut off, objective doesn't open the target | **FIXED** (B1/B2/B3 plates visible, objective opens the right sheet) |
| P4 | Restoring a room doesn't say it uses power | **STILL PRESENT** (wrecked-room sheet shows cost/time/crew, no power use) |
| P6 / bugs A1 | Two conflicting guides | **Mostly fixed** in Act I (objective card is the single driver). Command "What to do now" is still a second voice mid-game |
| P7 | Build menu shows 42 rooms, 33 locked | **FIXED** ("Can build 9" default, locked folded) |
| P8 / conv. D5 | People: unlabeled stats, huge cards | **Partly fixed** (labels Str/Int/Agi/Cha/End, Rows view). 4 filter rows still sit above the list |
| P10 | Door event: no preview, then an extra confirm | **FIXED** for the door. **STILL PRESENT** for the "Hidden stash" (choice modal → second result modal) |
| P11 / bugs C1 | Tip card stacked on "You found something" | **Fixed in that pair**, but other layers still pile up (see A12) |
| P12 / conv. D3 | HUD full of unlabeled chips | **STILL PRESENT** (`▾ 3`, `I·6%`, `4/4 !`, mid-game `IV +45`, 3 rows / 159 px in Act III) |
| P13 | All stores "full (wasting)" mid-game | **STILL PRESENT** (day-10 save: 6 of 7 resources full, food +239/s) |
| P18 | Several dialogs in a row on every return | **STILL PRESENT** (save warning + welcome + daily orders + pinch tip + "bunker can grow") |
| conv. B3 | Upgrade button below the fold | **FIXED** (Upgrade + "Next" at the top of the room panel) |
| conv. B6 | Expedition hexes tiny | **STILL PRESENT** (hexes measured 4–18 px wide) |
| conv. C1 | Escape/back close everything | **FIXED** (back/Escape close only the top sheet). Modals ignore both (see A20) |
| clarity A1 | Disabled buttons don't say why | **STILL PRESENT** (Research "Start research" disabled, no reason) |
| clarity C3 | Far research and "Genesis" jargon visible at minute 5 | **STILL PRESENT** (Act-2 items, Doctrines, "until Genesis", Isotope-7 in the shop) |
| feel F5 | Level-up toast spam | **STILL PRESENT** (level-up toasts in the first minutes) |

---

## 2.1 Friction log: the first 10 minutes (fresh game, phone 375x812)

Tags: **C** = Confusion, **E** = Effort, **F** = Frustration, **U** = Unpleasant.

| t | What happened | Tag |
|---|---|---|
| 00:00 | Splash "Tap to enter". It looks good. Loading takes about 3–4 s cold. "Skip" is small, top-right | — |
| 00:10 | Intro comic, 4 panels, tap to advance. Strong art | — |
| 00:30 | The difficulty modal fades in **under the same tap point** used to advance the comic. My next "advance" tap chose **Warden** without me ever seeing the choice, and the choice says "cannot be changed later" | **F** |
| 00:35 | First HUD frame: banner "Power is running low: act now". Power 0 (−1.0), food −0.40, water −0.30. Morale 67% → 46% in about 90 s, and nothing says why | **U / C** |
| 00:40 | (After a reload) red toast "The game closed in the middle of saving, the last minutes may be lost". This was a normal reload. It appeared on 4 of 6 reloads | **U** |
| 01:00 | I tapped the objective card and the "Knocking at the Door" modal took the tap. The choice now shows a preview, and the result is a toast instead of a second dialog: good | **E** |
| 01:30 | The objective opens "Wrecked Generator · B3" with clear cost, time, crew and finds. But the sheet covers the bunker, so the room I am restoring can't be seen | **C** |
| 02:00 | Start restoring: crew auto-assigned, "The crew got to work", done in 9 s. Satisfying | — |
| 02:30 | Generator done. Pinch tip card appears (fine). Food 72 at −0.5/s means **under 2.5 min to starvation**, but the HUD shows no countdown | **C / F** |
| 03:00 | Objective "Clear rubble B1": the camera behind the sheet points at the surface car, not at B1 | **C** |
| 04:00 | "You found something! → Read now" opens the tape reader. The **Close button slides down** as the typewriter text grows, so my tap missed | **E** |
| 05:00 | Objective "Restore the water pump". The sheet again doesn't mention power use (old P4) | **C** |
| 06:00 | Menu (☰): Settings is one ~25-row scroll that mixes navigation (Book, Chronicle, Rooms list), share, tour, language (row 9), graphics, saves and "New Game" | **E** |
| 06:30 | Build menu, food 38 and falling. "Recommended now" says **Living Quarters ("almost out of beds") and Canteen**. Farm is the 4th card | **C** |
| 06:45 | I picked Farm. Placement says **"No free spot for this room"**, yet "Best spot" and a green **"Build ✓20"** are shown. A dead end. At the same moment 3 toasts and the "Every Level" achievement banner pile on the placement bar | **F** |
| 07:00 | Cancel. The objective now says "Restore the farm on B2": the real answer was a wrecked room, which the Build menu never mentions | **C** |
| 07:30 | People: during the open/close animation two sheets overlap. With 4 survivors there are 4 rows of filters (tabs, All/Idle/rooms, floors, search + Rows) before the first person | **E** |
| 08:00 | A tap on "Research" landed in the gap between nav buttons and nothing happened. Research: 6 tabs, 3 visible. "Start research" is disabled with no reason, and Act-2, Doctrine and "Genesis" items are listed | **E / C** |
| 08:30 | 4 toasts at once (3 × "Goal complete" for auto-completed assign goals, plus an achievement) | **U** |
| 09:00 | Second "You found something!" modal | **E** |
| 09:30 | Surface: full-screen dead end ("Research Hazmat Suits"), plus "⚠ ⚠ Food is running low: act now" while food is **+0.24/s** | **C / U** |
| 10:00 | The **Shop is a tab inside Journal**. It offers Isotope-7 "for Genesis upgrades" at minute 10 | **C** |
| (he) | Hebrew reload: 2 warning banners, a tip card and the objective all on screen at once. A "Hidden stash" modal took my Build tap, then a second result modal followed | **U / E** |
| (mid) | Day-10 return: save warning, daily-orders toast, pinch tip (again), "The bunker can grow" modal that took my Surface tap, then the Act panel: "This Act ends in ~33d 5h" | **F** |

**Net:** the first 3 minutes of the restore loop are good: clear sheet, crew auto-assign, quick result. What hurts is pressure without explanation (morale and food fall, alarm banners, no time-to-empty), interruptions that take the player's taps, recommendations that contradict the real need, and layers piling up (toasts, banners, tips, ceremonies, modals).

---

## 2.2 Heuristic scores (1 = poor, 5 = excellent)

| Screen | Goal & next action | Cognitive load | Ergonomics | Feedback | Consistency | Readability | Feel | Error prev./recovery | Avg |
|---|---|---|---|---|---|---|---|---|---|
| HUD / main bunker | 3 | 2 | 3 | 3 | 3 | 3 | 4 | 2 | **2.9** |
| Build menu + placement | 2 | 3 | 4 | 2 | 3 | 4 | 3 | 2 | **2.9** |
| Room panel | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 4 | **3.8** |
| People | 3 | 2 | 3 | 3 | 3 | 4 | 3 | 3 | **3.0** |
| Research | 2 | 2 | 3 | 2 | 3 | 4 | 2 | 3 | **2.6** |
| Expeditions / surface | 2 (Act I dead end) | 2 | 1 (hexes 4–18 px) | 3 | 3 | 3 | 3 | 3 | **2.5** |
| Shop (in Journal) | 2 | 3 | 4 | 3 | 2 | 4 | 2 | 3 | **2.9** |
| Settings (Menu) | 3 | 2 | 4 | 3 | 3 | 4 | 2 | 3 (confirmed New Game) | **3.0** |
| Popups / events | 3 | 3 | 3 (taps hijacked) | 4 | 2 (some 1-step, some 2-step) | 4 | 4 | 2 (no Esc/back on info modals) | **3.1** |
| Tutorial / objectives | 4 | 3 | 4 | 3 | 3 | 4 | 3 | 2 (no time-to-starve, wrong recommendations) | **3.3** |

---

## 2.3 Technical checks

**Safe area and anchoring.** `env(safe-area-inset-*)` is used throughout (HUD top/bottom, sheets, modal, placement bar, ruler). Nothing goes off-screen at any size tested.

| Viewport | HUD top | Objective | Bottom nav | Bunker visible | Notes |
|---|---|---|---|---|---|
| 375x812 (19.5:9) | 0–123 | 677–721 | 729–812 | ~68% | OK |
| 360x640 (16:9) | 0–123 | 505–549 | 557–640 | ~59%, and the tip card covers half of it | Cramped |
| 360x840 (21:9) | 0–123 | — | 757–840 | ~70% | OK |
| 768x1024 (4:3) | 2-row resource grid, icon-only tiles, with "Survive / Population / Morale" labels | — | full-width nav | Large | Phone layout stretched; the tablet gets labels the phone doesn't |
| Act III phone | **159 px** (3 rows: resources, chips, 4 icon buttons) | | | ~63% | HUD grows with progress |

- **Resize bug (likely real).** `BunkerRenderer.ts:515` resizes the canvas to `window.innerWidth/innerHeight`. When the viewport shrinks (pane resize, rotation, split screen) the old, larger canvas keeps the layout wide. `innerWidth` then reports the zoomed-out width and the canvas never shrinks. Seen twice: canvas stayed 608x1317 or 375x812 after a resize, and `visualViewport.scale` = 0.62. Fix: size from `documentElement.clientWidth/Height` or `visualViewport`, and give the canvas `width:100%; height:100%`.

**Touch targets under 44x44 CSS px** (JS sweep of visible interactive elements):

| Where | Element | Size |
|---|---|---|
| HUD | `.res-more` "▾ 3" | **52x24** |
| HUD | era chip `I·6%` | 62–78x32 |
| HUD | population chip `4/4 !` | 79x32 |
| HUD | morale chip | 63x32 |
| HUD | supply crate, decisions, journal, season | **32x32** each |
| Room panel | Remove (worker), Move, **Demolish** | 70x34, 70x34, 95x34 (Demolish sits next to Move; it does ask for confirmation) |
| Surface | Close | 42x34 |
| Surface map | hex tiles | **4–18 px** |
| Nav | gap between nav buttons | ~2 px dead strip (a tap there does nothing) |

Bottom nav buttons (75x65) and all panel primary buttons pass.

**Contrast (WCAG AA, computed fg over composited bg).** HUD values 16.6:1; negative rate (#ff5555) 6.2:1; era chip 11:1; objective 16.6:1; nav labels 12.3:1; sheet body/hints 10.3:1; shop price chip 6.7:1. **All main pairs pass AA.** The real readability problems are not contrast: canvas text (floating "+2.9", "+4", "+6" numbers, room plates) over busy painted rooms; translucent toasts over the scene; depth-ruler labels at **9.9 px**; nav badges 11 px; body text mostly 12.1–13.2 px.

**Visible numbers on the main screen.** 17 DOM numbers at minute 4 (4 values + 4 rates + `▾ 3`, `I·6%`, `4/4`, 46%, clock, badge, objective rewards), plus canvas floor labels and floating numbers. In Act III: 17 DOM numbers again, with K-suffix values and `IV +45`. The genre benchmark is about 6–8.

**RTL (Hebrew).** The HUD and sheets mirror correctly (food rightmost, close button on the left, rows aligned right). Issues:
- Latin floor codes `B1`/`B3` inside Hebrew text ("B1 מגורים", objective "(B3)").
- `I·20%` era chip stays LTR.
- Every warning reads "⚠ ⚠", in both languages: `app.ts:886` adds `[[warning]]` and the 'bad' toast type adds another icon.
- The language switch reloads the whole game (`app.ts:1141`).

**Back button and Escape.** `app.ts:1161`: back and Escape close only the top sheet; with nothing open, the first back shows a toast and the second leaves. Good. **Modals ignore both Escape and back** (`popstate` re-pushes while `modal.isVisible`). That is right for decisions, but it also traps pure info modals ("You found something", "Welcome back", stash result, "The bunker can grow").

**Popup stacking.** Only one `Modal` at a time (`dialogQueue.ts`). But these layers are independent and were seen **at the same time**:
- placement bar, 3 toasts and an achievement ceremony
- 2 warning banners, a tip card and the objective card
- a sheet opening while another closes

Auto-dialogs also open on the frame the player taps something (door event over the objective tap, stash over the Build tap, "can grow" over the Surface tap). The gate should hold dialogs for about 1.5 s after a player gesture.

**UI performance.**
- `HUD.update` runs every frame and writes `className` on every resource rate and fill bar every frame, even when unchanged: about **414 DOM mutations/s** (~9 per frame) while idle (`HUD.ts:552,555`). Text is written only when it changes (`setText`). Fix: cache the class string.
- Floating numbers are on by default.
- The sheet slide animation is about 1 s, which feels slow.
- Load is fine: DOMContentLoaded 1.07 s on dev.

---

## 2.4 Issue table (sorted by severity)

| # | Screen | Problem | Severity | Impact | Effort | Proposed fix | Files |
|---|---|---|---|---|---|---|---|
| 1 | First minutes | Food and water fall fast (food under 2.5 min from empty at minute 2, water about 90 s) with no time-to-empty on the HUD. Morale drops 67→46% in 90 s with no cause shown. New players can starve before understanding the loop | critical | churn | M | Gentler Act I rates. "Food runs out in 2:10" countdown on the resource tile when under 5 min. Morale chip shows the top cause | `HUD.ts`, `tuning.ts`, `ObjectiveSystem.ts` |
| 2 | Build / placement | Build menu offers Farm, but placement says "No free spot" while still showing a green "Build ✓20" and "Best spot". The real fix (restore the wrecked farm) is never suggested | critical | churn / frustration | S | Cards with no free slot show "No space: restore the wrecked Farm on B2 →" or "Dig a floor" and route there. Disable Build when no spot | `BuildMenu.ts`, `controllers/world.ts`, `PlacementBar.ts` |
| 3 | Build menu | "Recommended now" ignores the actual crisis: beds and Canteen are offered while food is under 40 and falling | high | churn | S | Rank by time-to-empty first (food/water/power), then beds and morale | `BuildMenu.ts:218` |
| 4 | Intro → difficulty | The difficulty modal appears under the "advance intro" tap, so a fast tapper picks Warden blind ("cannot be changed later") | high | frustration | S | Ignore taps for 600 ms after the modal opens. Put options away from the screen centre, or add a "Confirm" step | `controllers/story.ts:170`, `Modal.ts` |
| 5 | Popups | Auto-dialogs (door, stash, "bunker can grow", finds) open on the same frame as the player's tap and swallow it | high | frustration | S | Gate: no new dialog within 1.5 s of a pointerdown or while a sheet is animating | `dialogQueue.ts`, `app.ts` (dialogGate) |
| 6 | Return / reload | "The game closed in the middle of saving…" red toast on normal reloads (4 of 6) | high | frustration (trust) | S | Flush the save on `pagehide`/`visibilitychange` before unload; show the warning only if the save really is older than the last good state | `core/saveFlag.ts`, `controllers/saves.ts:290` |
| 7 | Return | A pile of dialogs on every return (welcome back even after 1 min, daily orders, tips again, "can grow") | high | churn | M | Welcome-back only after more than 10 min away; one combined "while you were away" card; tips once per profile, not per slot | `controllers/welcome.ts`, `controllers/tips.ts`, `dialogQueue.ts` |
| 8 | HUD | Unlabeled chips (`▾ 3`, `I·6%`, `4/4 !`, `IV +45`). The phone HUD grows to 3 rows (159 px) by Act III | high | frustration | M | One info row: Act progress bar with name, people, morale. Move season/crate/decisions/journal into one "inbox" button with a count | `HUD.ts`, `style.css` |
| 9 | Surface | Expedition hexes are 4–18 px tap targets | high | frustration | M | Larger hexes and a pinch-zoomed map, or a list of regions with "Send" buttons (map as an illustration) | `components/worldMap.ts`, `SurfacePanel.ts` |
| 10 | Mid-game | All stores "full (wasting)" by day 10; "This Act ends in ~33d"; nothing to decide | high | churn | L | Economy rebalance (not a UI fix): sinks, caps, act-gate pacing | `tuning.ts`, `ResourceSystem.ts`, `acts.ts` |
| 11 | Warnings | "Food is running low: act now" fires at under 10% of cap even when food is rising (+0.24/s) or 12 min from empty. Every warning shows "⚠ ⚠" | high | frustration | S | Warn on time-to-empty under 3 min, clear it when the rate turns positive, one icon only | `app.ts:876-888`, `Toast.ts` |
| 12 | Layering | Toasts, banners, tip cards, achievement ceremonies and the placement bar overlap (placement plus 3 toasts plus a ceremony; 2 banners plus a tip plus the objective) | high | aesthetic / frustration | M | One notification lane with at most 1 toast. No toasts during placement. Ceremonies wait until no sheet or placement is open | `Toast.ts`, `ceremony.ts`, `controllers/feedback.ts` |
| 13 | Research | "Start research" disabled with no reason (needs 10 Knowledge, which the player has 0 of and can't get without a Laboratory) | high | churn | S | Button says "Need 10 Knowledge: build a Laboratory →" and routes | `ResearchPanel.ts` |
| 14 | Research | 6 tabs (3 off-screen); Act-2 items, Doctrines and "until Genesis" visible in Act I | medium | frustration | S | Show only the current and next tier. Fold "Opens in Act N". Explain Doctrine/Genesis only when they open | `ResearchPanel.ts` |
| 15 | Surface | In Act I the Surface tab is a full-screen dead end ("Research Hazmat Suits") | medium | frustration | S | Lock the tab with a small badge "Needs Hazmat Suits" plus a 1-line popover instead of a full screen | `SurfacePanel.ts`, `HUD.ts` |
| 16 | Wrecked-room sheet | Restoring doesn't show the room's power use (old P4) | medium | frustration | S | Add "Uses 2 power · you have +4.6" (red if negative) to the Cost card | `RuinPanel.ts` |
| 17 | Sheets | The sheet covers the target room; the camera points elsewhere (surface car for the B1 rubble) | medium | confusion | M | Camera frames the target in the visible area above the sheet (use `hudInsets`) | `rendering/camera*`, `utils/hudInsets.ts`, `RuinPanel.ts` |
| 18 | Lore reader | The Close button moves down while the typewriter text grows, so taps miss | medium | frustration | S | Reserve the full text height (or put Close in the header); tap anywhere to finish typing | `controllers/lore.ts`, `story.css` |
| 19 | Popups | "Hidden stash": choice modal, then a second result modal ("Continue") | medium | frustration | S | Result as a toast with a fly-to-HUD, as already done for the door event | `controllers/events.ts` |
| 20 | Popups | Info-only modals ignore Escape and Android back | medium | frustration | S | Back/Escape = "Later"/close for non-decision modals | `app.ts:1166`, `Modal.ts` |
| 21 | Objectives | 3 "assign worker" goals complete themselves in the same second, giving 3 toasts and noise | medium | aesthetic | S | Fold auto-completed goals into one "✓ 3 goals" line, or drop goals that auto-complete | `ObjectiveSystem.ts`, `controllers/feedback.ts` |
| 22 | Level-ups | Level-up toasts in the first minutes (feel F5) | medium | aesthetic | S | Fold into a per-minute digest; show on the person tag only | `controllers/feedback.ts` |
| 23 | Shop | Shop hidden as a tab inside Journal | medium | churn (monetisation) | S | Own entry (HUD credit chip or menu tile); Journal stays story only | `JournalPanel.ts`, `ShopPanel.ts`, `HUD.ts` |
| 24 | Shop | Isotope-7 "for Genesis upgrades", Project boost, etc. visible at minute 10 | medium | confusion | S | Hide items until their system opens | `ShopPanel.ts` |
| 25 | Settings | ~25-row single scroll that mixes navigation, share, tour, language, graphics, saves, New Game | medium | frustration | M | Split into groups: Game (language, sound, text size), Display, Saves, More (Book, Chronicle, Share, Tour). Language on top | `MenuPanel.ts` |
| 26 | Resize | Canvas sized from `innerWidth` doesn't shrink after the viewport gets smaller, so the page zooms out (seen at 608 px and 375 px) | medium | aesthetic / broken | S | Size from `documentElement.clientWidth/Height` or `visualViewport`; CSS 100% | `rendering/BunkerRenderer.ts:515`, `postfx.ts:166` |
| 27 | HUD | HUD touch targets 24–32 px (more pill 52x24, 4 icon buttons 32x32, chips 32 high) | medium | frustration | S | At least 44x44 hit areas (padding or pseudo-element), even if the visual stays small | `HUD.ts`, `style.css`, `touch.css` |
| 28 | Room panel | Remove, Move and Demolish are 34 px high; Demolish sits next to Move | medium | frustration | S | 44 px; Demolish in an overflow "…" | `BuildingPanel.ts:533` |
| 29 | People | 4 filter rows above the list even with 4 people; about 40% of the sheet is filters | medium | frustration | S | Show filters only above 12 people; one combined filter chip row | `PeoplePanel.ts` |
| 30 | People | Duplicate names ("Eli · Level 82", "Eli · Level 67") and odd levels at day 10 | low | confusion | S | Unique name generator, or a surname/initial | `PopulationSystem.ts` |
| 31 | Mid-game HUD | All stores at cap but tiles show huge +rates (+239/s), so the numbers mean nothing | medium | churn | M | Show "FULL" on capped tiles instead of the rate; point to a sink | `HUD.ts` |
| 32 | Act panel | "Command" is 3.5K characters (what-to-do, act goals, 7 acts, projects, 6-h forecast, endings) | medium | frustration | M | Tabs: Now / Act / Endings; first screen = next action plus 3 goals only | `EraPanel.ts` |
| 33 | Command vs objective | Mid-game "What to do now" (Command) and the objective card can differ (old P6) | medium | confusion | S | One source of truth for the next action | `ObjectiveSystem.ts`, `EraPanel.ts` |
| 34 | Tablet 4:3 | Icon-only resource tiles in an uneven 2-row grid; big "Survive" header; a stretched phone layout | medium | aesthetic | M | Tablet layout: labelled tiles in 1 row, side panel for sheets | `style.css`, `HUD.ts` |
| 35 | 16:9 phones | Only about 59% of the screen shows the bunker; the tip card covers half of that | medium | aesthetic | S | Compact HUD under 700 px height; tips as a small bubble near the target | `style.css`, `controllers/tips.ts` |
| 36 | Floating numbers | "All" by default, so +2.9, +4, +6 are scattered over busy paintings | low | aesthetic | S | Default "Important"; float numbers from the HUD tile instead | `components/NumberPopup.ts`, settings default |
| 37 | Nav | ~2 px dead gaps between nav buttons | low | frustration | S | Buttons flex to fill the nav with no gap (visual gap inside) | `style.css` (.hud-bottom) |
| 38 | Sheets | Slide about 1 s; two sheets visibly overlap when switching | low | aesthetic | S | 200–250 ms; cross-fade on switch; close the old sheet instantly | `components/Sheet.ts`, `style.css` |
| 39 | Placement | Hint "Choose a spot for Farm" sits under toasts | low | aesthetic | S | Covered by #12 | `PlacementBar.ts` |
| 40 | Language | The language switch reloads the game (about 4 s with splash) | low | frustration | M | Re-render the UI in place | `app.ts:1141`, i18n |
| 41 | RTL | Latin "B1/B3" and "I·20%" inside Hebrew strings | low | aesthetic | S | Hebrew floor labels ("קומה 3") or bidi-isolated badges | `he.json`, `floorTag.ts` |
| 42 | Readability | Depth ruler 9.9 px, nav badges 11 px, body 12.1 px | low | aesthetic | S | 12 px minimum for labels, 14 px for body text on the phone | `ruler.css`, `style.css` |
| 43 | Audio | "Tap to enable sound" text sits in the DOM; sound starts silent until a gesture, and the first taps have no SFX | low | aesthetic | S | Unlock audio on the "Tap to enter" gesture (already a gesture) | `audio/*`, `ui/splash.ts` |
| 44 | Perf | HUD writes `className` on 16 elements every frame (~414 mutations/s idle) | low | perf/battery | S | Cache class strings; update only on change; consider 10 Hz for the HUD | `HUD.ts:552-555` |
| 45 | Room panel | "Efficiency 54%" with no reason; upgrade cost shown twice (button and row) | low | confusion | S | Tap efficiency for reasons (workers, power, stat match); drop the duplicate cost row | `BuildingPanel.ts` |

---

## Overall verdict

Since 2026-10-09 the game has fixed many single-screen problems:
- the restore loop
- the objective routing
- the build-menu filter
- the room-panel upgrade placement
- back-button behaviour

What still makes it feel "uncomfortable and complicated" is system-level:
1. **Pressure without explanation.** Alarms, falling numbers, no time-to-empty.
2. **Interruptions.** Auto-dialogs take the player's taps, and up to 4 layers stack on screen.
3. **Advice that contradicts the real need.** Recommended beds while starving; Build Farm when no slot exists.
4. **A HUD of unlabeled, small, ever-growing chips.**
5. **Mid-game with nothing to decide.** Everything full; Acts measured in weeks.

Benchmarks like Fallout Shelter win on one clear HUD, one notification lane, big touch targets and short sessions with visible stakes. Items #1–#13 are mostly S/M effort and would remove most of the friction in the first 10 minutes.
