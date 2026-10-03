# The Last Bunker: balance and progression review

Reviewer: game-design / economy pass, 3 Oct 2026. Scope: `src/core`, `src/systems`, `src/data`, `tools/balance.ts`.
I did not edit any game file. All numbers come from code reading and from simulations (method in the Appendix).

---

## 1. Executive summary

The first 30 minutes work well. The player gets a quick win every 20 to 90 seconds: a ruin is cleared, a room comes back, someone knocks on the door, a lore note turns up, the first radio chapter plays. After that the economy breaks in two opposite ways at once:

1. **Hard walls that stop progress for good.** Scrap is always at 0, because workshops and labs burn it as an automatic "boost" fuel. Materials storage is smaller than what the next floor costs. Because of these two walls, Project Genesis (prestige) was **never reached** in any unmodified run: 4 bot runs of 48 h and 4 simulated "real player" weeks. In about 1 run in 3, a casual player stays stuck in era 1 on 3 floors **for the whole week**, because the 200 materials cap is below the 250 materials the first dig costs.
2. **Everything else is far too cheap and too plentiful.** Production multipliers stack to about 20× (level ×3, morale ×2, specialization ×1.4, boost ×1.5, research, skill, compound). One max-level farm feeds about 145 people. Every room reaches level 5 in 1 to 3 h of play. Materials, food, water, power and knowledge sit at their cap 85 to 95% of the time. Morale stays at 90 to 100 all game. **Nobody died in about 350 simulated online hours.** Survival tension, loss aversion and the "one more upgrade" loop are all missing after hour 2.

Because the caps are tiny compared with production, **offline progress is wasted**. From day 2 on, the welcome-back report is literally empty (`gained: {}`). The door clock, events, story and children only advance while the app is open. So the "come back and see what happened" loop, which is the backbone of an idle game, does not work.

The content also runs out fast when the walls are removed. In what-if runs with the walls patched, an engaged player finishes all 24 research nodes, all 41 room slots at level 5 and all 8 floors by about day 2. A casual player does the same by about day 4, and the 168-hex map is exhausted soon after. The 7 story chapters end by day 2 to 5. Prestige has about 2,850 isotope of upgrades in total, and the first rebirth already pays 600 to 1,300.

**Top fixes, all small data or constant changes (details in §5):**

| # | Fix | Where |
|---|---|---|
| M1 | Boost fuel (scrap) may only be burned above a reserve, for example 50% of cap | `src/data/chains.ts:43` |
| M2 | First dig must cost less than the base materials cap; flatten the dig curve | `src/systems/BuildingSystem.ts:224-225`, `src/systems/ResourceSystem.ts:14` |
| M3 | Storage also raises the scrap cap; larger per-level caps | `src/data/buildings.json` → `storage.effects.storageCap` |
| M4 | Gate Genesis on population and era as the plan says (pop 40 to 50, era 3); slow tier 4 and 5 research | `src/systems/MetaSystem.ts:30`, `src/data/research.ts` |
| M5 | Cut the rebirth payout about 4×; raise prestige sinks | `src/systems/MetaSystem.ts:37-39`, `src/data/prestige.ts` |
| M6 | The endless-objectives research track dead-ends at 25 researches (only 24 exist) | `src/systems/ObjectiveSystem.ts:162` |
| M7 | Restored rooms must not take every survivor as crew (Remnant stall, 30% of seeds) | `src/systems/RestorationSystem.ts:181-195` |
| S1 | Narrow the morale multiplier (0.5 to 2.0 becomes 0.75 to 1.5) and steepen upgrade costs | `src/systems/ResourceSystem.ts:150`, `src/systems/BuildingSystem.ts:71` |
| S2 | Bigger caps plus offline arrivals and a research queue, so the welcome-back screen has content | `src/core/GameEngine.ts:219-242` |
| S3 | Expeditions 4 to 8× longer, more teams, a bigger map; they become the offline payload | `src/systems/ExplorationSystem.ts:80`, `src/data/surface.ts:66` |

In what-if runs, patches M1 to M3 alone move Genesis from "never" to **15 h17m of online play** for the greedy bot, which is exactly the plan's 15 to 20 h. With M1 to M4 together, it lands on **day 1.5 to 2 for an engaged player and day 3 to 5 for a casual one**. That is still faster than the plan's week 2, which is why the S fixes (slower mid-game, more sinks) are needed as well.

