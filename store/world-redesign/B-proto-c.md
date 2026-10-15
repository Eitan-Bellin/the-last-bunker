# Stage B: Prototype C, real 3D with an angled camera ("cut-away diorama")

**In one line:** the city is built as a real 3D block of rock with the front face sliced off. A perspective camera looks at the cut from 13° to 23° above and about 10° to the side. Rooms have true depth, side walls and ceilings, and people walk up real stairs. Light comes only from point lamps in the dark. The renderer is about 1,000 lines of raw WebGL2, with no libraries and no texture files.

Screenshots (rendered by the prototype itself) are in `proto/c/shots/`:
- `c-desktop-start.jpg`: the start view on a desktop
- `c-mobile-start.jpg`: the start view on a phone (portrait)
- `c-atrium-close.jpg`: the hub up close, with a survivor on the stairs
- `c-district-close.jpg`: the living district up close
- `c-fog-revealed.jpg`: the metro and the crystal cave after a reveal

## 1. What the prototype shows

This is the shared scene. The entrance is on the **right** (Hebrew reading order) and the city deepens to the left:

| Space | What is there |
|---|---|
| Surface | Ash ground, the ruined entrance block (its roof slab has caved in, rebar sticks out, a blast door is propped open, there are sandbags and a red door lamp), a barrel fire with sparks, a wrecked car, dead trees, sagging power lines, scattered rubble, falling ash and 10 skeleton ruins fading into a dusk haze. The sky has a low sun glow, clouds and a two-layer skyline with a few lit windows. |
| Ramp | A sloped concrete tunnel (23°) from the hatch down to the atrium's top level. It has a safety-yellow hand rail, cable runs and a cage lamp that flickers like a failing tube. |
| Atrium (3 storeys) | A concrete hall 20 m wide and 12 m deep. Two levels of balconies and landings with railings and safety edges, and **two crossing steel stair flights** (one under the other). Also a ring chandelier with a light cone, a generator with a green indicator and an exhaust stack, water tanks, the commons (two long tables, benches, tin cups), banners, crates and barrels. |
| Service corridor | Green-painted concrete, ceiling pipes, a cable tray, a hazard stripe, a closed blast door with a red lamp, and two cage lamps (one cold and failing). |
| Living district | A **natural cavern**: noise-jittered rock and an arched, uneven ceiling. It has 3 tin shacks with lit windows, an open-front workshop with a forge glow, sparks, an anvil and a tool rack, and a magenta grow-light garden. Up a wooden stair is a platform on stilts with 2 more houses (one has an antenna and dish). A **rope bridge** sags across to a rock lookout ledge with a cold lamp and a water tank. Two strings of bulbs run across the cavern. There is also a laundry line and glowing lichen on the back wall. |
| Dark edge | An old timbered tunnel ends in a rubble choke with a crack at the top. A teal light leaks through the crack. There is a caution barrier and a dig site with a pick and a ground lantern. It starts half-fogged. |
| Under fog | **The old metro platform** (tiled walls, a safety edge, rails and sleepers, a derelict car with dim teal windows, a station sign) and **a crystal cave** under the district (emissive crystals that pulse). Each has its own light and only shows once uncovered. |

Also in the scene:
- **8 survivors** (`tokens.people.count`). They are low-poly figures with swinging legs and arms, a slight lean and a head bob, and each has its own outfit, skin, hat and backpack. They walk a 44-node graph with Dijkstra paths. They **take the ramp, both atrium stair flights, the district stair and the sagging bridge** (slower on climbs) and idle at destinations. One of them carries a **lantern that is a real moving light**, and lantern carriers favour the dig site and the surface.
- **Light:** 18 static point lights plus the lantern, with flicker for fires and failing tubes. Every lamp has a soft halo, 6 lamps have additive light cones, and dust motes are lit by the lamps near them. Darkness deepens with depth (ambient fades from dusk at the surface to almost black). The cut face gets a faint "section" fill, so the outline of the dig always reads.
- **Materials are procedural, made in the shader.** A 128² noise texture is generated in code, and the shader adds rock strata and cracks, concrete panels and run-off stains, rusted metal, corrugated tin, wood planks, metro tile with grout, dirt and emissive surfaces.
- **Fog of war:** a 2-texel-per-metre mask that every shader samples (rock, rooms, halos, cones, dust), drawn as slowly drifting smoke. Tapping reveals an 8.5 m area that grows over 1.1 s. The band from the surface down to the district floor starts known. The deep rock, the metro and the crystal cave start hidden. The tunnel beyond the rubble starts at 30%, so the teal glow teases.
- **Camera:** drag to pan (the grabbed point stays under the finger, with inertia), wheel or pinch to zoom toward the cursor, and right-drag, Shift-drag, a two-finger twist or Q/E to orbit the yaw within ±25°. Pitch follows zoom: 13° close up for a cinematic look, 23° far out for a map-like one.
- **DOM overlay:** Hebrew RTL labels are anchored to 3D points (projected every frame and hidden while fogged), plus an RTL help panel with buttons. This shows that the game's DOM UI keeps working over a 3D canvas.
- **WebGL context loss** is handled: the CPU-side meshes are kept, and `webglcontextrestored` rebuilds every GPU resource.

