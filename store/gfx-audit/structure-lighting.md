# Audit: structure, shaft, lighting, depth, post-FX, atmosphere

Scope: `structure.ts`, `shaft.ts`, `world.ts` (underground), `postfx.ts`, `decals.ts`, `atmosphere.ts`, `draw.ts`, `layout.ts`, the relevant parts of `BunkerRenderer.ts`, and `public/art/kit`. Evidence comes from `store/compare/final/*` plus fresh live views of `?slot=gfx` at 430×932: night 02:07, zoom 3.2 on floors B2–B4, and zoom 2.2 on the west casing and the bottom of the bunker.
Live counts in the world container: **2,436 display objects, 714 Graphics, 310 TilingSprites, 155 additive sprites**. `__perf()` reports 9.9 ms/frame on desktop at resolution 2.

## 1. What exists

- **Structure kit.** Painted tiling textures (wall 512², slab 1024×368, column, pipes) come in R/F/L era states (`structure.ts:40-55`). The slab is drawn 19 u tall in front of the rooms (`:401-413`). Columns sit only where rooms meet (`:420-449`), a pipe bundle runs under each ceiling (`:373-383`), and empty slots get painted excavated bays with a work-lamp glow (`:129-178`).
- **Lighting.** It is CPU "vertex" lighting: each slab, pipe and column segment gets one `tint` from the lamps in reach (`lampParts`/`lightOf`, `:221-241`, applied `:344-357`, re-tinted on power or flicker change `:516-529`). Additive spill sprites add column-face streaks, ceiling glows and floor pools (`:415-511`). Rooms are pre-lit paintings with additive glow and cone sprites on top (`paintedRoom.ts:35-60`). Flicker is shared through `roomFlicker` (`paintedRoom.ts:12`). People get one uniform ambient tint per room (`BunkerRenderer.ts:908-916`).
- **AO and shadows.** There is a fade ramp beside each column, a blob in each corner and a contact line at the floor (`structure.ts:385-399, 454-458`). The under-slab shadow is 6 stacked 2-px rects (`:393`). The shaft's side shadows are 7 stacked 1.5-px rects (`shaft.ts:130-134`).
- **Depth fog.** Each level is 3.5% darker and 4% bluer, floored at 75% and capped at 25% (`depthGains`, `structure.ts:298-304`). It is used by the shaft, people and decals.
- **Shaft.** A full mechanical cage lift: rails, sheave, counterweight, cables, landing gates per floor, a cabin light spread and a shadow blob (`shaft.ts:94-320`).
- **Post-FX.**
  - Era grade: one `ColorMatrixFilter` on the whole world container (`BunkerRenderer.ts:129, 372, 1150-1172`).
  - Bloom: the whole world is re-rendered at ¼ size every 2nd frame, then thresholded, blurred and added (`postfx.ts:68-94, 119-123`).
  - Grain and vignette: CSS DOM overlays (`postfx.ts:104-127`, `style.css:52-84`, vignette with scanlines).
- **Atmosphere.** Pooled particles (budget 120): drips, steam valves, sparks, dust in lamp light (`atmosphere.ts:79-130`). Decals are lit by the same lamp model (`decals.ts:132-150`).
- **Rock.** One strata painting stretched over the dug depth under a black gradient (`world.ts:155-170`). The casing is a dark overbreak polygon plus one tiled wall texture tinted `0x6e6e6e` (`structure.ts:181-205`).

## 2. Strengths

- Every light has a visible source. Flicker and power sag reach the structure, the decals and the people coherently. That is rare in idle games.
- The kit art itself is good. The slab texture has a painted top face, bolted plates and hazard paint. The room paintings already have one-point perspective (back wall inset, `layout.ts:17-20`).
- Era-driven wear (R/F/L), depth fog and particles tied to visible sources are good art direction.
- The shaft is the most "physical" element: moving sheave, counterweight and folding gates.
- The quality ladder exists (`PerformanceMonitor`, high/medium/low).

## 3. Problems, ranked by visual impact

