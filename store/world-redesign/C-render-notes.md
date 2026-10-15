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

## Phase 2: game integration (tech-artist, branch `world/c1-T`, 2026-10-15)

Everything below runs only with `?city` (`CITY` from `src/world/flag.ts`). Classic mode builds no city object and takes no new code path (see "Classic parity").

### What was built

| File | Change |
|---|---|
| `src/world/render/cityHost.ts` (new) | The glue between BunkerRenderer and CityRenderer: mounts the layer stack, syncs the layout, mounts the shell, feeds the rooms to the lightmap, runs the city frame, and wraps `renderer.extract` for snapshots |
| `src/world/render/citySeams.ts` (new) | The two seams (below) |
| `src/world/render/stubLayout.ts` (new) | The default layout provider |
| `src/world/render/CityRenderer.ts` | `beginSnapshot` / `endSnapshot` switch to the 'area' UV mode for extracts; the planes are hidden while the map covers |
| `src/world/render/layers.ts`, `tokensRender.ts` | `TIER_RENDER.planeRes`: the far and back caches render at 0.5x density on Medium and Low. Also adds `PEOPLE_RENDER.cityAmbient` |
| `src/world/render/backdrop.ts` | Far lifts: all rails go in one Graphics, all car dots after it. That is 2 draw calls; it was 2 per lift (32 at e55) |
| `src/rendering/BunkerRenderer.ts` | Adds `mountCity()`, `syncCityLayout()`, `updateCity()` and the shell seam in `rebuildStructure()`. Also the people tint, the incident and blocker floor rects, and Dust off. All of it sits behind `this.cityHost` |
| `src/rendering/shaft.ts` | `buildShaft2(..., spineOnly)`, detailed below |
| `src/rendering/postfx.ts` | `CITY_NIGHT_GRADE.underground` 0.45: in city mode the composite's underground night mood runs at 45%, because the lightmap carries the civic night |

What `spineOnly` changes in `buildShaft2`:
- it drops the back wall, the grime, the side shadows, the airy spine glow and the daylight cone;
- the rails and the landing frames become texture fills of one Graphics instead of TilingSprites;
- the gate leaves lose the highlight pass and the rivets, which keeps them under Pixi's batchable-geometry limit;
- result: the landings went from 55 draw calls to 4 at e55.

`cityMap.ts` needed no change for C.

### The 12 steps, as done

1. **Construct.** When `CITY` is set, `init()` calls `mountCity(canvas)`, which runs `new CityHost(renderer, isLiteMode() ? 'lite' : startQuality(), canvas)`.
2. **Mount.** `worldContainer` holds, in order:
   - far, back;
   - surface and the 5 project-site layers;
   - `city:lit` { mid, play { underground, bays, rooms, shaft, *shellFront*, utilities, walkers } };
   - slots, highlight;
   - `city:glow`;
   - dust, fx, incidentFx, disasterFx, dig, districtSign, wingSigns;
   - `city:fog`, `city:tease`, fore;
   - cityMap (inserted before labels, as before);
   - labels, badges, ghost.

   `mountSurface2` is handed `undergroundHolder.parent`, so the soil and the surface front land inside the lit group. In classic mode that parent is the same `worldContainer` as before.
3. **Render groups.** Unchanged. Nested render groups inside the filtered lit group render correctly (checked in the shots and the draw-call probe).
4. **Layout.** `syncCityLayout()` runs every frame on a numeric key made of `LAYOUT.ext`, `LAYOUT.rooms`, the era and the floor count.
   - The provider's `sig(state)` is asked only when the key moves.
   - `build(state)` runs only when the sig changes.
   - A new layout, era or kit readiness rebuilds the structure, which calls the shell seam.
   - With no mounter set, the classic underground stands in.
5. **Rooms.** `CityHost.syncRooms()` checks at most 4 times a second and rebuilds only when its cheap signature changes. The signature covers the layout hash, floors, blackout floors, power < 5%, a state letter per room and a started flag per ruin.
   - Room states:
     - building: `isConstructing`;
     - unpowered: power < 5%, or a blackout incident on its floor;
     - working: people in the room view;
     - idle;
     - ruin.
   - Lamps come from `ArtLibrary.lightsFor(entry)` and are mirrored like `worldLamps` (`compoundIndex`).
   - Each dug floor gets a walkway strip at `LIGHT.read.walkway`, from the hub's west edge to the strip's east end.
   - The selection goes through `setSelected` → `select()`.
