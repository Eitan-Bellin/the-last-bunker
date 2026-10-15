# C. World kit assets ("The City Below")

*Asset-pipeline agent, branch `world-redesign`, 2026-10-15. Everything here is procedural (Canvas 2D, seeded by asset id), baked to WebP, no downloads and no generated images. Rerunning the tool gives byte-identical files (checked: two runs, same total).*

## Summary

- **40 files, 550 KB on disk** (budget 2.5 MB, 22% used). If every file were loaded at once the kit would take 32.3 MB of GPU. **The vertical slice (strata 0 and 1) loads 22 files, about 17 MB of GPU** (measured with `worldKitStats()` in the runtime page, mipmaps included). Files load lazily one file at a time, so strata 2-6 cost nothing until they are shown.
- **49 assets**:
  - 7 rock tiles and 7 banding strips (one pair per `KitId`);
  - the cut-edge rim and AO, tape, railing and deck;
  - the Bell Square vault wall and the corridor tile wall;
  - 5 plates (far and back) and the fore lip;
  - 10 structure sprites: 3 blast-door states, a stair flight, 3 rubble piles and 3 timber pieces;
  - 8 lamps and 4 foreground silhouettes.
- **Emissive masks** hold glow on black and are drawn additively. They exist for:
  - the lamps atlas;
  - the far and back plates, at half resolution (windows, doorways, fires, the mast beacon);
  - the caves and core rock;
  - the mines, caves and core bands.
- **Scale.** Sizes follow `rendering/geom.ts` and the brief's scale: **an adult is 48 u** (1.75 m). Stairs use `FLIGHT_RUN 38 x FLIGHT_RISE 36`, and the corridor wall uses `ROOM_H 100`. `tokens.ts` still says an adult is 56 u (`PEOPLE.adultHeight`, style guide section 7). The kit uses 48, as the brief and the game's 2026-10-05 scale pass do. The token needs to be reconciled.

## Files

| Path | What |
|---|---|
| `tools/world/kit-world.html` + `kit-world.ts` | The baker, with a README at the top of the .ts. `?auto` bakes and saves, `?view` shows what is on disk, `&only=` limits which own-file assets are baked. The page shows a contact sheet and a rough slice mock-up. |
| `tools/world/paint.ts` | Painting library. It holds seeded noise, periodic fbm and height-field lighting (normals, cavity AO, specular). It also holds the "one hand" passes:<br>- `pal()`: saturation capped at 45%, 15% pull toward #6A6258;<br>- the shared grain at 12%;<br>- the 1.5 u outline #0A0806 at 85%;<br>- the vertical gradient. |
| `tools/world/recipes-surfaces.ts` | Rock tiles, banding strips, cut edge, tape, railing, deck, hub vault wall, corridor tile. |
| `tools/world/recipes-plates.ts` | Far plates, back plates, fore lip. |
| `tools/world/recipes-sprites.ts` | Doors, stairs, rubble, timber, lamps, fore silhouettes. |
| `tools/world/kit-world-runtime.html` + `.ts` | Runtime check: draws the slice pieces through `worldKit.ts` with Pixi. `?standin` shows only the procedural stand-ins. |
| `src/world/tokensAssets.ts` | **The asset table**, shared by the tool and the game. Per asset: px, pad, ppu, world size, anchor, repeat, layer, strata, tint role, emissive, lamp and glow spots. It also holds the atlas pages and the deterministic packer. |
| `src/art/worldKit.ts` | Runtime: `worldTex`, `worldEmissive`, `worldMeta`, `makeWorldSprite`, `makeWorldTiling`, `worldLamps`, `worldTint`, `preloadWorldKit`, `releaseWorldKit`, `worldKitStats`, `onWorldKitLoaded`, `configureWorldKit`. |
| `public/art/world/*.webp`, `world.json` | The baked kit. `world.json` (frames and byte sizes) is for tools and docs; the game reads the TS table. |

**To regenerate**, open `http://localhost:5176/tools/world/kit-world.html?auto` on the dev server (launch config "world"), or run it headless:
`chrome --headless=new --virtual-time-budget=900000 --dump-dom "http://localhost:5176/tools/world/kit-world.html?auto"`
The page title changes to `WORLD KIT DONE <n> files <bytes>` when it finishes.