1. **The light is painted on, not cast.**
   - All dynamic light is additive glow laid *over* pre-lit paintings. This lifts blacks into a milky veil instead of revealing surfaces. The greenhouse, workshop and lab read blown-out white in `cam2`, `cam6` and the live zoom.
   - Bloom (threshold ~0.62, alpha 0.42) adds a second veil over those rooms.
   - No surface is darker for being far from a lamp. Unlit corners exist only where hand-placed AO blobs sit.
   - People are tinted uniformly per room: no key side, no rim, and no shadow on the wall or floor. This is the main reason they read as "puppets in front of a picture".
2. **It reads as a grid diagram, not a cross-section.**
   - Every floor is the same height, with the same slab, columns and pipe strip, so the overview (`cam1`) is a spreadsheet of boxes.
   - At overview zoom the 19-u slab is ~11 px and reads as a stripe, not a 60 cm concrete floor.
   - There is no cut face: the casing has no visible thickness, rebar or bevel where the "saw" cut through rock and concrete. The rock simply butts a dark rim.
3. **No camera depth.**
   - The whole world is one container (`BunkerRenderer.ts:366-372, 492-494`). The surface, the rock, the rooms and the effects move 1:1. There is no foreground layer, no parallax and no depth of field.
   - Zooming only magnifies. At zoom ≥3 the paintings go soft and the CSS grain and scanlines become the most visible texture.
4. **Dead rock.**
   - The strata are darkened to near-black (`world.ts:162`). The area around the casing is a flat dark field, with no roots, conduits, water seams or bounce light from the bays.
   - A navy void (`backgroundColor 0x0d0f1a`) fills the bottom ~12% of `cam1` below the dig sign (`world.ts:153`: the rock ends 170 u below the last floor).
5. **Stepped, banded light.**
   - Tint lighting is constant per 23–46 u segment, so slab brightness changes in steps under a lamp.
   - The stacked-rect shadows (`structure.ts:393`, `shaft.ts:131-134`) band visibly at zoom.
6. **Post-FX looks "cheap filter" rather than filmic.**
   - The grade is a single matrix: no LUT, no shadow/highlight split toning, and no per-depth or night variation. `setNight` only puts people to bed (`BunkerRenderer.ts:346`); the bunker never dims or shifts to night lamps.
   - Grain and scanlines are a DOM `mix-blend-mode: overlay` layer, which is screen-space and resolution-independent, so it looks like video noise.
   - Bloom costs a second full scene render for a result that hurts contrast.
7. **Repetition.** One wall texture tiles the entire casing at 64 u. The columns, pipe bundle and lamp fixtures are identical in every room. The fixtures are flat yellow boxes on sticks at close zoom.

## 4. Improvements

Perf figures assume a mid-range phone (Adreno 610 / Mali-G57 class) at 860×1864 (DPR 2). Recommendation: cap DPR at 1.5 on "medium".