---

## 2. What a real player experiences today (as built)

Sources:
- "Casual" = the simulated player online about 45 min/day: a 40-min first session, then 15/10/10/10-min check-ins.
- "Engaged" = about 2 h/day in 8 sessions.
- Both use the balance-bot brain, but only while online, and offline time runs through the engine's own `simulate()`.
- 3 casual seeds and 2 engaged seeds, 7 days each. Ranges are across seeds.
- A real human makes decisions more slowly than the bot, so treat the early times as lower bounds.

| Wall-clock | What happens (casual / engaged) | Feel |
|---|---|---|
| **0 to 5 min** | Generator ruin cleared in about 15 s, B1 rubble and first note at about 1 min, pump and farm at about 2 min. **Era 1 "Restoration" at 1 to 3 min** (bot); in 9 of 30 seeds more than 10 min, in 2 of 30 more than 1 h (see P10). First knock at 60 s, 5 survivors at 5 min, chapter 1 "static" at about 5 min. | Excellent hook: dense, tactile, a stream of wins. Era 0 is over almost before it registers. |
| **5 to 30 min** | All 14 ruins cleared by 10 to 35 min. Canteen and storage built, first research, first expedition (about 20 min), first incident (15 min), first upgrade (15 to 30 min), chapter 3 "toll" at 30 min. Population hits the bed cap (8/8) between about 15 and 30 min. | Still good. The first small dead spell (up to 8 min) is waiting for knowledge before a lab exists. |
| **1 h** | Engaged: 15 to 19 rooms, many already at level 5 (`maxRoom` achievement at 42 to 67 min), 16 to 17 survivors. If a Storage was built, the 4th floor and era 2 arrive at about 45 to 60 min. Materials sit at cap from here on. | Peak "number go up". Upgrades cost 20 to 60 s of income, so they stop feeling like decisions. |
| **3 h** | Casual is offline after the first 40-min session. On return: +163 materials and +10 food, then caps. Engaged: 25 to 30 survivors, about 17 researches. | Welcome-back already small. |
| **8 h** | Casual: 16 to 20 survivors (the door clock only ticks while online), 14 to 15 rooms all maxed, knowledge and materials capped. Engaged: 4 floors, scrap 0, rooms maxed. | Little left to do in a check-in except send one 5-minute expedition. |
| **Day 1** | Casual: 24 to 30 survivors (bed-capped), 14/24 research. 1 in 3 casual seeds is stuck at 3 floors because there is no storage and the 200 cap is below the 250 dig cost. Engaged: 36 to 49 survivors, era 2. | The "what's next?" stops having an answer. |
| **Day 3** | Casual: era 2, 4 floors, 19 rooms all level 5, scrap 0. Research stuck at 17 to 20/24 (reactor and Genesis need scrap). Engaged: the same, plus most of the map explored. Story is finished (5 to 7 chapters). | Grind with no goal; only expeditions move. |
| **1 week** | Casual: about 45 survivors, era 2, 71 of 168 hexes explored, **no Genesis**, offline reports empty. Engaged: up to 6 floors and all 168 hexes; **Genesis research never completes** (scrap). | Churn risk is very high; the epic loop never starts. |

For comparison, the always-online greedy bot (4 seeds × 48 h) reaches era 2 at 7 h47m to 8 h21m, then **makes no progress from about hour 10 to hour 48**: same buildings, floors and research count (`g48_2`/`g48_3`, "Last progress" stays at about 10 to 12 h).

---

## 3. Problems found, with evidence

### A. Hard walls and soft-locks

**P1. Scrap is drained to 0 by automatic boost fuel, which blocks the whole late game.**
- `src/data/chains.ts:24-25`: workshop and laboratory take scrap as `boost: true` input. `inputFed()` (`chains.ts:43`) burns it whenever stock is above 0.5.
- Two L5 workshops and two labs draw about 0.25 to 0.31 scrap/s, which is about 1,000/h. Every scrap source is a trickle: expeditions give 3 to 40 per trip, ruins are one-off, raid wins give 10 to 30.
- Evidence: scrap was `0/200` at almost every hourly sample in every unmodified run. The offline log shows scrap *falling* while away (`scrap: -52`).
- What scrap gates: dig B4 to B8 needs 40 to 160 scrap, reactor 80, `reactorTheory` 60, `fusionHall` 140, `temporalTheory` 150, metro district 160, Reactor Hall 300.
- The player has no toggle (`src/ui/components/BuildingPanel.ts:168-173` only *shows* "boosted / no boost").
- With only the drain removed (patch `noBoostDrain`), the greedy bot reaches `GENESIS available` at **15h17m** instead of never.