Two headless gotchas:
- Encoding uses `toDataURL`, because `toBlob` never calls back under `--virtual-time-budget`.
- Check the runtime page in a real browser: Pixi's image loading also stalls under virtual time.

## How to use it (for level-builder / tech-artist)

```ts
import { makeWorldSprite, makeWorldTiling, worldLamps, preloadWorldKit } from '../art/worldKit';
import { SLICE_ASSETS } from '../world/tokensAssets';
void preloadWorldKit(SLICE_ASSETS);                                  // optional: everything also works before the files arrive
const wall = makeWorldTiling('hub-vault', hubW, 192);                // true texel scale, tiles sideways
const rail = makeWorldTiling('railing', 300, 24, { stratum: 1 });    // tinted with STRATA[1].palette.secondary
const door = makeWorldSprite('door-closed'); door.position.set(x, floorY);    // anchor bottom centre
const glow = makeWorldSprite('lamp-chandelier', { emissive: true });          // additive mask, same placement as the albedo
for (const L of worldLamps('lamp-chandelier', x, ceilY)) lights.add(L.preset, L.x, L.y);
```

- **No code waits on art.**
  - `worldTex(id)` returns the baked texture once it has loaded. Before that, it returns a small procedural stand-in with the right aspect, palette and silhouette, and starts the load.
  - Sprites and tiling sprites made with the helpers swap to the real art by themselves.
  - A missing file keeps its stand-in for good: no retries, no errors.
- **Placement.** Every sprite is drawn at its true world size (frame px / ppu) with the table's anchor. Lamp and glow spots are in world units relative to the anchor. `worldLamps(id, x, y, flip)` returns them in world coordinates, with x and the cone direction mirrored when the sprite is flipped.
- **Stairs.** `stair-flight` is one `FLIGHT_RUN x FLIGHT_RISE` flight. Flights chain by `repeatStep [38, -36]`; mirror with `flip` for the other hand.
- **Tinting.** Only pieces with a `tint` role are neutral bakes meant to be tinted:
  - `railing` by `secondary`;
  - `edge-rim` by `rockRim`;
  - `far-generic` by `farBase`.

  `worldTint(id, stratum)` gives the multiply colour. Everything else carries its own colour: draw it white.
- **Cut edge.** Lay `edge-ao` just inside the cut, with its top edge on the cut line (rotate it for walls). Lay `edge-rim` on the cut at alpha 0.35 (UNIFY.cutEdge).
- **Banding.** Lay `band-<kit>` across the rock tile at seams, or every few hundred units for variety. It is feathered at top and bottom.
- **Plates.**
  - Far and back plates tile sideways and dissolve into transparency at the top.
  - Their window masks are meant to fade with `DAY_NIGHT.farWindowsLit` (0.45 day / 0.85 night) and with the era (`ERA_LIGHT`).
  - `far-generic` is the neutral far plate for strata 2-6.
- **Fore.** `fore-*` and `fore-lip` are baked near-black with a faint warm rim. Draw them **untinted**: the `LAYERS.fore.tint` 0x060708 would erase the rim.
- **Not baked, on purpose:**
  - the contact shadow (UNIFY.contactShadow is a runtime ellipse);
  - the light pools and cones (the lightmap draws them);
  - the door status-lamp glows. The struct atlas has no emissive twin, which saves 2 MB of GPU. Instead the door rows carry `emergency` / `signal` lamp spots, and the preset's halo draws the glow.

## Look

- **One hand with the painted rooms.** The kit shares the rooms' look:
  - lit height fields on the rock, the vault wall and the corridor tile;
  - the shared 12% grain;
  - saturation capped at 45% and pulled toward the painting grey;
  - the 1.5 u outline on every made object.
- **Painted sources re-used.** The vault wall and the rubble use the painted kit concrete (`public/art/kit/wall-L.webp`) as luminance detail, and the doors use the painted hand wheel (`kit/wheel.webp`). Stains and texture therefore match the Canva kit.
- **Exceptions to the 45% cap**, kept small. Warning paint and brass must read at map zoom.
  - hazard yellow (tape, door jambs, stair nosings): 55-62%;
  - brass (chandelier, sconce): 50%;
  - copper vein: 60%.
