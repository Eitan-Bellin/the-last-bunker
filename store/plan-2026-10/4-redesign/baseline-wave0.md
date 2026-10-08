# Plan 4, wave 0: baselines and QA tooling (QA-Sim-Perf)

Measured on the code of commit `be9483d` (plan docs on top of `f2e1044`), in the agent container (4 shared CPUs, no GPU, Chromium 1194 with
SwiftShader, root user). **Read the caveat before using any number below as a gate.**

## 1. Performance baseline (`npm run build`, then `node tools/perf/run.mjs --check --only ...`)

It works here with `CHROME=/opt/pw-browsers/chromium` (also picked up automatically now: `tools/perf/lib.mjs` lists that path, and adds
`--no-sandbox` when running as root). `CI=1` adds the SwiftShader flags the GitHub runner uses; both modes give the same picture.

Two runs each (`CI=1`), phone profile 360x740 at DPR 2.75 (the game renders at 2x), Medium quality:

| scenario | draw calls (budget) | objects drawn / total | GPU texture MB (budget) | alloc KB/frame (budget) | ms median / p95 | picture fps | busy % |
|---|---|---|---|---|---|---|---|
| f8-overview-medium | 559, 625 (420) | 3,972 / 6,112 | 206, 191 (260) | 2,931, 3,631 (520) | 20.8/35.9, 30/30 | 0.5, 0.3 | 1.4, 1.0 |
| f24-close-medium | 626, 605 (440) | 4,549 / 9,734 | 235, 228 (280) | 4,222, 3,912 (430) | 20.2/21.6, 25.6/33.3 | 0.7, 0.8 | 2.2, 3.5 |
| f24-idle-medium | 875, 870 (720) | 7,057 / 11,851 | 214, 227 (280) | 5,035, 4,812 (1,300) | 34.8/141, 26/279 | 0.8, 0.8 | 6.5, 8.1 |
| f24w-close-medium (pending, X-4) | 632 (440) | 4,523 / 9,706 | 214 (280) | 4,503 (430) | 27.2/42.4 | 0.8 | 3.5 |

Bundle: JS 521 KB gz (limit 520 +10%), CSS 15 KB gz. No console errors. Overdraw (injected estimate): f8 12.6x, f24-close 18.0x, f24-idle 15.9x.

**Caveat: the gate does not pass in this container, and that is the container, not a regression.** Software GL renders a picture in
roughly 0.2-0.5 s (`requestAnimationFrame` runs at 2 fps at DPR 2.75, 5 fps at DPR 1), so the probe averages over 2-5 pictures per scenario.
Draw calls come out 30-50% above the budget (which was calibrated on real GPUs at ~60 fps) and allocation per frame is inflated 5-10x
(everything allocated between the few pictures is divided by a handful of frames). Objects drawn, objects total, GPU MB and the bundle size are
steady and within 5% of the budget or below it. Use this container for "does it run" and for relative objects/GPU MB before/after;
use CI (or a laptop with a GPU) for draw calls and allocation. The 4 CPUs are also shared with other agents, so ms are noise.

## 2. Sample saves (current code, `SAVE_VERSION` 6) in `store/sim/saves-v6/` (gitignored; copies in the session scratchpad)

| file | made with | act / era | floors | people | rooms |
|---|---|---|---|---|---|
| c-seed1/2/3.json | `--mode casual --days 3 --seeds 1-3 --dump-save store/sim/saves-v6/c` | 2 / 2 | 6, 6, 7 | 38 | 31-32 |
| e10-seed1.json | `--mode engaged --days 10 --seeds 1 --dump-save store/sim/saves-v6/e10` | 3 / 3 | 8 | 65 | 41 |
| e30-seed1.json | `--mode engaged --days 30 ... e30` | 4 / 3 | 14 | 110 | 46 |
| e55-seed1.json | `--mode engaged --days 55 ... e55` | 7 / 3 | 20 | 190 | 46 |

(Rooms/people after 1 h away + 10 min, from migrate-test.) Run time: 30 s for the casual set, 1.5 min / ~6 min / ~13 min for 10 / 30 / 55 days.
`--dump-save <prefix>` writes `<prefix>-seed<N>.json` as documented, no adaptation was needed.

`node tools/sim/migrate-test.mjs store/sim/saves-v6`: **all 6 pass v6->v6.** Fixed along the way (`tools/sim/migrate.ts`): the check "era 3 save is
placed in Act 4" is a v4->v5 rule and failed every v6 save outside Act 4 (e10, e55); it now applies only to saves with no `longGame` slice.

`node tools/sim/gates.mjs store/sim/saves-v6/e30-seed1.json`: determinism ok (same hash); offline identity ok for all 12 shared resources (max
0.6%); information-only full-online vs away: materials 17.5% (as before, info only); tick 1.07 ms (budget 2) ok; stringify 0.41 ms ok;
**`simulate 24h` 1,713 ms vs budget 1,500 FAILS** in this container (shared, slow CPU), so `gates` is not part of `check:full` yet.

## 3. Lint baseline (QA-3, non-failing)

`node tools/sim/lint.mjs` now prints `lint warning: 29 legacy floor-geometry use(s) outside rendering/geom.ts (/ FLOOR_H: 5, SLOTS_PER_FLOOR: 24)`
(`--verbose` lists them; `rendering/geom.ts` does not exist yet, so everything counts). Pattern is `/ FLOOR_H` and `SLOTS_PER_FLOOR` (broader than the
plan's `(y - TOPSOIL) / FLOOR_H`). Lint still exits 0. Later waves turn `legacyGeometryWarnings` (tools/sim/lint.ts) into problems.

## 4. Tools added in wave 0

| tool | how |
|---|---|
| `npm run check:full` | `npm run check` + `migrate-test` on `store/sim/saves-v6` (`check` itself unchanged; the saves folder must exist, see section 2) |
| `node tools/compare/run.mjs capture --tag <t> [--save file\|dir] [--fixture 24x60] [--sizes ..] [--dpr 2] [--lang he]` | the six `camShots` views at 375x667, 375x812, 390x844, 430x932 into `store/compare/<t>/<source>/<WxH>/<cam>.png`; starts its own Vite dev server (or `--url`) because `?slot` and `__camPng` exist in dev only |
| `node tools/compare/run.mjs diff <a> <b> [--images] [--check] [--tolerance 1] [--block 4]` | per-shot percent of 4x4 blocks that differ by more than 8/255, JSON in `store/compare/`, optional red-on-grey diff PNGs |
| `?perfFixture=wide` + `f24w-*` scenarios | hook only: today the same bunker as f24-*; `"pending": true` scenarios are printed under "PENDING" and never fail `--check` |

Noise floor of `compare`: two captures of the same code differ by 2.8% (overview) to 4.1% (close-up) on e30-seed1 (production pop-ups and light
glows follow the wall clock). A refactor that must be pixel-identical is therefore compared against a second capture of the baseline, not against 0.
Capture time here: about 1-2 minutes per source and size.