### How it renders (per frame, 6 draw calls, about 31k triangles)
1. **World (1 draw):** one static mesh of about 29k triangles. It holds the rock grid (cut faces first, so early depth testing skips what lies behind them) and all props. It uses one forward shader: material by id, ambient by depth, sun near the surface, **clustered lights**, haze, fog of war, ACES tone-map, grade, vignette and grain.
2. **People (1 draw):** one dynamic mesh rebuilt on the CPU each frame (the vertex storage is reused, so it allocates nothing).
3. **Sky (1 draw):** a full-screen triangle at the far plane, drawn after the world. Only uncovered pixels are shaded, which brought this pass from 3.2 ms to 0.5 ms.
4. **Additive passes (3 draws):** light cones, halo billboards and point-sprite dust, ash and sparks.

**2D light clusters:** the cross-section is cut into 2 m cells. Each cell stores in a 136×21 RGBA texture the (up to 8, in this scene at most 5) static lights that reach it. A fragment shades only those plus the lantern, not all 19. This one change took the frame from 11.6 ms to 7.5 ms. It also replaced a dynamic `for … break` light loop that **hung the GPU process** on this machine's D3D11/ANGLE driver whenever the light count was below the array size. That driver bug is a real risk, and it is listed below.

### Files (`store/world-redesign/proto/c/`)
| File | What it does |
|---|---|
| `tokens.ts` | **Every tunable value:** render, camera, haze, depth darkness, fog of war, light, sky, palette, the light list, lantern, people and detail counts, labels |
| `terrain.ts` | The 1 m rock grid, the cavities (ramp, atrium, corridor, cavern, tunnel, metro, crystal cave), strata colours, cave vertex jitter and AO |
| `props.ts` | Every structure and prop, plus the halo, cone and particle lists |
| `mesh.ts` | Mesh builder: quad, box, rotated box, beam, cylinder and sphere, with bottom-darkened AO |
| `shaders.ts` | All GLSL: main, sky, halo, cone, particles |
| `people.ts`, `nav.ts` | The walkers and the walk graph |
| `camera.ts`, `fow.ts`, `noiseTex.ts`, `math.ts` | Camera, fog of war, generated noise texture, maths |
| `main.ts` | GL setup, light grid, input, labels, frame loop, profiling hooks |

## 2. How to open it

`npm run dev` (or the `world` launch config, port 5176), then open
**http://localhost:5176/store/world-redesign/proto/c/index.html**

| Input | Action |
|---|---|
| Drag | Pan |
| Wheel / pinch | Zoom |
| Right-drag, Shift + drag, two-finger twist, or Q/E | Orbit (±25°) |
| Tap | Reveal fog |
| R | Reset camera |

Panel buttons: reset camera, re-fog, reveal all, hide the panel.

Query parameters for measurement:
- `?mobile=1|0` forces the phone or desktop profile.
- `?w=&h=&dpr=` pins the viewport.
- `?aa=0|1` turns MSAA off or on.
- `?skip=sky,world,people,cones,halos,parts` skips passes.

The console exposes `window.__protoC` with these calls:

| Call | What it does |
|---|---|
| `stats` | Live frame statistics |
| `gpuProfile(n)` | GPU ms per pass, from timer queries |
| `bench(n)` | Synchronous frame timing |
| `snap()` | Returns one rendered frame as a JPEG data URL |
| `advance(sec)` | Moves the simulation forward without rendering |
| `lightGrid()` | Light-cluster statistics |

## 3. Performance

**Test GPU:** Intel UHD Graphics (laptop integrated, D3D11 via ANGLE). This GPU sits roughly at the level of a mid-range phone, a little above it.