- **Checked visually** in three places:
  - the contact sheet (`?view`);
  - the slice mock-up on the tool page;
  - the Pixi runtime page in the built-in browser (22 files loaded, 0 failed, and the stand-in mode too).

## Inventory (assets)

World sizes are in world units (the content, without the transparent padding). Bytes are the WebP file sizes, with `e` for the emissive mask; atlas items share their page.

| id | px (frame) | world (u) | ppu | bytes | repeat | strata | purpose |
|---|---|---|---|---|---|---|---|
| `rock-surface` | 512x512 | 400 x 400 | 1.28 | 17,236 | xy | 0 | Rock cut-face tile, seamless both ways. ash soil with roots, charcoal and pebbles: the cut face at and just under the ground. |
| `rock-shelter` | 512x512 | 400 x 400 | 1.28 | 14,102 | xy | 1 | Rock cut-face tile, seamless both ways. warm clay with laminae, gravel lenses and rootlets: the Upper Shelter cut face. |
| `rock-works` | 512x512 | 400 x 400 | 1.28 | 25,860 | xy | 2 | Rock cut-face tile, seamless both ways. sandstone beds and gravel: the Service Network cut face. |
| `rock-metro` | 512x512 | 400 x 400 | 1.28 | 22,022 | xy | 3 | Rock cut-face tile, seamless both ways. grey granite blocks, joints and mica: the Old Metro cut face. |
| `rock-mines` | 512x512 | 400 x 400 | 1.28 | 22,342 | xy | 4 | Rock cut-face tile, seamless both ways. wet basalt, columnar joints, copper veins and gold flecks: the Mines cut face. |
| `rock-caves` | 512x512 | 400 x 400 | 1.28 | 24,898 + 1,342 e | xy | 5 | Rock cut-face tile, seamless both ways. violet-black rock with flowstone drapes and crystal flecks (emissive): the Deep Caves cut face. |
| `rock-core` | 512x512 | 400 x 400 | 1.28 | 12,410 + 2,400 e | xy | 6 | Rock cut-face tile, seamless both ways. near-black bedrock with magma-lit cracks (emissive): the Core cut face. |
| `band-surface` | 512x128 | 400 x 100 | 1.28 | 17,268 | x | 0 | Strata banding strip laid across the rock tile (feathered top and bottom): charcoal and ash layer. |
| `band-shelter` | 512x128 | 400 x 100 | 1.28 | 16,774 | x | 1 | Strata banding strip laid across the rock tile (feathered top and bottom): gravel lens and contact line. |
| `band-works` | 512x128 | 400 x 100 | 1.28 | 19,718 | x | 2 | Strata banding strip laid across the rock tile (feathered top and bottom): thick cross-bedded sandstone bed. |
| `band-metro` | 512x128 | 400 x 100 | 1.28 | 19,820 | x | 3 | Strata banding strip laid across the rock tile (feathered top and bottom): pale quartz vein band. |
| `band-mines` | 512x128 | 400 x 100 | 1.28 | 20,172 + 998 e | x | 4 | Strata banding strip laid across the rock tile (feathered top and bottom): ore seam: copper green and rust. |
| `band-caves` | 512x128 | 400 x 100 | 1.28 | 22,858 + 1,322 e | x | 5 | Strata banding strip laid across the rock tile (feathered top and bottom): calcite flowstone ledge (emissive crystals). |
| `band-core` | 512x128 | 400 x 100 | 1.28 | 17,238 + 1,282 e | x | 6 | Strata banding strip laid across the rock tile (feathered top and bottom): magma-lit fissure band (emissive). |
| `edge-rim` | 256x16 | 128 x 8 | 2 | 2,404 | x | all | Cut-edge light rim (white, ragged, chipped): tint with the stratum rockRim, alpha 0.35 (UNIFY.cutEdge). Anchor sits on the cut line. Tint: `rockRim`. |
| `edge-ao` | 256x32 | 128 x 16 | 2 | 3,038 | x | all | Cut-edge ambient occlusion band (black, ragged edge, 14 u falloff). Top edge on the cut line; rotate for walls and ceilings. |
| `tape` | 256x24 | 128 x 12 | 2 | 4,004 | x | all | Caution tape: hazard yellow and black, twisting, dirty. Stretch between posts across a blocked tunnel. |
| `railing` | 256x48 | 128 x 24 | 2 | 2,722 | x | 1-6 | Balcony / walkway railing (neutral enamel, tint per stratum): top rail, mid rail, posts every 64 u, kick plate, 1.5 u outline. Anchor on the deck line. Tint: `secondary`. |
| `deck` | 256x64 | 128 x 32 | 2 | 3,002 | x | 1-6 | Balcony / bridge deck: grating lip, riveted channel face, brackets every 64 u, soffit shadow. Anchor at the walking line. |
| `hub-vault` | 512x512 | 192 x 192 | 2.67 | 46,742 | x | 1 | Bell Square back wall: one 192 u bay of board-formed concrete, a recessed arch, enamel green dado, cream upper paint, pilasters at the seams. Tiles sideways; stack per storey. |
| `corridor-tile` | 256x256 | 100 x 100 | 2.56 | 17,292 | x | 1, 2 | Service corridor wall: cream subway tile over a green dado, cap band, skirting, grime and water streaks, chipped tiles. One room-height (100 u) repeat. |
| `far-shelter` | 1024x512 | 2048 x 1024 | 0.5 | 6,062 + 3,714 e | x | 1 | Far plate, Upper Shelter: distant cavern cliffs with terraced dwellings on ledges and a colossal pillar. Windows in the emissive mask (fade it 0.45 day / 0.85 night). |
| `far-generic` | 1024x512 | 2048 x 1024 | 0.5 | 22,466 + 3,900 e | x | 2-6 (generic) | Far plate, generic (strata 2-6): neutral cliffs, pillars and a few window clusters; tint toward the stratum farBase, emissive tinted by its key light. Tint: `farBase`. |
| `back-shelter` | 1024x512 | 1536 x 768 | 0.667 | 11,734 + 1,856 e | x | 1, 2 | Back plate: tiers of galleries with railings, arches, doorways and pipe runs (the view through the hub window). Doorways and windows glow in the mask. |
| `back-pipes` | 1024x256 | 1536 x 384 | 0.667 | 14,872 | x | 1-6 | Back plate: pipe rack with valves, flanges, supports and cable trays (behind corridors and galleries), painted steel with red valve wheels; transparent around it. |
| `back-surface` | 1024x256 | 2048 x 512 | 0.5 | 11,306 + 1,358 e | x | 0 | Back plate, surface: the ruined skyline (broken blocks, a radio mast with a red beacon, a few fires in windows) sitting on the horizon. |
| `fore-lip` | 1024x128 | 1024 x 128 | 1 | 4,954 | x | all | Foreground ragged rock lip (baked near-black with a faint warm rim; draw untinted). Anchor on its top edge; flip vertically for a floor lip. |
| `door-closed` | 180x228 | 56 x 72 | 3 | in `atlas-struct` | none | all | Blast door, closed: riveted enamel-green leaf worn to steel, hand wheel, hazard-banded frame, red status lamp above. Anchor bottom centre. |
| `door-open` | 180x228 | 56 x 72 | 3 | in `atlas-struct` | none | all | Blast door, open: the leaf swung back edge-on, the dark passage beyond, teal status lamp. Same frame as closed. |
| `door-welded` | 180x228 | 56 x 72 | 3 | in `atlas-struct` | none | all | Blast door, welded shut: closed leaf with crossed steel straps, weld beads and scorch; the status lamp is dead. |
| `stair-flight` | 126x120 | 38 x 36 | 3 | in `atlas-struct` | none | 1-6 | One steel stair flight (FLIGHT_RUN 38 x FLIGHT_RISE 36): channel stringer, 6 grated treads with lit nosings. Chain by repeatStep; scale.x = -1 for the other hand. |
| `rubble-a` | 204x90 | 64 x 26 | 3 | in `atlas-struct` | none | all | Rubble pile, small: concrete chunks and dust. Anchor bottom centre. |
| `rubble-b` | 300x120 | 96 x 36 | 3 | in `atlas-struct` | none | all | Rubble pile, medium: slabs, chunks, a bent rebar. |
| `rubble-c` | 396x162 | 128 x 50 | 3 | in `atlas-struct` | none | all | Rubble choke, large: broken slab, rebar, blocks, plank ends (the blocked tunnel). |
| `timber-set` | 204x228 | 64 x 72 | 3 | in `atlas-struct` | none | 1, 4 | Timber set: two posts and a cap beam with iron straps and wedges (tunnel support). Anchor bottom centre. |
| `timber-planks` | 180x60 | 56 x 16 | 3 | in `atlas-struct` | none | 0, 1, 4 | A stack of rough planks on the ground. |
| `timber-beam` | 300x72 | 96 x 20 | 3 | in `atlas-struct` | none | 1, 4 | A broken timber beam, snapped at one end, lying across rubble. |
| `lamp-tube` | 156x36 | 48 x 8 | 3 | in `atlas-lamps` (+e) | none | all | Caged fluorescent fixture, ceiling-mounted (anchor top centre). Use preset failingTube for the one bad tube per corridor. |
| `lamp-chandelier` | 312x264 | 100 x 84 | 3 | in `atlas-lamps` (+e) | none | 1 | Bell Square brass ring chandelier hanging from its chain (anchor at the ceiling hook): 6 visible bulbs, the hub lamp. |
| `lamp-bulb` | 30x42 | 6 x 10 | 3 | in `atlas-lamps` (+e) | none | all | One string-light bulb in its socket (anchor at the wire). Hang along a catenary. |
| `lamp-work` | 102x252 | 30 x 80 | 3 | in `atlas-lamps` (+e) | none | all | Work flood lamp on a tripod pole (dig faces, the ramp, building sites). Anchor at the feet. |
| `lamp-cage` | 48x60 | 12 x 16 | 3 | in `atlas-lamps` (+e) | none | all | Caged bulkhead lamp on a wall bracket (anchor at the wall plate). Ramp and tunnels. |
| `lamp-wall` | 54x54 | 14 x 14 | 3 | in `atlas-lamps` (+e) | none | 1 | Brass wall sconce with a glass shade (balcony backs, the vault pilasters). |
| `lamp-beacon` | 42x42 | 10 x 10 | 3 | in `atlas-lamps` (+e) | none | 0, 1 | Red emergency beacon (the hatch frame, the ramp threshold). Anchor at its base. |
| `lamp-lantern` | 42x60 | 10 x 16 | 3 | in `atlas-lamps` (+e) | none | all | Hand lantern (hung by its bail, anchor at the hook; set it on the ground with anchor y = 1). |
| `fore-outcrop` | 333x258 | 260 x 200 | 1.25 | in `atlas-fore` | none | all | Foreground rock outcrop rising from the bottom edge. |
| `fore-pipes` | 83x483 | 60 x 380 | 1.25 | in `atlas-fore` | none | 1-6 | Foreground pair of vertical pipes with flanges and a clamp (hang from the top). |
| `fore-cable` | 608x96 | 480 x 70 | 1.25 | in `atlas-fore` | none | all | Foreground sagging cable bundle, ends at the anchor (0,0) and (480,0). |
| `fore-pipe-h` | 608x71 | 480 x 50 | 1.25 | in `atlas-fore` | none | 1-6 | Foreground horizontal pipe pair with flanges and hangers. |

