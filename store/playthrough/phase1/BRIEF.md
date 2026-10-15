# Phase 1 "quick wins" — shared brief

Plan: `store/playthrough/upgrade-plan.html` (Hebrew). Evidence with file:line refs: `store/playthrough/review/{ui-architecture,economy-pacing,strategy-systems}.md`.
Branch `phase1-quickwins` in the MAIN checkout `C:\Users\eitan\Desktop\משחק לשרוד` (no worktrees). Two agents edit at the same time, so FILE OWNERSHIP IS STRICT.

## Rules for every agent
- Edit only files you own (below). Need a change in someone else's file? Write it in your report instead.
- Never kill processes by name (no taskkill /IM, no Stop-Process -Name). Stop only PIDs you started yourself. Don't start vite dev servers (the lead runs one); don't use the browser pane.
- Never delete or overwrite saves. Never push, never touch `main`. Do NOT commit — the lead commits.
- Match the surrounding code style and comment density; mark changes with `// [phase1]` comments like the existing `[ux-redesign]` tags.
- Gates before you finish: `npx tsc --noEmit` clean, plus the tests named in your section. `npm run check` runs tsc + smoke + lint + glossary.
- Final message: a list of what you changed (file:line), what you did NOT do and why, and anything the lead must do.

## Agent A — UI (owns `src/ui/**`, `src/styles/**`, `src/style.css`, `src/i18n/**` + locale json, `tools/sim/popup-test.*`, `tools/sim/advisor-test.*`, `tools/sim/onboarding-copy-test.*`)
1. Kit button edge-tap loss (ui-architecture.md §5.1): snapshot the button rect at pointerdown and test the release against that; keep touch pointer capture; move the pressed transform to an inner face so the hit box never shrinks.
2. Modal tap guard (§5.2): only ignore a click whose pointerdown started before the modal opened (or ≤250 ms), and no `.is-pressed` look while guarded.
3. Spotlight above dialogs (§5.3): hide the spotlight synchronously when any modal opens.
4. One problem, one place (§6 fix 5): power crisis shows in the objective strip only (with countdown); tile shows state colour only; remove/suppress the power banner when the strip shows power; no `shortage.low` toast for a store the strip already shows.
5. FTUE spotlight only on the scripted tutorial steps, keyed on the tutorial step, not on every advisor change; move "Skip tutorial" into the bubble (no separate chip over banners) (§6 fix 6).
6. Advisor order during Act I / tutorial: crisis > goal > collect; collect items become a bell badge only (§6 fix 7). Update advisor-test.
7. Returning player (§6 fix 10): after a welcome-back, no other auto dialog for 2 min; battery/install/backup offers gated on THIS SESSION's seconds (≥10 min), not save play time. Rename the battery offer text to say "phone battery" (he: "סוללת הטלפון") so it is not confused with the Power resource.
8. Project "pledge" toggle UI is owned by Agent B (ProjectsPanel.ts is B's file — see below). Do not edit ProjectsPanel.ts.

## Agent B — logic (owns `src/systems/**`, `src/data/**`, `src/core/**` EXCEPT the `[phase1 cheat]` line in GameEngine.loop, `src/ui/components/ProjectsPanel.ts`, `tools/sim/project-test.*`, `tools/sim/lint.*`, `tools/sim/migrate*`)
i18n: B does NOT edit locale json. Put new keys (en + he) in `store/playthrough/phase1/i18n-B.json` as `{ "en": {...}, "he": {...} }` with full dotted paths; the lead merges them. Use `i18n.t('phase1.xxx')` keys under a top-level `phase1` block.
1. First minute survivable (economy-pacing.md §2a): no power death spiral before the player has a lever. E.g. staff the generator as part of restoring it / make "assign to generator" the step right after restore (move ObjectiveSystem step), no `noJob` morale penalty in the first 10 min of a new game, darkness penalty ramps over ~60 s, enough starting power to reach the generator. Target: fresh game, do nothing for 60 s → morale stays ≥ 55, power not at 0 for long once the generator is restored.
2. Act I dead zone (§2b, fix 2): cut Vault Seal crew-hours (projects.ts:85-87) to roughly 1/2/3 h, and let the Act advance on load/offline (GameEngine.ts:352 advances online only). Keep save migration safe for games mid-seal.
3. Auto-delivery ("pledge") for charter projects (fix 8): per-project toggle that feeds the current stage from stock above the reserve every tick; persisted in the save (with migration default off→ on? choose ON for new games, keep current behaviour for old saves unless trivial); toggle in ProjectsPanel. Update project-test.
4. Cleanup (fix 9): remove dead `vaultCoins` from display paths (keep the field in the save type if removing it risks migration — at least hide it everywhere); cut the shop blueprint daily limit (3/day → 1/day); hide food/water/power refinement research while that resource's surplus is > 3x consumption.
5. Do NOT rebalance anything else. Run `node tools/sim/run.mjs --mode engaged --days 1 --seeds 1-3 --json store/playthrough/phase1/B-engaged-d1.json --quiet` and `--mode casual --days 3 --seeds 1-3` at the end and compare with `store/playthrough/d1.txt` (and report deaths, idle, Act II time).
   Gates: `npm run check`, `node tools/sim/project-test.mjs`, `node tools/sim/migrate-test.mjs store/sim/saves-v7`.
