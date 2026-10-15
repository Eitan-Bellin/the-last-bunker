# Phase 3 "an economy that matters" — shared brief

Plan: `store/playthrough/upgrade-plan.html` topics 7 and 8 (+ topic 5 item "fewer things in the first 6 minutes", topic 6 "short prices").
Evidence with file:line refs: `store/playthrough/review/economy-pacing.md` (§1, §2, §3, fixes 3, 4, 5, 7) and `strategy-systems.md` (C8).
Work in the WORKTREE `C:\Users\eitan\Desktop\משחק לשרוד\.claude\worktrees\p3` (branch `phase3-economy`, built on phases 1+2). NEVER edit the main checkout `C:\Users\eitan\Desktop\משחק לשרוד\src` (a measurement is running there). `node_modules` in the worktree is a JUNCTION to the main project's: never delete it, never run `npm install`/`npm ci`, never `git worktree remove`.
Two agents edit at the same time: FILE OWNERSHIP IS STRICT.

## Rules for every agent
- Edit only files you own (below). Need a change in someone else's file? Put it in your final report.
- i18n: do NOT edit `src/i18n/*.json`; new keys (en + he, natural Hebrew, plural forms like existing keys) go to `store/playthrough/phase3/i18n-<AGENT>.json` as `{ "en": {...}, "he": {...}, "replace": { "en": {...}, "he": {...} } }`, keys under `p3<agent>.`.
- Saves: every rule change must load old saves safely (state migration in `src/core/state/*` if a field changes; owned by Agent E). Never delete saves.
- Never kill processes by name. Don't start dev servers, don't use the browser. Don't commit, don't push.
- Sims: run them from the worktree (`node tools/sim/run.mjs ...` bundles the worktree's live src). Report before/after numbers. Baselines for comparison: run the same command on the unchanged code FIRST (before your first edit) and save it as `store/playthrough/phase3/<AGENT>-base-*.json`.
- Tag changes `// [phase3]`. Match surrounding style.
- Gates: `npx tsc --noEmit`, `npm run check:full` (it includes migrate-test on saves-v6/v7), `node tools/sim/migrate-test.mjs store/playthrough/saves`.
- Final message: changes (file:line), sim numbers before/after, what you skipped and why, anything the lead must do.

## Agent E — economy (owns `src/systems/ResourceSystem.ts`, `src/data/{tuning,pricing,resources,chains,specializations,shop}.ts`, `src/systems/ShopSystem.ts`, `src/core/**`, `src/systems/morale.ts`, `tools/sim/{lint,migrate,migrate-test,format-test}.*`)
Goal: food/water/power/knowledge matter again; no runaway numbers; prices list at most 2 resources.
1. Consumption per head rises per Act (≈ ×1.4–1.5 per Act) and the production multiplier stack gets a ceiling (`tuning.ts multiplierCeiling`, now Infinity → ≈4). When the Act changes, held overflow above cap is clamped to the cap. Target (engaged sims): base resources at cap ≤ 60% of online time from Act II on, but no famine/thirst deaths and no "stall" (bot still reaches the same Acts within +15% time).
2. Surplus feeds the Act: the Act-currency rooms (roles that produce components/alloys/data/influence/seedCores) take a meaningful input of base resources (food/water/power/materials), so one more farm = more of the Act currency (chains / role inputs).
3. Credits: no more credits from tier-1 overflow (`overflowCredits`); credits come from daily orders and contracts only. Make sure the shop is still usable (check sims: credits earned/day vs shop prices; adjust shop prices if needed).
4. Short prices: `olderCurrencyShare` → 0 so a price asks at most materials + the current Act currency (keep lint `node tools/sim/lint.mjs` green: every Act's upgrades/digs must fit storage).
Sims: engaged 14 days seeds 1-3 and casual 14 days seeds 1-3 (`--json store/playthrough/phase3/E-*.json`), compare to your base runs: Act times, at-cap shares, deaths, idle share, credits.

## Agent P — pace & unlocks (owns `src/data/acts.ts`, `src/data/eras.ts`, `src/systems/ActSystem.ts`, `src/systems/EraSystem.ts`, `src/systems/ObjectiveSystem.ts`, `src/ui/controllers/systems.ts`, `src/ui/HUD.ts`, `src/styles/hud.css`, `src/ui/components/ResourceSheet.ts`, `src/ui/components/EraPanel.ts`, `tools/sim/{openings,advisor}-test.*`)
1. Staggered unlocks: Act III opens one system at a time (laws +2 days, outposts +4 days, the second doctrine fork later); generalize the existing `lateActTwoSystems` stagger into a per-Act schedule list. Act II: Foreman day 0, contracts/caravans wait for Act III (with outposts), seasons Act IV.
2. Population caps: Act II popCap 30 → 40 (check the next Acts still step up sensibly); door arrivals while full wait in a queue instead of being lost (UI side is phase 2's knock card; rule side here if needed — if the rule lives in EventSystem/PopulationSystem, report it to the lead instead of editing).
3. First 6 minutes: expeditions and research wait until the base stands (e.g. after the generator, pump and farm are working / tutorial step N), so a new player meets one thing at a time.
4. Era vs Act: the player sees ONE progress bar (the Act). Hide era numbers/bars from the HUD and Command (keep eras internal for art/era backdrops); Act goals that say "reach era N" are reworded to what they mean.
5. "Life support" chip (HUD): when food, water and power each have production ≥ 2× consumption and ≥ 30 min of stock, the HUD shows ONE "life support OK" tile instead of the three tiles (free tiles show the Act currency / materials); a tile comes back by itself the moment its resource is short. Must fit 320 px.
Tests: openings-test, advisor-test, `npm run check:full`. Sims: engaged 4 days seeds 1-3 before/after (Act times, idle share, gaps).
