# VFX, world animation, camera & juice — audit

Scope: incident FX, ambient particles, post FX, construction/dig/upgrade/collection feedback, era change, day/night, machines, elevator, camera. Sources: code review, plus a live run at 430×932 on `?slot=gfx&gfx2`. I started fire, flood, blackout and breach on that save, then cleared them.

## 1. What exists

| Area | Where | What it does |
|---|---|---|
| Crisis FX | `src/rendering/incidentFx.ts:226-339` | Fire: additive mote "flames", sparse smoke, embers, an orange room wash (`g.rect` alpha 0.12). Flood: a flat blue `rect` with a sine stroke and drips. Blackout: a black rect over the whole floor, sparks and an arc. Roaches: vector bugs. Breach: a red wash and two **vector stick-figure raiders** (`:325-335`). |
| Ambient particles | `src/rendering/atmosphere.ts:79-349` | Pooled, budget 120, culled to the view. Drips that swell and splash, steam valves, junction-box sparks with a flash, dust in lamp cones. Turned down by era. |
| Room "life" | `src/rendering/paintedRoom.ts:69-196`, `src/art/registry.ts:61-92` | Lamp glow and cone with flicker, blink/screen/pulse glows, small emitters, dust motes. |
| Post | `src/rendering/postfx.ts` | Quarter-res bloom (threshold matrix + blur, every other frame), DOM film grain, adaptive quality. |
| Elevator | `src/rendering/shaft.ts:440-505` | Door cycle, eased travel, turning sheave, counterweight, cable sway, indicator lamps. The best-animated object in the game. |
| Build/upgrade | `roomArt.ts:539-610`, `BunkerRenderer.ts:686-700, 1060-1070, 1269-1279` | Blueprint ghost and scaffold with welding sparks. On completion, a 1.1 s crossfade and a 26-mote dust burst. |
| Era | `BunkerRenderer.ts:1137-1178`, `app.ts:860-869` | Colour-grade lerp, `shake(5,1.2)` and a DOM banner. |
| Camera | `BunkerRenderer.ts:410-495, 1044-1047, 1300-1306` | 1:1 drag, wheel/pinch zoom lerp, clamp, random-offset shake. |
| Popups | `src/ui/components/NumberPopup.ts`, `app.ts:1092-1105`, `app.ts:1030` + `styles/story.css:244-256` | Pop-in "+N" text and a CSS fly-to-HUD arc with a counter pulse. |

## 2. Strengths
- The elevator has real mechanical cause and effect: sheave rotation follows car velocity, and cable sway follows acceleration.
- `atmosphere.ts` works the way it should. Every particle has a visible source (stain, valve, junction box), there is one budget, view culling and quality tiers.
- A shared lamp-flicker bus (`roomFlicker`) already ties rooms, structure and people together. It is the right hook for crisis lighting.
- Bloom is cheap and correctly composited (`postfx.ts:448-450`).

## 3. Problems, ranked by impact

1. **The paintings never move.** Of the 45 room paintings (`public/art/rooms/*`), only 3 have authored lights or FX, and all 3 are tier 0 (`registry.ts:61-92`). The test save is era 3, so every room runs tier 1/2 art. Its only motion comes from people, a few glows and dust motes. There are no spinning fans, gauge needles, scrolling screens, pistons, bubbling tanks or conveyor belts. This is exactly the user's complaint: "pictures and puppets moving their arms".
2. **Crisis FX are thin, flat and partly vector.** In the live run:
   - The fire was a cluster of additive dots. There was no flame shape, no smoke volume, no heat haze, and no scorch left behind. Its light stays inside the room and does not reach people or neighbouring rooms.
   - The flood is a flat `rect` fill at alpha 0.55 with a hard edge (`incidentFx.ts:251`). That breaks the art bible's "no flat fill > 8×8" rule, and it has no refraction, caustics or darkening of what is under water.
   - The breach raiders are code-drawn rectangles with red visor bars, sitting next to painted people. They are the lowest-fidelity element on screen.
   - The blackout lays a black rect over the floor (`:270`) instead of turning off the lamps.
3. **UI hides the FX.** The alarm badge (halo 70 px) sits at room centre, `y+30`, over the fire. Production popups ("+6.5") keep spawning over burning or flooded rooms (`app.ts:1092`). In the shots, the fire reads as badge + popup + glow.
4. **The camera has no physics.** Pan stops dead on release, with no inertia or rubber-band at the edges (`:433`). Pinch zooms around the screen centre, not the fingers (`:462-465`). `focusOn` and `focusFloor` jump instantly (`:1300`, `:506`). The zoom lerp `*0.18` runs per frame, so its speed depends on frame rate. Shake is white noise each frame (`:487-490`), with no direction and no smooth falloff curve. Top mobile games all have momentum and focal-point pinch; without them the game feels cheap within seconds.
5. **Big moments have no choreography.**
   - Digging a floor is a sound plus `shake(3,2.2)`, and the floor pops in (`app.ts:361`). There is no drill, falling debris, dust from the ceilings, or lights switching on.
   - A finished build is a mote burst plus a "✓" popup.
   - An era change is a colour lerp behind a DOM banner. The world itself never transforms on screen.
   - Night only affects the surface and sends people to bed. Bunker lighting has no night cycle (no dimmed corridors or night-mode lamps).
6. **Timing bugs.** `NumberPopup` advances `life++` per frame (`:43`), so it runs twice as fast at 120 Hz. Particles spawn at full size with no anticipation.
7. **Performance hygiene.** `incidentFx`, `burstAt`, `floatIcons` and the room emitters allocate a new `Sprite` per particle and destroy it afterwards (`incidentFx.ts:171`, `paintedRoom.ts:83`), which causes GC churn. `Dust` re-tessellates hundreds of circles every frame, and the count grows with floor count. Each popup builds a new `Text`, which means a texture upload.

