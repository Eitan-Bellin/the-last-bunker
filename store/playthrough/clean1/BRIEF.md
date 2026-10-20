# Clean front, step 1: the room screen — brief

The owner chose "clean front + room screen" (plan `store/playthrough/clean-front-plan.html`, step 1). Step 0 is live: rooms in the world
show only painting + people + name + one status dot (`src/rendering/roomStatus.ts`, `roomPlate.ts`). Reference look for the room screen:
the prototype `tools/viewproto.html` focus mode and its shot `store/playthrough/viewproto/focus.png` (big picture of the room on top,
name, three facts, ONE main button at the bottom).

Branch `clean-front-1` in the MAIN checkout `C:\Users\eitan\Desktop\משחק לשרוד` (vite dev server on :5173 serves it; HMR fine).
Never kill processes by name; don't start servers; don't push; don't commit (the lead commits). Saves must keep loading. Hebrew RTL, phone first
(375 and 320 px wide), touch targets ≥ 44 px, design-system kit (`src/ui/kit/*`, tokens in `src/styles/tokens.css`), no hex literals, no raw z-index.
New i18n keys: add them directly to `src/i18n/en.json` and `he.json` under `cf1.` (natural Hebrew, glossary `store/ux-review/GLOSSARY.md`,
plural forms like existing keys) — you are the only agent working now.

## What to build
1. **Room screen** (new `src/ui/components/RoomScreen.ts` + its own CSS file) replaces the BuildingPanel bottom sheet as what opens when a
   room is tapped (`app.ts` `renderer.onBuildingClick` ~1196, and the other `buildingPanel.show(id)` call sites ~237, ~938).
   - **Top ~45% of the screen = the live room in the world**: the camera frames that room (use `CameraController.frameRect` / add a
     `frameRoom` that fits the room's width to the screen width inside the top area, honouring HUD insets); remember the camera before
     opening and glide back on close. The people in the room keep moving — this is the "Fallout Shelter zoom-in" feel.
   - **Bottom panel**: room name, status (one line from `roomStatus`), three facts (level · workers x/y · its main output or effect in plain
     words per hour), then ONE main action chosen by state: no or too few workers → "fill places" (best fit, `population.assignIdleBestFit`);
     upgrade possible → "upgrade" with its cost; broken/disaster → "repair"; under construction → progress (and rush if the game offers it);
     otherwise no main button. Everything else BuildingPanel shows today (specialty / roles, maintenance card, chain inputs, workers list,
     move, demolish, history…) goes into a collapsed **"עוד" / More** section — reuse BuildingPanel's existing renderers rather than
     rewriting the logic; no feature may disappear.
   - **Neighbours**: swipe left/right (and two small arrow buttons) move to the previous/next room on the same floor, RTL-aware; the camera
     follows. Back / Escape / the close button close the screen.
   - Opening it must not count as an interruption (it is player-initiated); it closes other sheets; it respects the tutorial spotlight
     (the tutorial step "start restoring"/"assign" targets must still be reachable — check `src/ui/onboarding/*` for selectors that point
     into BuildingPanel and keep them working).
2. **Ruins** (`RuinPanel`) keep their sheet for now (out of scope), but tapping a ruin must still work.
3. **Tests/gates**: `npx tsc --noEmit`, `npm run check:full` (onboarding/popup/advisor tests included), `node tools/sim/migrate-test.mjs store/playthrough/saves`.
4. **Screenshots**: extend `tools/playthrough-measure.mjs --tour` with a `room` stop that opens the busiest room through the app's own
   function (the same call the tap makes) and one `room-more` shot with "More" expanded. Take BEFORE shots first (current BuildingPanel)
   into `store/playthrough/clean1/before/`, then AFTER into `store/playthrough/clean1/after/` (stages d4 and d35, widths 375 and 320).
   Read the PNGs and iterate until it looks like the prototype's focus shot and nothing is clipped.
Final message: changes (file:line), how the main action is chosen, what moved under More, before/after observations, anything left.