**P2. Materials cap is lower than the next dig, and storage can be crowded out.**
- Base materials cap is 200 (`src/systems/ResourceSystem.ts:14`).
- Dig cost is `250 × 1.9^(floors−3)` materials plus `40 + 30×n` scrap (`src/systems/BuildingSystem.ts:224-225`). In order: **B4 250**, B5 475, B6 903, B7 1,715, B8 3,258.
- The only cap sources are Storage (+150 per level), Advanced Engineering (+200) and the Vault specialization.
- B1 to B3 are zoned (`src/data/zones.ts`) and hold about 15 rooms. If they fill up before a Storage is built, the player can't dig (250 > 200) and can't place a Storage. **There is no demolish** (the `build.demolish` string exists, but no system uses it).
- Evidence: casual seed `c7_3` is stuck at `M 200/200`, 3 floors and era 1 for all 7 days. Greedy `g48_2`/`g48_3` are stuck at `M 400/400` against a 475 dig from about hour 8 to hour 48.
- Quarters L4→L5 costs 472 and Lab L3→L4 costs 515, both above a 400 cap, so those upgrades are blocked too.

**P3. Reactor Hall needs 300 scrap, but the scrap cap is 200 and only the Vault specialization raises it.**
- `src/data/buildings.json` → `reactorHall.baseCost.scrap: 300`.
- `storage.effects.storageCap` has no `scrap` entry.
- The player has to max a Storage, then pick the Vault specialization, before Reactor Hall can ever be afforded. Nothing in the game tells them this.

**P4. Genesis is not reachable, and when it is, the plan's gate is missing.**
- `canRebirth` only checks the `temporalTheory` feature (`src/systems/MetaSystem.ts:30`).
- The plan says "Pop 50 + Temporal Research".
- As built it is never reached (P1 and P2). Once the walls are patched it comes too early: engaged day 1.5 (patched run `x_e_B`: 52 h wall time, 5.5 h online).

**P5. The endless objectives dead-end.**
- The research track target is `5 + 2×tier` (`src/systems/ObjectiveSystem.ts:162`).
- At tier 10 it asks for 25 researches, but `RESEARCH` has 24. The objective chain is sequential, so it **stops for good** there.
- The exploration track (`3 + 4×tier`, line 146) does the same at tier 42 (the map has 168 hexes).
- Players who are ahead clear the early tiers instantly ("Reach 8 survivors" when they have 30), so the dead end arrives quickly.

### B. Economy: too generous, everything capped

**P6. The production stack makes costs meaningless.**
- Farm example: base 0.6 × level-5 factor 3.0 (`levelMultiplier`, `perLevel` 0.5) × staffing/skill up to 1.75 × compound 1.1 × morale up to 2.0 (`ResourceSystem.ts:150`) × Orchard 1.4 × Nutrition 1.2 ≈ **11.6 food/s**.
- A survivor eats 0.08/s, so one farm feeds about 145 people.
- Upgrade costs are `base × mult^level × 1.5` (`BuildingSystem.ts:71`). In materials:

  | Upgrade | L1→2 | L2→3 | L3→4 | L4→5 |
  |---|---|---|---|---|
  | Farm | 48 | 77 | 123 | 197 |
  | Workshop | 38 | 65 | 111 | 188 |
  | Storage | 105 | 210 | 420 | 840 |

- By hour 1 materials income is 5 to 25/s, so every upgrade is under 40 s of income.
- Evidence: `maxRoom` achievement at 0h42m to 1h07m; all rooms L5 within 2 to 3 h.
- Time each resource spent at its cap (engaged `e7_1`, 14 h online): power 98%, water 99%, food 38% (famine sessions), medicine 96%, knowledge 92%, materials 89%.

