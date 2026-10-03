# GFX audit: rooms and interiors

Scope: `public/art/rooms` (45), `halls` (2), `ruins` (12), `src/rendering/paintedRoom.ts`, `roomArt.ts`, `src/art/ArtLibrary.ts`, `registry.ts`, `public/art/meta.json`, `balance.json`. Evidence comes from `store/compare/final/*` and direct viewing of the art.

## 1. What exists

- **Paintings**: 15 types × 3 tiers. They are 480×522 (2-slot, 92 world units) or 720×522 (3-slot, 138 u), which works out to about 5.2 texels per world unit. Halls are 560×876 and ruins are 480/720×522. Files are 30–73 KB WebP. Only 3 raw sources survive (`art-src/raw/{farm,generator,quarters}-0.png`, about 1400 px). Sources for the other 42 are gone.
- **Draw path** (`paintedRoom.ts:241-286`): one full-room `Sprite` (`:250`) stretched to the room. On top of it go additive glow sprites plus a light cone for every lamp with r≥0.15 (`:34-62`), a particle emitter for drip/smoke/steam/sparks/bubbles (`:73-157`), and static blink/pulse/screen glows (`:159-176`). Dust motes (`:179`) and a steel frame with gradient inner shading (`:199`) finish the room. Power affects tint, blackout and flicker (`:20, :275-284`). Flicker is shared with the structure through `roomFlicker`.
- **Lamp data**: hand-placed for 3 rooms only (`registry.ts:62-79`). The other 47 entries come from auto-detection in `meta.json`. FX spots exist **only for quarters-0, farm-0 and generator-0** (`registry.ts:82-93`). `meta.json` has no fx entries at all.
- **Balance** (`ArtLibrary.ts:46-59`): per-tier exposure cap plus a pull toward a warm white balance. `BunkerRenderer.ts:1008` multiplies this by depth fog and ±4% per-room jitter.
- **Tier/state handling**: `roomTier` gives tier 1 at level 3+ and tier 2 at level 5+ (`registry.ts:49`). A tier change crossfades with a dust burst (`BunkerRenderer.ts:681-700`). Rooms that are odd-numbered in a compound are mirrored (`:645, :677`). A new build shows a blue ghost of the painting with a grid and scaffold (`roomArt.ts:588`). An upgrade gets a flat-vector wooden scaffold with procedural welding sparks (`roomArt.ts:539`).
- **People**: walk in a 10-unit floor band (`people.ts:8-9`), drawn at 1.16× (`people.ts:184`) and always in front of the painting.

## 2. Strengths worth keeping

- The tier-0/1 paintings are moody, coherent and lamp-lit. canteen-0, generator-0, quarters-1 and collapsed-wide are commercial quality as single images.
- Tiers are composed from the same base, so an upgrade reads as "the same room, restored". The crossfade plus burst is a good transition.
- The live lamp layer is already tied to power: blackout, brown-out flicker, and flicker shared with the structure. That is a real systemic hook most indie games lack.
- The balance and depth-fog pass keeps the 45 images from looking pasted together.
- On-demand texture loading with mipmaps (`ArtLibrary.ts:93`) is the right architecture to scale up.

## 3. Problems (ranked by visual impact)

1. **Every room is a single flat photo, so there is no depth.** Back wall, machines and foreground share one sprite. People always draw over everything, so nobody stands behind a bed, bench or console (`zoom-detail.png`: survivors cover the bunks). This is the main source of the "pictures with puppets" complaint. Fallout Shelter, This War of Mine and Sheltered all put characters *inside* the set.
2. **Painted motion is frozen.** 42 of 45 rooms have zero FX spots. canteen-0 paints steam and a blue gas flame that never move. The engines, pumps, reactor coils and the robot arms in farm-2 and workshop-2 are static, and the screens are painted pixels. Dust motes are the only life. Frozen steam reads as "a picture" immediately.
3. **Scale mismatch between people and set.** People stand about 65 u tall (56×1.16) in a 100 u room, while painted furniture is undersized: the bunk and locker in quarters-1 are about 46 u. Survivors are as tall as a top bunk (`zoom-detail.png`, `zoom-people.png`). Puppet-scale actors in a miniature set read as toy-like.
4. **Additive glow blobs wash out tier 1–2 rooms.** Tier-2 paintings already have baked bright light, yet up to 4 cones (W×0.95 wide, alpha 0.32) and glows stack on top (`meta.json`, e.g. farm-2, laboratory-2 and reactor-2 each have 4 large lights). The result is white smears that erase the art (`cam2-floors-close.png`: hydroponics and workshop rows). This is double lighting, and it looks like a lens filter rather than light.
5. **Tier 2 breaks the style.** The tier-2 rooms (workshop-2, farm-2, generator-2) are glossy, over-sharpened, cyan "3D-render" stock art with a different rendering language. The balance pass only fixes colour, not style. It also contradicts the bible's rule that saturation is only for alerts and screens.
6. **Perspective is inconsistent.** Rooms use a frontal elevation with a shallow floor, but the halls (`halls/atrium.webp`, `reactorHall.webp`) are deep one-point boxes with their own painted frame. That produces a double frame and a mismatched horizon next to the rooms. The atrium's mezzanine also isn't walkable. Floor-plane height varies between paintings (about 0.80 to 0.88 of H), so feet float in some rooms.
7. **Compounds repeat visibly.** A merged 2–3-room compound is the same painting tiled and mirrored (twin bunk sets in `cam2`, twin grow racks), so the seam turns into a mirror line. Fallout Shelter paints merged-width variants.
8. **Resolution is soft at close zoom.** MAX_ZOOM 3 × DPR 2 gives 6 device px/unit against 5.2 texels/unit, plus WebP artefacts. Close shots are mushy. At overview zoom (0.6) the detailed paintings turn into noise because there is no simplified read.
9. **Construction and upgrade states are cheap.** The scaffold is flat `Graphics` rects in a single wood colour, with perfectly straight lines that break the bible rule (`roomArt.ts:539-560`). The construction state is a tinted ghost under a CSS-like grid. Neither is painterly.
10. **The structure lamp brackets overlap the painted lamps** at the top-left of every room (`cam2`, `cam4`). The room ends up with two lamps that don't match. This is owned by Lighting (`structure.ts`), but it hurts rooms.