6. **Frame.** `updateCity()` runs right before `postfx.update()` and calls `host.frame(wc, screen, t, dt, tier, mapCovers, era, night)`.
   - `parallaxInfo` is derived locally: `CityHost.parallaxInfo` is `parallaxFromWorld`, anchored at the screen centre.
   - `CameraController` was not touched. Camera-nav's official `parallaxInfo()` can replace the local version in one line.
   - Era and night go to `setEra` only when they change (night is quantised to 0.02).
7. **LOD.** `mapCovers` is passed through. While the map covers, the city skips the light, fog and glow work and hides its four planes. The lit group stays visible so rooms under the map stay tappable.
8. **People.**
   - Room people get `PEOPLE_RENDER.cityAmbient` instead of the lamp-pool tint. Project crews on the surface keep their old tint.
   - The walkers get the same neutral through a runtime override of `walkers.ambientAt`. walkers.ts belongs to life-systems: **remove this override when their city lighting lands.**
   - `CityHost.lightAt(x, y)` is the hook for self-light.
9. **Context loss.** The city listens to `webglcontextrestored` itself, registered after the renderer's own listener. `recoverGraphics()` calls `cityHost.invalidate()`, so the rooms and the shell re-sync.
   - Note: in headless Chrome, `WEBGL_lose_context` followed by a restore leaves **both classic and city** throwing `alphaMode of null` in the batcher on every frame (`drawFails` > 200).
   - This already happens on the classic path, so C1 did not cause it. It needs a separate investigation.
10. **Snapshots.** `CityHost` wraps `renderer.extract.canvas`, `.texture` and `.pixels`, with a depth counter (base64 and image go through canvas).
    - Inside an extract, the filter switches to the 'area' UV mode, with `filterArea` set to the current view, and the light texture is redrawn.
    - Afterwards the previous mode is restored.
    - `share.ts` and the dev shot tools need no change.
    - Checked: an `extract.canvas` with an inset frame matches the screen.
11. **Dust.** In city mode the classic `Dust` is neither drawn nor updated. The glow layer's lit motes are the dust, and this saves 5 draw calls.
12. **Night grade.** `CITY_NIGHT_GRADE` lives in postfx.ts. The era's civic light rides on `city.setEra`.

**Quality tiers.** The city tier is `isLiteMode() ? 'lite' : postfx.quality`.
- `postfx.quality` is the live level. It follows QUALITY_PROFILE / TOUCH_PROFILE, the player's pick and battery saver. This is the same rule PostFX uses for its effects.
- Pixel density keeps following `baseLevel` in PostFX.
- Lite means no lightmap, no planes and no glow, with the flat `liteTint`.

**Incidents.** In city mode, a blackout's floor rect and the popup blocker's rect are `stripX(f, ext)`, which includes the hub. Classic mode keeps its old rect.

### The two seams (for the level-builder at merge)

```ts
// src/world/render/citySeams.ts
setCityLayoutProvider({ sig: cityLayoutSig, build: buildCityLayout }); // default: stubLayoutProvider
setShellMounter(mountShell);                                           // default: null (classic underground stand-in)
```

**`CityLayoutProvider`**
- `sig(state)` must change whenever `build(state)` would return something different, in geometry or in area states.
- The renderer calls `city.setLayout()` on every new build.
  - The fog tweens state changes.
  - Geometry is rebuilt only when `layout.sig` changes, so put only geometry into `layout.sig`.
- The stub's areas:
  - `surface`;
  - `f:<k>` for each dug floor (revealed);
  - `d:<kind>` (digging while it is under construction);
  - the dig face `f:<currentFloors>` (glimpsed);
  - `e:<f>:w|e`: edge strips 3 slots past each end of a floor (glimpsed);
  - `s:below` (hidden).
- The stub's strata bands meet at the middle of each gallery gap, with the ground at y 0.
- It makes one flat-vault hub per reached stratum, clipped to the dug floors, and no cavities.

