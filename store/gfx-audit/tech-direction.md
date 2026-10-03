# The Last Bunker: visual technology direction

*Technical direction review, 2026-10-03. Research only, no game files changed.*

## 1. Short answer

**Yes, it is possible, and you do not need to change engines.** The "puppets moving their arms" feeling comes from one place: the people are flat vector limb-rigs (`src/rendering/people.ts:97` `limb()`, rotations at `people.ts:461-475`). They are placed over painted rooms that do not react to light. Two realistic upgrades are open, and both stay inside the current TypeScript/Vite/Capacitor app:

- **Real-time 3D diorama (path B, recommended target).** Use three.js for the bunker and the people, rendered as a Fallout Shelter-style cross-section with real lights, shadows and Mixamo-animated characters. The game logic, UI, audio and saves are kept as they are.
- **2.5D (path B fallback, path A).** Keep Pixi and add normal-mapped lighting, parallax depth, and characters pre-rendered from 3D models into sprite sheets.

Porting to Unity or Godot (C) would mean rewriting all ~23k lines, including the Hebrew/RTL DOM UI, to reach roughly what B already gives. It is not worth it for this project.

The real bottleneck is **art sourcing, not technology**. You have no 3D artist, so the plan is built around bought or free kits plus Mixamo.

## 2. Current architecture: how coupled is it?

The coupling is good. The logic is cleanly separated from rendering.

- `src/core`, `src/systems` and `src/data` (~6.1k lines) import nothing from `pixi.js` or `src/rendering`. I grepped for it and found zero hits. `GameEngine.ts:1-19` imports only state and systems.
- Rendering depends on logic one way only, through *type* imports and pure helpers (`BunkerRenderer.ts:3-7`, `structure.ts:2-7`, `layout.ts:1-3`). That is the right direction.
- `app.ts` talks to the renderer through a **façade of about 40 members**: `render`, `setEra`, `setNight`, `focusOn`, `roomRect`, `personPos`, `burstAt`, `floatIcons`, `on*Click`/`onPersonDrop` callbacks, and so on (`BunkerRenderer.ts:141-1312`; call sites `app.ts:130-957`). A 3D renderer that implements this same interface could replace it with almost no change to `app.ts`.
- Pixi is used outside `src/rendering` only in `src/art/ArtLibrary.ts`, `src/ui/components/NumberPopup.ts:1` (it draws into `renderer.worldContainer`, `app.ts:171`) and `src/dev/*`.

Two coupling problems need fixing:

1. **Person behaviour lives inside the view.** Wandering, work spots and walk speed are in `Person.update` (`people.ts:530-570`). Room-to-person assignment is in `BunkerRenderer.renderPeople` (`BunkerRenderer.ts:863+`). A new renderer would have to re-implement this, so it should be moved into a renderer-agnostic `PersonSim` (position, target, activity, facing).
2. **Hit-testing and the camera are Pixi-specific.** `targetAt` uses `worldContainer.toLocal` (`BunkerRenderer.ts:837-860`), and the pointer handling is at `:414`. In 3D this becomes raycasting. It is fine as long as it stays behind the façade.

Code that survives any 2D→3D change unchanged: core, systems, data, ui, audio, i18n and utils, about **14.4k lines (~63%)**, plus most of `app.ts` (1.4k lines). The code at risk is `src/rendering` (7.2k lines) and `src/art` (0.4k lines).

## 3. Comparison