## Inventory (files and GPU memory)

GPU = width x height x 4 bytes, plus a third when mipmapped. Plates and emissive masks skip mipmaps (`worldKit.ts`).

| file | px | KB | GPU MB | mips |
|---|---|---|---|---|
| `atlas-fore.webp` | 1024x512 | 13.9 | 2.67 | yes |
| `atlas-lamps.webp` | 512x512 | 26.3 | 1.33 | yes |
| `atlas-lamps-e.webp` | 512x512 | 2.8 | 1.00 | no |
| `atlas-struct.webp` | 1024x512 | 75.5 | 2.67 | yes |
| `back-pipes.webp` | 1024x256 | 14.5 | 1.00 | no |
| `back-shelter.webp` | 1024x512 | 11.5 | 2.00 | no |
| `back-shelter-e.webp` | 512x256 | 1.8 | 0.50 | no |
| `back-surface.webp` | 1024x256 | 11.0 | 1.00 | no |
| `back-surface-e.webp` | 512x128 | 1.3 | 0.25 | no |
| `band-caves.webp` | 512x128 | 22.3 | 0.33 | yes |
| `band-caves-e.webp` | 256x64 | 1.3 | 0.06 | no |
| `band-core.webp` | 512x128 | 16.8 | 0.33 | yes |
| `band-core-e.webp` | 256x64 | 1.3 | 0.06 | no |
| `band-metro.webp` | 512x128 | 19.4 | 0.33 | yes |
| `band-mines.webp` | 512x128 | 19.7 | 0.33 | yes |
| `band-mines-e.webp` | 256x64 | 1.0 | 0.06 | no |
| `band-shelter.webp` | 512x128 | 16.4 | 0.33 | yes |
| `band-surface.webp` | 512x128 | 16.9 | 0.33 | yes |
| `band-works.webp` | 512x128 | 19.3 | 0.33 | yes |
| `corridor-tile.webp` | 256x256 | 16.9 | 0.33 | yes |
| `deck.webp` | 256x64 | 2.9 | 0.08 | yes |
| `edge-ao.webp` | 256x32 | 3.0 | 0.04 | yes |
| `edge-rim.webp` | 256x16 | 2.3 | 0.02 | yes |
| `far-generic.webp` | 1024x512 | 21.9 | 2.00 | no |
| `far-generic-e.webp` | 512x256 | 3.8 | 0.50 | no |
| `far-shelter.webp` | 1024x512 | 5.9 | 2.00 | no |
| `far-shelter-e.webp` | 512x256 | 3.6 | 0.50 | no |
| `fore-lip.webp` | 1024x128 | 4.8 | 0.67 | yes |
| `hub-vault.webp` | 512x512 | 45.6 | 1.33 | yes |
| `railing.webp` | 256x48 | 2.7 | 0.06 | yes |
| `rock-caves.webp` | 512x512 | 24.3 | 1.33 | yes |
| `rock-caves-e.webp` | 256x256 | 1.3 | 0.25 | no |
| `rock-core.webp` | 512x512 | 12.1 | 1.33 | yes |
| `rock-core-e.webp` | 256x256 | 2.3 | 0.25 | no |
| `rock-metro.webp` | 512x512 | 21.5 | 1.33 | yes |
| `rock-mines.webp` | 512x512 | 21.8 | 1.33 | yes |
| `rock-shelter.webp` | 512x512 | 13.8 | 1.33 | yes |
| `rock-surface.webp` | 512x512 | 16.8 | 1.33 | yes |
| `rock-works.webp` | 512x512 | 25.3 | 1.33 | yes |
| `tape.webp` | 256x24 | 3.9 | 0.03 | yes |

