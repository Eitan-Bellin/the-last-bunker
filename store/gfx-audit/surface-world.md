# GFX audit: surface, entrance, sky, eras, districts, world map, city map

Reviewer: environment art. Evidence: `store/compare/final/cam1|cam3|cam5`, `store/screenshots/04-world-en.png` (old gfx1), and live shots I took on `?slot=gfx&gfx2` at 430×932: a night overview (`__forceNight=1`), the world map panel, and a far zoom (`devCamera(...,0.25)`). No game files were edited.

**Verdict:** the surface is **one static painting with a few sprites on top**. Under it there is a good painted foundation. It still reads as "a picture behind puppets" because nothing in it has depth, motion or weather. The world map is the weakest screen in the game: it uses flat-colour SVG hexes.

## 1. What exists

- **Panorama:** one 1400×706 painting per era, `public/art/backdrops/surface-0..3.webp`. It is placed as a single Sprite scaled to world width (`surface2.ts:214-227`), with a flat `0x0c0b10` fill above it (`:222`). It sits in `surfaceHolder` inside the world container, so it moves 1:1 with the camera (`BunkerRenderer.ts:367,1120-1134`). There is no parallax.
- **Sun shafts:** 6 additive cone sprites that sway slowly (`surface2.ts:229-246,426-429`).
- **Day/night:** one multiply tint on everything (`DAWN/DUSK/NIGHT` at `surface2.ts:68`, applied at `:409-417`). Lamps fade in at night (`:420-425`).
- **Props:** 13 fixed placements chosen per era (fence, mast, car, lamp, tree…) with contact shadows (`surface2.ts:49-63,251-277`).
- **Topsoil:** a keyed painted strip, tiled across the whole width (`surface2.ts:91-154,280-296`). The rock strata below it are a stretched TilingSprite (`world.ts:155-161`).
- **Entrance:** a portal painting per look (0 wrecked / 1 cleared / 3 gatehouse, `surface2.ts:31-36,298-371`). The wheel spins on mission start/return (`:74-83,440-451`). It also has floodlight cones, a beacon and a "17" plate.
- **Wind:** 12 dust motes (`surface2.ts:373-385,430-438`).
- **Legacy gfx1 surface:** procedural skyline and grey entrance block (`world.ts:26-140`).
- **Districts:** cavern paintings (`public/art/districts/*.webp`) shown through `buildPaintedRoom` with an auto-lit layer, dust motes and a rough rock frame (`paintedRoom.ts:216-235,270`). The tunnels are flat brown rects (`world.ts:185-200`). The "dig here" sign is spray-painted (`BunkerRenderer.ts:195-242`).
- **City map (far zoom):** a blueprint overlay with glowing rooms and resident sparks (`cityMap.ts:28-106`, fade at `BunkerRenderer.ts:1103-1114`).
- **World map:** an SVG hex grid with flat biome colours, `?` icons and straight mission lines (`SurfacePanel.ts:106-156`; colours in `data/surface.ts:15-41`). The six biome paintings are only shown in expedition reports (`ui/expeditionText.ts:51`).
- **Eras:** `data/eras.ts` sets the grade, gloom and ambient. There is no surface, weather or sky data per era.

## 2. Strengths

- The four era panoramas tell a strong story at a glance: ash-orange ruins, then a green, solar-powered valley (`surface-0` → `surface-3`). Era 0 is genuinely moody.
- The idea of a topsoil cross-section with hanging roots is right, and the strip art is good (cam3).
- The portal per era, the turning wheel tied to expeditions, and floodlights that come on at night are good "hero object" thinking.
- The district paintings, especially the lake, are atmospheric and fit the palette.
- The city-map LOD is a clever stylised abstraction for far zoom.

## 3. Problems, ranked by impact

1. **The world map is a spreadsheet, not a world** (live shot). It is a dark void, ~90% grey fog hexes and flat beige/ochre fills, with no terrain, landmarks or animation. The six biome paintings already exist and are not used here. This is the screen where "exploration" should feel richest. Impact: very high.
2. **The surface is a flat card.** Single sprite, 1:1 scroll, clouds frozen, painted birds frozen (`surface-3`), no wind on the vegetation. Panning or zooming shows no depth at all, and this is the core of the "just pictures" complaint.
3. **Night is a muddy multiply, not a sky** (live night shot). The whole surface turns blue-brown sludge. There are no stars, no moon, no sky gradient, and the baked sunset sun and warm light stay in the painting. The panoramas are all golden-hour, so midday looks like sunset as well.
4. **Resolution and softness.** A 1400 px painting stretched across ~1100 world units looks blurry at entrance zoom (cam3: windmills and houses are mushy) next to crisp bunker art.
5. **Entrance and props clash with the panorama.**
   - The portal (`kit/portal-3`) is a clean, front-lit mobile-cartoon render. The panorama is painterly and back-lit from the low right sun.
   - The portal's hillside does not join the panorama's hills.
   - In cam3 the painted houses directly behind the portal read at the same size as the door, so there is no scale or aerial perspective.
6. **The topsoil cut is a perfect ruler line.** It is one tiled band of constant thickness across the world (cam1/cam3), and the ground in the panorama meets it on a straight horizon. There is no mound around the portal and the roots don't vary. This breaks the art bible's "no straight line > 200 units" rule.
7. **No weather or atmosphere.** There is no rain, ash, snow, dust storm, fog or smoke anywhere, even though an expedition "storm" event exists (`expeditionEvents.ts:53`). Twelve motes is not readable on a phone.
8. **Districts read as framed pictures, not places.**
   - The water, crystals and fluorescent lights are static.
   - Each district is only 4 slots × 1 floor, too small to feel "vast".
   - The tunnels are programmer-art brown rects (`world.ts:194-199`).