## 4. Improvements toward high-end quality

| # | Technique | Effort | Impact | Dependencies | Pixi 2D? |
|---|---|---|---|---|---|
| A | **Layered 2.5D interiors.** Split each painting into back wall / mid machines / foreground props (AI layer separation, e.g. Canva `separate-image-layers`, or a repaint with alpha). Sort people between mid and front layers so they get occluded, and add 2–4% parallax per layer on camera pan. Paint a matching 3-slot "merged" variant. | L | 5 | New art for 45+ rooms; `people.ts` z-order hook | Yes |
| B | **Normal/depth maps plus dynamic 2D lighting.** Generate normals and depth per painting (Depth-Anything/Marigold, Laigter). A custom Pixi `Filter`/mesh shader takes the 4–8 lights per room from `meta.json`, so flicker and blackout actually shade geometry and people pick up the same light. Replaces the additive blobs. | L | 5 | Shader work, a normal map per image | Yes (WebGL2 filter) |
| C | **Baked 3D source pipeline.** Kit-bash rooms in Blender with one fixed orthographic camera, floor height and scale chart, then render albedo + normal + emission + AO + depth passes and paint over them. This is the most reliable route to "more 3D" and consistent scale and perspective, and the emission pass gives exact glow masks. | XL | 5 | Blender artist; replaces all room art | Yes (output is 2D) |
| D | **Animated machine inserts.** 8–16-frame loops or Spine for the hero prop of each room type: generator pistons, a pump wheel, a pulsing reactor core, scrolling screen data, a sweeping welding arm. Masked `DisplacementFilter` for steam, water and heat haze. | M per type | 4 | Sprite sheets (kit pipeline) or Spine runtime | Yes |
| E | **Emission-mask glows.** Brighten only the painted bright pixels (mask from the painting or the emission pass) instead of overlaying 128 px blobs. Drop cones whose light is already baked into the painting. | S–M | 4 | Mask per image (auto-threshold) | Yes |
| F | **Style and scale bible for regeneration.** One prompt template and style reference, fixed horizon, floor at 0.84 H, door at 65 u, and tier 2 kept warm and painterly ("restored with care", not sci-fi chrome). Regenerate at 2× (960/1440×1044) and load KTX2/high-quality WebP. | M | 4 | Art regeneration; texture memory roughly 4× (on-demand loading already handles this) | Yes |
| G | **Painted construction kit.** Scaffold sprites, tarps, crates and work lights from the kit pipeline. A dissolve/wipe shader reveals the new tier proportional to build progress, with workers welding at painted points. | M | 3 | Kit art | Yes |
| H | **Far LOD.** Below about 0.9 zoom, swap to a simplified, higher-contrast version per room (or apply a stylised posterize/sharpen filter) so the overview reads as clean icons of rooms. | M | 3 | 45 small variants or one filter | Yes |
| I | **Contact shadows and ambient occlusion where people meet the floor and props** (blob shadow plus darkening of the painting under feet). | S | 3 | `people.ts` owner | Yes |

None of this needs a 3D engine. Fallout Shelter-level depth is achievable in Pixi through A+B+D, or through C, which feeds A, B and E for free. Switching to real-time 3D (Three/Babylon) would mean rebuilding all art and the renderer for marginal gain on a fixed side camera.

## 5. Quick wins (≤1 day each)

1. **Add FX spots for all 45 paintings** in `registry.ts` ROOM_FX: canteen pot steam, stove flame `pulse`, purifier bubbles, pump drips, `screen` flicker on every painted monitor, `blink` on panel LEDs, workshop sparks. The system already exists.
2. **Tame the glow on bright tiers.** In `addLight`, scale glow and cone alpha by `1 - balance.lum` and skip cones when lum > 0.35. This removes the white smears.
3. **Fix people scale.** Drop painted people from 1.16 to about 0.95–1.0 (coordinate with the people owner), or crop the paintings tighter.
4. **Masked `DisplacementFilter` heat/steam shimmer** over painted vents and steam in about 6 rooms.
5. **Hide the duplicate structure lamp** when the room painting has its own ceiling lamp (Lighting owner).
6. **Re-export the 3 surviving raw sources at 2×** to measure the sharpness gain before committing to regeneration.

## Big moves

1. **Pipeline C (Blender-baked passes) or F (disciplined regeneration).** Decide this first, because A, B and E depend on what the source art contains.
2. **A: layered interiors with occlusion and merged-width variants.** This is the biggest "not a picture" upgrade.
3. **B: normal-mapped dynamic lighting** driven by the existing power and flicker system.
4. **D: animated hero machines** for the 15 room types.
