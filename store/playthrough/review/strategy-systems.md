# Strategy, decisions & system depth: "a pile of overlapping systems?"

Reviewer: strategy/system-depth pass, 2026-10-15, `main` @ efb8798. Read-only (code + sims). Builds on, and does not repeat,
`store/ux-review/02-strategy.md` (S1-S14) and `05-midlate.md`; where WP2 already fixed a finding (Act currency through the crew
and modifier stack, morale above 100 worth half, law "in your bunker" numbers) it is marked as fixed.

## 0. Verdict in five lines
1. **The game has ~30 player-facing systems and 17 currencies** (food, water, power, materials, medicine, knowledge, scrap, isotope7,
   blueprints, vaultCoins, components, alloys, data, influence, seedCores, credits + blueprint fragments + rush charges). A strong idle
   game has 4-6 systems and 3-5 currencies that all feed one bottleneck. "Cluttered" is not a UI problem first; it is a content-design one.
2. **Most decisions have an obvious answer or no consequence.** Of the ~25 recurring choices, I rate 6 as real trade-offs, 10 weak,
   9 fake. 05-midlate measured it: in Act IV only **2.3% of player actions are decisions**; the rest are chores.
3. **Engagement barely changes the outcome.** Same sim build (Oct 3): `neglect` bot ends 14 days at pop 121, era 3, Genesis day 13;
   `engaged` bot at pop 102, era 3, Genesis day 13 (`store/sim/C-neglect-v3.txt`, `C-engaged-v3.txt`). Playing more well is not rewarded.
4. **Deaths are rare and come from absence, not choices**: engaged 0-1 deaths in 14 days, casual 0/5 seeds (`after-casual.txt`), today's
   1-day engaged run 0 deaths, idle 55% (`store/playthrough/d1.txt`). Danger is a tax you read about in the welcome-back report.
5. **The doctrine forks are the best idea in the game and are hidden as research nodes.** The bot picks them by `(seed + fork) % 3`
   (`tools/sim/core.ts:621-625`) and every path lands on the same pacing: the choice changes the ending label, not the play.

## 1. System inventory

Legend: trade-off Y = two options each better in some real situation; weak = one option usually wins or the cost is invisible;
N = one right answer, or nothing scarce is at stake. Unlocks from `src/data/acts.ts`, `src/ui/controllers/systems.ts`, sims.

