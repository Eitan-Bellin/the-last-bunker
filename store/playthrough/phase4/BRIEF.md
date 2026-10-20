# Phase 4 "real decisions" — shared brief

Plan: `store/playthrough/upgrade-plan.html` topics 9–12. Evidence with file:line refs: `store/playthrough/review/strategy-systems.md` (C1–C7, C9, "Design rules"), `economy-pacing.md`. Phases 1–3 are on main (phase 3: per-Act appetite, surplus feeds the Act rooms, prices of at most two goods, unlock schedule `SYSTEM_SCHEDULE`/`systemOpen`/`forkOpen` in `src/data/acts.ts`, life-support tile).
Work ONLY in the worktree `C:\Users\eitan\Desktop\משחק לשרוד\.claude\worktrees\p4` (branch `phase4-decisions`). Never edit the main checkout. `node_modules` there is a JUNCTION to the main project's: never delete it, never `npm install/ci`, never `git worktree remove`.
Four agents edit at the same time: FILE OWNERSHIP IS STRICT.

## Design rules for every choice you touch (from strategy-systems.md §5)
1. A choice trades two things that are short right now (Act currency, people, defense, time) — never "X vs X-plus-food".
2. Show the result in THIS bunker before the tap ("in your bunker: +12 influence/h, raids 20% stronger").
3. A system that a default fully automates is not a system: hide it.
4. One list of goals (the Act). Everything else is a reward, not a goal.
5. Every danger must be preventable by a decision the player could have made, and must sometimes cost a person.

## Rules for every agent
- Edit only files you own. Need a change elsewhere? Put it in your final report.
- i18n: do NOT edit `src/i18n/*.json`; new keys (en + he, natural Hebrew, plural forms like existing keys, glossary `store/ux-review/GLOSSARY.md` + `node tools/sim/glossary-lint.mjs`) go to `store/playthrough/phase4/i18n-<AGENT>.json` as `{ "en": {...}, "he": {...}, "replace": { "en": {...}, "he": {...} } }`, keys under `p4<agent>.` (lowercase agent letter).
- UI: design-system kit (`src/ui/kit/*`, tokens in `src/styles/tokens.css`), no hex literals, no raw z-index; phones first (375 and 320 px wide, Hebrew RTL), touch targets ≥ 44 px. New CSS goes in a new file you own (e.g. `src/styles/p4-<agent>.css`) imported by your component.
- Saves: any state shape change needs a migration (`src/core/state/*` owned by Agent D — ask D via your report, or add a backwards-compatible optional field with a default at the read site). Never delete saves.
- Never kill processes by name. Don't start dev servers, don't use the browser. Don't commit, don't push.
- Sims from the worktree (`node tools/sim/run.mjs ...` bundles its live src). Run your base sims BEFORE your first edit (`store/playthrough/phase4/<AGENT>-base-*.json`), then after. The bot (`tools/sim/core.ts`, owned by the lead) feature-detects APIs: if your change needs the bot to choose differently, describe the bot rule in your report.
- Tag changes `// [phase4]`.
- Gates: `npx tsc --noEmit`, `npm run check:full`, `node tools/sim/migrate-test.mjs store/playthrough/saves`.
- Final message: changes (file:line), sim numbers before/after, skipped items and why, anything the lead must do.

