# Prototype B: isometric (2:1 dimetric) "City Below"

**Open:** `http://localhost:5176/store/world-redesign/proto/b/index.html` (dev server `world`, port 5176). The page takes `?detail=0.3` to lower the procedural detail density.
**Code:** `store/world-redesign/proto/b/`, 9 files, about 2,100 lines, all procedural (Pixi Graphics, canvas-generated gradient textures, no art files). Every tunable value is in `tokens.ts`: colours, strata palette, light intensities and colours, lightmap resolution, fog colour, density and tap radius, camera speeds and zoom limits, tile size, storey height, cutaway stub height, detail density, people, particles and vignette.
**Screenshots:** `proto/b/shots/` (desktop, mobile, atrium close-up, slice 2, fog revealed).

## What it shows

The same scene as A and C, cut out of a block of earth as a diorama:

- **Surface (level 0):** ashen ground with ruins, a dead tree, a rusted car, a radio mast with a blinking light and sandbags. A ruined blast-door frame sits over a **ramp trench** that drops one storey.
- **Atrium / hub (levels 1-3):** a crater open to the sky lets moonlight shafts and dust motes fall in. It has stacked steel balconies on levels 1 and 2 (hazard-striped edges, railings), a **free-standing stair flight** (level 1 to 2), a **bridge** and landing on level 2, a second flight (level 2 to 3), market stalls, a fire barrel with embers, a water tank and two strings of swaying bulbs across the void.
- **Corridor:** an old metro tunnel with tiled walls, a green trim band, rails and sleepers, sodium lamps (one failing), a pipe bundle and a steam vent.
- **Living district:** 6 shacks around a plank street, each with its own material and light:
  - home with a candle
  - container with a flickering TV
  - workshop with a welding flash and sparks
  - brick home
  - hydroponic tarp greenhouse with a magenta grow-light
  - forge with a glowing furnace mouth and sparks

  The shacks have full-height back walls and **cut stub front walls** with door frames, so interiors stay visible.
- **Dark edge:** the tunnel runs on to a hazard barrier, a red emergency light and a **rubble plug**. Past it, a lantern glimmers **through the fog**. A hidden **crystal cave** pocket sits under the fog south of the district.
- **The block's cut faces** show the 6 strata as coloured bands:
  - soil
  - sandstone with bedding lines
  - granite with cracks
  - metro basalt
  - mines with copper and gold veins
  - deep caves with violet crystals
  - core with glowing red cracks and a red bloom underneath

  Hebrew labels name them.
- **8 survivors** walk a 3D node graph using BFS. They use the ramp and both stairs; the graph only lets them enter a stair along its run. They have walk cycles and a back view when walking away from the camera, and 2 of them carry **headlamps that move their own light pool**.
- **Lighting:** 33 lights plus 2 headlamps, rendered into a half-resolution lightmap, which is multiplied over the scene to make the darkness. Each light has two parts:
  - an elliptical floor pool that follows the 2:1 projection
  - a round "volume" that lights walls and people

  Bulb glows and haze are additive on top. Flicker types: fire, failing tube, pulse, TV, weld bursts, blink and sway.
- **Fog of war:** soft smoke sprites over unexplored cells. A tap reveals all fog within 64 screen px, plus 2.3 cells around it, with a fade and swell. Lights under the fog stay dark until they are revealed; the lantern is the deliberate exception (it teases through).
- **Camera:** drag to pan with fling, wheel to zoom around the cursor, two-finger pinch to zoom around the midpoint. Tap and drag are told apart by a 6 px threshold.

### How vertical levels read in iso: what I chose and why

I combined two techniques; neither works alone.

1. **Automatic cutaway (default "all" view).** Rock that has no excavation in its column is lowered only where it would hide an open cell behind it on screen.
   - For each column, the code looks at open cells in the same screen strip (|Δ(x−y)| ≤ 1) behind it. The highest allowed top is `z_open + personHeight + (Δdiag−1)·0.41u`.
   - The result is a natural terraced cut: back walls and cliffs stay full height (they never hide anything), and rock in front steps down to stubs.
   - Shallow levels sit at the back and deeper ones in front, so the whole city reads at once. The surface, the cliff with the atrium balconies, and then the metro level all show, and stacked balconies stay visible because a balcony is shallower (2 cells ≈ 32 px) than a storey (86 px).
