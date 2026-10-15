# C — Render notes: lightmap, fog, parallax (tech-artist, phase 1)

*Branch `world-redesign`, 2026-10-15. Only new files were added; nothing existing was edited or committed.*

Shots (lab, 1600×900, DPR 1, real UHD 630 via headless Chrome):
- `shots/C-lab-overview.png`: Medium, zoom 1, hub + vestibule + district.
- `shots/C-lab-district-edge.png`: High, zoom 1.6, district rooms, the unpowered lab's emergency lamp, the dark edge with its cold tease.
- `shots/C-lab-zoomout-fog.png`: Medium, zoom 0.55, the 'known' dig face, the hidden pocket with its crystal tease, the hidden stratum-2 cavern.

## 1. Files

| File | What it does |
|---|---|
| `src/world/render/CityRenderer.ts` | The facade: `mount`, `setLayout`, `setAreaState`, `setTier`, `setRooms`, `selectRoom`, `addLight` / `removeLight` / `moveLight` / `setLightOn`, `setEra`, `reveal`, `areaAt`, `bounds`, `update`, `renderLightmap`, `onContextRestored`, `destroy`. Also `parallaxFromWorld()`. |
| `src/world/render/LightmapFilter.ts` | Multiply-keep-alpha in a shader (`rgb = src * light * gain`, `a = src.a`), with a highlight shoulder. Two screen-UV modes: `global` (Pixi 8 `uGlobalFrame`, nested-safe, default) and `area` (fallback: `filterArea` pinned to the screen). `resolution: 'inherit'`. |
| `src/world/render/lighting.ts` | `Lighting`: the off-stage `lightRoot` → light texture; light cells, budget, fade, flicker, room readability floors, glow layer (halos, cones, lit motes), tease layer. Shared generated textures (`cityTextures`). |
| `src/world/render/fog.ts` | `FogLayer`: area polygons → fog texture, states tween, reveal brushes, breathing halos, mottling. |
| `src/world/render/layers.ts` | `ParallaxPlane`: counter-transform, zoom/tier visibility, cached bake (Medium), merged bake (Low). |
| `src/world/render/backdrop.ts` | Procedural far / back / mid / fore content per stratum (chunked), live train and lifts. |
| `src/world/render/chunks.ts` | Generic `ChunkManager` (512² chunks, at most N builds per frame, park after 8 s). Generalised from `frontChunks.ts`. |
| `src/world/render/layoutTypes.ts` | `HubGeom`, `CityArea`, `Cavity`, `EdgeSite`, `CityLayout`, exactly as in the architecture (1.3). `Rect`, `StratumFrame` and `StratumId` are re-exported from C0's `src/world/types.ts`. When the level-builder moves the layout shapes into `types.ts`, this file becomes re-exports. |
| `src/world/tokensRender.ts` | Render-only tokens: lightmap encoding (gain 2), shoulder, depth-ramp gain, room-lamp gain, LOD, the `lite` tier, the per-tier switches, fog presentation, backdrop dressing. Art direction stays in `tokens.ts`, which was not edited. |
| `tools/world/render-lab.html` / `.ts` | The lab: a fake layout, 13 painted rooms, 12 walkers (2 with lanterns), 111 lights, a nested parent filter like PostFX. Hooks are on `window.__lab`. |

