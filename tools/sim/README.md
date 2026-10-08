# Balance simulator

Runs the real game systems headless (no browser, so Vite reloads can't kill a run) with a bot and three player models,
and prints/saves milestone times and economy health numbers. The browser page `/tools/balance.html` uses the same core.

## Run

```
node tools/sim/run.mjs --mode greedy  --hours 48 --seeds 1-5 --json store/sim/my-greedy.json
node tools/sim/run.mjs --mode casual  --days 7   --seeds 1-5 --json store/sim/my-casual.json
node tools/sim/run.mjs --mode engaged --days 7   --seeds 1-5 --json store/sim/my-engaged.json
```

| flag | meaning |
|---|---|
| `--mode` | `neglect` (Danger) casual visits but never reacts to raid warnings, disasters or wear (tests the offline safety net) · `greedy` always online · `casual` ~45 min/day (40-min first session, then 15/10/10/10-min check-ins at 0h/3.5h/13h/18h) · `engaged` ~2 h/day in 8 sessions |
| `--hours` / `--days` | length: greedy in online hours (default 48), casual/engaged in calendar days (default 7) |
| `--seeds` | `1-10` or `1,4,7` (default `1-5`); the same seed + same code = the same run |
| `--json` | save everything (per run + aggregate + code fingerprint); a `.txt` with the summary table is written next to it |
| `--nodanger` | control run with raids, disasters, wear and away danger switched off (compare Genesis timing; per-run `danger` block in the JSON otherwise) |
| `--think` | seconds between bot decisions while online (greedy 5, sessions 10) |
| `--jobs` | parallel worker threads (default: CPU count − 3) |
| `--src` | run against a frozen copy of the code instead of live `src/`, e.g. `store/sim/baseline-src` (holds `core/`, `systems/`, `data/`) |
| `--return` | `restart` (default: a real app start through `GameEngine.init()`, the welcome-back path) or `resume` (the tab-visible path, `engine.simulate()`) |
| `--note` | free text stored in the JSON |
| `--difficulty` | `settler`, `warden` (default) or `last` (long game) |
| `--dump-save <prefix>` | write each run's final game as `<prefix>-seed<N>.json` (sample saves for migration tests) |
| `--daily` | [plan4:GP-1] the bot's use of the daily orders: `half` (default: finishes and takes 1 then 2 of the 3 orders, 1.5 on average, the richest first: gold, taken as a piece of a blueprint, then silver), `full` (all three and the chest every day, the stress case), `off`. The result has a `daily` block (days, orders, chests, credits, rush, blueprints) |
| `--progress` / `--quiet` | more / less console output |

Re-print or compare saved runs:

```
node tools/sim/report.mjs store/sim/baseline-casual.json
node tools/sim/report.mjs store/sim/baseline-casual.json store/sim/my-casual.json     # A vs B medians
```

Browser: `http://localhost:5173/tools/balance.html?mode=casual&days=3&seeds=1-2` (also `hours=`, `seed=`, `think=`).
It keeps everything in memory and never touches the real save.

## How it works

- `bundle.mjs` bundles `node-entry.ts` + the live `src/` with the repo's own rolldown (into `node_modules/.cache/sim/`).
  `idb-keyval` is replaced by a stub; with `--src` every `src/` import is redirected to the snapshot.
- `worker.mjs` runs one seed per worker thread (fresh module state: the event bus and id counters are module-level),
  stubbing only what Node lacks (`window`, `document`, `localStorage`, `location`, `requestAnimationFrame`).
- `core.ts` (shared with the browser page):
  - **Determinism**: `Math.random` becomes a seeded PRNG and `Date.now` a simulated clock (the start differs per seed,
    so maps differ), before the engine is created. No game code is changed for this.
  - **Online step** = the calls `GameEngine.tick()` makes, read from its source at runtime (so a new system added to
    `tick()` is picked up), at dt = 1 s. The list is saved as `meta.stepList`.
  - **Away and back**: the bot saves (in-memory `SaveManager`), the clock jumps, and a fresh `GameEngine` runs
    `init()`, exactly like reopening the app (offline simulation, door, era catch-up). The welcome-back report is recorded.
  - **Bot**: answers every dialog (door newcomers accepted; raids fought; story: first affordable choice; any unknown
    event: first available choice, reported once in `warnings`), reads the journal (so onboarding advances), follows the
    current objective, restores ruins and pulls a worker off a job when a started ruin has no hands, keeps research and
    the research queue full (main tree first, cheapest first; Refinements when nothing else is open), builds what is short,
    builds/upgrades Storage when the next dig costs more than the cap, upgrades when materials pass 70%, specializes,
    digs, opens districts, staffs rooms (short resources first), uses every expedition team, keeps teams home late in a
    session to send them on long hauls overnight (when the game has them), lets door newcomers in after a return and opens
    the daily supply drop (when the game has it). New engine APIs are feature-detected, never assumed.

## Output (per run, aggregated across seeds)

Milestones (wall and online time): eras, floors B4–B8, populations, ruins cleared, first expedition, every research,
every story chapter, `GENESIS available` with the rebirth payout at that moment, first death. Plus: samples over time
(population, research count, resources/caps/net rates, morale, min HP, isotope estimate), share of online time each
resource sits at its cap, idle gaps (online time without any affordable action; gaps ≥ 1 min), deaths (famine/other),
injuries (expeditions, raids, sickness), famine/thirst seconds (online), each offline return (gained, wasted, door
arrivals, teams home, research done), story chapters reached, last-progress time (stall detection: era, floors, rooms,
levels, research, beds), objectives done and final state.

## Baseline

`store/sim/baseline-*.json` / `BASELINE.md` were made on the code from before the balance fixes, frozen in
`store/sim/baseline-src/` (verified identical to the reviewer's 3 Oct 16:24 bundle). Re-run a baseline mode with
`--src store/sim/baseline-src` to compare like for like after bot changes.

## Long-game tools

- `node tools/sim/daily-test.mjs [folder]`: [plan4:GP-1] daily orders (04:00 day, pool and choice, streak and grace day, rewards, the 1.5-hour cap, progress, away rules, swap, save defaults, one pass through the engine).
- `node tools/sim/lint.mjs`: en/he keys and placeholders match, research is a sound DAG, every cost names a real resource (also in CI and `npm run check`).
- `node tools/sim/migrate-test.mjs [folder]`: migrates and starts every sample save in the folder (default `store/sim/saves-v4`); fails on anything lost.
- `node tools/sim/gates.mjs <save.json> [--hours 24]`: determinism (same seed, same game), offline identity (a day away vs online, shared systems within 3%) and performance budgets.
- The bot follows a different doctrine path and law order per seed, takes contracts, builds outposts, digs with a crew and keeps the tier-2 roles of each Act. Milestones include `act N`, `doctrine <id>` and `ending <id>`; deaths carry a cause (`deaths.causes`), raids are counted by kind and stance (`danger.byKind`).
- Pacing knobs live in `src/data/tuning.ts` (reference income per Act, price scale, charter stage hours, contracts, outposts); Act ceilings and goals in `src/data/acts.ts`.