**`ShellMounter(ctx) → MountedShell | null`**
- `ctx` holds `state`, `layout`, `era` and `tier`, plus two holders and the light calls:
  - `back` = `undergroundHolder`: emptied before the call, behind the rooms, inside the lit group. `RoomViews.collectStructureCullables` and the airy rock parallax read its first child;
  - `front` = `shellFront`: emptied before the call, after the shaft and before utilities and walkers;
  - `addLight` / `removeLight` for the shell's own lamps.
- It returns `{ update?(t, dt), destroy() }`. `destroy` must remove the shell's lights.
- It is called on every structure rebuild: a new layout sig, era or kit state, or anything else in `structureSig`.
- Returning `null` still counts as mounted, so the classic underground is NOT drawn. To keep the stand-in, leave the mounter unset.

### Classic parity

Run with `tools/compare/run.mjs` on saves-v6 `e30-seed1` and `c-seed1`, 390x844@2x, 17 shots. The baseline is a detached worktree at 7cbb372.

| Pair | Mean | Max |
|---|---|---|
| base vs base2 (noise floor) | 2.33 % | 7.29 % |
| base vs head (first integration, captured under CPU load) | 2.92 % | 11.15 % |
| base2 vs head2 (same code, quiet machine) | 2.59 % | 8.04 % |
| base vs head3 (final code) | 2.50 % | 9.28 % |

The diff images show only animated people, smoke and the corridor lamp flicker. No structure, room or shell edge moved.

In classic mode every city path sits behind `this.cityHost`, which is null. The new `spineOnly` flag of `buildShaft2` and `lite` flag of `gateLeaf` both default to false.

### Performance in the game

**Method**
- Production build (`vite build`), headless Chrome on the iGPU (UHD 630, ANGLE D3D11).
- A2's `frames.mjs` method (scratch `ct-frames.mjs`). Classic and city were measured on the same machine in the same session.
- e55 = `saves-v7/e55-seed1`: 20 floors, 190 people.
- Desktop is 1280x800 at DPR 1. Phone is 375x812 at DPR 2 with touch.
- Raw = 60 × `render()` + `gl.finish()`.

| Scenario, Medium | Draw calls idle, classic → city | GPU tex MB, classic → city | Raw frame med (p95) ms, classic → city | Idle CPU update ms, classic → city |
|---|---|---|---|---|
| fresh desktop | 203 → **203** | 157 → 167 | 2.8 (16.3) → 5.6 (18.2) | 0.8 → 1.5 |
| e55 desktop | 528 → **468** | 241 → 253 | 15.4 (28.1) → 15.6 (26.1) | 3.6 → 4.5 |
| fresh phone | 190 → **175** | 383 → **365** | 3.2 (21.3) → 4.6 (18.5) | 0.9 → 1.6 |
| e55 phone | 499 → **426** | 461 → **448** | 19.8 (34.0) → 15.9 (20.8) | 5.7 → 4.5 |

| Scenario, High | Draw calls idle, classic → city | GPU tex MB, classic → city | Raw frame med ms, classic → city |
|---|---|---|---|
| fresh desktop | 207 → 225 | 173 → 154 | 59.1 → 61.7 |
| e55 desktop | 540 → 500 | 230 → 238 | 56.7 → 79.4 (an earlier city run gave 57.3; MSAA High on this iGPU is noisy) |
| fresh phone | 194 → 187 | 319 → 361 | 3.7 → 6.5 |
| e55 phone | 512 → 448 | 397 → 444 | 18.6 → 18.3 |

**Medium target**
- **Draw calls: met.** City is equal or lower in every scenario.
  - The city's lightmap, fog, glow and planes add about 25 calls.
  - The shaft and backdrop batching and the dropped Dust pay for them.
- **GPU memory on phones: met.** City is 13 to 18 MB lower.
- **GPU memory on desktop: not met.** City is +10 to 12 MB (+5 to 6 %). What remains:
  - the lit group's filter texture, a screen-size intermediate: 3.9 MB at 1280x800;
  - the two plane caches: 3.3 MB at 0.5x;
  - the light texture: 0.5 MB;
  - the fog texture: about 2 MB;
  - the generated light textures.
- The texture estimate itself moves by about ±10 MB between runs, depending on when textures are garbage-collected. Phone High is an example: city is +42 MB there.

