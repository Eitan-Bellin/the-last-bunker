# Review: Economy, resources and progression pacing

The Last Bunker, code at `main` (efb8798, sim fingerprint `#9225e6296b4a`). This is a read-only review written 2026-10-15.

**Evidence used:** live bot runs `store/playthrough/d1.*` and `d4.*` (engaged, seed 1), with saves `saves/d1-seed1.json` and `d4-seed1.json`. Older runs: `store/sim/saves-v6/e30|e55` (Oct 8, Acts IV/VII), `store/qa/02-economy.md` + `assets/02/*` (casual 100 days), `store/sim/C-engaged-v3.txt`. The d10/35/50/70 runs had not finished when this was written.
**Units:** every rate in the code is per second (`FOOD_PER_SURVIVOR = 0.08/s`, `ResourceSystem.ts:30`).

---

## TL;DR

1. **The game has 16 currencies, and you only have to think about about 3 at a time.** Those are materials, plus the current Act's tier-2 good, plus scrap or knowledge early on. Food, water, power, medicine, credits and blueprints sit at their cap or pile up without limit after the first ~30 minutes. `vaultCoins` is never earned and never spent.
2. **The first minute is hostile by construction.** The bunker starts with 10 power and the only room draws 1/s. The tutorial asks you to restore the generator first but only asks you to *staff* it at step 7. Survivors who have no job get -10 morale. Morale drifts 1%/s toward a target of about 19, so it falls from 65 to about 45 in 60 s. This is exact arithmetic, shown in section 2.
3. **Act I is two hours of play followed by a ~34-hour wait.** All Act I goals except the charter project are done by about 2 h. Population, floors and room level all hit the Act caps (12 / 5 / Mk3). The Vault Seal then needs 42 crew-hours. Act II started at 36.5 h in d4.
4. **The Acts are counters.** Their goals are "dig N, research N, N rooms at Mk X, pop N, plus deposit into 2-3 projects". Acts V-VII add no new room level (levelCap stays 10) and Act VII adds no population room (popCap 190 = Act VI). The real novelty of each Act is a renamed currency (components, alloys, data, influence, seed cores) that plays the same role as the one before.
5. **Idle share is 55%** (d1 and d4) and ~60% on casual over 100 days, with 18 gaps of 5 minutes or more in 4 days. Story chapters have 14-17 day droughts (casual run: day 12 to 27, 46 to 62, 63 to 80).

---

## 1. Resources and currencies: when each appears and whether it matters

The defined list is in `src/data/resources.ts:29-50`. The starting stock is in `src/core/GameState.ts:671-688`.

| # | Resource | Appears | Must you think about it? | Evidence |
|---|---|---|---|---|
| 1 | materials | min 0 | **YES: the Act I-II currency** and 40% of every later price (`pricing.ts:22-28`) | only 0-7% of online time at cap (d1/d4), so it is always being spent |
| 2 | food | min 0 | Only in about the first 15 min (d1 at 15 m: 41 food, -0.15/s). After that it is **noise** | d1 end: production 7.4/s vs consumption ~1/s. Stock 156K over a 78K cap. d4: 125K over a cap of 5,250. e30: production 26x consumption |
| 3 | water | min 0 | Same as food. **Noise** | d4: 69K over a cap of 3,675. At cap 79-97% of the time |
| 4 | power | min 0 | **Painful in the first 30 min** (at 0, deficit -1.8 to -8/s). After that it is never a factor | d4: at cap 88%, production 2.5x demand. e30: 12x |
| 5 | knowledge | min ~2 (lab) | Early on, yes. From about hour 2 it overflows | d4: 7,200 over a cap of 2,400. Research tree: 44 of 123 nodes plus 52 refinement levels done by day 4 |
| 6 | scrap | min 0 | Yes in Act I (ruins, Vault Seal: 40/60/90). Weak later | d4 at cap 58% |
| 7 | medicine | Act I | Rarely: only healing (0.02/s) and the quick fix for a sickness incident | d4 at cap 76% |
| 8 | credits | Act I (from overflow) | **Noise.** The pile is huge and shop daily limits cap spending | d4: 143,860 credits. Spending all daily shop limits costs about 1.3K/day (`shop.ts:31-41`). e55: 10.7M |
| 9 | blueprints | Act I | Hardly. About 25 are needed in the whole game, the shop sells 3/day, and the bunker already holds 25 at day 4 | d4 save |
| 10 | isotope7 | Genesis | Meta currency, fine | |
| 11 | **vaultCoins** | **never** | **Dead.** Only referenced in GameState, resources.ts and an EraPanel filter | `grep vaultCoins src` |
| 12-16 | components, alloys, data, influence, seedCores | Acts III-VII (`resources.ts:39-44`) | Yes, but only one at a time: each is "this Act's materials" | `pricing.ts:15` ACT_CURRENCY |