| # | Improvement | Technique | Effort | Impact | GPU cost | Depends on |
|---|---|---|---|---|---|---|
| A | **Light buffer (deferred-lite)** | Render every lamp as a soft shaped sprite (cone, pool, glow, with flicker alpha) into a ½-res RenderTexture. Composite in one full-screen filter: `scene × mix(ambient(era, depth, night), 1+k, light)`. Remove the additive veils. People, decals and structure are then lit by position, with smooth gradients (fixes #5). The era grade folds into the same shader. | M | 5 | ~0.3 ms lights + ~0.8 ms composite, replacing the grade pass; net ≈ +0.5 ms | Retune painting brightness (the light map masks between a darkened and a full version) |
| B | **Character shadows + key light** | Per person: a black, blurred, skewed copy of their sprite on the back wall and the floor, sheared away from the nearest lamp, with alpha by distance. A one-sided rim tint on the lamp side (a second tinted sprite with an offset mask). | S–M | 4 | ~0 (2 sprites per person) | People renderer owner |
| C | **Section-cut thickness** | Thick cut casing with a lit top bevel, broken edge, rebar stubs and a 2–3 u highlight lip on every slab top plus a soft under-shadow gradient. Vary slab segments, use different column profiles per zone, and make every 3rd–4th floor a heavier "structural" slab. | S–M | 4 | ~0 | Kit art (2–3 new strips) |
| D | **Parallax layers + baked DOF** | Split into far rock (0.9×), bunker (1.0×) and foreground (1.12×) with pre-blurred rock lips, roots, cables and girders at the screen edges. The surface backdrop scrolls vertically at 0.6×. Offsets in `updateTransform`. Do not blur in real time; bake the blur into the foreground art. | M | 4 | Small fill-rate (edges only) | Art for foreground pieces |
| E | **Depth-map room parallax** ("2.5D paintings") | Generate a depth map per room painting (Depth-Anything / Marigold, offline in `tools/`). Cut it into 3 planes (back wall, props, front props), or use a batched mesh shader that offsets UVs by depth × camera delta. Rooms then shift inside when you pan. This is the strongest "it's 3D" cue available without 3D. | L | 5 | 3 sprites per room, or 1 extra texture sample | Room-art owner; pipeline work |
| F | **LUT grade + in-engine grain/vignette** | A 32³ LUT strip per era, plus depth and night LUTs blended by uniforms. World-space or film-res grain and a vignette in the same pass as A. Delete the CSS overlays and scanlines. | S–M | 3 | ≈0 net (merged into A's pass) | A (or standalone, replacing the ColorMatrix) |
| G | **Bloom from lights only** | Feed bloom from the light buffer and emissive sprites (screens, cores), not the whole world. Use a soft-knee threshold. | S | 3 | **Saves** a full scene re-render (−1–2 ms) | Best with A |
| H | **Normal-mapped kit** | Normal maps for slab, wall, column, pipes and car (Sobel from height in `tools/kit.ts`). A custom mesh shader takes N·L from ≤6 nearby lamps, so rivets, bevels and cracks catch the light. | L | 3 (5 with room normals from E) | +1–2 ms; the custom shader breaks batching | A, E |
| I | **Volumetric cones** | Scrolling-noise mask on the existing cone sprites. Skip radial-blur god-rays (2–3 ms). | S | 2–3 | ~0.2 ms | — |
| J | **Rock richness** | An "excavation halo" painting around the casing (roots, conduit, seepage, bounce light from the bays). Extend the strata to the screen bottom (fixes the void). Lighten the darkening gradient (0.85 → ~0.6). | S–M | 3 | ~0 | Art |
| K | **Night lighting underground** | Drive A's ambient and LUT from `nightNow`: corridors to 40%, warm night-lights. | S | 2 | 0 | A or F |
| L | **SDF / radiance-cascade 2D GI** | Jump-flood SDF at ¼ res, raymarched soft shadows. | XL | 3 | 3–6 ms on mid phones: too expensive | — |
| M | **Real 3D** (three.js/Babylon, or Unity like Fallout Shelter) | Textured 3D room shells, baked lightmaps, perspective camera. | XL (months: ~7,300-line renderer, 3D art pipeline, rigged people) | 5 only if people go 3D too | Fine with baked light | Everything |

**Honest take on M.** A 3D structure with today's 2D paper people would look *worse*: the user's "puppets" complaint is about the people. A+B+C+D+E deliver most of the perceived "3D, higher quality" for roughly 15–25% of a 3D port's cost, and keep the painted identity. Revisit M only for a sequel or a native rebuild.

**Perf note.** The current frame already pays a full-screen grade pass plus a ¼-res second scene render, with 714 Graphics and 310 TilingSprites. A, F and G *replace* those costs rather than add to them. Verify draw calls with Spector.js before and after. TilingSprites with non-power-of-two frames may not batch.

## 5. Quick wins vs big moves

**Quick wins (days each):**
- **G:** bloom from lights only. It is cheaper and stops the white-out.
- **Turn the additive room glow down** (alpha ~0.85 → 0.5) and add a dark ambient so lamp pools have edges.
- **C:** slab top highlight lip, cut-face casing and the bottom void fill (J part).
- **B:** person shadow sprites cast from the nearest lamp.
- **Gradient shadows:** replace the stacked-rect shadows with the existing `fadeV` gradient texture.
- **F:** LUT plus in-engine grain; drop the CSS scanlines.

**Big moves (weeks), in this order:**
1. **A:** light buffer. It is the foundation that makes lighting "real".
2. **D:** parallax layers.
3. **E:** depth-map room parallax.
4. **H:** normal maps (after E, so room normals come from the depth maps).
5. **M only as a strategic decision**, together with 3D characters.