| | **A. 2.5D in Pixi** | **B. three.js hybrid (3D bunker + Pixi/DOM overlay)** | **C. Port to Godot 4.6 / Unity 6** |
|---|---|---|---|
| **Visual ceiling** | Painted rooms that light up properly: lamp pools, normal-mapped relief, rim light on people, parallax depth. Characters look 3D-rendered, but camera angle and lighting are baked. Roughly a "premium 2D" look (Darkest Dungeon / This War of Mine side view). | A real diorama: soft shadows, emissive screens, bloom, slight perspective so you see room depth, smooth zoom with true parallax. Mixamo characters with ~2,500 professional animations. Fallout Shelter class. Synty kits make it stylized low-poly, not photoreal. | Same as B, plus an editor, a GPU lightmapper and better native performance. Not a meaningfully higher ceiling for this camera. |
| **Code reuse** | ~95%. New code is a lighting layer, plus Person drawing replaced by sprite-sheet playback. | ~70%. Logic, UI and audio stay. Rendering is rewritten, but layout math (`layout.ts`), LOD logic and FX ideas carry over. Pixi stays for the far-zoom city map, labels, bubbles and popups, as a transparent canvas on top. | ~0% of code. Data JSON and the i18n strings can be reused. The whole DOM UI and Hebrew RTL have to be rebuilt in the engine's UI system. |
| **Effort (solo + AI agent)** | 4–7 weeks | 10–14 weeks to reach parity at higher quality (2-week spike first) | 24–36+ weeks |
| **Mobile performance** | Excellent; this is the current baseline. Light pass costs about one extra full-screen pass. | Feasible with discipline. Only ~6–10 rooms are on screen at phone zoom, so frustum-cull everything else. Use **baked lightmaps** plus at most 1–2 dynamic lights. ~30–60 skinned characters with GPU skinning is OK on mid-range Android if they share materials and animation updates are throttled (half-rate) off-screen or far away. CPU skinning cost is the known limit at hundreds of rigs, not dozens. Cap at 30 fps when idle: this is an idle game, so battery and heat matter more than peak fps. | Best native performance. Godot 4.5.2/4.6 cut mobile crash rates from ~4% to <1%. |
| **Bundle / download** | +5–15 MB of sprite sheets (webp) | three.js ~170 KB gzipped, plus GLB/KTX2 assets of ~15–40 MB (Draco/Meshopt + KTX2 compression) | Unity ~20–35 MB shell; Godot ~25–40 MB, plus assets |
| **Key risks** | The combinations of outfits × animations × directions explode the frame count. Mitigate with a few base bodies and tinted layers. It still reads as 2D. | Art coherence: mixing kit models with your painted surface/backdrops. Synty licence handling on web (below). Draw calls and heat. Two WebGL contexts (three + Pixi) use more memory. Fallback: a DOM overlay instead of Pixi. | Months with no new player-facing content. AI agents are weaker in editor/scene-driven workflows. Godot has gaps in IAP, ads and analytics plugins. Unity Personal is free under $200k revenue. |
| **Asset cost** | ~$0–100. Mixamo is free; Blender is free. | ~$100–400 (1–3 Synty packs, or free Quaternius/Kenney), plus an optional Meshy/Tripo Pro month | Same assets as B, plus engine-specific tooling |

**Proof of concept built (direction B).** I rendered a small live three.js scene with `show_threejs_scene`:

- Rock wall backdrop.
- Three open-front rooms: dorm and hydroponic farm side by side, and a generator room below.
- Each room has a concrete back wall, steel ceiling and a warm shadow-casting lamp with an emissive bulb. The generator room's lamp flickers and has a cyan glowing panel.
- Four capsule "people" walk left/right with swinging legs and cast real shadows on the floor and walls.
- A shaft beside the rooms, ACES tone mapping, bloom, fog, and a narrow-FOV (22°) camera with limited orbit, so you see room depth without leaving the side view.

Even with placeholder geometry and noise textures it reads as a lit physical space, which no amount of flat painting gives. Caveat: three shadow-casting point lights mean 18 shadow renders per frame. That is fine on desktop and too much for a phone. Production should bake room lighting and keep one dynamic shadow light at most.

## 4. Recommendation and phased plan

**Target B (a three.js diorama), but reach it through steps that are useful whatever is decided.** Gate the big rewrite on a device spike.

**Phase 1: no-regret work (2–3 weeks; helps A and B).**

1. **Extract a view interface.** Define `IBunkerView` from the façade members used in `app.ts`. Make `BunkerRenderer` implement it, and make `NumberPopup` go through it instead of `worldContainer`.
2. **Extract `PersonSim`.** Move walk, target and activity logic out of `people.ts`/`renderPeople` into `src/systems` or `src/rendering/sim`. Renderers then only *draw* a person state (`x`, `floor`, `facing`, `activity`, `lifted`).
3. **Character pipeline.** Pick base bodies: Mixamo characters, Synty/Quaternius modular survivors, or Meshy-generated bodies auto-rigged in Mixamo. Download ~10 animations as FBX: walk, idle, hammer, wrench, typing, carry, dig, watering, sit, sleep. Convert them to GLB with a scripted Blender CLI step (the agent can write and run it). These GLBs are the *same source* for A's pre-rendered sprites and B's real-time characters.

