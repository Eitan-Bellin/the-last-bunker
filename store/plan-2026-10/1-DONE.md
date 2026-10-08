# Implementation of plan 1 (game logic and strategy): what was done

Branch: `worktree-agent-ac9edca2eac65ab9c` (worktree `.claude/worktrees/agent-ac9edca2eac65ab9c`). Nothing was pushed or merged.

## Built (phase 1, all 14 items)

| Item | What |
|---|---|
| Q1 | Story timing: chapters 9/10/12 wait for Act III/IV/V, "the big decision" fires only when the Genesis button is open (`genesisGateMet` in `MetaSystem.ts`), late chapters at least one play hour apart (kept in the save: `lateGame.storyUntil`). |
| Q2 | `src/systems/Guide.ts`: the HUD objective line is now the Act's bottleneck (what blocks, with ETA/missing goods) and a tap goes to the right panel (new actions: projects, dig, rooms, ruins, command, genesis). The chip shows `Act·%`. The generic "add 5 levels" tasks only show when the guide has no step. |
| Q3 | The era panel became the **Command panel** (`EraPanel.ts`): "what to do now", every Act requirement with its own next step and a tap, six hour forecast, ending lean, homes, Foreman, laws. Era goals are hidden for long-game runs (shown only for pre-long-game bunkers). The 30/40 contradiction is no longer visible (era goals appear only as a sub-step text). |
| Q4 | Inbox cards show ask and reward, "safe" tag, sort by value, "take all safe contracts" button. |
| Q5 | Contracts: 4 h window, max 3 open, one an hour, reward 3 h, ask is about an hour of the bunker's own production of a scarce good (medicine, scrap, knowledge, tier-2). |
| Q6 | Bunker Book (30 entries, search) with a "?" plate on 10 sheets and in Menu (`HelpPanel.ts`, `data/book.ts`). |
| Q7 | "New system" cards with a glowing button (`controllers/systems.ts`); contracts and seasons open 2.5 days into Act II instead of together with the rest. |
| Q8 | Ending lean in the Command panel (scores and what raises them). |
| Q9 | Foreman standing orders: quick training and safe contracts. |
| Q10 | Shop: blueprint 3/day, scrap 5/day, prices +50% per Act; overflow credits x0.25 from Act IV; training costs components from Act III. |
| Q11 | Raids follow the Act (8 per Act to Act III, +6 after), per-Act gap and away rate. |
| Q12 | **Not enabled.** Measured product of output modifiers (engaged): p95 food 2.1 (Act I), 4.0 (II), 6.5 (III), 7.0 (IV), 9.2 (V), 9.0 (VI); knowledge ~6-7, materials ~5.5. `multiplierCeiling` stays Infinity: a ceiling near 6 as the plan suggests would cut food by a third in Acts V-VI and was not re-simulated. Value for a decision: ~9. |
| Q13 | Weekly prizes shown as collectible badges (not drawn in the scene: that is a rendering change); unused saved fields marked `[reserved]`. |
| Q14 | Chronicle (Menu, settings tab) kept in the save across Genesis. |

## Built (phase 2 and part of 3)

- P2-1 / P2-8: four new doctrine forks (industry, surface, regime, what crosses over) and 24 late research nodes (`researchLate.ts`) with hooks; research now lasts to day ~55 (engaged), ~74 (casual). Lint checks forks and late currency costs.
- P2-2: a second design for 12 charter projects (chosen until the first stage is done).
- P2-3: ending is a choice card when more than one fits (best fit if unanswered; Genesis settles it).
- P2-7: seven late story chapters (Acts IV-VII) plus echoes in the final chapter.
- P2-9: the map grows a ring per Act from Act IV (270 to 468 hexes).
- Exodus lite (P3-5): after the first Genesis the player picks where the next world begins (Bunker 17, Metro, Mine, Seed Vault: rules, start, ending lean); the finished bunker stays as a "home" that sends 1% x Act of an hour of income per hour from Act II. Doctrines "Seed Store" and "Vanguard" carry stock/veterans across.

## Deferred (and why)