| # | System | Unlock | Decision asked | Trade-off? | Overlaps with | Verdict |
|---|---|---|---|---|---|---|
| 1 | Ruins / restoration | Act I, min 0 | which ruin first; who clears | weak (all get cleared in 10-35 min) | build | keep (tutorial) |
| 2 | Build / place rooms | min 1 | what, where | Y in Act I-II, N later (S1 surplus); "best spot" auto-ranks | specializations, districts | deepen (adjacency on Act currency) |
| 3 | Upgrades (Mk1-10) | min 5 | which room next | weak (cheapest/goal room); one-by-one taps | Act "levels" goals | deepen: batch, show "+X/s" |
| 4 | Dig floors / wings / 2nd dig | min ~15; wings Act II; parallel dig research | dig vs upgrade with materials | Y in Act II (materials tight), N after | Act "dig" goals, strata | keep, merge wings into dig card |
| 5 | Districts (cave/lake/metro/geo/oldVault) | story ch.5, ~1 h | which cavern on this floor | weak (one per floor, all eventually) | build, strata | keep as "landmark rooms" |
| 6 | City Below strata / pockets (`src/world`, `data/strata.ts`) | always (render) | none (cosmetic finds write `state.city.found`) | N | lore, achievements | keep as presentation; do not add rules |
| 7 | Research tree (≈123 node ids over 5 files, tiers 1-8) | ~min 10 | next node | N for 90% of nodes (linear prerequisites), Eureka is a free discount | Act goals ("N researches") | cut ~40% of filler nodes; keep forks |
| 8 | Doctrine forks (7 forks x 3) | Act II (power, food) to Act VII (crossing) | pick 1 of 3, permanent | weak: food/power forks act on a surplus; industry fork % now applies (WP2 S3); bot outcomes converge | laws, endings, project designs | **deepen + elevate** (see C1) |
| 9 | Laws (6, slots 1/1/2/3/3 from Act III) | Act III | which 1-3 laws | weak: one-time knowledge cost, free repeal, Double Shifts best (02-S4; morale fix helps) | doctrines, Foreman | merge into "Policies" with doctrines |
| 10 | Charter projects + design A/B | every Act (14 projects) | A or B design; deposit | weak/N: several pairs dominated (02-S2) | Act goals, Foreman `deposit` | keep, rewrite dominated pairs |
| 11 | Specializations (75 ids, 2 per room) + retool | room Mk5 | which role per room | N: bot picks the same role in 100% of rooms of a type | doctrines, room types | cut to the role that matters (Act currency) or 1 choice per room *type* |
| 12 | Population: door knocks, accept/refuse | min 1 | accept / refuse | N after Act I (food in surplus) | open-doors law | keep, make it cost (beds/food) |
| 13 | Worker assignment / stats / mastery / training | min 1 / training room | who works where; train | N mid-game: 64% idle in Act VII, all rank 5 (02-S7); 1,396 trainings per run (05) | Foreman `staff`/`train` | hide behind Foreman; keep stats for Act currency rooms |
| 14 | Morale | always | indirect (laws, canteens) | weak (WP2 now counts >100 at half) | laws, families | keep as one gauge |
| 15 | Families / births | ~h 2+ | none (automatic) | N | population | keep as flavour, no UI weight |
| 16 | Expeditions / hex map / events | min ~14 | where, who, risky option | weak: loot ×1.6 on goods in surplus (02-S2) | outposts, caravans | merge with outposts as "Surface" |
| 17 | Outposts | Act III | where | N: same Act-currency yield on every hex (02-S8) | expeditions, Act V goal | deepen (yield by biome/distance) |
| 18 | Trade / caravans / partner relations | partners open via story | which deal | N: give surplus, get basics (02-S2) | contracts, endings | merge with contracts |
| 19 | Contracts (Inbox) | Act II + 2.5 days | accept / decline | N: pays ~3x, Foreman auto-takes them | trade, daily orders | merge with trade into "Requests from outside" |
| 20 | Decision Inbox | Act II | holds only `contract` and `ending` cards (`InboxSystem` kinds registered in ContractSystem.ts:63, ActSystem.ts:30) | n/a | dialog queue, events | merge: one queue for every non-urgent choice, or remove the HUD button |
| 21 | Random events (trader, stash, wanderer...) | min ~3 | 2-3 options | N after hour 1 (stakes don't scale, 02-P16) | contracts, inbox | keep 6-8 best, scale to Act currency |
| 22 | Threat meter + raids (stance hold/sally/hide, tribute) | Act I-II | stance or pay | **Y only in Act II**; `raidOdds` returns 0 or 1 (`EventSystem.ts:579-584`), hide is dominated by tribute; most raids happen while away | seasons, laws, doctrines, doors | **deepen** (C3) |
| 23 | Incidents / disasters (fire, flood, collapse, meltdown, epidemic) | min ~15 | pay quick-fix or let crew handle | weak: cost scales with era (stops at 3), always "pay" (02-S9) | maintenance, doors | keep, price in Act currency |
| 24 | Maintenance / wear | room Mk3 | tap Maintain | N: Foreman `maintain` on by default (`longGame.ts:152`) | incidents | hide entirely under Foreman |
| 25 | Infra: bulkhead doors, stairwells, vents | research | where to place; seal on alarm | weak but spatial (fire/epidemic/raid defense) | incidents, raids, Foreman `sealOnAlarm` | keep, it is the only spatial puzzle |
| 26 | Foreman (standing orders) | Act II | which orders on | N: they are chores, all on is right | daily, maintenance, contracts | **deepen into the policy layer** (C5) |
| 27 | Seasons | Act II + 2.5 d | none (passive ±15-25% on surplus) | N | mutators, events | merge into threat/raid calendar or cut |
| 28 | Daily orders (22, 3/day) + streak + silver/chest + swap | after 30 min | which to swap; credits vs fragment | N (pure chores) | objectives, weekly, achievements, supply crate | merge (C6) |
| 29 | Weekly challenge (12) | week 1 | none | N | daily, achievements | merge |
| 30 | Endless objectives (`ObjectiveSystem`) | min 0 | none (tap goal) | N | Act goals, guide, daily | merge into Act goals |
| 31 | Achievements (28) | min 0 | none | N | all of the above | keep, silent |
| 32 | Supply crate / rush charges / credits shop (7 items, daily caps) | day 1 | where to spend rush; buy | weak (rush: Y, small); shop: buy-all chore (02-S11) | daily, Genesis shop | merge rush + shop into one "favours" currency |
| 33 | Act charter & goals (7 Acts) | always | none (it is the spine) | n/a | objectives, era, Guide | keep as the ONE goal list |
| 34 | Eras (visual) | always | none | n/a | Acts | keep internal only |
| 35 | Genesis / rebirth + isotope shop (17 upgrades) | end of Act VII (~day 50-80) | which upgrades | weak: full shop gives Act currency +0%, dig +0% (05) | keystones | deepen |
| 36 | Keystones (2 groups x 3) | prestige shop | pick 1 of 3 forever | Y (Bastion vs Artisan vs Settler shape the run) | doctrines | keep, show earlier as the run's "class" |
| 37 | Scenarios / mutators (4 each) | Genesis | opt-in difficulty for +legacy | N: "free money" (02-S2) | seasons, difficulty | keep 1-2 with real bite |
| 38 | Endings (4) | Act VII | none directly: scored from doctrines/laws/relations | Y in principle, invisible in practice | doctrines, laws, trade | **elevate** (C1) |
| 39 | Story chapters / lore / chronicle / Bunker Book | always | rare choices | n/a | events | keep |

Count: real trade-offs (Y) = doctrines-in-principle, raids (Act II), keystones, dig-vs-upgrade (Act II), build (early), endings.
Everything else is either a chore, a reward drip, or a % on a resource that is already overflowing.

### Duplicate clusters (the clutter)
- **Goal/reward drip x6**: Act goals, endless objectives, daily orders, weekly challenge, achievements, supply crate. Six lists of
  "do X, get Y", most of them asking for things the player already does. Each has its own UI, badge and claim tap.
- **Run-identity choices x5**: doctrines, laws, project designs, specializations, keystones. All are "pick one of N modifiers";
  none show the others side by side; endings read three of them silently.
- **Outside world x5**: expeditions, outposts, caravans/trade, contracts, partner relations. Five flows, two panels plus the Inbox,
  all converting people/time into resources that are mostly in surplus.
- **Spend-the-surplus sinks x4**: credits shop, rush, training, maintenance. None asks "this or that".
- **Passive world modifiers x3**: seasons, mutators, scenarios. ±% that nobody plays around.
- **Hazards x4**: raids, incidents, maintenance wear, epidemic. Good variety, but cost is flat and the Foreman/crew solve most.

## 2. What the game should be ABOUT: 4 core loops

| Loop | The question the player answers | Systems that serve it (keep) | Systems that only decorate it |
|---|---|---|---|
| **A. Dig deeper (space & economy)** | "Where does this hour of materials go: down, wide, or up a level?" | build, upgrades, dig/wings, districts, Act currency rooms, charter | specializations, adjacency %, strata visuals |
| **B. Keep them alive (people & danger)** | "How exposed do I let the bunker get?" (wealth/radio/people raise threat: `ThreatSystem.ts:21-37`) | threat meter, raids + stance, incidents, doors, morale, deaths | seasons, maintenance, families, training |
| **C. Reach outside (risk for reward)** | "Who do I send out, and where, knowing they may not come back?" | expeditions, outposts | contracts, caravans, partner relations, events |
| **D. Decide who you are (identity -> ending -> next run)** | "Fortress, Commonwealth, Garden or Ark?" | doctrine forks, laws, endings, keystones, Genesis | project designs, mutators, scenarios |

The daily/weekly/achievement/shop layer is a **retention wrapper**, not a loop; it should be one panel and never compete with A-D.

The three loops are already wired to one beautiful dial the player never sees: **the threat meter rises with full stores, the radio,
population and Act** (`threatTarget`). That is the game's best strategic tension (grow = get noticed) and it is invisible. Making it
the visible centre of loop B connects A (wealth), C (outposts/expansionism +10) and D (isolationism ×0.75, diplomacy halves tribute).

## 3. Top 10 changes (fewer, deeper decisions)

| # | Problem | Change | Files | Effort | Effect |
|---|---|---|---|---|---|
| C1 | Doctrines are buried research nodes; picked in one tap; bot shows the paths converge; ending is read silently from them | **"Crossroads" screen**: each fork opens as a full-screen 3-column choice when its Act begins (not a research node). Each column: one *rule change* (not a %), "in your bunker" number, and which **ending** it pushes. Rewrite the 21 nodes so each changes how a loop plays: e.g. Fortress = raids rarer but stronger and you choose a sally each time; Diplomacy = tribute auto-paid while away, never lose people; Isolationism = threat ×0.75 but no outposts/contracts. Show the 4 endings as a live tally in Command. | `src/data/researchLong.ts`, `researchLate.ts`, `src/data/endings.ts`, `src/ui/components/ResearchPanel.ts`, `src/ui/controllers/systems.ts`, `src/systems/ResearchSystem.ts` | M | Turns 7 hidden picks into the 7 headline moments of a 2-month run; gives loop D a face |
| C2 | 5 "pick a modifier" systems (doctrines, laws, designs, specs, keystones) | **One "Policies" panel** = doctrines (permanent) + laws (swappable slots with *hourly upkeep* in influence/knowledge and a 12 h cooldown). Project A/B designs: keep only pairs that trade two scarce things; delete the rest (default A). Specializations: one choice per room *type* (applies to all rooms of that type) instead of per room, from Act III; cut the per-room retool UI. | `src/data/laws.ts`, `src/systems/morale.ts`, `src/ui/components/EraPanel.ts`, `src/data/projects.ts`, `src/data/specializations.ts`, `src/systems/BuildingSystem.ts:481-497`, `BuildingPanel.ts` | M | Removes ~75 spec picks and ~14 design picks per run; laws become a budget, not a one-off unlock |
| C3 | Raids: 0/1 odds (`EventSystem.ts:579-584`), hide dominated by tribute, most raids while away, 0-1 deaths per run | **Continuous odds** (logistic around defense/strength, show "72%"); raid strength tracks the bunker's defense (0.8-1.2x) instead of an Act formula; **hide** protects people and rooms but stops production 1 h; tribute is a % of the *Act currency*; a lost fight can kill 1-2 named people. **Away policy** set once in the Foreman ("fight if ≥ X%, else pay/hide"). Guarantee one online raid warning per ~3 sessions ("scouts in 15 min"). | `src/systems/EventSystem.ts` (raidOdds, raidTribute, hide), `src/systems/AwayDanger.ts`, `src/systems/ThreatSystem.ts`, `src/ui/controllers/danger.ts`, `src/systems/ForemanSystem.ts` | M | Loop B gets real stakes in every Act; deaths become a consequence of a choice the player made |
| C4 | The threat meter (best tension in the design) is invisible | Show **Exposure** as a HUD gauge with its 4 drivers (stores, radio, people, outposts) and the next raid ETA; let the player *spend* exposure: e.g. "hide the stores" (cap stockpile to 60% = threat −X, overflow becomes Act currency), "radio silence" (no newcomers, threat −8). | `src/systems/ThreatSystem.ts`, `src/ui/HUD.ts`, `src/ui/components/EraPanel.ts`, `src/data/tuning.ts` | S-M | Makes "grow vs get noticed" the central question; gives a reason to *not* max everything |
| C5 | Foreman only removes chores, which then removes decisions (maintenance, staffing, contracts, deposit are all "on") | Keep it as automation (fine), but **delete the systems it fully automates from the player's view**: maintenance becomes a passive wear stat with no button; training becomes automatic; staffing uses `optimalStat`. Move the 3-4 real policies into it: away-raid policy (C3), resource priority ("Act currency first"), incident auto-pay ceiling. | `src/systems/ForemanSystem.ts`, `MaintenanceSystem.ts`, `src/ui/components/BuildingPanel.ts`, `PeoplePanel.ts` | S-M | Cuts 3 UI surfaces; the Foreman becomes "where I set strategy" |
| C6 | Six goal/reward lists (Act goals, objectives, daily, weekly, achievements, supply crate) | **One "Today" card + the Act list.** Act goals remain the only *progress* list; endless objectives retire into it. Daily orders (3) + weekly + supply crate merge into one daily card with a single claim; achievements become silent toasts and a Book page. Rush + credits shop merge into one sink ("Favours"), no daily caps, rising price. | `src/systems/ObjectiveSystem.ts`, `DailySystem.ts`, `SupplySystem.ts`, `ShopSystem.ts`, `src/data/challenges.ts`, `src/data/shop.ts`, `src/ui/controllers/daily.ts`, `src/ui/HUD.ts` | M | Removes 3-4 HUD badges and ~5 claim taps/day; the player always knows "the goal" = the Act |
| C7 | Outside world is 5 flows (expeditions, outposts, trade, contracts, relations) + an Inbox that only carries contracts | **One Surface screen, two verbs: Send (expedition/caravan) and Hold (outpost).** Contracts become partner *requests* shown on the partner's map marker (no Inbox). Outpost yield by biome and distance, with "pays back in Y h" on the claim card. Remove the Inbox HUD button; keep the ending choice as a ceremony dialog. | `src/systems/ContractSystem.ts`, `OutpostSystem.ts:108-121`, `ExplorationSystem.ts`, `src/data/trade.ts`, `src/ui/components/SurfacePanel.ts`, `TradePanel.ts`, `src/systems/InboxSystem.ts`, `src/ui/controllers/inbox.ts` | M-L | One mental model for loop C; one fewer HUD icon; outposts become a placement decision |
| C8 | Base resources overflow ×9-40 from Act III, so seasons, food/power doctrines, half the laws/specs/events are noise (02-S1, still open: `multiplierCeiling` and per-head use unchanged) | **Surplus feeds the Act:** big base-resource inputs on the Act-currency rooms (`chains.ts`, role `inputs`), so "one more farm" = "more influence". Then cut seasons to 2 (Harvest/Winter) as raid-calendar flavour, or remove. | `src/data/chains.ts`, `src/data/specializations.ts` (role inputs), `src/data/tuning.ts`, `src/data/seasons.ts` | M | Revives ~60% of existing choices without adding a system; every room matters to the bottleneck |
| C9 | ~123 research ids, mostly linear filler; Eureka is a free discount; Act goals ask "N researches" so filler is mandatory | Trim research to ~60 nodes: forks (21) + room/feature unlocks; fold % nodes into room upgrades. Replace "complete N researches" Act goals with specific unlocks. Eureka stays as a shown hint ("explore 50 hexes: −40%"), which is a nice nudge. | `src/data/research*.ts`, `src/data/acts.ts` (goals), `src/ui/components/ResearchPanel.ts` | M | Research panel becomes readable; each node is a decision or an unlock |
| C10 | Genesis gives +0% to the bottleneck (05); mutators are free legacy; keystones are good but late | Make keystones the **first** Genesis purchase and show them at the start of run 2 as a "class" pick; isotope upgrades act on Act currency and dig/upgrade time; mutators each remove a crutch (e.g. "no tribute", "outposts lost on a lost raid") for their legacy. | `src/data/prestige.ts`, `src/systems/MetaSystem.ts`, `src/data/mutators.ts`, `src/data/scenarios.ts` | S-M | Run 2 plays differently from run 1, which is the point of a 2-month prestige loop |

### Hide-until-later (no code removed, only gated)
Reorder the Act II flood (Inbox, Foreman, contracts, seasons, two doctrines) so that **Act II opens exactly one new system per
real day**: Foreman (day 1 of Act II) -> power crossroads (day 2) -> raids get a stance (day 3) -> food crossroads (day 4).
Contracts/caravans wait for Act III with outposts (they are the same loop). Seasons: Act IV or never.
`ACT2_LATE_SYSTEMS_AFTER` (`acts.ts`) already does part of this; extend it to a schedule list.

## 4. Sim evidence, condensed
| Source | What it shows |
|---|---|
| `store/sim/C-engaged-v3.txt` vs `C-neglect-v3.txt` (14 d, 3 seeds, Oct 3 build) | neglect pop 121 vs engaged 102; both era 3, Genesis ~day 13; engaged idle 81% online, last progress 190 h before the end. Effort is not rewarded. |
| same | deaths: engaged median 1 [0-5], neglect 4 [3-5]. Deaths come from *absence* (AwayDanger), not from decisions. |
| `store/sim/after-casual.txt` (14 d, 5 seeds) | 0 deaths in 5/5 seeds; idle share 89%. |
| `store/playthrough/d1.txt` (today's build, 1 d engaged) | 0 deaths, idle 55%, 4 gaps ≥ 5 min, materials never at cap (Act I-II still tight: good). |
| `tools/sim/core.ts:621-625, 1046` | bot chooses doctrines and laws by seed rotation, with no evaluation, and still meets the pacing guard rails: no fork or law is load-bearing. |
| `tools/sim/core.ts:465-484` | bot raid policy = "sally if it wins, else pay": a deterministic rule solves the danger system. |
| 02-strategy S5 table | raids: coin-flip only in Act II; always won Acts III-VI; always lost Act VII. |
| 05-midlate | Act IV: 2.3% of actions are decisions, ~70% of online time no action possible; full Genesis shop +0% to Act currency. |

Caveat: the 14-day sims predate WP2 (morale soft cap, Act currency through crew/modifiers). Rerun `engaged`/`neglect` 14 d x 3 seeds on
current `main` before acting on finding 3 of §0; the structural findings (0/1 raids, Inbox kinds, duplicate clusters) are from current code.

## 5. Design rules to apply to every remaining choice
1. A choice trades **two things that are short right now** (Act currency, people, defense, time), never "X vs X-minus-plus-food".
2. Show the result **in this bunker** before the tap (the law card already does this since WP2; extend to doctrines, designs, outposts).
3. A system that a default setting fully automates is not a system; hide it.
4. One list of goals (the Act). Everything else is a reward, not a goal.
5. Every danger must be preventable by a decision the player could have made (exposure, policy, doors), and must sometimes cost a person.