**Total: 40 files, 550 KB.** If every file were loaded, the GPU would hold 32.3 MB. The slice set (`SLICE_ASSETS`) is 22 files, about 17 MB.

## Perf notes and options

- **Plates are the heavy part of the slice on the GPU.** Far, back and surface together take 6.75 MB with their masks. On Low, `LAYERS` already drops the far plane; the level builder can also skip `far-shelter` there and save 2.5 MB.
- **Lite mode.** Call `configureWorldKit({ mipmaps: false })` before the first load. That takes a quarter less memory on the mipmapped files.
- **Unloading.** When a stratum leaves the view for good, `releaseWorldKit(worldAssetsForStratum(s))` unloads its files. Atlas pages stay as long as another loaded asset uses them.
- **Power of two everywhere.** Tiles are 512 or 256, strips 256, 512 or 1024 wide, and atlas pages 1024x512 and 512x512. Mipmaps and repeat wrap therefore also work on WebGL1 phones.

## Open items

- **Adult height token.** `tokens.ts` says 56 u; the brief and the game say 48 u. One value is needed.
- **Hero kits for strata 2-6** are not in this pass: the pipe manifold, the metro sign, the headframe, crystals and the vault ring door. Those strata get the generic set for now:
  - their own rock and band;
  - `far-generic` and `back-pipes`;
  - the neutral structure pieces.
- **Window masks light every window at once.** Lighting the far plates window by window with the era would need a per-window rank channel and a small filter. Not done.