**P7. Morale is a free ×2 multiplier and creates no tension.**
- Morale factors: base 45, job +15, canteens up to +22 (`MAX_CANTEEN_BONUS`, `src/systems/PopulationSystem.ts:28`), Leadership +8, Mess Hall specs +10 each, family +6, children up to +6, leader +5.
- Average morale was **90 to 100 for the entire game** in every run. The −14 crowding cap (`PopulationSystem.ts:144`) never bites.
- The multiplier range 0.5 to 2.0 therefore sits at about 1.9 permanently.

**P8. Power is a non-resource.**
- A generator makes 6/s at L1 and 18/s at L5. Room draw is 1 to 4 and **does not scale with level** (`ResourceSystem.ts:31` adds a flat `def.powerConsumption`).
- Net power surplus was +30 to +300/s from hour 1; power was capped 98% of the time.
- The Reactor (30/s) and Reactor Hall (90/s) solve a problem that doesn't exist; they are only worth building because an era goal asks for a reactor.

**P9. Food and water never threaten survival.**
- Only starvation-type crises occurred, caused by bot build-order quirks: worst survivor HP dipped to 41, and **0 deaths in about 350 online hours**.
- Starvation costs 0.1 HP/s, but offline `simulate()` doesn't run `PopulationSystem` at all, so a starving bunker freezes while away.
- The plan's "loss aversion: a survivor can die" never happens. Raids that are lost take 30% of materials (`src/systems/EventSystem.ts:266-268`), which is refilled in seconds because materials are capped.

### C. Population, beds and the door clock

**P10. Remnant (era 0) is either over in 1 to 3 minutes or stalls.**
- Ruin work per slot is 9 to 16 seconds (`src/data/ruins.ts:17-32`), so the generator wreck is about 22 work-seconds.
- Across 30 seeds (`era0.js`), era 1 arrived in 76 to 137 s in 21 seeds, 6.5 to 23 min in 7 seeds, and **more than 45 min / more than 1 h in 2 seeds**. The official bot (`seed=7`) showed 0h43m.
- Every slow seed had the same state at 10 min: beds `4/4`, **0 idle survivors, 1 ruin started with no hands, 3 ruins cleared**.
- Cause: `RestorationSystem.complete()` keeps the clearing workers as crew of the restored room (lines 181-195). After generator (1), pump (1) and farm (2), all 4 survivors are employed. The remaining ruin has nobody, and with the starting dormitory full (4 beds) no newcomer can arrive.
- A human sees the `ruin.noIdle` hint (`src/ui/components/RuinPanel.ts:127`) but has to work out on their own that they should pull someone off a job.

**P11. Upgrading Quarters is about 3× worse per bed than building new ones, and B1 only fits 2 Quarters.**
- New Quarters: 30, 54, 97, 175 materials for 4 beds each.
- Quarters upgrade: +2 beds for 81, 146, 263, 472.
- After the canteen and medbay are restored, B1 has room for exactly one more 3-wide Quarters. Beds stall at 12 to 30 until the player digs. Combined with P2, population stalls without explanation (casual `y_c4`/`z_c5`: 12/12 for 10 days).

**P12. The door clock only runs while the app is open.**
- `stats.totalPlayTime` is not advanced in `GameEngine.simulate()` (lines 219-242), and `EventSystem`, `StorySystem`, `IncidentSystem` and `EraSystem` are not run offline. Children's growth is also keyed to play time (`src/systems/FamilySystem.ts:74`).
- A 45-min/day player gets about 3 to 6 arrivals per day once past 16 people (gaps of 300/480/840 s, `EventSystem.ts:308`).
- On its own this is a reasonable "the door needs someone home" rule. Combined with empty offline reports, though, nothing social happens while away.

### D. Research, eras, floors, districts

**P13. The research tree is short and fast.**
- 24 nodes; research speed is `1 + 0.25 × labLevels` (`src/systems/ResearchSystem.ts:94`). Two L5 labs give 3.5×, so even `temporalTheory` (1,800 s) takes about 9 minutes.
- All non-scrap nodes were done by about 2 to 5 h of play. With scrap fixed, all 24 were done on day 2 (engaged) and day 4 (casual).
- There is one research slot and no queue, so 8 h offline completes at most one node.