## Agent C — identity: Crossroads, Policies, Endings (owns `src/data/{researchLong,researchLate,research,endings,laws}.ts`, `src/systems/ResearchSystem.ts`, `src/systems/ActSystem.ts`, `src/ui/components/{ResearchPanel,EraPanel}.ts`, new `src/ui/components/Crossroads.ts`, `src/ui/controllers/systems.ts`)
1. Crossroads (C1): each doctrine fork stops being a research node the player stumbles on. When its fork opens (`forkOpen`), a full-screen Crossroads opens once (respecting the dialog budget: register it as an important source via the existing dialog queue in `src/app.ts` — report the 3-line wiring to the lead) with 3 columns: the rule change (not a %), the number "in your bunker", and which ending it pushes. Rewrite the doctrine nodes so each changes how a loop plays (e.g. Fortress: raids rarer but stronger and you choose a sally each time; Diplomacy: tribute auto-paid while away and never lose people to raids; Isolationism: threat ×0.75 but no outposts/contracts). The choice stays permanent; the research tree shows the chosen path as done.
2. Endings tally: Command (EraPanel) "Endings" tab shows the four endings with a live score and what pushes each.
3. Policies (C2): laws cost upkeep per hour (influence or knowledge, scaled per Act) and have a 12-hour cooldown after repeal; the Policies tab in Command shows doctrines (read-only chosen path) + law slots with "in your bunker" numbers.
4. Research trim (C9, careful): hide filler % nodes the player never needs to think about (fold them into automatic room upgrades or mark them auto-complete when their prerequisites are done), aiming at ~60 visible nodes; replace any Act goal that says "complete N researches" with a specific unlock (report the acts.ts goal change to the lead if you can't own it — acts.ts is NOT yours).
Sims: engaged 14 days seeds 1-3 before/after (Act times, doctrine picks still happen, research count).

## Agent D — danger: Exposure & raids & Foreman (owns `src/systems/{EventSystem,ThreatSystem,AwayDanger,ForemanSystem,IncidentSystem,DeathSystem}.ts`, `src/data/{incidents,difficulty}.ts`, `src/ui/controllers/danger.ts`, `src/ui/HUD.ts`, `src/styles/hud.css`, `src/core/**`, `tools/sim/{migrate,migrate-test,foreman-test}.*`)
1. Exposure (C4): show the threat meter as an "Exposure" gauge (HUD status chip or a small gauge next to it; must fit 320 px) with its 4 drivers (stores, radio, people, outposts) and the next raid ETA in a sheet on tap; two player levers: "Hide the stores" (cap stockpiles to 60%: threat −X, overflow becomes Act currency) and "Radio silence" (no newcomers, threat −Y).
2. Raids (C3): continuous odds (logistic around defense/strength, shown as "72%"), raid strength tracks the bunker's defense (0.8–1.2×) instead of a flat Act formula; "hide" protects people and rooms but stops production 1 h; tribute is a % of the Act currency; a lost fight can kill 1–2 named people (never on Settler difficulty; respect existing floors like onlineHealthFloor). At least one raid warning lands while the player is online every ~3 sessions ("scouts in 15 min").
3. Away policy (C3/C5): one Foreman setting "while I'm away: fight if odds ≥ X%, else pay / hide"; AwayDanger uses it.
4. Foreman as strategy (C5): the Foreman's orders that are pure chores stay automatic but disappear from the player's view (no toggles for maintain/staff/train); the Foreman screen shows only the 3–4 real policies: away raid policy, resource priority ("Act currency first"), incident auto-pay ceiling.
5. Incidents priced in the Act currency (C3 note).
Sims: engaged and neglect 14 days seeds 1-3 before/after: deaths (must be > 0 sometimes for neglect, ~0–2 for engaged on Warden), raid win rate not 0/100, Act times within +15%.

## Agent R — rooms & chores (owns `src/data/{specializations,projects,mastery}.ts`, `src/systems/{BuildingSystem,MaintenanceSystem,ProjectSystem,PopulationSystem}.ts`, `src/ui/components/{BuildingPanel,PeoplePanel,ProjectsPanel,MaintenanceCard}.ts`, `tools/sim/{project,rooms}-test.*`)
1. Specializations (C2): one choice per room TYPE (applies to every room of that type, change costs a cooldown), from Act III; remove the per-room retool UI (keep save compatibility: existing per-room roles map to the type choice = the most common role).
2. Project designs: keep only A/B pairs that trade two scarce things; delete dominated designs (default A for saves that had them).
3. Hide chores (C5): maintenance becomes a passive wear stat with no button (the Foreman/crew handle it); training is automatic; staffing uses the best-fit stat by default — keep a manual override but remove nags.
Sims: engaged 14 days seeds 1-3 before/after (room levels, Act times, maintenance incidents).

## Agent O — outside & rewards (owns `src/systems/{ContractSystem,OutpostSystem,ExplorationSystem,InboxSystem,DailySystem,SupplySystem,ShopSystem,RushSystem,ObjectiveSystem}.ts`, `src/data/{trade,surface,surfaceDefs,challenges,orders,shop,achievements,expeditionEvents}.ts`, `src/ui/components/{SurfacePanel,TradePanel,ShopPanel,JournalPanel}.ts`, `src/ui/controllers/{inbox,daily}.ts`, `tools/sim/daily-test.*`)
1. One Surface screen, two verbs (C7): Send (expedition / caravan) and Hold (outpost). Contracts become partner requests shown on the partner's marker / in the Trade tab (no separate Inbox flow for contracts). Outpost yield by biome and distance, with "pays back in Y h" on the claim card.
2. One "Today" card (C6): daily orders (3) + weekly challenge + supply crate merge into ONE daily card with a single claim; the endless objectives retire into the Act goals (the Act list is the only progress list); achievements become silent toasts + a Book page.
3. Favours (C6): rush charges + credits shop merge into one sink, no daily caps, price rising with each purchase (keep phase 3's credit sources: orders + contracts + Act I overflow).
Sims: engaged and casual 14 days seeds 1-3 before/after (credits earned/spent, outposts held, expeditions sent, idle share).

## Extra for Agent R (found by the lead in a day-35 tour)
4. Survivor levels run away: a toast said "ערן עלה לרמה 432" (level 432). Find the level/mastery growth (src/data/mastery.ts, PopulationSystem / training) and cap or rescale it so levels stay human-readable (e.g. ≤ 50, or show a rank instead of a raw number); keep save compatibility (rescale on load).
