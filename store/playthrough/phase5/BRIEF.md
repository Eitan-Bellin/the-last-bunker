# Phase 5 "content & memory" — shared brief

Plan: `store/playthrough/upgrade-plan.html` topics 13 and 14. Evidence: `store/playthrough/review/economy-pacing.md` (§4 "the Acts are counters",
fixes 6 and 10), `strategy-systems.md` (C10, loop D). Live already: phases 1–3, phase 4 part 1 (Crossroads doctrines with an endings tally,
law upkeep, research trim, `SYSTEM_SCHEDULE` in `src/data/acts.ts`), clean-front steps 0–3 (clean world, RoomScreen, camera, 18 new paintings).
The owner's complaint: the game feels like a pile of counters, not fun, not memorable. Goal of this phase: every Act is a chapter you remember,
something happens in the middle of it, and the second run plays differently.

Branch `phase5-content` in the MAIN checkout `C:\Users\eitan\Desktop\משחק לשרוד` (a vite dev server on :5173 serves it). Two agents edit at the
same time: FILE OWNERSHIP IS STRICT. Never kill processes by name; don't start servers unless you need your own (stop it by its own PID);
don't push; don't commit (the lead commits). Saves must keep loading (`node tools/sim/migrate-test.mjs store/playthrough/saves` + check:full).
i18n: do NOT edit `src/i18n/*.json`; put keys in `store/playthrough/phase5/i18n-<AGENT>.json` as `{ "en": {...}, "he": {...}, "replace": {...} }`
under `p5<agent>.` (lowercase letter). Story text: write both English and natural Hebrew (plural address for the player, glossary
`store/ux-review/GLOSSARY.md`, `node tools/sim/glossary-lint.mjs`), in the tone of the existing chapters in `src/data/story.ts`.
Tag changes `// [phase5]`. Gates: `npx tsc --noEmit`, `npm run check:full`, migrate-test. Sims: engaged 14 days seeds 1-3 before/after for
Acts I–III; for later Acts load the stage saves `store/playthrough/saves/d35|d50|d70-seed1.json` in a small Node harness built on
`tools/sim/core.ts` / `migrate.ts` helpers (or `tools/sim/run.mjs` options if it can start from a save) and advance a few days.
Final message: changes (file:line), numbers before/after, skipped items and why, exact wiring the lead must do in files you don't own.

## Agent A — the Acts as chapters (owns `src/data/acts.ts`, `src/systems/ActSystem.ts`, `src/data/story.ts`, `src/systems/StorySystem.ts`,
`src/ui/controllers/story.ts`, `src/ui/components/StoryDialog.ts`, `src/data/incidents.ts`, `src/systems/EventSystem.ts` (only for a new
Act event), `src/ui/components/EraPanel.ts` (Act goal display only), `tools/sim/{openings,advisor}-test.*`)
1. **A signature problem per Act** (economy-pacing fix 6): each Act keeps at most 2 counter goals plus ONE goal that is an event or a choice
   tied to its theme, e.g. II "the first winter / take in the clan", III "choose the law that defines the colony", IV "hold the Wall in a siege"
   (a scripted multi-wave raid that the player prepares for, warned a day ahead), V something about the outside (an expedition/outpost
   moment), VI "the vote" (a real choice using influence, not "have 1,500"), VII the crossing / the ending decision. Drop "dig N floors"
   from at least 3 Acts. Each signature event is announced (Act card + a goal line), can be prepared for, resolves with a story beat, and
   can partly fail without a dead end (a worse outcome, never a stuck save). Keep Act length roughly the same (sims within ±20%).
2. **A story beat in the middle of every Act** (fix 10): one chapter or decision that triggers at ~50% of the Act's goal progress, tied to the
   Act's signature problem (it foreshadows or sets it up). Add them to `story.ts` (II–VII), through the existing story system.
3. The bot (`tools/sim/core.ts`, owned by the lead) must be able to pass the signature goals: describe in your report the bot rule needed
   (e.g. "answer the siege prompt with X"), or make the default path automatic when the bot does nothing reasonable.

## Agent G — Genesis and run 2 (owns `src/data/{prestige,mutators,scenarios,endings}.ts`, `src/systems/MetaSystem.ts`,
`src/ui/components/MenuPanel.ts` (Genesis tab only), any new `src/ui/components/Genesis*.ts` + its CSS, `tools/sim/migrate*`)
1. **Keystones first** (C10): at Genesis the first purchase is a keystone; at the start of run 2 the player picks a "class" (the keystone) on a
   full-screen choice with what it changes in plain words.
2. **Isotope upgrades that matter**: isotope-7 upgrades act on the Act currency and on dig/upgrade time (today the full shop gives +0% to the
   Act currency — see strategy-systems.md §0/C10).
3. **Mutators with bite**: each mutator removes a crutch (e.g. "no tribute", "outposts are lost on a lost raid", "no Foreman") in return for its
   legacy bonus; no more free legacy.
4. **The ending you got shapes run 2**: the ending reached (Fortress / Commonwealth / Garden / Ark, see endings.ts and the Crossroads tally)
   grants a distinct small starting perk in the next run, shown on the Genesis screen.
Check with a run-2 sim: a Genesis on the d70 save then 3 days engaged — report what changed vs run 1.
