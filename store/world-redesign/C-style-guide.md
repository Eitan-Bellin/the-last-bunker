# C. Style guide: "The City Below"

*Art direction for the world redesign of THE LAST BUNKER. Branch `world-redesign`, 2026-10-15.*

Every number in this guide also lives in **`src/world/tokens.ts`**. The code reads the tokens, never this file. If you change one, change the other.

**Decision taken before this guide (orchestrator):** Perspective **A**. The city is a deep 2.5D side cross-section with 6 parallax depth planes. It keeps:
- the 45 painted room interiors (`public/art/rooms`) and their `meta.json` lamps;
- the pre-rendered 3D people (`people3d`);
- the PostFX chain (`postfx.ts`).

It borrows from two other prototypes:
- **from C:** the lighting language. Real light pools with falloff in deep darkness, darkness graded by depth, lit dust motes, and a faint section fill so the cut always reads.
- **from B:** warm and cool contrast, and readable cut-away edges (a rim on the cut, ambient occlusion inside it).

---

## 1. Pillars

1. **Islands of light in a black earth.** Darkness is the canvas and light is the content. Every lamp has a source you can see: a bulb, a flame, a crystal or a screen. No light comes from nowhere. At map zoom the whole city reads as warm islands in black rock.
2. **The work is never in the dark.** Atmosphere is for the world, not for the job. A room you work in always reads at 70% or more of its painted exposure. Badges, plates and people stay legible at every depth and in every era. If a new effect fails this rule, the effect loses.
3. **Warm means people, cool means the unknown.** Inhabited places glow in tungsten, amber and fire. Abandoned places, outside places and places not yet found glow cold: blue, teal, cyan. Cool light glimpsed through fog is the game's invitation to explore. Depth itself darkens and cools. People push it back warm.
4. **One hand.** Painted rooms and procedural structure share one lightmap, one outline weight, one grain, one contact-shadow rule and one palette discipline. Nobody should be able to point at the seam between "painting" and "code".
5. **Every stratum has a name you can see.** Each of the seven strata is told apart in under a second by four things: its rock, its key light colour, its one signature accent and its sound. The strata change at the service galleries, so going down always feels like arriving somewhere new.

---

## 2. The seven strata

Strata are keyed by **logical floor index**, not by world y. The seams fall on the service galleries (`GALLERY_ABOVE_FLOORS` 3, 7, 11, 15, 19), so the game's existing floor-index rules keep their meaning: zones, galleries, fire code, collapse and Acts. Act floor caps 5/8/11/… mean each Act opens a peek into the next stratum, which works as a discovery hook.

| # | Stratum | Floors | Rock | Key light | Ambient | Fog |
|---|---|---|---|---|---|---|
| 0 | Surface | -1 and the sky | ash soil `#4A3426` | low sun `#FFB070` 2600K (night: moon `#7F95C8`) | 0.85 day / 0.30 night | dust `#6A5040` 0.35 |
| 1 | Upper Shelter | 0–3 | clay `#4D3322` | tungsten `#FFD8A0` 2900K | `#40382F` × 0.34 | `#2A2622` 0.45 |
| 2 | Service Network | 4–7 | sandstone `#6C6252` | fluorescent `#C8F0E0` 5000K | `#2A332F` × 0.26 | `#1E2A26` 0.55 |
| 3 | Old Metro | 8–11 | granite `#4A4C52` | sodium `#FF9A3C` 2000K | `#1C2228` × 0.20 | `#1A2130` 0.65 |
| 4 | Mines | 12–15 | wet basalt `#322E2C` | carbide lantern `#FFCC80` 2400K | `#1A1512` × 0.13 | dust `#2A2018` 0.75 |
| 5 | Deep Caves | 16–19 | violet-black `#352C47` | bioluminescent `#4AFFC8` (cold) | `#0C1018` × 0.08 | mist `#101626` 0.85 |
| 6 | Core | 20–23 | bedrock `#1A1618` | magma `#FF3A10` 1500K | `#2A0D06` × 0.12 | heat `#2A0D06` 0.70 |

**Seams:** the last floor of a stratum blends its ambient, fog and audio toward the next one (`STRATA_SEAM`). The gallery band at the seam carries the transition art: the rock changes, and one signature prop of the next stratum shows up early.