**I could not get a requestAnimationFrame sample.** The built-in browser pane was **hidden** the whole session and is shared by three prototype agents. In a hidden pane, rAF never fires (a 5 s sampler got 0 callbacks), the viewport reports 0×0, and synchronous readback timings are inflated about 10× by the compositor. So I measured with **`EXT_disjoint_timer_query_webgl2`**: real GPU time per pass, 60–120 frames each, at a pinned viewport. CPU time is the JS part of a frame. Other agents were loading the same GPU and CPU at the same time, so the p95 values are pessimistic.

| Profile | Drawing buffer | GPU frame median / p95 | Main pass (world) | CPU (JS) | Draws | Triangles |
|---|---|---|---|---|---|---|
| Desktop 1920×1080, DPR 1 | 1920×1080 | **12.4 / 23.5 ms** | 11.4 ms | ~1.3 ms | 6 | 31.0k |
| Desktop 1280×720, DPR 1 | 1280×720 | **6.1 / 6.5 ms** | 5.5 ms | ~1.3 ms | 6 | 31.0k |
| Phone preset (390×844 at DPR 3, capped to 1.25 and 0.9 MP) | 488×1055 | **4.7 / 4.8 ms** | 4.3 ms | 1.3–5 ms (noisy) | 6 | 30.6k |

Optimisation history at 1280×720, GPU median:

| Step | Frame | Note |
|---|---|---|
| First version (arithmetic hash noise, all 16 lights per fragment, sky drawn first) | 11.6 ms | The sky alone was 3.2 ms |
| Sky moved to the end, with a depth test | 7.5 ms | Together with the light clusters below |
| Light clusters (2D, 8 slots per cell) | (included above) | |
| Noise moved to a texture | 6.1 ms | |
| MSAA on vs off | no measurable change | On this GPU |

Other numbers:
- Scene build: about 110–250 ms on the CPU at start (terrain, props, light grid and noise texture).
- Memory: one static vertex buffer (about 29k triangles, 11 floats per vertex), roughly 5 MB of GPU memory in total.

**Phone estimate:** a mid-range Android (Adreno 610–619 or Mali-G57) is about 1.5–3× slower than this Intel GPU for fragment-heavy work. That would put the phone profile at roughly **7–14 ms of GPU per frame**. That fits 30 fps comfortably and 60 fps only on the better phones.

Heat depends on how many frames are drawn. The existing `postfx.ts` frame-rate tiers (60 while the camera moves, 20 while watching, 5 when idle) would be needed here too. Everything moving in this scene is time-driven, so drawing at 20 or 5 fps still looks right.

## 4. Evaluation: adopting C in the real game

### What happens to the current code

**Kept as-is (it is not rendering):**
- The whole simulation, `core/`, `data/`, the save system and all the DOM UI (HUD, sheets, popups, `hudInsets.ts`).
- The prototype shows DOM labels projected from 3D points. Any UI anchored to a room (popups, plaques, wing dig signs) needs a `worldToScreen(x, y, z)` from the 3D camera instead of from the Pixi container transform.
- `routes.ts` / `walkers.ts` route *logic*, as in "who goes where, and when". It is cosmetic and decoupled (decision D4).
- The art-pipeline tooling idea: generate art in the browser, on the dev server, with no Blender.

**Adapted:**
- **`walkers.ts`:** the node graph gains a z (lane depth), and stair and ramp edges become 3D segments. The budget logic (12 walkers, nobody walks below a zoom threshold) carries over. The prototype's `people.ts` is the same idea with a 3D path.
- **`people3d.ts` and `tools/people3d.ts`:** today the bodies are SDF characters ray-marched to sprite atlases from one fixed angle. Two ways to go:
  - (a) Keep the sprites as **camera-facing billboards** standing in the 3D scene. This is cheap, and it reuses the whole outfit-tint layer system. But with yaw clamped to ±25° the fixed angle shows, and the bodies need depth-tested alpha and a contact shadow.
  - (b) Render each animation from 3–5 yaw angles and pick the angle per walker. This means the same tool with a camera loop: 3–5× more atlas memory.
  - (c, the long-term option) Turn the SDF rig into low-poly meshes and animate them in real time. The tool already has the rig and the primitives.