**P14. Era goals are fine as signposts but hide the cap and scrap prerequisites.**
- Era 1→2 asks for "Dig a fourth level", which needs Storage (P2).
- Era 2→3 asks for a reactor and 6 levels, which need scrap (P1).
- Players read these as the next goals and hit invisible walls.

**P15. Districts and halls are good content but gated only by the story flag and scrap.**
- `districts:unlocked` comes from chapter 5 "deep".
- Cave, lake and metro cost 60/100/160 scrap (`src/data/districts.ts`); see P1.

### E. Events, incidents, raids, story

**P16. Event stakes don't scale.**
- Stash gives 20 to 40 + 3 × buildings materials (`EventSystem.ts:119`). Trader: 15 food → 30 materials, or 15 water → 5 medicine. Pipe leak: 10 materials, or lose 30% water.
- After hour 1 these choices are noise, because everything is capped. Raid tribute is "25% of materials", which is always worth paying since materials are capped; there is never a reason to fight.
- Frequency is fine for active play: one random event every 3 to 7 min (`MIN_GAP`/`MAX_GAP`, lines 298-299), an incident every 7 to 15 min (`src/systems/IncidentSystem.ts:11-12`), and a chapter at most every 4 min. In a 10-minute check-in that is about 2 events, 1 incident and 1 to 2 knocks.

**P17. Incidents are fair but toothless.**
- The crew puts out a fire in 50 to 100 s. Quick-fix costs (25 water, 20 materials, 4 medicine, 25 scrap) are always affordable. Burnout is capped.
- Good as a "tap to help" micro-loop, but it creates no real danger after hour 1.

**P18. The story runs out early.**
- 7 chapters (`src/data/story.ts`). All of them played by 2 h of online play: day 2 for engaged, day 2 to 6 for casual.
- There is no narrative content for era 3, for population growth or for the run-up to Genesis. The plan's "The Tension Cycle (hours 10 to 30)" and "faction storylines" have nothing behind them.

### F. Expeditions and the surface

**P19. Trips are too short for an idle game, loot is flat, and the map runs out.**
- Duration is `60 + 45×distance + 30×danger` seconds (`src/systems/ExplorationSystem.ts:80`): 2.3 min for nearby ruins, 8.3 min for the farthest military zone, half that with Vehicles.
- Biome loot (`src/data/surface.ts`) is 3 to 40 per resource and doesn't scale with progress, so materials loot is irrelevant after hour 1. Only scrap, blueprints and recruits matter.
- The map has radius 7, which is 168 hexes. The always-online bot explores all of them by 13 to 16 h with one team; a casual player covers about 70 in a week.
- A team returns minutes after a casual player leaves, so expeditions don't fill offline time, which is exactly where an idle game needs them.
- Concurrent teams are already allowed (`canSend` has no limit), but nothing in the UI or the bot encourages using them.

### G. Prestige, meta and offline

**P20. The rebirth payout is about 5 to 10× too large for the shop.**
- `rebirthGain = 5 + √(food/20) + 2×pop + 2×research + explored + Σlevels` (`MetaSystem.ts:37`). At the moment Genesis unlocked in patched runs it gave **600 to 1,300 isotope**.
- The whole shop (`src/data/prestige.ts`, all 7 upgrades to max) costs about **2,850**. The first rebirth buys about 40% of all meta progress; the second or third rebirth maxes it.
- Some upgrades are weak against the current economy:
  - `quickStart` gives +60 resources, which is seconds of income.
  - `veteranSurvivors` adds +1 starting survivor when a newcomer knocks every 75 s anyway.
- There is no Ascension layer, so the meta loop ends after about 3 rebirths.

**P21. The offline and welcome-back loop is empty.**
- Offline runs at 80% efficiency with a 24 h cap (`GameEngine.ts:25-26`), but resources hit their caps within minutes.
- Casual `c7_1` offline log: from 37 h wall time on, **every return reports `{}`**. Engaged `e7_1`: `{}` or "+1,300 food" (refilling after a famine).
- Nothing else accrues: no arrivals, no story. Research completes at most one node, and expeditions return within minutes.
- There are no push or local notifications at all: `settings.notificationsEnabled` exists in `GameState.ts:156`, but nothing reads it.

### H. Engagement loops

