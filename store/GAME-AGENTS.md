# Balance fixes — shared brief for the parallel agents

Project: `C:\Users\eitan\Desktop\משחק לשרוד` — "The Last Bunker / הבונקר האחרון", TypeScript + Vite + PixiJS v8 idle/survival game, Hebrew + English.
The review you implement: `store/BALANCE-REVIEW.md` (read §1, §3 and §5 fully; the fix ids M1–M7, S1–S9, NICE1–4 come from there).
The user asked to implement ALL fixes. Proposed values are starting points; keep the intent, tune with the simulator.

## Rules
- Never touch the player's real save: IndexedDB `keyval-store`/`keyval` key `lastbunker_auto`. In the browser use only `?slot=<yourname>` (dev-only separate save) on your own tab (`tabs_create`; don't touch other tabs).
- New state fields go in `GameState` (`src/core/GameState.ts`) with a safe default in `createInitialState()` AND a fallback in `migrateState()` so old saves load. Don't bump SAVE_VERSION unless needed.
- Every player-facing string goes into BOTH `src/i18n/he.json` and `src/i18n/en.json` (keys must stay in parity; Hebrew is the main language — write natural, simple Hebrew). These two files are shared: re-read right before editing, add your keys as a small block near related keys, never reformat.
- Keep the code style: small focused edits, comments explaining "why" like the surrounding code, no new dependencies.
- Type-check often: `npx tsc --noEmit -p .` and `npx tsc --noEmit -p tsconfig.tools.json`. Other agents edit other files at the same time; if an error is in a file you don't own, wait and retry, never fix someone else's file.
- Shell: write patch scripts as .cjs files in your scratchpad (heredocs with backticks break). Re-read a file right before editing it.
- The dev server runs at http://localhost:5173 (don't start/stop it, don't kill processes).
- Simulator: the balance bot `tools/balance.ts` (`/tools/balance.html?hours=12&seed=N`) — the Simulation agent is upgrading it (Node runner + casual/engaged modes). You may run it; only the Simulation agent edits it.

## Ownership (edit only your files; small, clearly marked hook edits elsewhere only where listed)
- **Economy** (M1, M2, M3, M7, S1, S2, S3, S8, NICE2 demolish): `src/data/chains.ts`, `src/systems/ResourceSystem.ts`, `src/systems/BuildingSystem.ts`, `src/data/buildings.json`, `src/systems/RestorationSystem.ts`, `src/data/ruins.ts`, `src/data/eras.ts` (era goals only), `src/data/zones.ts`, `src/ui/components/BuildingPanel.ts`, the dig-sign text in `src/app.ts`.
- **Progression & meta** (M4, M5, M6, S4): `src/systems/MetaSystem.ts`, `src/data/research.ts`, `src/systems/ResearchSystem.ts`, `src/systems/ObjectiveSystem.ts`, `src/data/prestige.ts`, research/prestige UI panels. Hook edits allowed: the cap bonus of the new "storage memory" prestige upgrade inside `ResourceSystem.computeCaps` (one marked line), starting floors for "pre-dug level" in `GameEngine` new-game/rebirth setup (marked lines).
- **Offline, expeditions & events** (S5, S6, S7, NICE1, NICE3): `src/core/GameEngine.ts` (`simulate()` / offline report), `src/systems/ExplorationSystem.ts`, `src/data/surface.ts`, `src/data/expeditionEvents.ts`, `src/systems/EventSystem.ts`, `src/systems/IncidentSystem.ts`, `src/data/incidents.ts`, welcome-back / offline UI, bubble constant in `src/app.ts`, settings for notifications. Concurrent expedition teams: 2 at start + prestige upgrade `scoutTeams` level (the Progression agent defines that upgrade id in prestige.ts; read its level with `state.prestige.upgrades['scoutTeams'] ?? 0`).
- **Story** (S9): `src/data/story.ts`, `src/systems/StorySystem.ts`, story UI if needed.
- **Simulation** (NICE4): `tools/balance.ts`, `tools/balance.html`, new `tools/sim/*`.

## Report back
What you changed (file:line, old → new values), how you verified it (simulation numbers before/after where relevant), anything left open.