2. **Slice toggle (buttons "הכל / 1 / 2 / 3", keys 0-3).** Everything above level k is removed and the rock is capped at k's ceiling with a "fresh cut" top. The removed levels stay as a **cyan x-ray outline** for context. This is needed as soon as levels overlap in plan, which a real city will do constantly.

I rejected **translucent upper levels**. Alpha-blending stacked geometry in iso gives muddy double images and costs fill rate. Ghost outlines carry the same information for free.

### Depth sorting

Every primitive (rock face, floor, slab edge, railing, wall segment, prop) gets a true camera-depth key: `x + y + 0.816·z` (for a 30° elevation). The keys feed two levels of grouping:

- Static primitives are baked into Graphics **chunks** per (level, key bucket of 0.5).
- Chunks are grouped into **depth slabs** (key span 3), each a Pixi **render group**.

People are re-parented into the slab of their current key, with zIndex snapped to the chunk grid. A slab therefore re-sorts and re-batches only itself, and only when someone crosses a chunk boundary.

This fix mattered. Before it, re-sorting the people re-batched the whole world every frame: 21% of CPU time was spent in Pixi's `Batcher.break`, and a 4× CPU-throttled phone ran at about 79 ms per frame. After it, the main thread is 66% idle.

## Performance

How I measured: the built-in browser pane was hidden in this session, so its requestAnimationFrame (rAF) loop was paused and could not be timed. Instead, the project's own headless-Chrome CDP harness (`tools/perf/lib.mjs`) drove the same dev-server page on this machine's real GPU (Intel UHD 630, ANGLE/D3D11). Each run is a rAF sampler over 5 s. The machine was shared with the sibling A and C agents, so the throttled numbers are noisy.

| Run | avg frame | p95 | Display objects |
|---|---|---|---|
| Desktop 1440×900 @1x, "all" view | 19.6-21.2 ms | 33.4 ms | 1,259-1,279 (541 chunks) |
| Desktop, slice 2 | 16.7 ms | 16.9 ms | 916 (347 chunks) |
| Desktop, `?detail=0.3` | 18.0 ms | 33.2 ms | 1,277 |
| Mobile preset 375×812 @2x | 20.1-22.9 ms | 33-50 ms | 1,279 |
| Mobile + 4× CPU throttle | 45-117 ms (noisy) | 166-550 ms | 1,279 |

What the numbers mean:

- It runs at about 50 fps on an integrated GPU and is **GPU-bound**: the main thread is idle. About 113k vertices and 63k triangles of static vector geometry are drawn every frame, plus three full-screen passes (sky gradient, multiply darkness, vignette) and the lightmap.
- Hiding any single layer (glow, fog, labels, darkness) saves less than 1.5 ms. The static vector world itself is the cost: half the chunks brings it to 60 fps.
- **For a phone, the static world must be baked to textures.** Chunk geometry should be rendered once into tiles per depth slab and re-baked only when a room changes. That trades vertex load for texture memory, which is the open budget question.

## Adopting B in the real game

### What stays, what is adapted, what is rewritten

**Kept as-is:** the whole simulation (`core/`, `data/`), the save format, and all UI/HUD. Several rendering-side pieces of logic also carry over:

- the cosmetic-walker contract from `walkers.ts`: decision D4, the walker budget, "appear at destination" when there is no route, and preallocation
- `roomFlicker` / `roomWorking` publishing
- crisis light and incident semantics
- quality tiers in `perfFx`

**Adapted:**

| File | Change |
|---|---|
| `CameraController.ts` | Pan, pinch, fling, springs, double-tap and HUD insets carry over. Bounds become the iso diamond. Zoom tracks are re-tuned. Taps must pick an iso **cell and level** (unproject onto each visible level plane, front-most first) instead of a slot on a floor. |
| `strata.ts` | The 5 bands, palette ideas and procedural tile painting map directly onto the block's cut faces and cut tops. The 512 px tiles would become face textures instead of tiling sprites. |
| `world.ts` | Only the concepts survive (surface, underground, shaft, utilities). Its geometry is side-view. |
| `walkers.ts` / `routes.ts` | Floors, lift and zig-zag stairs become a 3D node graph with stair and ramp edges, as in `map.ts`. Budgets and interception stay. |
| `people3d.ts` + `tools/people3d.html` | The pipeline is reusable: greyscale layers tinted per outfit, hair and gear sprites at head anchors. The atlases must be re-rendered from a 30°-elevation camera at **2 iso facings** (front-left and back-left, mirrored for the right side), which doubles atlas size. Sprites shrink to about 35 px at default zoom, so faces stop reading and silhouettes have to do the work. |
| `atmosphere.ts` / `postfx.ts` / `lightStrip.ts` | Replaced by the lightmap model. Room lamps become light defs placed in 3D. |