- **Short loop (seconds)**: tap bubbles (30 s of one room's output, `src/app.ts:64`), tap incidents, answer knocks. Strong for the first hour. After that a bubble is worth about 0.5% of a cap, so it stops being rewarding.
- **Medium loop (minutes)**: build, upgrade, staff. Dies at about 2 h, because everything is affordable at once or blocked by P1 and P2.
- **Long loop (hours)**: research, eras, chapters, digging. Ends by day 2 to 3; for 1 in 3 casual players it is frozen from day 1.
- **Epic loop (days)**: prestige. Unreachable as built.
- **"One more minute" moments** that exist: an expedition decision on the road, the next knock, an incident burning. Ones that are missing: "my storage is almost full, I need to spend", "the trader leaves in 30 min", "the team comes home in 2 h with something rare", "Genesis in 3 more milestones".

---

## 4. What-if results (evidence for the fixes)

All patches are runtime monkey-patches in the simulator, not edits to the game. Times are wall time; online time is in brackets.

| Scenario | Patches | Era 2 | Era 3 | GENESIS available | Notes |
|---|---|---|---|---|---|
| Greedy, as built (4 seeds × 48 h) | none | 7h47m to 8h21m | never | **never** | Frozen from about hour 10. Scrap 0, materials cap 400 < 475 dig. |
| Casual, as built (3 seeds × 7 d) | none | 3.5 h to 48 h, or never | never | **never** | 1 of 3 frozen in era 1 for the whole week (no Storage). |
| Engaged, as built (7 d) | none | 47 min | never | **never** | Famine sessions from bot build order; 0 deaths. |
| Greedy | `noBoostDrain` | 12h38m | n/a | **15h17m** | Matches the plan's 15 to 20 h for an always-online player. |
| Casual | `noBoostDrain` | 27.5 h | never | never | Scrap still too thin for a casual player. |
| Casual | + `scrapCap`, `bigCaps`, `digCheap` | 13 h | 96 h | **133 h (day 5.5)** [4.7 h online] | Payout 1,405 isotope (too much, P20). |
| Engaged | same | 4 h | 48 h | **52 h (day 2.2)** [5.5 h online] | Everything maxed by day 4, then idle. |
| Casual | full package + `steep3` + `slowLate` + Genesis gate (pop 40, era 3) | 18 h | 52 h | **75 h (day 3)** | Still fast; the content runs out by day 5. |
| Engaged | same | 2 h | 20 h | **46 h** | |

Conclusions:
- M1 to M3 remove the walls.
- Making the mid-game slower (S1, S4) and stretching content (S3, S5) are both needed to reach the plan's "first rebirth in week 1 to 2" for casual players.
- Rebirth payout has to shrink (M5) whatever the timing.

---

## 5. Prioritized fixes

Values are proposals to tune with the bot after the M fixes land.

### MUST

1. **M1: Scrap boost only burns surplus.**
   - `src/data/chains.ts:42-44`, `inputFed()`. For boost inputs, require `amount > 0.5 × cap` (or a fixed reserve of 100) instead of `> 0.5`.
   - Optionally lower the workshop scrap draw (`chains.ts:24`) from `base 0.05, perLevel 0.3` to `base 0.03, perLevel 0.15`.
   - Expected: scrap accumulates for digs and research. Greedy Genesis goes from never to about 15 h.
2. **M2: First dig always affordable; gentler dig curve.**
   - `src/systems/ResourceSystem.ts:14`: `BASE_CAPS.materials` 200 → **300**.
   - `src/systems/BuildingSystem.ts:224-225`: `250 × 1.9^n` → **`180 × 1.7^n`** (B4–B8: 180 / 306 / 520 / 884 / 1,503), and scrap `40 + 30n` → **`25 + 20n`**.
   - Also show "needs storage: cap X < cost Y" on the dig button.
   - Expected: no permanent era-1 freeze (the `c7_3` case).
3. **M3: Storage raises the scrap cap and caps grow faster.**
   - `src/data/buildings.json` → `storage.effects.storageCap`: add `"scrap": 100`.
   - `materials` 150 → **300**; `food`/`water` 100 → **200**; `knowledge` 100 → **150**.
   - Expected: Reactor Hall and the metro become reachable without the hidden Vault requirement, and caps hold longer offline.
4. **M4: Genesis gate and pacing per the plan.**
   - `src/systems/MetaSystem.ts:30`: `canRebirth` = `genesis` feature **and** `survivors ≥ 40` **and** `era ≥ 3`.
   - `src/data/research.ts`: multiply `time` ×2 for tier 3, ×4 for tier 4, ×8 for tier 5. `temporalTheory` 1,800 → 14,400 s; `fusionHall` 1,500 → 12,000 s.
   - Expected: engaged about day 2 to 3, casual about day 3 to 5 with M1 to M3. Add the S fixes to reach the plan's week 1 to 2.
5. **M5: Rebirth economy.**
   - `MetaSystem.ts:37-39`: return `Math.floor(raw / 4 × (1 + 0.1 × rebirthCount))`, so the first rebirth pays about 150 to 300.
   - `src/data/prestige.ts`:
     - `quickStart` +60 → **+150 per level, including 30 scrap**.
     - New upgrades:
       - "Storage memory": +25% caps per level.
       - "Pre-dug level": start with 4 floors.
       - "Second lab bench": +1 research queue slot.
       - "Scout teams": +1 concurrent expedition.
   - Expected: meta progress over 5 to 10 rebirths instead of 2 or 3.
6. **M6: Objective dead end.**
   - `src/systems/ObjectiveSystem.ts:162`: target `Math.min(5 + tier×2, RESEARCH.length)`, with `skipIf` when every node is done. Same for explore at line 146: `Math.min(…, map size − 1)`.
   - Better: make the dynamic targets relative, for example "+N from now", so they are never already done.
7. **M7: The Remnant crew stall.**
   - `src/systems/RestorationSystem.ts:181-195`: keep at most **1** crew member on a restored room while another started ruin has no hands. Alternatively make `pickIdle()` (line 90) take from staffed rooms when nobody is idle during era 0.
   - Or raise the starting dormitory to 6 beds (Quarters `effects.maxPopulation.base` 4 → 6 for the seeded room only).
   - Expected: era 0 never stalls (currently 30% of seeds take more than 6 min, and 2 of 30 more than 45 min).

### SHOULD

1. **S1: Compress the multiplier stack.**
   - `src/systems/ResourceSystem.ts:150`: `0.5 + avg/100×1.5` → **`0.75 + avg/100×0.75`** (0.75 to 1.5).
   - `src/systems/BuildingSystem.ts:71`: upgrade multiplier `pow(costMultiplier, level) × 1.5` → **`pow(costMultiplier + 0.6, level) × 1.5`**. Farm L4→5 goes from 197 to about 1,180; quarters from 472 to about 2,140.
   - Expected: rooms max out around day 2 to 4 instead of hour 1, and upgrading becomes a decision again.
   - Re-check early food balance with the bot (morale ×1.4 → ×1.2 in the first hour).
2. **S2: Quarters upgrade worth it.**
   - `src/data/buildings.json` → `quarters.effects.maxPopulation.perLevel` 2 → **3**.
   - Optionally give quarters an upgrade factor of 1.0 instead of 1.5 (`BuildingSystem.ts:71`).
   - Hint "dig deeper for more homes" when B1 is full.
3. **S3: Power matters.**
   - `src/systems/ResourceSystem.ts:31`: `powerDemand += def.powerConsumption × (1 + 0.5 × (level − 1))`.
   - `generator.production.power.base` 6 → **4**.
   - Expected: generators and reactors are needed as rooms level up; blackouts become meaningful.
4. **S4: Research depth and the offline queue.**
   - Add a "Refinement" repeatable node per resource (+5% per level, cost ×1.6 per level) as an endless knowledge sink (`src/data/research.ts`).
   - Allow a 2-slot queue (`src/systems/ResearchSystem.ts:97-113`), so offline time isn't wasted.
5. **S5: Expeditions as the offline payload.**
   - `src/systems/ExplorationSystem.ts:80`: `t = 120 + 240×distance + 120×danger` (about 8 min nearby, about 38 min far). Add a "long expedition" option at ×6 time with ×4 loot.
   - Scale loot with distance, `×(1 + 0.35×distance)` in `complete()` (line 230).
   - Expose 2 teams from the start and +1 per prestige upgrade.
   - `src/data/surface.ts:66`: `MAP_RADIUS` 7 → **9** (270 hexes), or reveal outer rings only after the Vehicles research.
   - `ANSWER_TIMEOUT` 180 s (`ExplorationSystem.ts:16`) is fine.
6. **S6: Offline that feels like something happened.**
   - In `GameEngine.simulate()` (lines 219-242), advance a separate "away clock" and allow up to `min(free beds, 3)` newcomers at `arrivalGap × 2`. Show them as "N people are waiting at the door" on the welcome screen; accepting them is the first action of the session.
   - Report "wasted: X materials (storage full)" to point at Storage.
   - Implement local notifications (Capacitor LocalNotifications) for: expedition home, research done, storage full, someone at the door. At most 3 per day, as in the plan.
7. **S7: Events with real stakes.**
   - `src/systems/EventSystem.ts`:
     - Stash and trader amounts scale with caps (for example 10 to 20% of the materials cap; the trader also offers **scrap** and **blueprints**).
     - A lost raid (lines 266-271) injures 1 to 2 people (−35 HP) and **starts a `breach` incident**, and steals 25% of **scrap**.
     - Tribute is paid in food plus scrap, so fight versus pay becomes a real decision.
   - `IncidentSystem` quick-fix costs scale ×(1 + era).
8. **S8: The Remnant as an era.**
   - Era 0 goal "Clear 4 ruined areas" (`src/data/eras.ts:49`) → **"Clear 6 areas including a flooded one"**.
   - Ruin `workPerSlot` ×2 for `flooded`/`collapsed` (`src/data/ruins.ts:17,27`).
   - Target 8 to 12 min of era 0 with the first three restorations still under 30 s each.
9. **S9: Late story beats.**
   - `src/data/story.ts`: add 4 to 6 chapters gated on era 3, pop 30/40/50, the first expedition to the outer ring, and "Genesis is ready" (the plan's "Big Decision" buildup).
   - Current story ends on about day 2.

### NICE

1. Bubble reward `BUBBLE_SECONDS` 30 → 120, or sometimes scrap or knowledge (`src/app.ts:64`).
2. A demolish or relocate action for rooms (string `build.demolish` already in i18n) so layout mistakes aren't permanent.
3. A daily "supply drop" or streak (FOMO pull) with a reward of 1 to 2 h of production.
4. Balance bot upgrades in `tools/balance.ts`:
   - A `&mode=casual|engaged` session plus offline model, using `engine.simulate()` between sessions as in the Appendix.
   - Read the journal: the bot never finishes objective `readNote`, so `tutorialStep` stays at 2 forever.
   - Staff started ruins, use 2 teams, and print the share of time each resource is capped and the offline gains.
   - Survivors and the map use `Math.random` and `Date.now()` before the seed is applied (`GameState.ts:343`, `ExplorationSystem.ts:49`), so `?seed=` isn't reproducible. Seed `randomSeed` and `createdAt` from the URL.

---

## Appendix: method

- **Code reading**: every system and data file listed in the brief.
- **Official bot**: `http://localhost:5173/tools/balance.html`. `hours=1&seed=3` gave era 1 at 0h01m and 16/16 population at 1 h. `hours=3&seed=7` gave era 1 at 0h43m (the P10 stall).
- **Faithful Node port of the bot** (identical `think()` and step order), bundled with the repo's own `rolldown` against the live `src/`. It was used because Vite hot-reloads kept killing in-page runs. It adds:
  - a session model: casual about 45 min/day, engaged about 2 h/day, with `engine.simulate(gap, offlineEfficiency)` between sessions exactly like a real return;
  - cap, idle-gap and offline-gain tracking;
  - runtime what-if patches (names in §4).
  - Scripts are in the session scratchpad (`sim.js`, `head.js`, `patch.js`, `scen.js`, `era0.js`); they are not part of the repo.
- **Limits**:
  - The bot is greedy and never reads the journal. It caps quarters at 6, labs and workshops at 2 and halls at 1, uses one expedition team, and always fights raids.
  - Humans are slower in the first hour but would avoid some bot-specific stalls (unstaffed ruins).
  - Initial survivors and the map are unseeded, so every run differs; ranges above span 2 to 30 seeds.
  - Real players see the cinematic intro and dialogs, which the simulation skips (the engine pauses during them).
