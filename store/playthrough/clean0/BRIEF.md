# Clean front, step 0: "clean the world" — brief

The owner finds the bunker view cluttered and low quality. They chose to keep the front cross-section but make it CLEAN.
Plan: `store/playthrough/clean-front-plan.html` (Hebrew), step 0. Reference look: the prototype `tools/viewproto.html` and its shot
`store/playthrough/viewproto/front.png` — big room paintings, a name at the bottom on a dark fade, ONE status dot in a corner, a calm
uniform dark background between rooms. Current look: `store/playthrough/clean0/before/d10-main.png` (and d1, d35).

Branch `clean-front` in the MAIN checkout `C:\Users\eitan\Desktop\משחק לשרוד` (a vite dev server on :5173 serves it; HMR is fine).
Renderer ONLY: `src/rendering/**`, `src/world/render/**` (if needed), `src/rendering/gfxFeatures.ts`. Do not change UI panels, game logic, saves or i18n
(if a label text is unavoidable, use existing keys). Never kill processes by name; don't start servers; don't push; don't commit (the lead commits).

## The rule for a room in the world at normal zoom
Shown: the painting (or composed room), the people in it, the room NAME at the bottom of the room on a dark gradient, ONE status dot
(green working · amber building / short of workers · red no workers / broken / disaster). Nothing else on the room.
Not shown at normal zoom: the clarity wash/tint and ceiling band and the big round icon plate (keep them at FAR zoom only, where the
painting is unreadable), the "+N" production tickers / output tags, decals (cracks, rust, stains, chalk), painted signage props on columns,
the pipe bundle under ceilings, extra floor-identity paint bands. Keep: lamp light, people, construction state, incident/fire effects,
selection highlight, the floor number (one small tag per floor at the side).

## Tasks
1. Add a `clean` switch to `GfxFeatures` (on by default at every level; `?gx=-clean` restores today's look; include it in the `?gx` names).
   Gate every item above on it. Where an element is useful at far zoom (icon plate, wash), keep it only beyond the mid-zoom threshold the
   code already uses (LabelScale / labelState modes).
2. Room name + status dot: one helper that computes the room status from state (construction, workers vs maxWorkers, disabled/disaster)
   — put it in a new `src/rendering/roomStatus.ts` (the lead will reuse it for the room screen later). Name at the bottom-start of the room,
   readable at default zoom on a 375 px phone (≥ 12 css px), RTL-safe (Hebrew names), never overlapping the neighbour (respect the existing
   label row logic / LABEL_CAP in RoomViews; a name that does not fit is shortened, not overlapped).
3. Rooms read as cards: a thin dark frame and a clear gap between rooms; a calm uniform rock/dark tone between rooms and floors instead of
   busy textures at normal zoom (strata detail only at far zoom).
4. No new per-frame cost: prefer not creating objects over hiding them every frame; check the existing culling. Respect quality levels.
5. Gates: `npx tsc --noEmit`, `npm run check:full`, `node tools/sim/migrate-test.mjs store/playthrough/saves`.
6. Self-check with the screenshot tour (the dev server is running): 
   `node tools/playthrough-measure.mjs --url http://localhost:5173 --stage d10 --tour --width 375 --out store/playthrough/clean0/after/d10.json`
   (same for d1 and d35; create the folder). Look at `*-main.png` (Read the PNG) and iterate until it matches the rule above. Also one run with
   `--width 320`. Compare with `store/playthrough/clean0/before/`.
Final message: what you changed (file:line), what each ?gx toggle does, before/after observations, anything left.