**Phase 2: decision spike (1–2 weeks).**

- Behind a `?gfx3` flag, build a three.js view for one floor: 3–4 rooms from a kit, baked lightmap, 15 Mixamo people driven by `PersonSim`, and the Pixi labels overlay.
- Ship it to a mid-range Android phone (e.g. a Galaxy A-series) through Capacitor. Measure fps, frame time, temperature after 15 minutes, battery drain, and APK size.
- **Gate:** if it holds a stable 30 fps and the phone stays cool, go B. Otherwise go A: render the same GLB characters into sprite sheets and add `pixijs-light2d` normal-mapped lighting.

**Phase 3B: full migration (8–12 weeks).**

- A room-kit system: one GLB "shell" per room type and era-dependent prop/material sets that map to the current R/F/L wear states.
- Camera and zoom LOD; keep the existing far-zoom city map in Pixi.
- Raycast hit-testing and drag-drop.
- Incident FX (fire and smoke as particle sprites in 3D).
- The surface stays a painted backdrop plane with a 3D entrance in front.
- Keep `?gfx2` (Pixi) as the fallback renderer for low-end devices until the 3D path is proven.

**Phase 3A (if the gate fails, 3–5 weeks).**

- Pre-render 8 frames × ~10 animations × 2 facings per base body. Tint clothing layers instead of rendering every outfit.
- Generate normal and depth maps for the painted rooms (AI depth estimation → normal maps, or Laigter).
- Add per-room lamp lights and 2–3 parallax layers per room.

## 5. Asset sourcing plan and licences

| Source | Use | Licence (verified 2026) | Notes |
|---|---|---|---|
| **Mixamo** (Adobe) | Characters + ~2,500 animations | Free and royalty-free for commercial games. You may not redistribute the raw files as an asset product. | Best value by far. Shipping them inside a game build is allowed. |
| **Synty POLYGON** (Apocalypse, Military, Town) | Room shells, props, survivors | One-time licence (updated 9 Jul 2026): perpetual, commercial, all platforms, 5 seats. Source files must not be shared outside your team. **Forbids using the assets with generative-AI tools or to generate 3D models.** | A web/Capacitor build exposes GLBs inside the APK. Ask bizdev@syntystudios.com to confirm this is acceptable (it is standard for Unity WebGL too) and pack or obfuscate the assets. Never feed Synty assets to Meshy/Tripo. |
| **Quaternius / Kenney** | Props, modular rooms, low-poly people | CC0 | Free; a good spike placeholder. Style is simpler than Synty. |
| **Poly Haven** | PBR textures (concrete, rust, rock), HDRIs for baking | CC0 | Gives a more realistic surface feel even on low-poly shapes. |
| **Sketchfab** | One-off hero props | Per-model CC-BY / CC0 / Standard | Filter by licence and keep an attribution file. Quality varies. |
| **Meshy / Tripo / Rodin (AI 3D)** | Props (crates, generators, consoles) | Meshy free tier = public CC BY 4.0 (credit required); private ownership starts at Pro. Tripo free tier is **non-commercial**; commercial rights come with paid plans. Rodin's paid tiers are needed for commercial use. | Good for static props. Weak for characters (messy topology and UVs, needs re-rigging). Pay for one month while producing assets and record each asset's tier. |
| **Existing AI painted art** | Surface backdrops, signage, decals, UI | Your current pipeline | Stays useful in every path: backdrop planes, decal textures, UI. |

Keep `store/gfx-audit/asset-licences.csv` listing asset, source, licence, attribution and purchase receipt from day one.

**Sources:**
- [Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
- [Synty one-time licence](https://syntystore.com/pages/one-time-purchase-licence)
- [spine-pixi-v8](https://esotericsoftware.com/spine-pixi)
- [pixijs-light2d](https://github.com/haiyoucuv/pixijs-light2d)
- [Godot mobile update Apr 2026](https://godotengine.org/article/godot-mobile-update-apr-2026/)
- [Godot mobile readiness](https://ziva.sh/blogs/godot-mobile)
- [three.js skinned-mesh scaling](https://discourse.threejs.org/t/optimization-of-large-amounts-100-1000-of-skinned-meshes-cpu-bottlenecks/58196)
- [AI 3D licences](https://app.cinevva.com/guides/ai-3d-model-generators)
- [Unity pricing 2026](https://www.vendr.com/marketplace/unity)