**CPU.** The city's update costs 0.5 to 4 ms per picture. It culls the lights every frame; at e55 High up to 101 are in view.

**Next savings, if wanted**
- Merge far into back on Medium, as Low does (−1.6 MB).
- Clip the fog sprite to the bounds of the non-revealed areas.
- When the level-builder's shell replaces the classic underground, the underground's 59 draw calls at e55 go away with it.

### Shots

- `shots/C1-T-fresh-overview.png`: fresh game, High, zoom 0.6×fit. Shows the lit rooms and the dark hub gap; the shell is not merged yet.
- `shots/C1-T-e55-hub-medium.png`: e55 at Medium, zoom 1. Shows the spine-only shaft, worked rooms at the 0.70 floor plus their lamps, and the walkway strips.
- `shots/C1-T-e55-wide-medium.png`: e55 at Medium, zoom 0.55. Shows the stratum ambient on the rock.

### Open items

- **life-systems:**
  - replace the walkers' `ambientAt` override;
  - add lanterns via `addLight({ dynamic: true })` + `moveLight`;
  - add the rim light from `lightAt`.
- **camera-nav:** an official `parallaxInfo()`.
- **level-builder:** plug in both seams. Shell lamps go through `ctx.addLight`.
- **Everyone:** the context-restore crash in the batcher, which also happens in classic mode.

## Phase 2b: the real layout and shell in the game (tech-artist, world-redesign, 2026-10-15)

### Wiring

`src/world/render/cityWiring.ts` → `installCityWorld()` is called by `BunkerRenderer.mountCity()`. It runs only in city mode (dev and prod) and registers two things:
- the provider: `setCityLayoutProvider({ sig: cityLayoutSig, build: buildCityLayout })`;
- the shell mounter: an adapter around `buildShell`.

The stub stays as the fallback (`setCityLayoutProvider(null)`).

What the adapter does:
- **Holders.** The shell goes into `CityHost.shellBack` (its own holder, right after `undergroundHolder`) and `shellFront` (right after the shaft).
  - `rebuildStructure` never clears either holder. This is the C1-L §3 trap.
- **Lights.** They go in through `ctx.addLight`, with their area ids, and are removed again on `destroy`.
- **Every frame.** `shell.update(view)` gets the world rect on screen, from worldContainer.
- **Twice a second.** `cityProgress(state)` → `city.setAreaState` + `shell.setProgress`.
- **Remount.** It happens on:
  - a new layout sig, era or kit state;
  - a tier change (`CityHost.ensureShell`);
  - and, 800 ms after the world-kit art arrivals settle, `onWorldKitLoaded` → `ctx.requestRebuild()`.
- **Culling.** Each shell piece's children are culled against the view: Pixi draws what is visible even when it is off screen, and every vestibule tile is a TilingSprite.

Seam additions:
- `ShellMountContext.setAreaState` / `requestRebuild`;
- `MountedShell.update(t, dt, view)` and `syncProgress(state)`.

### Integration bugs found and fixed

1. **Room and ruin taps opened the build menu.**
   - Cause: C1 had moved the slot pad (an invisible tap area over every slot) above the lit group.
   - Fix: it is back under the rooms, as in classic. Only the placement highlight stays above the lightmap.
2. **The rock had a hard seam to the parallax planes** when zoomed out. Fix in `shell/rock.ts`: the rock runs `ROCK_SIDE_RUN` (2400 u) past the layout bounds to the sides and below.
3. **Stand-in rock was baked into the chunk caches** (plain rock around the storeys, banded rock beyond). Fix: the adapter remounts once the world-kit art has arrived.
4. **Rock chunk caches were 1024x2048 px each.** `cacheAsTexture` took the bounds of every whole cavity polygon near the chunk.
   - Fix: `boundsArea` is set to the chunk. Each cache is now 0.3 MB instead of 8 MB.
   - This saved about 200 MB of GPU memory at e55.
   - Chunks are now parked after 4 s instead of 12 s.