- **`CameraController.ts`:** most of its 987 lines (inertia, edge springs, focus springs, HUD insets, phone zoom tracks, far-zoom city map threshold, shake) is behaviour that maps onto an orbit camera. The maths changes: target plus distance, perspective picking. The far zoom turns into a raised pitch, a natural "city map" view.
- **`postfx.ts`:** the quality profiles are worth more than the code. They cover the per-device pixel budget, MP caps and frame-rate tiers (60/30/20/5). The colour grade, vignette and grain move into the 3D tone-map, as the prototype does. Bloom would be a new blur pass (about 1 ms on a phone at quarter resolution).
- **Room content and layout:**
  - `layout.ts` (slots, floors, wings) maps 1:1 onto the grid in `terrain.ts`: a room is a carved box.
  - `roomSpecs*` / `roomComposer.ts` already describe rooms as data (props, lamps, workspots). That data can drive 3D prop placement.
- **Painted rooms (`paintedRoom.ts`, `public/art/rooms/*.webp`, 45 paintings):**
  - These are side-view paintings with baked light. They do **not** fit true 3D under a moving perspective camera.
  - The honest reuse is to put each painting on the **back wall** of its 3D room as a "mural backdrop", and use its `meta.json` lamp spots as real point lights. The 3D floor, side walls, ceiling and foreground props are built around it.
  - This works at 13–23° pitch and ±25° yaw because the back wall is mostly seen straight on. The baked painted light will disagree with the real lights, though, so the paintings would need a darker, flatter repaint to look right.

**Rewritten:**
- **`BunkerRenderer.ts` (1,739 lines), `world.ts`, `strata.ts`, `structure.ts`, `shaft.ts`, `surface*.ts`, `frontChunks`, `gallery`, `decals`.** They are Pixi container trees of 2D Graphics and sprites. The whole layering model (gloom overlays, front chunks, light spill as sprites) is replaced by geometry plus real light.
- Picking: today it is Pixi hit areas. In 3D it becomes a ray against the room boxes (the cross-section makes this simple: one plane plus room AABBs, as `cam.pick()` does).
- Room highlight and selection, build-slot ghosts, dig signs: all new 3D overlays.

### Is a real engine needed?

**For production, yes. Use three.js (about 160 KB gzipped, `three` and its types).** The raw prototype proves the look and the budget, but a shippable game needs things a hand-rolled renderer would have to grow one by one:
- glTF loading, if any modelled props come in later
- instancing and LOD for a city with hundreds of rooms
- frustum culling and per-room meshes (the prototype has one static mesh: fine for one scene, not for a game that builds and digs)
- shadow maps if ever wanted
- a post-processing chain (bloom)
- texture compression (KTX2 / Basis for phones)
- a well-tested context-loss path
- a large body of known driver workarounds (the D3D11 loop hang above is exactly the sort of thing three.js has already met)

What installing it means:
- `npm i three @types/three`. This needs the network (forbidden for this prototype).
- Vite tree-shakes it.
- PixiJS stays for nothing in the world view. It could remain for `tools/` and the art pipeline, or be dropped from the bundle.
- The light-cluster, procedural-material, fog-of-war and section-fill ideas from this prototype port straight to three.js. They become a `ShaderMaterial` / `onBeforeCompile` patch on `MeshStandardMaterial`, or one custom material for the rock.
- Capacitor packaging is unaffected.

The alternative, growing this raw renderer, is viable for a tightly scoped game (grid rock, box rooms, billboarded people). It would cost about 30–40% more agent time on infrastructure and carry more driver risk.

### Effort (agent-days, one capable agent, self-test included)

| Work | Days |
|---|---|
| three.js scaffold: renderer, quality tiers from `postfx.ts`, context loss, frame-rate tiers | 2 |
| Rock grid from `layout.ts` / buildings: carve, strata, cave jitter, per-chunk meshes, rebuild on dig/build | 4 |
| Room shells: concrete boxes with depth; back-wall paintings as backdrops; lamp spots become lights; props from `roomSpecs` | 6 |
| Lighting: clustered lights (2D grid), flicker and power-dip hooks (`roomFlicker`), halos and cones, depth darkness, tone-map and grade | 3 |
| People: billboards from the existing atlases (outfit tints, heads, faces), 3D walkers on stairs and ramps, contact shadows | 4 |
| Camera port: orbit plus inertia, springs, HUD insets, focus-on-room, far "city map" view, touch gestures | 3 |
| Picking and interaction: tap a room, long-press, drag a survivor onto a room, build ghosts, dig signs, projects on the surface | 4 |
| Fog of war wired to real exploration state; district identity kits (shacks, metro, caves) | 3 |
| Surface: ruins, sky, eras, project lots in 3D | 3 |
| Art pass: palettes per district, repainting the 45 room murals darker and flatter, prop kits | 5 |
| Perf and heat pass on real Android hardware, QA, regressions in UI anchoring | 4 |
| **Total** | **≈ 41 agent-days** (about 8 working weeks for one agent, about 4–5 with parallel agents) |