## 4. Improvements

| # | Technique (Pixi v8) | Effort | Impact | Perf on mobile | Deps |
|---|---|---|---|---|---|
| A | **Machine inserts for all 45 paintings.** Small animated sprites at authored spots: rotating fan/rotor blades, gauge needles (spring wobble), CRT screens as 4–8 frame flipbooks or scrolling `TilingSprite`, piston bob, tank bubbles, conveyor scroll, grow-light breathing. Extend `FxSpot` with `fan/needle/screen/scroll/piston`. | L (data M + art) | 5 | Low: a handful of sprites per visible room | registry spots per painting; small cut-out art via the kit pipeline |
| B | **Fire rebuilt in layers.** Flipbook flame sprites (8×8 sheet) on 2–3 seats. Dark `puffTexture` smoke that pools and spills from the door. Stretched ember streaks (reuse the atmosphere spark code). A **heat-haze `DisplacementFilter`** with a scrolling noise texture, limited to the room via `filterArea`. Room flicker goes into `roomFlicker` so lamps, people and structure pulse orange. A char/scorch decal stays after the fire. | M | 5 | One small filter pass + ~60 particles | flipbook sheet (generated or CC0) |
| C | **Water shader.** A custom `Filter` (or Mesh) on the flood region: wavy surface line with a specular highlight, refraction displacement of what is under water, darken and tint by depth, additive caustics `TilingSprite`, splash rings where drips land. Reuse it for flooded ruins (`ruinArt.ts:113`). | M | 4 | One region pass | none |
| D | **Shared FX core.** One pooled emitter on v8 `ParticleContainer` + `Particle` (dynamic position/color/scale), dt-based curves (size/alpha/color over life), sub-emitters (spark → smoke). Move incidents, bursts, room emitters and Dust onto it. Note that `@pixi/particle-emitter` targets v7, so a ~200-line custom emitter is safer. | M | 3 (enabler) | Big saving: one draw call, no GC | none |
| E | **Camera feel.** Track pointer velocity over the last ~80 ms and coast with exponential friction on release. Rubber-band at the bounds. Pinch and wheel anchored at the focal point. Critically damped springs for camX/camY/zoom, so `focusOn` glides. Trauma-based shake (`trauma²` × smooth noise, directional kick). Zoom punch (+3% for 120 ms) on build complete, collect and crisis start. Double-tap a room to frame it. | S–M | 5 | Free | none |
| F | **Crisis lighting through the light bus.** Blackout: drive `roomFlicker` towards 0.05 so the painted lamps and people actually go dark, then stutter back on when fixed. Breach: a rotating red beacon cone instead of the full-room wash. | S | 4 | Free | existing `roomFlicker` |
| G | **Painted raiders.** Reuse the `people.ts` painted rig with a raider outfit and remove the vector figures. | S–M | 4 | Same as people | people agent |
| H | **Choreographed beats.** Dig: camera glides to the bottom, drill shake, rocks and dust flipbook, falling grit from the ceiling on every floor, then the new floor reveals with its lamps clicking on in sequence. Build done: scaffold drops away, lamp flicks on, zoom punch, then the crossfade. Era: a "lights-on" wave sweeping down the floors before the grade lerp. | M–L | 4 | Brief bursts only | D, E |
| I | **Juice for popups and collection.** dt-based timing, pooled `BitmapText`. Merge per-room popups and hide them during incidents. Coins/drops arc to the HUD as particles. Move the alarm badge to the ceiling line so the FX stays visible. | S | 3 | Saves texture uploads | none |
| J | **Bunker night cycle.** Corridors dim, room lamps warm or go to a night setting, monitors become the dominant light, and occasional torch-carrying walkers appear. Night drives a grade target. | S–M | 3 | Free | lighting agent |
| K | **2.5D lighting.** Normal and depth maps for the room paintings (generated with a depth-estimation model, then normals from depth) and a light filter where lamp and fire positions rake across surfaces as they flicker. Add 2–3-layer parallax per room (back wall / machines / foreground pipes) on camera pan. This is what actually reads as "3D". | XL | 5 | One full-screen pass; must be gated by quality tier | art pipeline: depth maps, layer splits |
| L | **FX flipbook library.** Generate fire, smoke, steam, splash, spark burst and dust puff as sprite sheets with a tools page (canvas/WebGL noise sim, fits `tools/kit.ts`). Alternatives: Kenney particle pack (CC0) or EmberGen exports. | M | 4 | Cheap (atlas) | kit pipeline |

## 5. Quick wins vs big moves

**Quick wins (≈1–3 days total, all S):**
- E: camera inertia, focal pinch, spring `focusOn`, trauma shake
- F: blackout and breach through `roomFlicker`
- I: popups dt-based, hidden during incidents; badge moved up
- Fire: dark `puffTexture` smoke, ember streaks, scorch decal, orange into `roomFlicker`
- Replace `Dust` Graphics with pooled sprites
- Fix the frame-rate-dependent lerps

**Big moves, in order:**
1. A: machine inserts across all paintings. This most directly answers "just pictures".
2. D + L: FX core and flipbook library, the base for B and C.
3. B and C: fire and water done properly, with haze and refraction.
4. H: choreographed beats.
5. K: normal-map lighting + parallax. The true "3D" step; the largest effort, so prototype it on one room first and measure on a mid-range Android.

Perf guardrails: one `ParticleContainer` with a budget of about 250 on high and half on medium. Filters only on on-screen incident rooms, using `filterArea`. Keep flipbooks in one atlas. Disable haze, caustics and 2.5D lighting on `low`.