5. **The east edges were out of the camera's reach.** Fix: `BunkerRenderer.applyCityExtents()` widens `extentL` / `extentR` to the edge sites and district caverns (+90 u).
6. **The sky and ground ended short in the west** (a black band). Fix: in city mode, `surfaceLeft` follows the layout bounds.
7. **The fore plane's lit lip drew stray wire lines** in front of the undiscovered fog. Fix (backdrop.ts): the fore lip is drawn only at seams above a stratum that has a non-hidden storey.

### Checked in the game (headless Chrome with GPU, 1600x900)

**Slice, `slice-dig`, fresh game and e55:**
- no console errors;
- hub with balconies, stairs and the chandelier;
- tiled vestibules, the living district, edge chokes with tape, rubble and signs;
- dig face at 40–60 % with crew and fog;
- spine-only lift;
- no classic casing in the hub.

**Taps** (CDP mouse; each check was the first tap of its session, because a sheet the test opened blocked the taps after it):
- room → `onBuildingClick`;
- ruin → `onRuinClick`;
- dig sign → `onDigClick`;
- `slotAtWorld` at floor 2, slot 7 → `{ floor: 2, x: 7 }`.

All slice edges are blocked by the Act, so a wing-dig tap was not exercised.

### Classic parity

`tools/compare/run.mjs` (saves-v6 e30 and c, 390x844@2x), baseline dae3858 vs this change: 2.02 % mean, 4.44 % max. The noise floor is about 2.3 %.

### Performance

Production build, iGPU, A2 method; classic and city measured in the same session.

| Medium | Draw calls, classic → city | GPU tex MB, classic → city | Raw frame med ms, classic → city |
|---|---|---|---|
| fresh desktop | 203 → 234 | 141 → 197 | 3.9 → 8.1 |
| e55 desktop | 530 → **473** | 241 → 339 | 16.5 → 19.4 |
| fresh phone | 191 → 198 | 351 → 408 | 5.6 → 7.1 |
| e55 phone | 502 → **423** | 440 → 465 | 19.6 → 16.5 |

| High | Draw calls, classic → city | GPU tex MB, classic → city | Raw frame med ms, classic → city |
|---|---|---|---|
| fresh desktop | 207 → 257 | 144 → 170 | 55.8 → 104 (noisy run; an earlier run gave 67.5) |
| e55 desktop | 544 → 506 | 229 → 306 | 63.8 → 76–124 (noisy) |
| fresh phone | 194 → 209 | 351 → 323 | 6.0 → 8.0 |
| e55 phone | 513 → 442 | 312 → 422 | 15.7 → 17.0 |

**Medium target**
- **Draw calls:** met for e55, desktop and phone. Fresh games are +7 to +31.
- **GPU memory:** not met.
  - City is +25 MB on the e55 phone and +56 to 98 MB elsewhere.
  - The new world-kit paintings (rock tiles, hub, vestibule and edge kit) and the rock chunk caches are most of it.
  - The texture count also includes a leak: one 256x1 FillGradient texture is left behind per shell build (about 330 per remount). They are tiny in MB, but they add up.

**Next steps**
- Share or dispose the shell's gradients.
- Remount only the rock (not the whole shell) on world-kit arrivals.
- Merge far into back on Medium.
- One cache per rock chunk instead of two.

### Shots

`shots/C-overview.png`, `C-hub.png`, `C-corridor.png`, `C-district.png`, `C-edge.png` (slice) and `C-dig.png` (slice-dig). All at High, 1600x900.

The camera still clamps vertically. The east edge choke is framed from the rooms' side.

## Phase 2c: camera and life wiring, open items, budgets (tech-artist, world-redesign, 2026-10-15)

### What changed

**Wiring**
- `CityHost.parallaxSource = () => cam.parallaxInfo()` gives the city camera-nav's official parallax camera, so the local derivation is only a fallback.
- `cam.setCityLayout(layout)` is called on every layout sync.
- `setLightSink(...)` (C1-Li §1) replaces the walkers' `ambientAt` override.
- `walkers.life(...)` runs after `walkers.update` in `renderPeople`. It only runs in city mode.

**Wing signs (`wingSigns.ts`)**
- In the city, an edge the Act holds shut shows no price plate; the shell's choke is the blocked look.
- The tap target stays, so the wing card still explains why it is shut.