### Risks

1. **Mid-range Android heat and performance.**
   - The prototype's phone profile is 4.7 ms of GPU on Intel UHD, about 7–14 ms on a mid-range phone. That is acceptable only with the existing frame-rate tiers (5 fps when idle) and a pixel cap of about 0.9 MP.
   - A full city with hundreds of rooms needs per-chunk culling.
   - A forward shader with procedural noise costs more per pixel than Pixi sprites. The user's heat complaint will come back unless idle frames really drop to 5 fps.
   - MSAA has to stay off on phones. FXAA would be a further 0.5 ms.
2. **Driver bugs:** this session hit a GPU-process hang from a dynamic loop exit on D3D11/ANGLE. The browser tab also crashed once ("Target crashed") during a 1600 px readback, while other agents were loading the GPU. Real Android drivers (Mali especially) have their own. three.js lowers this risk but does not remove it.
3. **WebGL context loss** is more likely with heavy 3D on Android when the app is backgrounded. The prototype rebuilds from kept CPU meshes. A real game must also re-upload textures and atlases (the person atlases are large).
4. **Art pipeline without Blender.** Everything here is procedural boxes, and that is the ceiling of the look: premium-diorama is reachable, painterly is not.
   - The 45 painted rooms only half-fit, and repainting them darker and flatter is real work.
   - Modelled props would need glTF from somewhere: AI 3D generators, or hand-coded meshes like these.
   - The existing SDF people tool is the strongest asset: it already *is* a 3D pipeline.
5. **Touch picking:** it is solid for a cross-section (a ray against the focus plane plus room boxes). But stacked balconies and props at different depths can be ambiguous. Taps need a "nearest room under the ray" rule and a generous hit size (rooms, not props).
6. **Readability:** perspective makes rooms at the edge of the screen show their side walls. At far zoom, rooms are small and ceilings hide some of the interior. People are about 1.7 m tall, which is about 8–10 px on a phone at the start view. They need an outline, a self-light (the prototype uses `figureLift`) or a highlight to stay readable.
7. **Portrait phones and a wide section:** the scene is 120 m wide. In portrait you see about 24 m (one district). A raised pitch helps a little, but the far "city map" mode is essential.
8. **RTL:** there is no conflict in 3D. Labels are DOM with `dir="rtl"`, and the city can be laid out entrance-right. Orbit and pan directions are not mirrored, which is correct: they are spatial, not text.

### Scores (1–10, higher is better; for effort, higher means **less** effort)

| Criterion | Score | Why |
|---|---|---|
| **Wow** | **8** | Real depth, parallax, light pools in true darkness, crossing stairs, the sagging bridge and a living lantern. Orbiting ±25° sells "a city under the ground". Procedural boxes cap it short of 9–10 without real modelled art. |
| **Readability** | **6** | Close up it is excellent (rooms read as places). Far out, rooms are small, side walls and ceilings steal pixels, and people get tiny. Labels and highlights help. |
| **Explorability** | **9** | The best of the three. Zooming into a district, tilting to look into the cavern's depth, fog dissolving to reveal the metro, and a lantern walking into the dark. True verticality comes for free. |
| **Reuse of existing art** | **3** | The painted rooms can only be back-wall murals with baked light that clashes. Structure, surface and strata art is not reusable. The people atlases work as billboards; the SDF tool could feed 3D. |
| **Phone perf** | **5** | 4.7 ms of GPU on Intel UHD at phone resolution means about 7–14 ms on a mid-range phone, 30 fps safe. Heat depends on idle frame-rate discipline. The full city needs culling. |
| **Effort** | **3** | About 41 agent-days, a new engine dependency, and most of the rendering layer rewritten. |

**Bottom line:** C has the biggest "wow" and the best explorability, and the renderer budget fits a phone. But it is the most expensive option, it throws away the most existing art, and it brings back the heat risk the user already raised. A hybrid could take C's best ideas into A or B without the cost: true room depth, real point lights in darkness, the 2D light clusters, and the fog mask sampled by every shader. Alternatively, C could be kept for a later "explore mode" or zoomed-in view.
