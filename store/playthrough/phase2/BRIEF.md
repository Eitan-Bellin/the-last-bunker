# Phase 2 "clean screen" (UX/UI & navigation) — shared brief

Plan: `store/playthrough/upgrade-plan.html` topics 2, 3, 4, 6 (Hebrew). Evidence with file:line refs: `store/playthrough/review/ui-architecture.md` (§1–§6) and `strategy-systems.md`. Phase 1 (already on main) fixed: button edge taps, modal tap guard, spotlight only on scripted steps, power shown in the strip only, crate never on the strip in Act I, 2-min quiet after welcome-back, offers after 10 min of session.
Branch `phase2-ux` in the MAIN checkout `C:\Users\eitan\Desktop\משחק לשרוד` (no worktrees). Four agents edit at the same time, so FILE OWNERSHIP IS STRICT.

## Rules for every agent
- Edit only files you own (below). Need a change in someone else's file? Write it in your final report instead.
- Phase 2 is UI only: do NOT edit `src/systems/**`, `src/data/**`, `src/core/**` (a sim is bundling them right now). If a rule change is truly needed, report it.
- i18n: do NOT edit `src/i18n/*.json`. Put new keys (en + he, Hebrew must be natural, plural rules like existing keys) in `store/playthrough/phase2/i18n-<AGENT>.json` as `{ "en": {...}, "he": {...} }`, flat dotted keys under `p2<agent>.` (e.g. `p2h.status`). Changed wording of an EXISTING key: put it in the same file under `"replace": { "en": {...}, "he": {...} }`. The lead merges. Until merged, `i18n.t` shows the raw key — that is fine for your tests.
- Never kill processes by name (no taskkill /IM, no Stop-Process -Name). Stop only PIDs you started. Don't start dev servers; don't use the browser pane.
- Never delete or overwrite saves. Never push, never touch `main`. Do NOT commit — the lead commits.
- Match the surrounding code style and comment density; tag changes `// [phase2]`. Use the design-system kit (`src/ui/kit/*`, tokens in `src/styles/tokens.css`, `store/ux-redesign/DESIGN-SYSTEM.md`); no hex literals, no new z-index numbers outside tokens.
- Phones first: 375x812 and 320 px wide, Hebrew RTL. Touch targets ≥ 44 px.
- Gates before you finish: `npx tsc --noEmit` clean, `npm run check`, plus the tests named in your section. Extend tests you own when you change rules.
- Final message: what you changed (file:line), what you did NOT do and why, i18n file path, anything the lead must do.

## Agent P — interruptions (owns `src/ui/popupRules.ts`, `src/ui/dialogQueue.ts`, `src/ui/controllers/{inbox,systems,tips,lore,whatsnew,dig,events,welcome,feedback,daily}.ts`, `src/app.ts` (dialog sources / gate wiring only), `tools/sim/popup-test.*`)
1. Interruption budget (ui-architecture §6 fix 1): at most 1 non-critical auto-opened dialog per 3 min (5 min in the first 30 min after the tutorial); critical (raid, fire, death, real danger) always passes. Everything else waits silently (bell/inbox) and is never lost.
2. Door knocks (fix 3): only the FIRST knock of a game opens a dialog (teaching). Later knocks: a non-blocking bottom card / toast with Accept / Later, plus a bell row; the player can also set "accept newcomers automatically while there is a bed" (store the preference with the existing settings mechanism, UI-side).
3. Tips / what's-new / "new system" cards / lore finds (fix 4): never chained as blocking modals. New-system cards: at most ONE card per Act transition that lists everything that opened ("Act II opens: Decisions, Foreman, Doctrines"); tips and lore become non-blocking cards (auto-hide) or bell rows ("Read now" stays available from the bell/journal).
4. Leftover from phase 1: when the Act changes during away time on a cold start, show the Act title card after the welcome-back (the offline report log has a `k:'act'` entry; `feedback.ts:457` listener is not registered yet on cold start).
Tests: popup-test (add cases for the budget and the first-knock rule), `npm run check`.

## Agent H — HUD & bell (owns `src/ui/HUD.ts`, `src/styles/hud.css`, `src/styles/touch.css`, `src/styles/bunker-os.css`, `src/ui/components/MenuPanel.ts`, `src/ui/components/ResourceSheet.ts`, `tools/sim/tokens-test.*`)
1. One-row HUD (fix 8): row 1 = 4 resource tiles (amount + one state cue; rate on tap) + one compact "status" chip (Act %, survivors, morale; tap opens Command) + bell. Drop the second row. No "+N more" chip in Act I; afterwards show overflow as an arrow/tile, not a floating chip. Tile order frozen (no live re-sort; urgent tiles get a badge/colour, not a new position). Must fit 320 px wide.
2. Nav tabs (topic 4): a tab whose panel would be empty is hidden or shown locked with when it opens (Research before it has anything to start; Surface while locked already shows a lock — keep consistent). Menu: hide the Genesis entry until Act VI (keep it reachable if the save already has prestige).
3. One bell = "Inbox" (fix 9): the bell lists only rows the player can act on (decisions, crate, daily reward, door knocks, finds, system news). Journal/Chronicle/Book move to one "Archive" entry in the Menu (top row, 1 tap); Shop moves next to credits / Surface trade. Remove the separate "Decisions waiting" pill: its count shows on the bell. One name everywhere: "Inbox" / "תיבה".
Tests: tokens-test, `npm run check`. Agent P owns inbox.ts (the inbox controller); you own how the bell renders. Coordinate through public methods only; report any API you need from P.

## Agent S — screens (owns `src/ui/components/{BuildMenu,PeoplePanel,SurfacePanel,TradePanel,EraPanel,ProjectsPanel,ResearchPanel,BuildingPanel}.ts` and their CSS files under `src/styles/` that only they use (check with grep), `tools/sim/{rooms,placement,openings}-test.*` if touched)
1. Build menu (topic 4): opens on "can build now"; when nothing can be built because there is no space, show ONE clear card "Dig a new floor" (routes to the dig action) instead of 42 cards that each say "no space". Fewer icons per card: keep name, one-line purpose, cost, one main effect; move the rest into the card's detail.
2. Survivor card (PeoplePanel): replace the 5 unlabeled numbers with the top stat by name + one "fit for current job" bar; full stats on tap.
3. Surface panel: open on 3 recommended, different destinations (e.g. safest, best loot, story/new), with the full list/map behind "All areas"; Trade becomes a tab in the Surface panel, not the last list row.
4. Command (EraPanel) with tabs: Now · Projects · Policies(laws/doctrines as they exist today) · Endings — Projects and Laws one tap from the Act chip.
5. Research: when no research can be started yet (Act I), the panel says so in one line with when it opens; no empty branch tabs.
Tests: `npm run check`, plus any of your tests you touch.

## Agent W — world feel (owns `src/rendering/CameraController.ts`, `src/rendering/BunkerRenderer.ts` (camera framing + celebration hooks only), `src/rendering/LabelScale.ts`, `src/rendering/signage.ts`, `src/audio/uiSound.ts`, `src/ui/motion*`/`src/styles/motion.css` if they exist)
1. On start / return, the camera frames the player's own rooms (the floors with people and work), not the empty hub shaft or the sky.
2. Room names readable on a phone at the default zoom (≥ 11 css px equivalent); labels never overlap.
3. Success moments get a short celebration: room restored / built / upgraded, new floor dug, Act complete — camera eases to frame the result, a light flash/particles and a sound (respect reduced motion and the quality setting; ≤ 1.2 s; never blocks input).
Tests: `npm run check`. Read `store/world-redesign/` docs for the City Below camera rules (city mode is default).
