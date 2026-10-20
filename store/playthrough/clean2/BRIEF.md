# Clean front, step 2: camera & navigation — brief

Plan `store/playthrough/clean-front-plan.html` step 2. Live already: step 0 (clean world: painting + people + name + one status dot, `clean` gfx flag)
and step 1 (RoomScreen: tap a room → camera frames it, panel below). Goal now: a 24-floor bunker feels ordered on a phone — floor by floor,
never lost, big readable rooms, the city's rock detail only when zoomed far out.

Branch `clean-front-2` in the MAIN checkout `C:\Users\eitan\Desktop\משחק לשרוד` (vite dev server on :5173 serves it; if it is not up,
start your own on another port and stop it by its own PID/task id only). Never kill processes by name; don't push; don't commit (lead commits).
Owns: `src/rendering/CameraController.ts`, `src/rendering/BunkerRenderer.ts` (camera/zoom hooks only), `src/rendering/LabelScale.ts`,
`src/world/render/**` (zoom-dependent detail only), a new small DOM overlay for the floor tag if needed (`src/ui/floorTag.ts` + CSS), `tools/playthrough-measure.mjs`.
Hebrew RTL, phone first (375 and 320 px), tokens only in CSS, no raw z-index. New i18n keys directly in en/he json under `cf2.` (you are the only agent).

## Build
1. **Default zoom**: on a phone the home view shows about 2.5 floors with rooms big (room name ≥ 12 css px, a 2-slot room ≈ half the screen
   width or more). Keep it consistent across save sizes (d1 small bunker vs d70 24 floors). Desktop/tablet may show more.
2. **Floor snap**: vertical scroll/drag/fling settles so a floor's slab lines up (the nearest floor boundary at the top of the visible area
   under the HUD), with a short ease; never fights the finger; pinch zoom still free. Horizontal pan stays free (wings).
3. **Sticky floor tag**: while scrolling, a small tag at the screen side (start edge in RTL = right) shows the floor in view ("B7 · חקלאות ומים"
   from the existing floor identity names) — DOM overlay or renderer UI layer, one element, updates only when the floor changes.
4. **Far zoom = map**: the city strata/rock detail and the shell ornaments appear only when zoomed out past the threshold step 0 used for icons
   (LabelScale modes); at normal zoom the background stays the calm dark sheet. Check the existing far-zoom city map (`cityMap.ts`) still works.
5. **Quick floor jump**: tapping the floor tag opens a compact floor list (B1…Bn with the floor's name and a status dot if any room there is
   red); tapping one glides there. Keep it small; reuse kit components.
6. Don't break: RoomScreen framing (frameRoom/releaseRoom), tours/ceremonies camera moves, follow-survivor, back-to-bunker button (`goHome`),
   edge arrows, placement mode panning, the tutorial spotlight targets.
7. Gates: `npx tsc --noEmit`, `npm run check:full`, `node tools/sim/migrate-test.mjs store/playthrough/saves`.
8. Screenshots: BEFORE first into `store/playthrough/clean2/before/` (tours of d4, d35, d70 at 375 and 320; add a `scroll` stop to
   `--tour` that scrolls down ~1.3 screens and shoots after the snap settles, and a `far` stop zoomed out), then AFTER into `clean2/after/`.
   Read the PNGs and iterate.
Final message: changes (file:line), numbers (default zoom, floors visible at 375/320, snap timing), before/after observations, anything left.