**Side districts** (cave, lake, metro, geothermal, oldVault) keep their own painting and identity even when it belongs to another stratum. The Metro station on B4 foreshadows stratum 3. They take the **host** stratum's ambient, fog and grade (`DISTRICT_HOST_GRADE`).

### 0 · Surface
- **Feels like:** the last warm light before the descent.
- **Materials:** ash soil, scorched concrete, rebar, rusted sheet metal, sandbags, dead timber.
- **Architecture:** ruins, and one propped blast hatch. Everything leans; nothing is plumb.
- **Palette:** soil `#4A3426` / `#2C1F17`, concrete `#6E6860`, rust `#7A4A2C`, sandbag `#8A7D5E`, sky top `#2A1C18` → horizon `#D88A44`.
- **Light:** low sun `#FFB070`, sky ambient 0.85 by day. Moon `#7F95C8` and ambient 0.30 at night. A god-ray pours down the ramp by day only. The tease colour is the red hatch beacon `#FF3A2A`.
- **Signature props:** the propped hatch leaf, a sandbag wall, a radio mast with a blinking red beacon, a dead tree, a rusted car, a sagging power line, a barrel fire.
- **Sound:** wind over ash, a loose sheet of metal knocking, a rare geiger tick.

### 1 · Upper Shelter
- **Feels like:** a town square inside a civil-defence shelter that became home.
- **Materials:** board-formed concrete, enamel paint in green `#5D6B58` and cream `#8D8670`, riveted steel, brass `#B08A4A`, hazard bands `#C89A2A`, stencil numbers.
- **Architecture:** rectilinear. Chamfered beams, riveted blast doors. The 3-storey hub has balconies, stair flights and a bridge.
- **Light:** tungsten `#FFD8A0` for wall and room lamps, a brass chandelier `#FFC27A`, string lights. The warmest lit stratum, and the one people see most, so it sets the reference exposure.
- **Signature props:** the ring chandelier, balcony railings, a notice board, ration posters, benches, string lights, the old lift cage (the existing shaft survives here as the hub's spine).
- **Sound:** mains hum, crowd murmur, boots on steel grating, a far ventilation fan.

### 2 · Service Network
- **Feels like:** the lungs and veins of the city.
- **Materials:** green and cream glazed tile, galvanised steel `#7A8288`, grating, insulated pipe, cable trays, valves painted red `#8A3A2A`.
- **Architecture:** galleries and catwalks, pipe racks and tiled maintenance corridors. Everything is bolted and labelled.
- **Light:** caged fluorescent tubes `#C8F0E0` (one per corridor is failing), with sodium `#FF9A3C` at junctions. This is the one stratum where neutral-white work light dominates.
- **Signature props:** a pipe manifold with red valve wheels, steam vents, pressure gauges, a big wall fan, junction boxes.
- **Sound:** ventilation roar, pipe knocks, a buzzing ballast, steam hiss.

### 3 · Old Metro
- **Feels like:** a dead city's commute, reoccupied as a bazaar.
- **Materials:** dirty glazed tile `#BCB59C`, teal enamel trim `#2F6B5C`, cast iron `#3A3E44`, rail steel, creosote sleepers, granite.
- **Architecture:** vaulted tunnels, platforms, cast-iron columns and viaducts. The lines are long and horizontal, the only stratum that is wider than it is tall.
- **Light:** sodium platform lamps `#FF9A3C` (2000K, the most orange light in the game) and teal signal lamps `#40E0C0`. The tease is a teal glow down a tunnel.
- **Signature props:** an enamel station sign (Hebrew), a platform clock, turnstiles, a derailed car with lit windows used as a market stall, signal lamps, the viaduct. A train passes on the back plane.
- **Sound:** tunnel wind, a ghost-train rumble far away, long echo, market chatter.

### 4 · Mines
- **Feels like:** hard labour by lantern light, where the city earns its stone.
- **Materials:** raw wet rock `#322E2C`, rough timber `#6B4C2E`, iron straps, rails and ore carts, rope, canvas. Copper veins `#3FA58A` and gold flecks `#D8B04A` run through the walls.
- **Architecture:** timbered drifts, headframes and winches, ladders and chutes. Nothing is straight.
- **Light:** carbide lanterns `#FFCC80` hung on timbers, work floods `#FFF0D0` at the face. Miners wear **headlamps**, which are moving pools.
- **Signature props:** a headframe with a winch wheel, ore carts on rails, timber sets, hanging lanterns, blasting crates.
- **Sound:** picks, a distant blast and its rumble, timber creak, a winch ratchet.

### 5 · Deep Caves
- **Feels like:** a cathedral nobody built.
- **Materials:** violet-black rock `#352C47`, flowstone, crystal `#7AF2FF` and violet `#B07AFF`, still black water `#0A1822`, rope, tarp on poles.
- **Architecture:** natural caverns, stalactites and ledges. Human building here is light: rope bridges, stilt platforms, tarps.
- **Light:** the coldest stratum. Bioluminescent fungus `#4AFFC8` and crystals pulse slowly. Human camps are small warm islands, the strongest warm/cool contrast in the game.
- **Signature props:** crystal clusters, fungus beds, a rope bridge, a stilt platform, a still pool with reflections, stalactites.
- **Sound:** drips with long echoes, a low resonant tone, a far waterfall.

### 6 · Core
- **Feels like:** the warm heart of the earth, dangerous and generous.
- **Materials:** basalt, obsidian, heat-blued steel, vault brass `#C8A060`, ceramic tiles, steam.
- **Architecture:** magma fissures, heavy pre-war vault machinery, heat shields.
- **Light:** magma `#FF3A10` from **below**. This is the only stratum lit from the floor up, and it reads instantly. Ember `#FFA040` is the secondary. Heat shimmer sits over fissures (High only).
- **Signature props:** magma fissures, heat shields, geothermal pipes, the vault ring door, steam plumes.
- **Sound:** deep rumble, steam hiss, a slow machine pulse like a heartbeat.

---

## 3. Depth-layer stack

Position on screen is `screen/2 − cam·p·scale`, with `scale = zoom^p`. Far planes therefore zoom less as well as scroll less, and that is what sells depth on a pinch. **Only the play plane is hit-tested.**

| Layer | p | Fog toward stratum colour | Base tint | Lit by | Visible | Lowest tier | What lives there |
|---|---:|---:|---|---|---|---|---|
| sky | 0.15 | 0 | none | self | above ground only | Low | the surface painting (`backdrops/surface-<era>`), pinned to the horizon vertically |
| far | 0.40 | 0.72 | `#9098A8` | baked fog + its own glows | zoom ≥ 0.30 | Medium | colossal pillars, distant terraced districts as clusters of window lights, far lifts, haze bands; one painted far plate per stratum |
| back | 0.68 | 0.48 | `#B0B0B8` | baked fog + its own glows | zoom ≥ 0.30 | Low | cavern wall ribs, backlit house clusters, the metro viaduct and its moving train, the ruins skyline. On Low it also carries the far plate, merged into one cached image |
| mid | 0.88 | 0.12 | `#D8D4CC` | the lightmap | zoom ≥ 0.38 | Medium | galleries and pipes behind the hub window, shanties behind districts, crystal spires behind caves |
| play | 1.00 | 0 | none | the lightmap | always | Low | rock cut face, back walls, structure, painted rooms, stairs, bridges, survivors, signs |
| fore | 1.32 | 0 | `#060708` | silhouette + rim | zoom ≥ 0.85 | High | ragged black rock lip, outcrops, sagging cables. Never over a room's centre; at most 12% of the screen |

**Fog strength** of a layer = `layer.fog × stratum.fog.density`. Haze bands in the stratum fog colour sit between far and back (full) and between back and mid (×0.6). Far and back go into **one cached render texture**, refreshed when the camera has moved 24 px or zoom has changed 4%, with 15% overscan (`LAYER_CACHE`).

---

## 4. Lighting rules

**Pipeline.** This is prototype A's pipeline, with C's discipline added.
1. Lightmap render texture: High 0.5×, Medium 0.35×, Low 0.25× (Low redraws at most 15 times per second).
2. Clear it to the stratum ambient.
3. Add the depth ramp (sky warmth down to about y 420, then black).
4. Draw zone fills, then **room readability floors**, then the pools.
5. Multiply onto the lit play and mid planes with **multiply-keep-alpha**, so open caverns stay transparent and the far planes show through.
6. Draw the additive glow layer (cores, cones, god-ray, flames, motes) on top.
7. PostFX runs last and unchanged: bloom, era grade, night grade, vignette and grain. Drop the prototype's own vignette and grain.

**Falloff.** `I(d) = intensity · (1 − x)^2.2`, where `x = (d − 0.12r)/(0.88r)`. The flat core (12% of the radius) keeps a lamp's own floor readable. This is the single curve for every pool in the game.

**Pool presets.** Radius is in world units; for scale, a room is 100 tall and a person is 56.

| Preset | Colour | Radius | Intensity | Flicker | Cone |
|---|---|---:|---:|---|---:|
| room lamp (from `meta.json`, × 1.6) | `#FFD8A0` | 110 | 1.0 | steady | – |
| wall lamp | `#FFC27A` | 90 | 0.9 | steady | – |
| cage lamp | `#FFD8A0` | 120 | 1.0 | steady | 110 |
| fluorescent tube | `#C8F0E0` | 130 | 0.95 | steady (1 in 3 failing) | 90 |
| sodium | `#FF9A3C` | 170 | 1.05 | steady | 140 |
| street lamp | `#FFC27A` | 160 | 1.1 | steady | 150 |
| chandelier | `#FFC27A` | 320 | 1.25 | sway | 260 |
| string bulb | `#FFD090` | 36 | 0.7 | sway | – |
| fire barrel / forge | `#FF7A2A` / `#FF5A1E` | 140 / 150 | 1.3 / 1.4 | fire | – |
| lantern / headlamp | `#FFCC80` / `#FFF0D0` | 80 / 70 | 0.95 / 0.9 | fire / steady | – / 120 |
| emergency | `#FF3A2A` | 90 | 0.8 | blink | – |
| signal / crystal / bio | `#40E0C0` / `#7AF2FF` / `#4AFFC8` | 70 / 120 / 90 | 0.7–0.85 | steady / pulse | – |
| magma | `#FF3A10` | 200 | 1.2 | pulse | – |
| tease (beyond rubble) | `#6AA8FF` | 140 | 0.6 | pulse | – |

**Flicker.**

| Kind | Behaviour |
|---|---|
| fire | ±18% at 9 Hz, radius wobble 6% |
| failing tube | 0.35 drop-outs per second, 0.12 s each |
| pulse (crystal, bio, magma) | ±15% at 0.25 Hz |
| sway (chandelier, strings) | ±5% at 0.4 Hz |
| blink | on/off at 0.8 Hz |
| tv | random cuts |
| weld | 1.4 s bursts |

Medium animates only fire, failing tube, blink, weld and pulse. Low animates only blink; everything else holds its mean.

**Budget.** At most 96 / 56 / 28 pools per frame (High / Medium / Low). Room lamps get priority, then the pools nearest the view centre. Pools fade in or out over 0.4 s when they cross the budget, so nothing pops.

### How working rooms stay readable (non-negotiable)

Before any pool is drawn, each room rectangle is filled into the lightmap at a **floor value**, feathered 18 units past its edges. The room's own lamps add on top of that.

| Room state | Floor |
|---|---:|
| powered, people working | **0.70** |
| powered, empty | 0.55 |
| under construction / upgrading | 0.50 |
| unpowered (blackout) | 0.30, plus one emergency lamp |
| ruin not yet cleared | 0.22 |
| selected or placement neighbour | +0.15 |
| walkway strip in front of built rooms | 0.32 |

On top of the floors:
- Labels, badges and plates draw in a screen layer **above fog and lightmap**, with 4.5:1 contrast against what is behind them.
- Below zoom 0.42 the city map takes over, as it does today.
- The player's Brightness setting still runs through the PostFX gamma lift.

### Warm and cool
- The inhabited palette is tungsten, amber and fire.
- Work light (fluorescent, flood) is neutral white.
- The abandoned or unknown palette is blue `#6AA8FF`, teal `#40E0C0` and moon `#7F95C8`.
- Danger is red `#FF3A2A` or magma.
- In an inhabited stratum at most 25% of lamps may be cool. Exception: the Service Network's tubes count as work light.

---

## 5. Fog of war

| State | Look |
|---|---|
| **Undiscovered** | near-black `#030406` at 94%, slow mottling (scale 220 u, drift 4 u/s). No labels, no pins, no lights, except **teases**, which show at 30%. The edge breathes: a soft halo 2.5 cells wide, alpha 0.25, speed 0.6, with a faint warm rim `#BF6B2E` at 6% so the edge reads as rock lit from your side. |
| **Known, unlit** (seen, but not built or not powered) | a "memory": darkened 55%, 70% desaturated, a cool `#6A7A90` wash at 18%. Shapes and outlines read; the label shows at 55%. |
| **Lit** | no fog at all. |

**Mechanics:**
- One fog cell is 8 world units, upscaled bilinear, which gives soft organic edges for free.
- Reveal radius: 190 for a tap, 120 for a dig, 320 for a story event.
- A reveal grows over 0.9 s with out-cubic easing.
- Dark edges such as the blocked tunnel start 30% open, so you see a hint.
- Fog is saved as one bit per cell, at most 2 KB per district.

---

## 6. Unifying painted rooms and procedural structure (risk 1)

The two-styles risk is solved by sharing six things.

1. **One light.** Painted rooms go through the **same lightmap** as rock and structure, protected by the readability floors. Their baked `meta.json` lamps become real pools that also spill into the corridor at 45%. A painting is never the only lit thing on screen, so it never looks pasted on.
2. **One frame.** Every room sits in an **alcove**:
   - a 4 u concrete lip `#2A2420`;
   - inner ambient occlusion 10 u wide at 45%, stronger at the top (×1.4);
   - the existing `roomDepth` back-wall parallax.

   The room reads as a hole cut into the world, not a card laid on it.
3. **One line.** Every made edge that meets darkness gets the same **1.5 u outline** `#0A0806` at 85%. That covers painted-room frames, slabs, railings, stair stringers and props.
4. **One surface.** Procedural flat fills are never flat:
   - a vertical gradient (top ×1.08, bottom ×0.9);
   - the shared noise grain at 12% multiply (the same noise as `strata.ts`);
   - colours capped at 45% saturation and pulled 15% toward warm grey `#6A6258`, which is the painting palette.
5. **Paint first, vector second.** Slabs, columns, walls and pipes use the painted kit tiles in `public/art/kit`. Vector is allowed only for parts thinner than 6 u (railings, treads, cables), with two values plus the outline.
6. **One ground.** Everything that stands on a floor gets the same contact shadow: an ellipse 1.1× its width, 5 u tall, 40%, blur 3. That covers people, props, carts and the room plinth.

**The cut edge** comes from B. Where the section cut meets a cavity:
- a 2 u light rim in the stratum `rockRim` colour at 35%;
- a 14 u ambient-occlusion band just inside, at 42%;
- C's faint section fill `#1A1A22`, so the silhouette of the dig always reads, even in the core.

---

## 7. Survivor readability (risk 2, people half)

- **Size:** an adult is 56 u tall, a child ×0.74. The home zoom on a phone (0.62) keeps an adult at least 30 CSS px tall. Below zoom 0.42 people become warm dots `#FFD8A0` (r 2.2) on the city map.
- **Light floor:** a survivor never drops below 0.28 light. In pools darker than 0.2 they get extra self-light.
- **Rim:** an additive copy, offset 1 u toward the strongest nearby pool and tinted by it, at 35% (50% in dark places). This is off on Low.
- **Silhouette:** one saturated accent per job (65%), the rest muted. The pose and the tool do the talking.
- **Carried light:**
  - 35% of walkers in the deep strata carry a lantern, which is a real moving pool;
  - 8% do in the upper strata;
  - miners wear headlamps.

  A lit walker in the dark is the best "the city is alive" shot we have.
- **Ground:** every survivor gets a contact shadow.

---

## 8. In-world text and signs

- Hebrew is RTL. **Never set `letterSpacing` on Pixi Text that holds Hebrew**: Pixi then draws glyph by glyph and reverses the word.
- Never build words from per-glyph sprites.
- Numbers inside Hebrew go in a **separate Text object**, placed to the left.
- At most 3 words in the world; anything longer belongs in the DOM UI.
- Hide text that would be smaller than 11 CSS px, but keep its plate.
- **Plate:** dark enamel `#1C1A17` with a lighter rim `#8F8A80`, text `#EADFC6`, Rubik. Stencil text on walls uses Karantina. Plates are lit by the lightmap with a floor of 0.6.
- Each stratum has its own sign ink for wayfinding (`SIGNS.stratumInk`).
- The world is **not mirrored** by language: the entrance stays on the right and the city deepens to the left in both Hebrew and English.

---

## 9. Day and night, and eras

**Day and night**
- Only strata 0 and 1 see the sky clock:
  - the surface switches from sun (`#FFB070`, ambient 0.85) to moon (`#7F95C8`, ambient 0.30);
  - the ramp god-ray runs at 1 / 0.6 / 0 for day / dusk / night.
- Below that, night is a **civic rhythm**:
  - public lamps (street, string, chandelier) drop to 60%;
  - homes warm by 8%;
  - lit windows on the far and back plates rise from 45% to 85%.
- The phase change fades over 6 s.
- PostFX `nightLight` stays as it is.

**Eras** keep their grade, gloom and ambient from `data/eras.ts`. They also scale the **civic light** of the city:

| Era | Ambient | Public lamps lit | String lights | Look |
|---|---:|---:|---|---|
| Remnant | ×0.8 | 25% | no | cold teases everywhere, more dust |
| Restoration | ×0.9 | 60% | no | lamps back unevenly, one failing tube per corridor |
| Colony | ×1.0 | 90% | yes | market fires, string lights over hub and streets |
| Undercity | ×1.1 | 100% | yes | signage glows, far plates full of window lights |

The city literally lights up as you progress. That is the main visual reward curve.

---

## 10. Quality tiers

| | High (desktop) | Medium (phone default) | Low (lite) |
|---|---|---|---|
| Layers | all 6 (fore only at zoom 0.85 and above) | 5, no fore | 3: sky, back (far merged in, cached), play |
| Lightmap | 0.5× | 0.35× | 0.25×, at most 15 updates per second |
| Pools / glows | 96 / 300 | 56 / 160 | 28 / 60 |
| Flicker | all kinds | fire, failing tube, blink, weld, pulse | blink only |
| Motes / sparks | 140 / 26 | 70 / 14 | 0 / 6 |
| Scatter density | 1.0 | 0.6 | 0.35 |
| Far and back life (train, lifts) | yes | yes | no |
| Cones, god-ray, sway | yes | yes | no |
| Fog breathing | yes | yes | static |
| Survivor rim | yes | yes | no |
| Rock bake resolution | 0.6 | 0.45 | 0.3 |

The PostFX quality profile (`QUALITY_PROFILE` / `TOUCH_PROFILE`) keeps controlling pixel density, bloom passes, grain and frame rates. These tiers ride on the same `QualityLevel`.

---

## 11. Do and don't

**Do**
- Give every light a visible source.
- Draw the readability floor before the pools.
- Keep warm light for people and cool light for the unknown.
- Use the painted kit before vector.
- Put the same outline, grain and contact shadow on everything.
- Leave one cool tease in view of every dark edge.
- Let each stratum's signature accent appear at least once per screen.
- Show the city get brighter era by era.
- Keep plates and badges above fog.
- Test every screen at zoom 0.62 on a 390-px-wide phone.

**Don't**
- Don't darken a working room below 0.70, and never let a vignette or a fog layer cover a room's centre.
- Don't use pure black `#000000` fills in the play plane. The darkest made surface is `#0E0B0C`, the rock is lit by the section fill, and true black is reserved for the fore silhouette.
- Don't use flat, ungrained vector fills, or vector parts thicker than 6 u.
- Don't use cool light as the main light of an inhabited home.
- Don't set `letterSpacing` on Hebrew Pixi text, build per-glyph text, or put long text in the world.
- Don't mirror the world by language.
- Don't hit-test parallax planes.
- Don't add new full-screen layers without a tier gate. Fill rate is our budget.
- Don't add a new light colour. Pick one from `LIGHT.presets` / `TEMPERATURE`.
- Don't put a foreground silhouette over a room or a badge.

---

## 12. Vertical slice: the look, beat by beat

The slice is the first build of the new world, at the Upper Shelter depth. It reads right to left: the entrance is on the right and the city deepens to the left. Lights and fog states per beat are in `SLICE` in the tokens.

1. **The Hatch (surface, stratum 0).**
   - **Sky and ground:** a dusk sky plate pinned to the horizon. A burnt crust of ash soil with rubble and a dead tree on the back plane.
   - **The hatch:** a broken blast-hatch leaf, propped open, rusted. Sandbags around it, and a barrel fire (fire pool, radius 140) that throws orange onto the leaf. A red emergency beacon blinks on the frame.
   - **The way down:** by day the god-ray falls through the hatch into the dark. This is the first "light pool in darkness" the player sees.
   - **Cut face:** the warm red-brown soil, with roots and a bright rim at the cut.
2. **The Ramp (descending into stratum 1).**
   - **The tunnel:** a sloped concrete tunnel with hazard banding, rust streaks and a yellow handrail.
   - **Light:** two cage lamps make overlapping pools; between them the concrete falls to ambient. The red emergency lamp at the bottom marks the threshold.
   - **Sky warmth fading:** the depth ramp's warmth fades out halfway down, and the air turns from sky haze to shelter fog `#2A2622`.
3. **Bell Square, the hub (3 storeys).**
   - **The vault:** an arched concrete vault in enamel green and cream. Balconies on levels 1 and 2 have railings with the 1.5 u outline, linked by three stair flights and a steel truss bridge.
   - **Chandelier:** a brass ring chandelier (pool 320, cone 260) lights the square floor. Its pool fades to about 0.2 at the balcony backs, where wall lamps take over.
   - **String lights:** two catenary runs of string bulbs (Colony era and later).
   - **The square:** a fountain or water tank, benches and a notice board. A barrel fire by a market stall makes a second, warmer, flickering pool.
   - **The observation window:** a huge arched window shows the back and far planes: cavern ribs, backlit house clusters and far window lights. This is the depth money shot.
   - **Fog:** a storeroom behind a half-open blast door sits under "known" fog.
4. **Service Corridor.**
   - **The corridor:** cream and green tile, a ceiling pipe bundle with red valve wheels, and a short ramp down.
   - **Light:** three fluorescent pools in cool `#C8F0E0`; the middle one is failing (drop-outs). This is the one cool-white stretch, and it reads as "infrastructure" between two warm places.
   - **Floor:** the walkway floor of 0.32 keeps walkers visible between the tubes.
5. **Miners' Quarter, the living district.**
   - **The cavern:** an organic cavern. Five painted dwellings (quarters, workshop, canteen, medbay, greenhouse) sit as concrete alcoves along a terrace row, each at its readability floor (0.70 when worked).
   - **Lamps:** each dwelling's `meta.json` lamps spill warm onto the street at 45%.
   - **Street life:** an upper terrace on steel columns, reached by a stair. A street lamp, a fire barrel with sparks, a laundry line, a water tank, string lights and stalactites.
   - **Back plane:** through the open cavern back you see stepped houses with lit windows, a metro viaduct with a passing train (sodium-lit, which foreshadows stratum 3), and far cliffs with slow lifts.
   - **People:** two walkers carry lanterns.
   - **Fog:** the district starts **known**, and lights up as rooms are built or powered.
6. **The Blocked Tunnel, the dark edge.**
   - **The tunnel:** past the district a timbered tunnel ends in a rubble choke, with a broken beam, planks and caution tape.
   - **Light:** one lantern on the ground near a pick (a warm island). Beyond the rubble, a **cold blue tease** (`#6AA8FF`, pulse) leaks through a crack and shows through the fog at 30%.
   - **Fog:** the beat starts 30% revealed. Tapping it plays the reveal (0.9 s brush), and the blue glow becomes the hook for the next dig.
   - **Under the fog:** further down, under undiscovered fog, a cave pocket glows faintly cyan. It is the first sign of the Deep Caves.

**The slice is done when:**
- at zoom 0.35 it reads as five warm islands and one cold one in black earth;
- at zoom 0.62 on a phone every working room and every survivor reads;
- nobody can tell which edges are painted and which are drawn.