- Council/factions, tribunal (P2-4), new work rooms (P2-5), era derived from Act with new landscape stages (P2-6: touches rendering owned by graphics work), daily orders (P2-10), season routine (P2-11), full chronicle graphs (P2-12), settlements/roads/diplomacy/regions (P3-1..4), real scenario content (own projects/chapters per scenario), Ascension (P3-7), phone profiling (P3-8).
- Drawing weekly cosmetics in the scene (rendering).
- Exodus second-timeline simulation: started but stopped on request; the rebirth path is only code-reviewed (tsc, lint) and covered by the migrate test, not by a full sim.

## Simulation (Warden, 3 seeds, same bot; baseline = code before this branch)

| | baseline | after (final tuning) | plan target |
|---|---|---|---|
| Engaged: Genesis day | 49.2-50.0 (median 49.5) | 59.9-61.0 (median 60.0) | 55-65 |
| Casual: Genesis day | 74.5-82.0 (75.0) | 76.0-81.5 (80.0) | 100-115 (**not met**) |
| Engaged Act II/III/IV/V/VI/VII start (day) | 1.5/6.6/15.9/26.5/35.5/40.0 | 1.5/8.0/18.7/33.6/45.5/52.8 | |
| Last research done (day, engaged / casual) | 17-18 / 29 | 55 / 70-75 | ~45 |
| Story chapters (count / last day, engaged) | 13 / day 7 | 20 / day 60 | every <=5 days |
| Map complete (hexes) | 270 | 468 | |
| Idle share online (engaged / casual) | 66% / 71% | 62% / 70% | <=45% (not met) |
| Non-routine decisions per online hour (engaged / casual) | 6.5 / 9.0 | 7.4 / 11.0 | >=10 |
| Deaths | 0 | 0 | 0-2 |
| Online raids, engaged seed 1 | 7 won / 1 lost / 4 tribute | 1 / 0 / 3 | loss 10-20% |

Notes: the casual/engaged gap is 1.33x (was 1.5x): both modes are bound by offline time gates (charter crew hours, research, digs), the same finding as in the Long Game notes. The "routine share" the bot reports (~94%) is dominated by per-tick deposits and is not comparable to a human's clicks. Away raids are lost more often (soft version, no deaths). The 30-minute opening was not touched (Act I code paths unchanged; Act-I guide only replaces the generic tasks after the tutorial).
Raw runs: scratchpad `base-*`, `A-*`, `B-*` json (not in the repo; `store/sim` is untracked).

## Verified

`npx tsc --noEmit` (app and tools), `node tools/sim/lint.mjs` (970 keys per language, plus new checks), `node tools/sim/smoke.mjs`, `npm run build`, migrate test on `store/sim/saves-v4` (5 saves) and on two v5 saves dumped from the baseline code (`v5->v6`, all fine). Browser (dev server, `?slot=bal1&debug`, Hebrew and English, mobile width): Command panel, Bunker Book, inbox cards, new-system card with glow, chronicle; no console errors.

## Save migration

`SAVE_VERSION` 5 -> 6. New fields are all additive with defaults: `longGame.chronicle`, `longGame.meta.homes`, `lateGame.storyUntil`, `lateGame.designs`, `prestige.seedBank/vanguard` (transient). A v5 save is kept once as `lastbunker_auto_v5` before it migrates (existing mechanism). Foreman orders are a map, so the new orders start off. Story flags `sys:*` (tips seen) survive Genesis; a game that already has the Acts' systems gets them marked as seen on first load (no card flood).

## Merge risks

- Shared files touched: `src/app.ts`, `src/ui/HUD.ts`, `src/ui/components/Sheet.ts` (help plate; the sheet moves to the top of the DOM on open, below dialogs), `src/styles/command.css` (new file), `src/data/story.ts`, `src/core/GameEngine.ts`. No file in `src/rendering/*`, `tools/kit*` or `public/art` was changed.
- `Sheet.show()` re-appends its overlay: if the performance agent changes sheet mounting, check it.
- `EraPanel.ts` was rewritten; the panel title key `era.title` now reads "Command".
- Chapter "decision" is now number 20 (new chapters are 13-19); ids unchanged.
- The `.claude/launch.json` was not changed.