**Gradient leak (`shell/kit.ts`)**
- `vfill` gradients are now shared. Same arguments, same `FillGradient`.
- Before, every shell build left about 330 textures of 256x1 behind. On e55 the count now stays flat across three remounts (815 before and after); it used to grow from 1987 to 2976.

**Art arrival**
- When world-kit art arrives, only the rock is refreshed: `ShellParts.refreshRock()` drops the rock chunks.
- The whole shell is no longer rebuilt. The other pieces swap their stand-ins themselves (`pendingSprites`).

**Rock caches**
- One cache per rock chunk (it was two). The AO is drawn over the erased rock: it still shades the hole, and now also slightly darkens the cut lip.

**Far and back planes**
- On Medium the far plane is merged into the back plane's cache (`TIER_RENDER.medium.planes = 'merged'`), as on Low.

**Batching**
- Each shell piece's children are regrouped by blend mode: normal, then multiply, then add.
- The vestibules went from 15 draw calls to 4 on a fresh game.

**Fore plane: off** (`BACKDROP.fore.enabled = false`)
- At parallax 1.32 its seam lip drifted over the dig face, the dig sign and the rooms. The style guide does not allow that.
- It needs a layout-aware fore before it comes back.

### Checked in the game

**Camera**
- City bounds come from camera-nav: y −140..716 in the slice, the edges are included, and the camera now pans vertically.
- Phone framing: hub shot at 375x812@2.

**Life**
- slice: 1 loiterer, at the west edge tunnel.
- slice-dig: 2 diggers, who walk down the hub stairs to the face. The dig ends after about 20 s; the B4 hub then holds them.
- e55: 10 loiterers and 1 lantern, a moving light.
- No console errors.

**People update** (`renderPeople` median / p95, dev build)
- slice: 0.3 / 0.6 ms.
- e55: 2.1 / 6.0 ms, against 1.3 / 3.5 ms in classic.

**Classic compare** (baseline 0ec099d): 3.04 % mean, 8.1 % max. The diff images show only rain, people and lamp flicker; nothing in the structure changed.

### Performance

Production build, iGPU. Classic and city were measured in the same session at the **same absolute zoom**: overview 0.8 on desktop, 0.62 on phone; the sweep runs over 0.7–2.3.

| Medium | Draw calls, classic → city | GPU MB, classic → city | Raw frame med ms, classic → city |
|---|---|---|---|
| fresh desktop | 203 → 219 (+16) | 169 → 208 | 3.5 → 6.8 |
| e55 desktop | 625 → **601** | 256 → 371 | 24.4 → 25.1 |
| fresh phone | 205 → 217 (+12) | 370 → **383 (+13)** | 3.5 → 4.2 |
| e55 phone | 645 → **558** | 449 → **299** | 23.8 → 21.8 |

| High | Draw calls, classic → city | GPU MB, classic → city | Raw frame med ms, classic → city |
|---|---|---|---|
| fresh desktop | 207 → 259 | 146 → 200 | 33.8 → 51.4 |
| e55 desktop | 645 → 665 | 251 → 334 | 41.6 → 47.7 |
| fresh phone | 208 → 240 | 370 → 315 | 3.9 → 6.1 |
| e55 phone | 666 → 597 | 321 → 281 | 20.9 → 35.7 |

**Budgets at Medium**
- **Phone memory: met.** The city is at most classic + 20 MB: +13 MB fresh, −150 MB at e55.
- **Fresh-game draw calls: not met.** The budget is classic + 10; the city is +12 on phone and +16 on desktop.
  - What remains is non-batchable shell Graphics: the edge chokes and the hub front, each above Pixi's 200-vertex batching limit.
- **Desktop memory:** +39 MB fresh, +115 MB at e55. The new world-kit art is most of it.

The earlier tables measured at a relative zoom. Camera-nav's city fit changed the base zoom, so city and classic were no longer framing the same view. They are not comparable with this one.

**Next steps**
- Cache the edge chokes and the hub front as small textures, or simplify their Graphics.
- Check the desktop world-kit texture sizes, which use mipmaps.

### Shots

All at High, 1600x900:
- `C-overview`, `C-hub`, `C-corridor`, `C-district`, `C-edge`: the slice, now with life.
- `C-dig`: slice-dig at 59 %, with the crew on the hub stairs.

