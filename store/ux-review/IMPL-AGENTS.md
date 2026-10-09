# UX review → implementation (2026-10-09): shared brief for the 6 implementation agents

The owner said: implement the recommendations, don't stop, don't ask questions. Work autonomously; when a choice is a judgement
call, pick the option the review recommends and note it in your final summary.

## Where you work
- Each agent has its OWN git worktree and branch, already created: `C:\Users\eitan\Desktop\lbux-wpN` on branch `ux/wpN`
  (node_modules is a junction; `store/sim/saves-v6/` is there). Work ONLY inside your worktree. Never touch
  `C:\Users\eitan\Desktop\משחק לשרוד` (the owner's checkout) or another agent's worktree.
- The reports are in `store/ux-review/*.md` inside your worktree. Read the sections for your items before coding.
- Files are CRLF in places; keep each file's existing line endings. Patch scripts (if any) go in your scratchpad, as .cjs files.
- Do NOT start dev servers on 5173/5174/4199/4299. No `pkill`/killing node. Headless checks only (tsc, tools/sim).
- Never delete or overwrite saves (IndexedDB `lastbunker_auto`). Save format changes must be backward compatible
  (optional fields; old saves must load; `node tools/sim/migrate-test.mjs store/sim/saves-v6` must pass).

## File ownership (edit only your own files; if you truly need a one-line hook in someone else's file, keep it tiny and say so in the summary)
- **WP1 Guidance & goals**: `src/systems/ObjectiveSystem.ts`, `src/systems/Guide.ts`, `src/ui/components/EraPanel.ts`,
  `src/ui/components/ProjectsPanel.ts`, `src/systems/ProjectSystem.ts`, `src/app.ts` (ONLY `onObjectiveTap`/`runAction`/
  `focusUpgradeCandidate` and helpers they call), `src/ui/controllers/systems.ts`.
- **WP2 Economy & strategy**: `src/systems/ResourceSystem.ts`, `SupplySystem.ts`, `DailySystem.ts`, `ShopSystem.ts`,
  `ForemanSystem.ts`, `OutpostSystem.ts`, `ExplorationSystem.ts` (loot only), `BuildingSystem.ts` (upgrade cost/time only),
  `src/systems/modifiers.ts`, `src/data/{tuning,pricing,orders,laws,prestige,acts,challenges,shop,research*}.ts`,
  `src/core/state/longGame.ts`, `src/ui/components/ResourceSheet.ts`, and the morale code wherever it lives (PopulationSystem/HomeSystem).
- **WP3 Feedback, feel & notifications**: `src/ui/controllers/{feedback,danger,story}.ts`, `src/ui/ceremony.ts`,
  `src/ui/components/{NumberPopup,Toast}.ts`, `src/ui/dialogQueue.ts`, `src/ui/notifications.ts`, `public/sw.js`,
  `src/systems/{DeathSystem,IncidentSystem}.ts`, `src/audio/*`, `src/app.ts` (ONLY `dialogGate`, tips, `spawnOnLeave` call,
  visibility handlers, the not-enough-resources toasts), a new helper `src/ui/missing.ts` (what is missing/how much/ETA).
- **WP4 Convenience & HUD**: `src/ui/HUD.ts`, `src/ui/components/{BuildMenu,BuildingPanel,PeoplePanel,StructurePanel,RuinPanel,Sheet,Modal,ZoomButtons}.ts`,
  `src/ui/controllers/{world,events,daily}.ts` (events = inbox flow), `src/ui/rtl.ts`, `src/ui/dom.ts`, `src/ui/viewportUi.ts`,
  `src/styles/*`, `src/style.css`, `tools/sim/lint.mjs` (only to add a lint rule).
- **WP5 Content & return report**: `src/data/{lore,incidents,expeditionEvents,story,chains,ruins}.ts`, a new `src/data/names.ts`,
  `src/systems/{EventSystem,StorySystem,ChronicleSystem,PopulationSystem(name generation only),FamilySystem}.ts`,
  `src/ui/controllers/welcome.ts`, `src/core/GameEngine.ts` (ONLY the away/offline report bookkeeping), `src/ui/expeditionText.ts`,
  `src/ui/components/{JournalPanel,ChroniclePanel}.ts`.
- **WP6 Words, onboarding & book**: existing strings in `src/i18n/he.json` + `en.json` (rewrites), `src/data/{book,story}.ts`
  (only the difficulty-picker order at story.ts ~80), `src/ui/components/{HelpPanel,ResearchPanel,Intro}.ts`, `src/ui/splash.ts`.
- **i18n**: everyone may ADD new keys to `he.json` and `en.json`. Add them inside your own new top-level block
  named `"wp1"`, `"wp2"`, ... placed right after the opening `{` (so merges don't collide at the end). Hebrew is the main
  language: write natural, short Hebrew, plural address ("לחצו", not "לחץ"). Keep he/en parity (`node tools/sim/lint.mjs`).

## Gates before you finish (all must pass in your worktree)
`npx tsc --noEmit -p .` · `npx tsc --noEmit -p tsconfig.tools.json` · `node tools/sim/smoke.mjs` · `node tools/sim/lint.mjs` ·
`node tools/sim/migrate-test.mjs store/sim/saves-v6` · `npm run check:full` (if a test needs files you don't have, say so) · `npm run build`.
WP2 (and anyone touching pacing) also: sims per `tools/sim/README.md`, before vs after, short runs in the background.
Pacing guard rails: engaged Genesis ~50–65 days, casual ~75–115, Warden deaths ≈ 0 on casual; Act II must not get longer.

## Finish
Commit on your branch (several small commits are fine), message prefix `ux-wpN:`, ending with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push, do NOT merge. Final message to the lead (Hebrew, ≤25 lines):
what you did per item (done / partial / skipped + why), gates results, sim numbers if any, anything the lead must check when merging.