**Rewritten:**

- `BunkerRenderer.ts` layout, `geom.ts`/`layout.ts`: slots and floors become a cell grid with levels, plus a mapping from the game's rooms to footprints.
- `structure.ts`: the side-view painted kit (casing, slabs, columns).
- `RoomViews`, `roomComposer`/`roomSpecs*`, `PlacementGhost`/`PlacementController`, `HitSlop`, `signage`/`wingSigns`, `shaft.ts`.
- `paintedRoom.ts` and **all 45 room paintings** plus the district and hall paintings in `public/art`. They are side-view plates and cannot be shown as iso interiors. At best they survive as UI portraits, codex images or distant parallax backdrops.

### Effort (agent-days, beyond this prototype)

| Item | Agent-days |
|---|---|
| Iso core in production quality: projection, depth sorter, static baking to tiles per slab, culling, re-bake on change | 4-5 |
| World model: game floors/slots/wings mapped to iso footprints, auto-cutaway, slicing UI, strata faces | 5-6 |
| Rooms as iso dioramas: about 15 room types × 3 tiers. Procedural kits like the dwellings here, or a new 3D pre-render pipeline. **This is the largest item.** | 10-15 |
| People atlases at iso angles, plus walkers and routes on the graph | 5-6 |
| Camera, cell/level hit-testing, placement ghost, touch | 3-4 |
| Lighting, fog, particles hooked to game state (power, crises, exploration) | 3-4 |
| Mid-Android performance hardening, quality tiers | 4-5 |
| RTL, labels, QA, regression | 2-3 |
| **Total** | **≈ 36-48 agent-days** |

### Risks

- **Performance on mid-range Android:** high. The vector world is GPU-bound already on an Intel UHD. Production needs texture baking, viewport culling of slabs and a lower lightmap scale (0.35) on the Low tier. Texture memory for baked slabs on a 3-4k px world at 2× DPR could reach 150-250 MB unless tiles are culled and evicted.
- **Art re-creation cost:** very high. None of today's painted room art or the side-view people atlases transfers. The game's current premium look comes from those paintings. Procedural iso rooms can look good, as the dwellings here show, but each room type is real design work.
- **Readability of vertical depth:** medium. It works when the city is laid out as a descending terrace. A real city with heavy plan overlap needs the slice view most of the time, which hides the "everything at once" wow. The other levels show only as x-ray outlines.
- **Readability of people:** medium. At city zoom they are about 35 px tall, in the dark. Inspecting individuals needs zoom-to-room.
- **Touch hit-testing:** medium. One screen point maps to several cells along a diagonal and across levels. Tap targets need "front-most visible cell of the active slice" logic plus generous radius picking (this prototype uses a 64 px radius for fog). Stairs and balconies overlap in screen space.
- **RTL:** low but real.
  - Iso has no inherent left-to-right reading order, which helps an RTL game.
  - **Pixi `Text` breaks Hebrew if `letterSpacing` is set.** Pixi then draws glyph by glyph and loses the bidi algorithm, so the first build showed reversed words. With `letterSpacing` removed, and each label wrapped in RLI…PDI for mixed Hebrew and digits, it renders correctly.
  - Directional hints must follow RTL: the city grows toward the screen's lower-left.

### Scores (1-10)

| | Score | Why |
|---|---|---|
| Wow | 8 | A lit diorama city with a sky crater, strata faces and a core glow is very "premium city builder". |
| Readability | 6 | Districts and paths read well. Vertical overlap needs slicing, and people are small. |
| Explorability | 8 | Fog over a 2D grid with depth, slicing to look down levels, and teasing lights beyond the rubble. |
| Reuse of existing art | 2 | Paintings and people atlases are side-view. Strata ideas and palettes survive. |
| Phone performance | 5 | 50 fps on an integrated GPU as vector geometry. It needs baking, and it is fine after that. |
| Effort (10 = cheapest) | 3 | About 40 agent-days, most of it rebuilding room interiors. |