`C-phone-hub` is the mobile preset, 375x812@2.

## Round 1 fixes: perf re-measure (fixer, world-redesign, 2026-10-15)

Same method as Phase 2c: production build (`vite build` into the scratchpad), headless Chrome on the iGPU, `ct-frames7.mjs` (A2 `frames.mjs` at the same absolute zoom: overview 0.8 desktop, 0.62 phone). Classic rows come from the full run at `a47ecd3`; city rows were re-run at `43b6744`, which only touches city code. Baseline `6a7ff3b` (before round 1) was re-measured in the same session for the phone rows, because GPU MB drifts between sessions.

### What changed for the renderer
- **Shell Graphics batch** (`cityWiring.forceBatch`). Pixi only batches a Graphics under 200 vertices. The edge chokes, hub front, dig front and pockets are 300–5000 vertices each, so each drew alone and broke the batch around it. Their contexts now use `batchMode: 'batch'`.
- **Shell holders are render groups** (`cityHost`). With the vertices batched, the lit group's per-frame draw-list rebuild copied them every frame: e55 phone idle draw went 10.1 → 14.1 ms. In their own groups the copy happens only when the shell changes.
- The city renderer now loads as its own chunks: `cityHost` and `cityWiring`, about 17 KB gzip each.

### Medium

| Medium | Draw calls, classic → city | GPU MB, classic → city | Raw frame med ms, classic → city | Idle CPU draw med ms, classic → city |
|---|---|---|---|---|
| fresh desktop | 204 → **197 (−7)** | 173 → 199 | 3.4 → 6.3 | 2.3 → 3.4 |
| e55 desktop | 632 → **579** | 256 → 360 | 17.1 → 22.7 | 5.7 → 10.6 |
| fresh phone | 205 → **194 (−11)** | 384 → 411 | 2.6 → 6.9 | 2.4 → 2.7 |
| e55 phone | 644 → **538** | 389 → **372** | 18.0 → 20.0 | 6.9 → 9.1 |

City before round 1 (`6a7ff3b`), same session, phone:
- fresh: 216 calls, 398 MB, 5.5 ms, idle draw 2.8 ms.
- e55: 559 calls, 505 MB, 18.4 ms, idle draw 10.1 ms.

### High

| High | Draw calls, classic → city | GPU MB, classic → city | Raw frame med ms, classic → city |
|---|---|---|---|
| fresh desktop | 208 → 238 | 151 → 174 | 30.4 → 27.7 |
| e55 desktop | 650 → 656 | 251 → 315 | 41.0 → 40.5 |
| fresh phone | 208 → 219 | 384 → 343 | 3.9 → 7.6 |
| e55 phone | 665 → 583 | 376 → 351 | 20.4 → 22.2 |

### Budgets at Medium
- **Fresh-game draw calls: met.** The budget is classic + 10. The city is now below classic: −7 on desktop, −11 on phone. Before this round it was +16 / +12.
- **Phone memory:** the budget is classic + 20 MB.
  - fresh: three runs of this build gave 400, 397 and 411 MB against classic 384, so +13 to +27. Baseline `6a7ff3b` gave 398 MB in the same session.
  - None of this round's changes allocate textures. The spread is lazy art loading in the first sweep. Treat it as at the edge of the budget, not over it, and re-check on a device.
  - e55: −17 MB.
- **Frame time:** the "raw full" median is bimodal on this iGPU. Fresh classic often reads below its own Pixi-only time, so read it next to the idle CPU draw column. Against the same-session baseline, city phone idle draw is 2.8 → 2.7 ms fresh and 10.1 → 9.1 ms e55. The full-frame average at e55 is 18.5 → 19.8 ms.

Classic compare: `tools/compare/run.mjs` on saves-v6 e30 and c, 390x844@2x, 17 shots.
- Baseline `6a7ff3b` against itself (noise floor): 1.84 % mean, 4.52 % max.
- Baseline against round 1: **1.45 % mean, 4.04 % max.** Classic is unchanged.

Shots refreshed: `C-hub` (slice; the loiterer is on the B1 balcony, not in the west tunnel) and `C-dig` (slice-dig; both diggers at the face, headlamps on, dig at 74 %).