Non-resource counters the player also tracks: rush charges, daily-order fragments and streak, weekly challenge, mastery ranks, relation levels, morale, plus the Era (0-3) next to the Act (1-7).

**Merge or hide (recommended):**
- **Remove `vaultCoins`** (dead).
- **Hide food, water and power behind one "Life support" status** (OK / low / crisis) once production exceeds consumption by 2x or more. Show the numbers only when one of them is under 30 min of stock.
- **Stop showing credits as a number.** Fold the overflow into "Supply crates" (a progress bar that fills and drops a crate), or delete overflow-to-credits entirely (see fix #4).
- **Collapse the 5 tier-2 currencies into 2.** "Parts" would cover components and alloys (Acts III-IV); "Charter" would cover data, influence and seed cores (Acts V-VII). Better still, keep one "advanced good" whose name and icon change per Act. Today `olderCurrencyShare` (`tuning.ts:28`) makes every Act VII price ask for 6 currencies (`pricing.ts:22-28`, e.g. seedLab L5 in `qa/assets/02/act-rooms-payback.txt`). That is the source of "cluttered" price tags.
- **Merge Era into Act.** `eras.ts` goals (generator, pop 10, B4, 6 research, then pop 40, 250 power, 80 hexes, 8 contracts...) duplicate Act goals (`acts.ts:58,83` literally say "reach era N"). The result is two progress bars that point at each other.

---

## 2. Pacing

### 2a. Early-game pressure: why morale goes 65→45 and power hits 0 in about a minute (exact cause)

- **Start state** (`GameState.ts:675`, `GameEngine.ts:443-444`): 3 survivors, power 10/50, a single built room, the Living Quarters. Quarters draw `powerConsumption: 1`/s (`buildings.json:29`). Power reaches 0 after ~10 s. No producer exists: the generator is a *wreck ruin* on B3 (`ruins.ts:65`).
- **Darkness penalty** (`PopulationSystem.ts:460`): `powerRatio` drops to `EMERGENCY_EFFICIENCY` 0.25 (`ResourceSystem.ts:22,158`), which gives -(round(15·0.75)+5) = **-16 morale**.
- **No-job penalty** (`PopulationSystem.ts:489`): a survivor with no job gets **-10**. At t=0 no job slot exists apart from ruins, which take max 2 workers each (`ruins.ts:106`).
- **Base mood is 45** (`PopulationSystem.ts:454`), so the idle target is 45-16-10 = **19**. Starting happiness is 60-80 (`:372`). Drift is 1% of the gap per second (`:32,165`): 65 → 19 + 46·e^-0.6 ≈ **44 after 60 s**. This matches the owner's 65→45.
- **The tutorial then deepens the hole.** Step 1 is "restore the generator" (`ObjectiveSystem.ts:61`), but "assign a worker to the generator" only comes at step 7 (`:96`). An unstaffed generator gives 6 × 0.5 baseEfficiency = 3/s. Meanwhile steps 4-6 and 10 add a pump (2/s), farm (1), canteen (1), storage (1) and laboratory (3). d1 samples: power 0 with rate -1.79/s at 5 m, -8.06/s at 15 m, -1.0/s at 30 m. Morale was 53 at 15 m. All non-farm output runs at 25-50% during the tutorial (`POWER_FLOOR` in `resources.ts:30-35`).

The pressure is not a designed challenge: the player has no lever until step 7, and nothing tells them why.

### 2b. Idle and gaps

| Run | Idle share online | Gaps ≥ 5 min | Longest gaps |
|---|---|---|---|
| d1 engaged | 55% | 4 | 8 m, 6.5 m, 5.3 m |
| d4 engaged | 55% | 18 | 11 m, 10.7 m, 9 m |
| casual 100 d (QA) | 59-62% | 186-191 | n/a |

**Act I dead zone** (d4 milestones): era 2 at 2.0 h → Vault Seal done at 28.3 h → Act II at 36.5 h. From ~2 h every Act I ceiling is hit: pop 12 (`acts.ts:56`, reached at 2.0 h), floors 5 (B5 at 0.9 h), level cap Mk3. Only the Vault Seal's 8+14+20 crew-hours remain (`projects.ts:85-87`). The bot filled the time by upgrading 27 rooms to Mk3 (levels 26→72) and making 320 hand deposits. Act II also waits up to 8 h after the seal because `act` advances online only (`GameEngine.ts:352`).

**Population walls.** popCap per Act is 12/30/65/110/150/190/190. On casual, population 30 came at day 2 and 40 at day 12: 10 days with a full roster and the door closed.

**Story droughts** (casual 100 d): no chapter from day 12 to 27, 30 to 44, 46 to 62, 63 to 80.

### 2c. Overwhelm spikes

- **First 15 minutes:** 9 buildings, expeditions, research, ruins and the story all start before minute 6 (d1 milestones: research at 59 s, expedition at 360 s, era 1 at 475 s). The guide has 17 steps.
- **Act II** (`acts.ts:75` "opens"): Inbox, Foreman, contracts, seasons, doctrines, and 2 charter projects. The [Q7] stagger (`acts.ts:153`, contracts and seasons +2.5 days) and the 120 s card gap (`ui/controllers/systems.ts:67`) help.
- **Act III** (`acts.ts:88`): components, outposts, the first law, 2 doctrine branches, 3 charter projects (greenhouse, archive, metro) and era 3, all at once. This is the largest single unlock wave.

---

## 3. Resources at cap, wasted or meaningless

- **The food/water cap is tied to production in Act I** (`ResourceSystem.ts:27,396-398`: cap = 2.5 h of *gross* production). The cap swings with power and morale (d1 food cap: 8.4K → 3.3K → 8.5K → 3.8K → 13.9K...). Stock above the cap is kept (`:208` `hold`). At Act II the rule switches off, so d4 holds **125K food against a 5,250 cap**. That number can never matter.
- **Food/water sinks barely exist.** They are: the purifier and greenhouse charter stages (`projects.ts:109,122`), the Sky Dome (`:216`), 4 research nodes (`researchLong.ts:46,61,97,119`), training at 60·rank food (`mastery.ts:41`), a few story choices of 40-120 food, and caravans at a trade value of 1/unit (`trade.ts:36`). Against production of 0.9-1.8M/h at days 30-55 (e30/e55), all of these together are rounding errors. **The day-30 save's 11K food is at cap, and the surplus is about 900K/h.** Nothing meaningful can be bought with it.
- **Credits pile up**: 4K at day 1, 144K at day 4, 6.4M at day 30, 10.7M at day 55. Since ux-wp2 the overflow decays 95% from Act III (`tuning.ts:59-60`, `ResourceSystem.ts:256`), but Acts I-II still mint it at the full rate. Only `actGoods` (Act III+, `shop.ts:40`) has no limit.
- **Refinement research is spent on surplus.** In d4, `refine_food`/`refine_water`/`refine_power` are all at level 9, adding output to resources that already run at 7-14x consumption.
- **Power:** cap 450, production 770K/h vs 313K/h. The cap is irrelevant after hour 1.
- **Knowledge, medicine, scrap:** at cap 56% / 76% / 58% of online time (d4).

---

## 4. The 7 Acts: clear, distinct, fun?

| Act | Goals (`acts.ts`) | Distinct mechanic? | Verdict |
|---|---|---|---|
| I Survive (:52) | era 2, clear ruins, 10 research, Vault Seal | Ruins + restoration (good) | Fun for 2 h, then a 34 h timer |
| II Rebuild (:65) | dig 8, 22 research, 10 rooms Mk5, Radio Mast, Purifier | Contracts / Foreman / seasons | Checklist. The purifier asks for water, which is free |
| III Settle (:78) | era 3, dig 11, 8 rooms Mk7, 3 charters | Components, outposts, laws | Overloaded (see 2c); "reach era 3" is a goal inside a goal |
| IV Expand (:91) | dig 14, 4 rooms Mk9, pop 90, 2 charters | Alloys = reskinned components | Checklist |
| V Rise (:105) | 3 outposts, dig 17, 5 rooms Mk10 | Data | Outposts is the only goal that asks for a new action |
| VI Govern (:119) | 1,500 influence, pop 150, dig 20 | Influence | "Gather 1,500" is a pure stockpile wait |
| VII Genesis (:132) | dig 24, pop 170, Seed Vault research, Ark + Genesis Core | Seed cores | Same levelCap/popCap as VI, so nothing grows |

Every Act contains "dig N" (II-VII). Five of seven ask "N rooms at level X" or "pop N". Act lengths (QA casual) are 10.6 / 15.0 / 16.9 / 18.0 / 11.5 / 8.3+ days, and each one is mostly upgrade timers (`maxUpgradeSeconds` 12 h, `tuning.ts:64`) and charter crew-hours. The Act cards name *what opens*, not *what problem the bunker faces*: there is no Act-level threat, choice or twist. The endings (`ActSystem.ts:58`) are the only branch, and they come at the very end.

---

## 5. Top 10 fixes (priority order)

**1. Fix the first minute.** Effort S.
- *Problem:* power hits 0 in 10 s, morale falls to ~45 in 60 s, and the player has no lever (§2a).
- *Change:* start with the generator restored and staffed, or start with 150 power and make "assign to generator" step 2. Give no `noJob` penalty for the first 10 min, or count "camping in the quarters" as a job. Make the darkness penalty ramp over 60 s.
- *Files:* `core/GameState.ts:675`, `systems/ObjectiveSystem.ts:61-96`, `systems/PopulationSystem.ts:460,489`.
- *Expected effect:* the first impression is "bring it back to life", not "everything is failing".

**2. Cut the Act I dead zone.** Effort S.
- *Problem:* 2 h of play, then a ~34 h wait for 42 crew-hours (§2b).
- *Change:* cut Vault Seal hours from 8/14/20 to 1/2/3. Alternatively, let Act II open at "era 2 + Seal stage 1" and finish the seal as an Act II goal. Let `act` advance offline too, or advance it on load.
- *Files:* `data/projects.ts:85-87`, `data/acts.ts:56-62`, `core/GameEngine.ts:352`.
- *Expected effect:* Act II on day 1 for an engaged player. Removes the longest early stall.

**3. Make food, water and power matter, or stop showing them.** Effort M.
- *Problem:* 7-26x surplus, 125K stock against a 5K cap (§3).
- *Change:* per-capita consumption that grows per Act (×1.5 per Act), plus `multiplierCeiling: 4` (`tuning.ts:16`, currently Infinity). Drop the Act I production-based cap and clamp held overflow back to the cap when the Act changes. Then collapse the three into a "Life support" HUD chip (§1).
- *Files:* `systems/ResourceSystem.ts:30-31,208,396-398`, `data/tuning.ts:16`, HUD.
- *Expected effect:* the basic rooms keep a reason to exist, and the HUD loses 3 meaningless numbers.

**4. Remove or replace credits from overflow.** Effort M.
- *Problem:* 144K credits by day 4 and millions later, against a shop that can spend ~1.3K/day.
- *Change:* delete `overflowCredits` for tier-1 goods. Credits come only from daily orders and contracts (as `orders.ts` intends). Alternatively, overflow fills a "supply crate" meter.
- *Files:* `data/resources.ts:30-44`, `systems/ResourceSystem.ts:212,246-256`, `data/shop.ts`.
- *Expected effect:* credits become a real choice, and there is one less runaway number.

**5. Collapse the tier-2 currency ladder.** Effort L.
- *Problem:* 5 currencies that do the same job, and late prices that list up to 6 resources (`pricing.ts:22-28`).
- *Change:* use 2 goods: "parts" for Acts III-IV and "charter" for V-VII. Alternatively, set `olderCurrencyShare` to 0 so each price lists at most 2 resources (the Act good plus materials).
- *Files:* `data/pricing.ts`, `data/resources.ts:39-44`, `data/tuning.ts:21,28`, `data/specializations.ts` (roles), `data/projects.ts`.
- *Expected effect:* price tags drop from 4-6 icons to 2, and the long game is easier to read.

**6. Give each Act one signature problem instead of a counter list.** Effort L.
- *Problem:* the goals are dig/research/levels/pop clones (§4).
- *Change:* give each Act at most 2 counters plus one *event-driven* goal tied to its theme. Examples: Act II, survive the first winter or take in the clan; Act III, choose the law that defines the colony; Act IV, hold the Wall during a siege; Act VI, win a vote (a real choice using influence, not "have 1,500"). Drop "dig N" from at least 3 Acts.
- *Files:* `data/acts.ts:51-144`, `systems/ActSystem.ts`, story / `data/incidents.ts`.
- *Expected effect:* each Act feels distinct and gives the player something to remember.

**7. Spread the Act III unlock wave and re-time the population caps.** Effort S.
- *Problem:* Act III opens 6 systems at once, and casual players sit 10 days at pop 30.
- *Change:* extend `lateActTwoSystems`-style staggering to Act III (laws +2 days, outposts +4 days). Raise Act II popCap from 30 to 40, or let door arrivals queue.
- *Files:* `data/acts.ts:68,81,153-160`, `ui/controllers/systems.ts:38-64`.
- *Expected effect:* no overwhelm spike, and no "full house, nothing to do" week.

**8. Auto-deliver charter projects.** Effort S.
- *Problem:* hand deposits that respect a reserve took 320 taps on day 1 and 1,124 over 4 days for the bot. That is clunky busywork (`ProjectSystem.ts:20-22,223-240`).
- *Change:* add a per-project "pledge" toggle that keeps feeding the stage from stock above the reserve every tick. The manual button stays for burst deliveries.
- *Files:* `systems/ProjectSystem.ts`, the project panel UI.
- *Expected effect:* removes the most repeated action in the game and makes the long Acts idle-friendly.

**9. Kill dead and noise currencies and research.** Effort S.
- *Problem:* `vaultCoins` is unused, blueprints pile up (25 by day 4, ~25 needed in the whole game), and refine_food/water/power reach level 9 for nothing.
- *Change:* remove `vaultCoins`. Cut the shop blueprint limit from 3/day to 1/week, or give blueprints a repeatable sink (room skins, an extra wing). Hide food/water/power refinements while that resource's surplus is above 3x.
- *Files:* `data/resources.ts:47`, `core/GameState.ts:21,681`, `data/shop.ts:32`, `data/research*.ts` (refine_*).
- *Expected effect:* fewer currencies on screen, and research picks that matter.

**10. Fill the long-Act story droughts.** Effort M.
- *Problem:* gaps of 14-17 days without a chapter in Acts III-VI (casual run), on top of 55-60% idle online time.
- *Change:* add one mid-Act chapter or decision per Act, triggered at about 50% of Act goal progress. Pair it with the signature problem from #6.
- *Files:* `data/story.ts`, `systems/StorySystem.ts`, `data/acts.ts`.
- *Expected effect:* something to come back for every 3-5 days. Should push idle share down toward 40%.

---

### Notes and confidence

- The power and morale arithmetic and the Act I timeline come from the d1/d4 runs of today's code. Confidence is high.
- The day 30 and 55 numbers come from Oct 8 saves (`saves-v6`). Since then ux-wp2 has changed overflow decay and the Act I caps, but those saves still show the same pattern.
- The bot finished 44 of 123 research nodes plus 52 refinement levels by day 4. A human will be slower, but the surplus ratios hold because they are structural: the multiplier stack has no ceiling (`tuning.ts:16`) and consumption is flat per head (`ResourceSystem.ts:30-31`).