Hard rules, checked:
- Every Filter uses `resolution: 'inherit'` (LightmapFilter, fog BlurFilter, the lab's ColorMatrix).
- Colours, intensities and sizes come from `tokens.ts` or `tokensRender.ts`. The only exceptions are the procedural shape constants of the backdrop silhouettes.
- Per-tier light caps follow `LIGHT.budget` (96/56/28), plus 12 slack slots for fading out.
- The per-frame paths do not allocate:
  - culling runs on fields, with no closures;
  - sprites are pooled;
  - candidates go in a reused array.
- The lightmap, fog and glow are skipped while the map covers (zoom < `CAMERA.zoom.far` or `mapCovers`).
- Context loss: `onContextRestored()` rebuilds the light texture, the fog texture and the plane caches. It is tested in the lab with `WEBGL_lose_context`: no errors, and the picture comes back.
- No Pixi Text anywhere.

## 2. How it works

**Layer stack.** `mount(world)` puts these into worldContainer:
- at the bottom: `far`, `back`;
- on top, in this order: `litGroup` (mid plane, then `playLayer`), `glowLayer`, `fogLayer`, `teaseLayer`, `fore`.

Each of them is a render group. The host slots its own layers between them (section 4).

**Parallax.** A plane's content is authored in plane units: a world point (x, y) sits at (x·p, y·p).
- Scale inside worldContainer: `k = z^(p·c − 1)`. With c = `zoomCoupling` = 1 this is the architecture's `z^(p−1)`.
- Position: `cam·(1 − p·k)`.
- `cam` is the world point at the screen anchor: the camera centre.

**Light texture, every frame** (Medium: 0.35× screen = 560×315 at 1600×900):
1. Clear to `LIGHT.sectionFill`.
2. Stratum ambient bands: each is the hue of `ambient` at `ambientLevel` × era. The bands cross-fade over 60 u at the seams, which gives the depth-graded darkness.
3. `LIGHT.depthRamp`, measured from the ground line and scaled by `depthRampGain` 0.3.
4. Room readability floors, drawn with `'max'` blend as feathered nine-slices (18 u feather). The values come from `roomFloorLight()`. The selected room eases in +0.15 over 0.2 s.
5. Pools, additive, with the pool texture baked from `poolFalloff` (the single curve).

Values are stored at ½ and the filter doubles them, so a pool can overexpose to 2×. The filter then applies a shoulder above 1.

**Budget.**
- Static lights live in 256 u cells. Moving lights (lanterns) sit in a separate list.
- Culling covers the view plus the largest radius.
- Ranking: room lamps first, then by distance to the view centre.
- The top `LIGHT.budget[tier]` lights fade in, and the rest fade out over 0.4 s.
- Flicker follows `LIGHT.flicker` and `flickerTiers`. A kind that does not animate holds its mean (`FLICKER_MEAN`).
- Low redraws the light texture at most 15 times a second while the camera is still.

**Rooms.** `setRooms(rooms, extraFloors)` takes `{id, x, y, w, h, state, lamps, area}`. The lamps are the `meta.json` spots.
- Each lamp becomes a pool:
  - radius = `roomLamp.radius × clamp(r/0.15, 0.4, 1)`;
  - intensity × `roomLampGain` 0.55.
- The main lamp also gets a corridor spill at `LIGHT.roomSpill`.
- Unpowered rooms get one `emergency` lamp instead.
- Call `setRooms` when the rooms change, not every frame.

**Glow.** Halo diameter = `halo × radius`, with alpha `LIGHT.lightmap.glow × glowGain`. Cones only at zoom ≥ 0.85 and on tiers where `DETAIL.cones` is on. Motes: `DETAIL.motes` sprites, lit by the pools they drift through and tinted by the strongest one.

**Fog.**
- **Texture:** one texel per `FOG.cell`, upscaled bilinear. The area mask is blurred by `softCells`.
- **States:**
  - hidden: `undiscovered` (0.94 near-black), mottled by drifting noise;
  - glimpsed: the `known` memory look (darken 55% plus the cool wash, folded into one overlay colour and alpha). An `edge` area instead starts `hintStart` open;
  - digging: the glimpsed look × (1 − progress);
  - revealed: clear.
- **Changes:** a state change tweens over 0.9 s with out-cubic easing. `reveal()` adds a growing erase brush.
- **Halos:** 2 / 1 / 1 / 0 by tier.
- **Redraws:** the texture is redrawn only on change, or at 30 / 15 / 0 Hz for the drift.
- **Lights:** lights whose `area` is hidden are dark. Tease halos sit above the fog at `FOG.teaseAlpha`.

**Caching.**
- Medium bakes far and back into their own screen-sized textures (15% overscan).
- A plane is re-baked when it has moved 24 px or the zoom has changed 4%, at most every 0.12 s. It is re-baked at once if the overscan runs out.
- The baked sprite lives inside the plane's own container, so between bakes it keeps exact parallax.
- Low bakes far into back's texture ("merged"). Lite has no planes, no lightmap and no glow; the lit group gets a flat `liteTint`.

## 3. Performance (lab, 1600×900, DPR 1, Intel UHD 630, ANGLE D3D11, headless Chrome with GPU, `EXT_disjoint_timer_query_webgl2`, 120 frames each, nested parent filter on)

How it was measured:
- **Light pass:** the light texture render on its own.
- **Filter:** the frame with the LightmapFilter minus the frame without it. This covers the group's intermediate texture plus the full-screen multiply.
- **Lightmap:** light pass + filter.

| Tier / view | Lights drawn / in view | Light pass med (p95) | Filter | **Lightmap total** | Lab frame on / off | Fog share | CPU update med (p95) |
|---|---|---|---|---|---|---|---|
| **Medium**, z 1 (hub + district) | 56 / 93 | 0.42 (0.59) ms | 0.87 ms | **1.30 ms** | 4.36 / 3.48 ms | 0.76 ms | 0.5 (1.4) ms |
| Medium, z 1.25 (hub) | 56 / 82 | 0.46 (0.63) ms | 0.94 ms | **1.40 ms** | 4.57 / 3.64 ms | 0.88 ms | 0.4 (0.9) ms |
| High, z 1 | 93 / 93 | 1.01 (1.09) ms | 0.93 ms | **1.94 ms** | 6.46 / 5.53 ms | 0.73 ms | 0.9 (2.0) ms |
| Low, z 1 | 28 / 93 | 0.12 (0.13) ms | 0.51 ms | **0.64 ms** | 3.71 / 3.19 ms | 0.82 ms | 0.1 (0.3) ms |

**Target met:** the lightmap pass is under 2 ms GPU at Medium with 56 lights (more than the ~40 asked) plus fog: 1.30 ms. High, with 93 lights at the 0.5× light texture, is at 1.94 ms. Rerun with `node <scratchpad>/lab-cdp.mjs probe "" bench.js`; the script calls `__lab.bench(120)` per tier.

**Next optimisations, if phones need them:**
- **Fog:** about 0.8 ms, because it is 2 to 3 full-screen blends. Clip the fog sprite to the bounding box of the non-revealed areas, and drop the halo copy on Medium.
- **Filter:** about 0.9 ms. Its intermediate texture covers the whole lit group; `filterArea` = screen ('area' mode) caps it at the screen size even when the group is larger.

## 4. Integration plan for BunkerRenderer (phase 2, behind `?city`, classic untouched)

Line numbers are for `src/rendering/BunkerRenderer.ts` at commit bd4fdcf.

1. **Construct.**
   - Add a `city: CityRenderer | null` field.
   - In `init()`, after `app.init` (l.459-482) and `watchContext` (l.483), when `CITY` (from `src/world/flag.ts`) is true:
     ```ts
     new CityRenderer({ renderer: this.app.renderer, tier: isLiteMode() ? 'lite' : startQuality(), canvas })
     ```
   - Classic keeps `city = null` and every path below is skipped, so the compare stays at zero diff.
2. **Mount, l.485-492** (the `worldContainer.addChild(...)` list).
   - In city mode:
     - call `city.mount(this.worldContainer)` first;
     - put `undergroundHolder, bayHolder, roomLayer, shaftHolder, utilitiesHolder, walkers.layer` into `city.playLayer` instead of the worldContainer, keeping that order;
     - add `surfaceHolder` and the `projectSites.*` layers at index 2, just after the back plane.
   - Then reorder the host's layers around the city's ones:
     - `slotLayer` and `highlightLayer` go right after `city.litGroup` (they are never darkened);
     - `dust.container`, `fxLayer`, `incidents.fx`, `disasterFx.fx`, `digHolder`, `districtSignHolder` and `wingSigns.container` go between `city.glowLayer` and `city.fogLayer`;
     - `labelLayer`, `incidents.badges`, `ghost.layer` and the city map stay last, after `city.planes.fore.container`.
   - `this.worldContainer.filters = [this.grade]` (l.495) and the `PostFX` constructor (l.515) stay as they are. The LightmapFilter is nested under the composite, and the `global` UV mode handles that; the lab tests exactly this case.
3. **Render groups, l.528.**
   - Do not mark `undergroundHolder`, `roomLayer` and the rest as render groups when they sit inside `litGroup`. A render group inside a filtered container still works in Pixi 8, but keep the list as it is and check with the `?perf` probe.
   - `city.mount` already marks its own layers.
4. **Layout, `rebuildStructure()` (l.615).**
   - In city mode, skip `buildUnderground`/`buildCasing` (l.635). Build the level-builder's `shell/*` into `undergroundHolder` instead.
   - Call `city.setLayout(buildCityLayout(state))` whenever `cityLayoutSig(state)` changes.
   - Area-only changes (the `city:seen` events, dig progress) go through `city.setAreaState(id, state, progress)`.
5. **Rooms.**
   - Room shapes and lamps change only with the structure signature, so make one `city.setRooms(...)` call per structure rebuild and pass the hall and vestibule walkway strips as the `extra` floor rects (value `LIGHT.read.walkway`).
   - Power and occupancy change faster, so call `setRooms` again when this cheap signature changes: `LAYOUT.rooms` (perfFx) + `powerRatio < 0.05` + the working/idle state of each room.
   - Room lamps come from `ArtLibrary.lightsFor(entry)` (the same spots as `paintedRoom.ts`).
   - When the selection changes, call `city.selectRoom(this.selectedId)`.
   - At l.1080, the city lights replace the `roomLight` colour map only for the people tint (step 8).
6. **Every frame, `updateScene()` (l.1322).**
   - After `renderPeople` (l.1349), lantern walkers move their lights: `city.moveLight(id, x, y)`.
   - Right before `this.postfx?.update(now)` (l.1416) every camera and position write for the picture is done, so call:
     ```ts
     const v = this.cam.view;
     pi.cx = v.x; pi.cy = v.y; pi.z = wc.scale.x; pi.ox = wc.x; pi.oy = wc.y; pi.sw = screen.width; pi.sh = screen.height;
     this.city.setTier(isLiteMode() ? 'lite' : (this.postfx?.quality ?? 'high'));
     this.city.update(pi, this.time, dt, { mapCovers: this.mapCovers });
     ```
     Notes on these values:
     - `pi` is a reused object.
     - `cam.view` carries the anchor (`width/2`, `viewCY()`).
     - `wc.scale` includes the punch zoom, and `wc.x`/`wc.y` include the shake. Camera-nav's `parallaxInfo()` can replace the first line later.
   - `draw()` (l.1310) needs no change: the light texture is already rendered inside `update`, before `app.render()`.
7. **LOD, `updateLod()` (l.1429).**
   - `mapCovers` (l.1458) is passed straight through.
   - In city mode, also hide `city.litGroup` while the map covers, as is done today for `bayHolder` and `utilitiesHolder`.
8. **People.**
   - In city mode, the lamp-pool tint (l.966-971) becomes `PEOPLE.minLight` / rim only. The lightmap now lights the people, because `walkers.layer` and the room people are inside `litGroup`.
   - Survivors in dark spots: `city.lighting.lightAt(x, y)` gives the light value for the self-light lift (`PEOPLE.darkThreshold`).
9. **Context, `watchContext()` (l.1131).**
   - The city listens to `webglcontextrestored` itself when it is given the canvas.
   - If the host prefers to control the order, call `this.city?.onContextRestored()` after `recoverGraphics()` (l.1145) instead.
10. **Snapshots (`share.ts` l.98, `extract.canvas({ target: stage, frame })`).**
    - Extracting renders into a new root target, so the `global` UV would read the light texture against the extract frame.
    - Before extracting, call `city.setUvMode('area')`, then `city.update(...)` and `city.renderLightmap(t)` at the extract frame's camera. Switch back to `global` afterwards.
    - Alternative: hide `litGroup.filters` for the share picture.
11. **Dust.** `atmosphere`/`Dust` can stay. Above them, the city motes are the lit dust from the style guide. On High, consider dropping `Dust` when the city is on, to avoid double particles.
12. **Postfx city grade** (owned by the tech-artist, a separate step): no change is needed for the lightmap to work. The stratum grade can ride on `postfx` later.

**Integration risks.**
- **Texture pool size.** The filter takes an intermediate texture the size of the lit group's bounds. These are clipped to the viewport, so they are never larger than the screen.
- **Pixi 'max' blend.** It is native GL (`gl.MAX`); WebGL2 always has it.
- **First frame of a cached plane.** It shows the live content until its first bake (about 1 frame).

## 5. Decisions taken (and conflicts resolved)

- **Light texture scale: the tokens win.** `LIGHT.lightmap.scale` gives 0.5 / 0.35 / 0.25. Architecture section 5 says 0.5 / 0.5 / 0.35. Medium at 0.35 measured well under budget.
- **`litRes`** (architecture tier table 1 / 1 / 0.75) is not applied. The rule that every Filter uses `'inherit'` wins. If Low needs it, lower PostFX's resolution instead.
- **Depth ramp.** At full strength it lit all of stratum 1 to about 0.9 and drowned the lamps. It now starts at the ground line and is scaled by `depthRampGain` 0.3. The style guide's numbers are kept in `tokens.ts`.
- **Room lamps** run at × 0.55 on top of the 0.70 floor. At full preset intensity, working rooms rendered at about 1.7× their painted exposure.
- **Ambient.** The stratum `ambient` colour is read as a hue, normalised to its brightest channel, and `ambientLevel` sets the strength. Read literally (`0x40382F × 0.34`), the rock would have been at about 3%.
- **Highlight shoulder** (`shoulder` 1.6): a hub full of overlapping pools glows instead of clipping to white.
- **Not done yet:**
  - the "known" state's 70% desaturation (the fog is an overlay, so the darken and the cool wash are approximated);
  - the warm rim on the undiscovered edge;
  - the god-ray;
  - the people's rim light. That one is life-systems' job; `lightAt()` is their hook.
