# C1 — life-systems notes: people, carried light, the dig crew, the city's sound

*Branch `world/c1-Li` (from `world-redesign` @ `dae3858`). 2026-10-15.*

Presentation only. Who works where, who digs, production and every number the simulation reads are unchanged. This branch only changes where an idle person stands for a while, that the dig crew is seen at the rock, what people carry, how they are lit, and what the city sounds like.

Shots (dev server, headless Chrome 1280x800, High, with the integration lines from section 1 and the level-builder's layout and shell plugged in locally):
- `shots/C1-Li-dig-face.png`: `slice-dig`. The two diggers at the face in hard hats, picks swinging (`dig` anim), with headlamps. The work lamp is to their left.
- `shots/C1-Li-hub-loiter.png`: e10 at the hub. A worker on a break stands on the bridge rail and looks out.
- `shots/C1-Li-lanterns.png`: e10 at the hub, after a dev poke that gives every loiterer a lantern. Two people on the east balcony carry lit lanterns, which are real pools.

## 1. What the orchestrator adds to BunkerRenderer (3 lines + 1 removed)

BunkerRenderer is the tech-artist's file, so these lines are **not** in this branch. They were tested locally: `scratchpad/li/integration.diff` is exactly this.

```ts
// imports (next to the other [world:C1] imports)
import { setLightSink } from '../world/life/lanterns'; // [world:C1-Li]

// mountCity(): REPLACE the walkers' ambientAt override line
//   (this.walkers as unknown as { ambientAt(y: number): number }).ambientAt = () => PEOPLE_RENDER.cityAmbient;
// WITH
setLightSink({ add: l => host.city.addLight(l), remove: id => host.city.removeLight(id), move: (id, x, y) => host.city.moveLight(id, x, y), lightAt: (x, y) => host.lightAt(x, y) }); // [world:C1-Li]

// renderPeople(): right after `this.walkers.update(dt, this.time, this.cam.zoom);`
this.walkers.life(state, this.people, this.views, this.cam.zoom, this.nightNow, isLiteMode() ? 'lite' : this.postfx?.quality ?? 'high'); // [world:C1-Li] loiterers, the dig crew
```

- If the city host is ever torn down, also call `setLightSink(null)`. Today there is no such path.
- **The override line.** `walkers.ts` now switches on `CITY` itself and returns `PEOPLE_RENDER.cityAmbient`. So the override is dead code, and it is harmless if it stays a while.
- **Without the `life()` line** nothing breaks. Walkers in transit are lit by the city switch, but nobody loiters, digs on screen or carries a light, and the crowd murmur stays at its floor (section 5).
- **Order.** `life()` must run after `update()`, which sets the clock, and before the placement loop. A person it takes out of a room is then left alone that same picture: `intercept` returns true.

**Also needed for the full picture:** the level-builder's layout provider (`setCityLayoutProvider({ sig: cityLayoutSig, build: buildCityLayout })`). The spots and the dig sites come from `cityLayoutProvider()`. With the stub provider there are no balconies or bench and no dig cavity, so only the plaza pair and the stub corridor show, and the crew does not go to the face.

## 2. Files

| File | What |
|---|---|
| `src/world/life/idleSpots.ts` | `IdleSpots`: the loiter places from a `CityLayout`, built once per layout signature as flat typed arrays (at most 320). The places are balcony rails and the bridge, the fire barrel ring, the bench and the plaza pair beside the spine (stratum 1 hub props), the vestibules, and up to 3 walkway places per floor strip. `pick()` is weighted, deterministic and allocation-free. `outAt` / `onBreakAt` / `cycleIndex` are the per-person schedules (an FNV hash of the id plus the clock). Pure and Node-safe. |
| `src/world/life/lanterns.ts` | The light seam: `setLightSink`, `addCarried` / `addSelfLight` / `moveLight` / `removeLight`, `carryFor` (PEOPLE lantern shares, headlamps in `PEOPLE.headlampStrata`), and caps per tier. A light generation guards against a changed sink. |
| `src/world/life/digCrew.ts` | `digSite(state, layout, slot)`: a floor dig is worked at the pit `c:dig:<n>`, in front of the rubble wall, reached down a ladder from the plaza; a wing dig is worked at the edge choke `e:<f>:<side>`. `crewPlace(k)`: the first `LIFE.dig.atFace` dig, the rest carry. It only reads `longGame.dig` / `dig2`. |
| `src/world/life/ambience.ts` | `lifeHints`: view centre, zoom, people in view and floors dug, written by the walkers. `strataWeights(cy)`: a smoothstep crossfade 90 u either side of each seam. `cityMix()`: per-stratum bed gains and the crowd level. |
| `src/rendering/walkers.ts` | The city switch for the ambient (it replaces the override), extra life slots (`MAX_WALKERS` walks + 28 life), `life()`, loiter / break / dig walks, holds (`M_LOITER`, `M_WORK`), call-backs, redirects, carried light, rim, self-light and the hints. Classic mode: 12 slots and the same code paths (`CITY` false everywhere). |
| `src/rendering/people.ts` | `stepTransit(..., act)` (diggers swing; the default `'idle'` is the old behaviour), `setTransitPose('talk' / 'look')`, `setCarry` (lantern or headlamp drawing), `setRim`, `facingDir` / `standHeight`, and `leaveLife()` on `endTransit` / `abortTransit`. City-only outfit accent (see section 4). |
| `src/rendering/people3d.ts` | `Body3D.rim()`: a white copy of the body sprites plus hair and hat, additive, behind the body, synced on frame change. It uses the same textures (no atlas memory). |
| `src/audio/cityBeds.ts` | The stratum beds (wind, hum, vent, drip, machine, rumble, water, resonance, fire, train) mixed by `AUDIO.strata[s].layers` under the stratum low-pass, plus the `cityCrowd` murmur loop. They are in the lazy synth chunk (`synth.ts` re-exports them). |
| `src/audio/AudioEngine.ts` | In `CITY` only: `updateCity()` runs from `setAmbience` (the app's audio tick). It renders a bed the first time its stratum is wanted, then crossfades. The era bed sits under at `AUDIO.eraBedShare`. |
| `src/world/tokens.ts` | The new **LIFE** block only (AUDIO untouched; its numbers are used as they are). |

## 3. Behaviour

**Idle people (city only).**
- Survivors with no job, not on a mission and standing in a quarters room walk out when their own schedule says "out". The schedule is half of a 130 s ±20% cycle, at a per-person phase.
- **Where they go.** A spot is drawn by weight from those in their stratum within 3 floors. Nearer ones weigh more: `weight / (1 + dx/170 + floors apart)`. They walk the normal routes there (lift, stairs, towers).
- **Coming back.** They return when the schedule says "in", but only after at least 20 s at the spot. They return at once when night falls (> 0.65, so they go to bed), when they get a job, when a meal sends them to the canteen (they walk there), when the cap drops (tier) or when the layout changes.
- **Holding a spot.** They idle and every third 5 s they talk (barrel, bench, plaza; set poses) or look out (rails). They face the spine or the barrel. Holding costs nothing off screen: there is no animation and no light work.

**Workers' short breaks (assumption, see section 7).** A worker steps out for 18% of their own 260 s cycle, to a spot within 1 floor. There is never more than one per room at a time, and never when fewer than 2 people stand in the room. This is only the drawing: the simulation still counts them in the room. They come back by schedule (after the minimum hold) or at once when reassigned.

**Dig crew.**
- **Who.** `p_dig` / `p_dig2` survivors walk from wherever the renderer put them (the quarters) to their slot's site, and hold `M_WORK` there.
- **At the face.** Crew 0..2 dig (`dig` anim, facing the rock, 19 u apart, 7 u off the rubble wall) with headlamps. Crew 3+ carry (`carry` anim) further back. They wear the ruin outfit: hard hat and pick.
- **Getting there.** For a floor dig: a walk to the plaza above the pit, then a ladder leg down at the pit's west end + 16, then along the pit.
- **Crew changes.** A change of crew re-places the others (a short walk). When the dig ends or someone is unassigned, they walk back up the ladder and home.
- **Never sent home** by night or meals: the dig runs on.

**Budget.**
- Life slots stay out on screen or off it. An outbound walk that nobody can see (both ends off screen), or any walk under zoom 0.42, is placed at its end at once. A return that nobody sees ends at home at once.
- Loiterers are capped per tier at 16 / 10 / 5 / 0 (H/M/L/lite). At most 3 walks are planned per pass, and passes run at 2 Hz. The transit walks between rooms keep their own `MAX_WALKERS` (12).
- Reduced motion: nobody walks; people are placed at the spot, and home again.

## 4. Light and readability (style guide 7)

- **Neutral tint.** Walkers in the city wear `PEOPLE_RENDER.cityAmbient` and the lightmap lights them (they are in `litGroup`). This is the switch in `walkers.ambientAt` that replaces the runtime override.
- **Carried light.**
  - Who carries: walkers between rooms, loiterers and diggers. The share is `PEOPLE.lanternShareUpper` (8%) above stratum 4 and `lanternShareDeep` (35%) from 4 down. In `PEOPLE.headlampStrata` (the mines) it is a headlamp. Diggers at the face always wear headlamps.
  - Each one is a real dynamic `carried` light (`lantern` / `headlamp` preset), moved every frame to the hand or the forehead, with no allocation.
  - The figure only carries a lantern drawing when the light was granted. Caps are 8 / 5 / 2 / 0.
- **Self-light.**
  - Who gets it: someone with no light of their own who stands where no walkway floor holds them up (on a stair flight between lanes, in the pit below the dug city, out at an edge site), when `lightAt` there is under 0.3.
  - The light: a faint warm pool (radius 34, intensity 0.34) that stays at least 3 s. Caps are 8 / 5 / 3 / 0.
  - On the lanes, the `walkway` readability floor (0.32) already keeps everyone above `PEOPLE.minLight`.
- **Rim.**
  - The light: an additive copy of the 3D body behind it at `PEOPLE.rim.alpha` (0.35), or `darkAlpha` (0.5) where `lightAt` < 0.3. It is offset `PEOPLE.rim.offset` toward the brighter side, which is picked by sampling `lightAt` 10 u left and right at chest height; with no gradient the offset is upward.
  - The tint is the stratum's key light colour, or the person's own lantern / headlamp colour. It is off on Low and lite, and re-sampled every 3rd frame per person.
  - **Who:** walkers, loiterers and diggers only. Room people are lit evenly by their room's readability floor. The renderer's room loop is not mine.
- **Accent.** In the city, a job outfit's shirt is pulled to HSL saturation 0.65, with lightness clamped to 0.34..0.58. Under a coat, the hat takes the accent and the coat stays white. Trousers and the coat are muted further (`muteMore`, 0.55). Greys and whites stay neutral. Classic is untouched.

## 5. City ambience (AUDIO tokens)

- **The mix.**
  - Each stratum's bed is heard at `AUDIO.strata[s].master` times its weight for the depth of the view centre. Weights crossfade over the seam galleries (±90 u) and settle over `AUDIO.crossfade` (setTargetAtTime, tc = crossfade / 3).
  - On the map (`far`) the beds duck to `AUDIO.mapDuck`, and the existing `city` bed leads as before.
  - The era bed stays under at `AUDIO.eraBedShare` (city only).
- **Crowd.** The crowd murmur is a loop of its own. Its level is the strata's `crowd` gains, times the people in view (12 or more is full, with a 0.15 floor), times `AUDIO.fogQuiet.crowd` below the dug city.
- **Rendering.**
  - Everything goes to the ambience bus, so the effects volume, the sound switch and the context suspend all apply. Nothing exists before the first gesture: there is no context before it.
  - Beds are rendered offline in the existing idle job queue (prio 7, crowd 8), only for strata the camera visits. They are 16 s stereo loops at 32 kHz (16 kHz on light devices).
- **Measured (e55, headless).**

  | Camera | Mix |
  |---|---|
  | Stratum 3 | bed 3 at 0.50, crowd 0.42 |
  | Seam 2/3 | bed 2 at 0.48, bed 3 at 0.02 |
  | Stratum 5 | bed 5 at 0.45, crowd 0 |

  The first bed arrives tens of seconds after the first tap: the initial queue (UI sounds, music lane, era bed) goes first. The era bed covers the gap.

## 6. Gates and measurements

- **Gates.** `tsc --noEmit` passes, as do every step of `check:full` (smoke, lint, glossary-lint, both migrate tests, project, city-layout, placement, infra, routes, rooms, openings, daily, foreman) and `vite build`.
  - The steps were run one by one, because `node_modules/.bin` is missing in the shared install, so `npm run` cannot find `tsc`. See section 7.
- **Classic unchanged.** `tools/compare/run.mjs` on saves-v7 `e30-seed1` + `c-seed1` at 390x844@2x (19 shots), HEAD vs this branch: mean 1.45%, max 3.25%. That is under the noise floor C1-L measured for this tool: base vs base2 was a 2.43% mean and 10.0% max. The diff images show only people, lamp glows and dust motes.
- **Bundle.**
  - The main chunk grows by 7.6 kB gz. Most of it is the layout model and stub that `walkers.ts` now reaches through `citySeams` and `cityLayout`. At C2 `main.ts` imports `cityLayout` anyway, so this cost is shared.
  - The lazy synth chunk grows from 23.3 to 27.1 kB raw.
- **People update ms.**
  - Method: production builds, headless Chrome, 1280x800 High, city mode, a hub camera at zoom 1.3, 12 s of play, three alternating runs. `renderPeople` was wrapped (it includes `walkers.update` and `walkers.life`).
  - Both builds had the level-builder shell plugged in, so they differ only in this branch plus the 3 integration lines.
  - The machine was loaded by other agents' runs, so the frame counts vary between runs.

  | Save | People | Before: renderPeople median ms (runs) | After | walkers.update mean | life() mean / max |
  |---|---|---|---|---|---|
  | e10-seed1 | 65 | 1.3 / 1.0 / 1.7 | 1.4 / 1.3 / 1.6 | 0.28-0.32 | 0.04-0.06 / 5.1 |
  | e55-seed1 | 190 | 2.7 / 3.2 / 2.8 | 2.2 / 2.6 / 2.6 | 0.27-0.37 | 0.07-0.10 / 5.4 |

  At e10 the cost is about +0.2 ms. At e55 it is no worse: the up to 16 people out of their rooms cost less standing at a spot (and nothing off screen) than they did walking about inside a room.
  - **Spikes.** The life pass peaks at ~5 ms, on the pass that rebuilds the spots after a layout change and on route planning. That is why `startsPerPass` is 3. `update` peaks at 3-7 ms when a set-pose atlas or a rim copy is first created.
- **Allocations.**
  - Per frame there are none: position, light moves, rim and self-light checks write numbers into existing objects.
  - Per pass only small, rare ones, all at most 2 Hz and only on events: the layout signature string (1 Hz), `edges.find` closures for the dig sites, a `WeakMap` entry on a refused plan, a `Map` on a redirect.

## 7. Assumptions and open items

- **Workers' breaks.** "Idle/off-duty" was read as idle people plus short visual breaks of workers, because mid-game saves have almost nobody idle (e10: 0 of 65; c-seed1: 0 of 38; e55: 60 of 190). Without breaks the hubs would be empty in most games.
  - What stays true: production and the simulation's staffing are untouched, and a room never shows empty because of it.
  - To turn it off, set `LIFE.idle.breakShare: 0`.
- **The rim colour** is the stratum's key light colour, not the colour of the nearest pool. The lighting has no "nearest pool colour" query, and `lightAt` gives only intensity. If the tech-artist adds `poolAt(x, y)` → `{ color, dx }`, `walkers.lightStep` is the one place to switch.
- **The pit ladder** is not drawn. The diggers climb at the pit's west end + 16, through the plaza deck. The level-builder could draw a ladder there (`LIFE.dig.ladderX`).
- **The wing-dig crew at an edge choke** is coded but was not seen on screen (no scenario has a wing dig running). The floor dig was checked in `slice-dig`.
- **`AUDIO.fogQuiet.resonance`** is not applied: the resonance is baked into the bed. Only the crowd is quieted below the dug city.
- **The shared `node_modules` was broken this morning** (around 06:45). `@pixi/colord`, `@oxc-project/types` and the `package.json` of `@rolldown/binding-win32-x64-msvc` were missing, so no `vite build` could run. I restored exactly those three from the registry tarballs of the locked versions (`npm pack`, additive only, nothing overwritten). `.bin` is still missing, so `npm run` scripts and `npx` cannot find the CLIs. Run them as `node node_modules/<pkg>/bin/...`.
- Not done (out of scope or not mine): a rim on room people (BunkerRenderer's loop); dots for people at map zoom (CityRenderer); people standing on the shell's stair flights while loitering (they use the lanes only).