9. **Era change is a hard swap** (`refreshSurface` rebuilds everything). It loses the game's best emotional beat, the world healing.
10. **At far zoom the world is a finite box in a navy void** (live shot). The sky cuts off and the surface edges are visible.

## 4. Improvements

| # | Technique | Effort | Impact | Dependencies / art source |
|---|---|---|---|---|
| A | **4-layer parallax**: sky (0.1×), far hills (0.3×), mid (0.6×), near ground and props (1×). Blur the far layer (BlurFilter 1.5–3) and add a haze gradient between layers (atmospheric perspective / depth of field) | M | 5 | Re-generate each era as separated layers at 2800–4096 px: Moda `canvas_edit_image` generate + remove_background, or separate-image-layers on the existing paintings |
| B | **Time-of-day sky**: a sky-free landscape (alpha) over a gradient-sky filter keyed to the clock, with a moving sun and moon, stars, and a horizon glow. Replace the multiply tint with a ColorMatrix (desaturate plus cool shift) and rim light from the sky colour | M | 5 | Needs the sky separated (A). Sky, stars and moon are procedural |
| C | **Moving clouds and fog**: 2 TilingSprites of noise clouds scrolling at different speeds; low fog bands between parallax layers; era 0 ash haze | S | 4 | Procedural noise (canvas tool) or Moda cloud strips |
| D | **Weather system**: ash fall (era 0), rain with splash on the topsoil and a lightning flash on the sky (eras 1–3), dust storm (wasteland), occasional snow. Drive it from the clock and expedition events. Use ParticleContainer | M | 4 | Procedural sprites only |
| E | **Wind sway**: DisplacementFilter with a scrolling noise map, masked to the grass fringe, portal hillside foliage and the near-layer trees | S | 3 | Procedural noise map |
| F | **Life**: bird flocks (flap from a 2-frame procedural silhouette; crows/vultures in eras 0–1, songbirds later); chimney/vent smoke from the bunker exhaust next to the portal; fire smoke in era 0 ruins; turning windmills in era 3 (split them out of the painting) | S–M | 4 | Procedural, plus small Moda sprites |
| G | **Entrance as hero**: split the door leaf from the frame so the door can slide or swing open when a team leaves or returns. Survivors walk out along a path into the mid layer and shrink in perspective. Grade the portal to the panorama's light (ColorMatrix plus a warm rim on the sun side) and repaint it img2img with the panorama style reference | M–L | 4 | New door/frame parts (Moda/Canva with style ref `MAHW6HZgYnA`). Commission it if budget allows |
| H | **Organic ground cut**: mask the topsoil with a noisy polyline (varying thickness, a mound around the portal); scatter roots, stones and a buried pipe; dark soil-to-rock blend; puddles in the rain | S | 3 | Existing strip and procedural mask |
| I | **Era transition**: noise-threshold dissolve shader from the old layers to the new; props rise with dust; a one-shot camera pull-out | M | 4 | Builds on A |
| J | **Living districts**: displacement water with a reflection shimmer masked to the lake; pulsing crystal glows (cave); fluorescent flicker and a passing train-light sweep (metro). Make districts 2 floors tall. Paint the tunnels | M | 3 | Masks per painting; tunnel art from Moda |
| K | **Painted world map**: render in Pixi rather than SVG. Use painted hex tiles per biome (isometric-ish, 2–3 variants each), POI landmark mini-illustrations, an animated noise-cloud fog of war that burns back when a hex is revealed, a team token walking a curved route, and a day/night tint shared with the bunker. Show the biome painting in the hex card | L | 5 | ~20 tiles + 10 landmarks (Moda/Canva generation with a style ref), or one commissioned illustrated map |
| L | **Far-zoom framing**: extend the sky and strata beyond the world bounds with a vignette fade, and show a surface silhouette with lit windows on the city map | S | 2 | None |
| M | **2.5D option**: normal-mapped portal and props lit by the sky and sun direction (custom Pixi light filter), or 3D-rendered backdrop layers (a Blender scene rendered per era and time of day) | XL | 4 | 3D artist/Blender. Only worth it after A–D |

## 5. Quick wins vs big moves

**Quick wins (≈1–3 days each, almost no new art):**
- C: clouds and fog.
- E: grass and foliage sway.
- F: birds and smoke.
- H: organic topsoil cut.
- D: ash and rain particles.
- Portal colour grade from G.
- L: far-zoom framing.

Together these turn the surface from a "picture" into a "place" on day one. Start with C+E+F: they directly answer "not just pictures".

**Big moves (biggest perceived quality jump):**
1. **A+B, layered panoramas with a real sky.** This is the foundation for depth, night, weather and era transitions. It needs a new art pass on 4 eras × 4 layers, generated with Moda and style-matched.
2. **K, painted world map.** It is currently the lowest-quality screen and the one players open every session.
3. **G, door-opening expedition sequence.** It makes the entrance the game's signature moment.
4. **I, animated era transformation.**

Skip true 3D (M) until A–D ship. Layered 2D with filters will get ~80% of the "more 3D" feel for a fraction of the cost.
