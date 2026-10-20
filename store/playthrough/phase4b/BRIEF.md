# Phase 4b — finishing "danger" (D) and "outside & rewards" (O) — shared brief

Plan: `store/playthrough/upgrade-plan.html` topics 10, 11, 12. Evidence: `store/playthrough/review/strategy-systems.md` (C3, C4, C5, C6, C7,
"Design rules" §5). The first attempt was stopped half way; its unfinished work-in-progress is on branch `phase4-decisions` (commit cbd8e89) —
READ it for ideas (`git show phase4-decisions:<path>`, `git diff 44ae508 cbd8e89 -- <path>`), but START FROM TODAY'S main: a lot changed since.
Important: that WIP, D and O together, slowed the game badly (era 3 not reached in 14 days); your result must not.

What is live now and must keep working:
- phase 3 economy (per-Act appetite, surplus feeds the Act rooms, two-good prices, `SYSTEM_SCHEDULE`/`systemOpen` in `src/data/acts.ts`);
- phase 4 part 1: Crossroads doctrines + endings tally, law upkeep/cooldown, research trim, type specialties, automatic maintenance/training,
  best-fit staffing (Foreman `staff()` calls `population.assignIdleBestFit`), doctrine hooks already wired: `doctrineRaidPace` in
  ThreatSystem.threatPace, `doctrineRaidStrength` + `doctrineWarningBonus` in EventSystem, `doctrineAwayTruce` in AwayDanger (Diplomacy),
  `doctrineClosedGates` in ContractSystem.active / OutpostSystem.max / trade.partnerOpen (Isolationism);
- phase 5: Act signatures — ActSystem's siege reads `bunkerDefense` and `raidStrength` from EventSystem (keep their exports and meaning),
  Genesis hardships `noForeman` (ForemanSystem.available) and `exposedOutposts` (MetaSystem on `raid:resolved`) and `cutOff` (no tribute,
  scenarios.ts);
- UI: one-row HUD with a status chip, life-support tile and floor tag; RoomScreen; Messages bell; Command tabs (Now/Projects/Policies/Endings);
  Surface panel with Picks / All areas / Trade tabs; interruption budget (popupRules/dialogQueue).

Branch `phase4b` in the MAIN checkout `C:\Users\eitan\Desktop\משחק לשרוד` (vite dev server on :5173 serves it). Two agents at the same time:
FILE OWNERSHIP IS STRICT. Never kill processes by name; don't start servers unless needed (stop yours by its own PID); don't push; don't
commit (the lead commits). Saves must keep loading (`node tools/sim/migrate-test.mjs store/playthrough/saves`, `npm run check:full`).
i18n: keys in `store/playthrough/phase4b/i18n-<AGENT>.json` (`{ en, he, replace }`, prefix `p4b<agent>.`, natural Hebrew, glossary lint).
UI: kit + tokens only, phone first (375/320 px, RTL), touch ≥ 44 px, own CSS file. Tag `// [phase4b]`.
SIMS ARE THE GATE: run your base sims FIRST (before any edit), then after: engaged 14 days seeds 1-3 and casual 14 days seeds 1-3
(`node tools/sim/run.mjs ... --json store/playthrough/phase4b/<AGENT>-*.json`). Act II/III start times within +15% of base, idle share not up,
deaths: engaged 0–2 per run on Warden, and the neglect mode (`--mode neglect`) must sometimes lose people. Use `--src` snapshots of HEAD +
only your files to separate your effect from the other agent's in-progress work. Screenshots: `node tools/playthrough-measure.mjs --url
http://localhost:5173 --stage d20 --tour --width 375 --out store/playthrough/phase4b/<AGENT>-tour/d20.json` (read the PNGs, iterate).
Final message: changes (file:line), base vs after numbers, skipped items and why, exact wiring for the lead in files you don't own,
and the bot rule the sim needs (`tools/sim/core.ts` is the lead's).

## Agent D — danger: Exposure, raids, away policy, Foreman (owns `src/systems/{EventSystem,ThreatSystem,AwayDanger,ForemanSystem,IncidentSystem,DeathSystem}.ts`,
`src/data/{incidents,difficulty}.ts`, `src/ui/controllers/danger.ts`, `src/ui/HUD.ts` (exposure gauge only), `src/styles/hud.css`, new
`src/ui/components/Exposure*.ts` + CSS, `src/core/**` (state fields + migration), `tools/sim/{foreman-test,migrate,migrate-test}.*`)
1. Exposure (C4): the threat meter becomes a visible "Exposure" gauge (status chip or a small gauge next to it; fits 320 px) with its 4 drivers
   (stores, radio, people, outposts) and the next-raid ETA in a sheet on tap; two levers: "Hide the stores" (cap stockpiles at 60%: threat −X;
   with phase 3 the overflow already feeds the Act rooms) and "Radio silence" (no newcomers, threat −Y). Show the effect "in your bunker".
2. Raids (C3): continuous odds (logistic around defense vs strength, shown as a %), strength scaled to the bunker's defense (0.8–1.2×) instead
   of the flat Act formula — keep `raidStrength`'s signature for the siege; "hide" protects people and rooms but stops production 1 h; tribute
   a % of the Act currency (respect `cutOff`); a lost fight can kill 1–2 named people (never on Settler; respect health floors and Diplomacy's
   away truce). At least one raid warning lands while the player is online every ~3 sessions.
3. Away policy (C3/C5): one Foreman setting "while I'm away: fight if odds ≥ X%, else pay / hide"; AwayDanger uses it (Diplomacy overrides).
4. Foreman as strategy (C5): the Foreman screen shows only the real policies (away raid policy, resource priority "Act currency first",
   incident auto-pay ceiling); pure chores stay automatic and out of view.

## Agent O — outside & rewards (owns `src/systems/{ContractSystem,OutpostSystem,ExplorationSystem,InboxSystem,DailySystem,SupplySystem,ShopSystem,RushSystem,ObjectiveSystem}.ts`,
`src/data/{trade,surface,surfaceDefs,challenges,orders,shop,achievements,expeditionEvents}.ts`, `src/ui/components/{SurfacePanel,TradePanel,ShopPanel,JournalPanel}.ts`,
`src/ui/controllers/{inbox,daily}.ts`, new `src/ui/components/Today*.ts` + CSS, `tools/sim/daily-test.*`)
1. One Surface screen, two verbs (C7): Send (expedition / caravan) and Hold (outpost) on the existing Picks / All areas / Trade tabs; contracts
   become partner requests shown in the Trade tab and on the partner's map marker (no separate Inbox flow for contracts; keep Isolationism);
   outpost yield by biome and distance, with "pays back in Y h" on the claim card.
2. One "Today" card (C6): daily orders (3) + weekly challenge + supply crate merge into ONE card with a single claim; the endless objectives
   retire into the Act goals (the Act list is the only progress list; keep the tutorial steps); achievements become silent toasts + a Book page.
3. Favours (C6): rush charges + the credits shop merge into one sink, no daily caps, price rising with each purchase (credits come from orders,
   contracts and Act I overflow — phase 3).
