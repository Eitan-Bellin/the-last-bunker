# C1 — camera-nav notes: the city camera, hub-stair routing

*Branch `world/c1-C` (from `world-redesign` @ `dae3858`). 2026-10-15.*

## 1. Files

| File | What |
|---|---|
| `src/rendering/CameraController.ts` | City mode (only with `?city`): bounds, home view and overview from the layout, `parallaxInfo()`, `glideTo()`, `follow()` (M2 stub), token-driven feel, zoom limits, reduced motion. Classic paths are unchanged. |
| `src/world/nav/cameraFrame.ts` (new) | `cityCameraFrame(layout)`: `{ bounds, content, hub }` for the camera. Pure, Node-safe. |
| `src/world/nav/hubStairs.ts` (new) | `hubStairX(s, side)`, `hubStairFor(currentFloors, lo, hi, nearX)`, `isHubStairX`, `HUB_STAIR_AMP`, `HUB_FLIGHTS_PER_FLOOR`. Pure and allocation-free. |
| `src/rendering/routes.ts` | Hub stair columns are a tower-hop source in the city. The lift boards and leaves on the balcony lane. A stair trip that runs too long falls back to the lift. |
| `src/rendering/voids.ts` | `hasAnnex()` is false in the city projection. |
| `src/world/tokens.ts` | The CAMERA block only: a header comment and the new `CAMERA.city` sub-block. |
| `tools/sim/routes-test.ts` | A classic route digest, plus the city cases (`cityChecks`, run under `__setProjectionForTests('city')`). |

## 2. For the orchestrator: BunkerRenderer wiring (2 lines, not applied here)

I did not edit BunkerRenderer (it is the tech-artist's file). I tested these two lines locally and then reverted them:

```ts
// mountCity(), right after the walkers' ambientAt override (l.548):
host.parallaxInfo = () => this.cam.parallaxInfo(); // [world:C1 camera-nav] the official parallax camera (reduced motion: no drift)

// syncCityLayout(), right after `if (host.syncLayout(...)) this.undergroundSig = '';` (l.1466):
if (host.current) this.cam.setCityLayout(host.current); // [world:C1 camera-nav] city bounds, home view, overview
```

- The first line replaces `CityHost.parallaxInfo` on the instance. `CityHost.frame()` already calls `this.parallaxInfo(wc, sw, sh)`, so cityHost.ts needs no change. The extra arguments are simply ignored.
- The values match `parallaxFromWorld`: they are read from the world container, so the shake and the punch are included. The one difference is the anchor: it is the camera centre (`width/2`, `viewCY()`, between the HUD bands) and not the screen centre. That is the architecture's "camera centre". On a phone the shift is about 40 screen px of anchor, which only moves where each plane's content is pinned.
- `setCityLayout` is cheap. It returns early when the frame did not change, so it is safe to call on every sync.

## 3. Camera (architecture 5.2 / 6.2)

**Frame** (`cityCameraFrame`):

| Part | What it covers |
|---|---|
| bounds | Revealed storeys, edge stubs, districts, glimpsed or found pockets, and the hubs with their vestibules. Depth goes down to the deepest area that is not hidden (the dig face). Plus `CAMERA.pan.margin` (140) on the sides and 70 below. The top is `CAMERA.city.topY` (-140, the classic VIEW_TOP). |
| content | The same set without the pockets. This is what the desktop home view fits. |
| hub | The stratum-1 hub plus its two vestibules. In the slice that is x -100..158, centred on the spine (29). |

- A glimpsed storey (the dig face spans the world's width) counts for depth only, never for width.
- The layout's own `bounds` are not used: they carry a dressing pad of 420 to the sides and 700 of sky.
- The camera still unions in the host's `extentL`/`extentR`, so the surface row and the project sites stay reachable.

**Home view** (`fitToScreen` with a frame):

| Screen | Home view |
|---|---|
| Phone (< 700 CSS px) | Spine-centred. Zoom = width / (hub with vestibules + `CAMERA.city.phoneSlots` 4 × SLOT_W). It is clamped to people ≥ `minPersonPx` (30 px), at most `phoneMaxZoom` 1.25, and at least `CITY_Z_FLOOR` (just above the map threshold, with its hysteresis). Vertically, the surface strip shows on top when the hub fits under it; otherwise the view centres on the hub. |
| Desktop | The whole dug city fits between the HUD bands, with a 4% margin, up to 1.6. |

Measured in the slice: on a 375×812 phone, zoom 0.85, centre x 29. On a 1024×768 desktop, zoom 0.64, which shows the slice whole.

**Overview** (double tap on empty space, or the chips): the whole dug city across, never below `CITY_Z_FLOOR`.

**The core chip** (`coreX`): the spine.

**Feel.** In the city all of these come from the tokens:
- `CAMERA.zoom.min` / `max` (0.32 / 3);
- `pan.friction` / `edgeSpring`;
- `springs.focus` / `zoom`;
- the fling cap: `maxFlingPhone` 2600 / `maxFlingDesktop` 4200 (classic keeps 5000).

The rubber band, the soft zoom limits and the critically damped springs are the existing ones. I checked the camera released 1,900 units past the west edge: it springs back to the bound with no overshoot.

**`glideTo(x, y, z?, rate = CAMERA.city.glide 4)`.** It uses the same spring at a gentler rate. Under reduced motion it cuts straight there.

**`follow(get)` (M2 stub).**
- While `get()` returns a point, the camera glides at `CAMERA.follow.spring` to keep it inside the central `deadZone`. `null` ends the follow.
- A touch or the wheel cancels it (`cancelOnDrag`).
- `moving` stays true while following, so the engine draws at its motion rate.
- Checked by stepping the camera: a point outside the dead zone gets centred (up to the bounds clamp); a point inside it does not move the camera.

**Reduced motion (city only; classic is unchanged):**
- There is no fling coasting (`CAMERA.city.calmFling` false).
- Focus moves settle faster (`calmFocusSpring` 12).
- `glideTo` cuts.
- **No parallax drift.** `parallaxInfo()` keeps the anchor still at the middle of the city, so the planes move rigidly with the world while you pan. The zoom stays live, because the planes' culling math needs the real zoom.
  - A still anchor can run the slowest plane (far, p 0.4) out of content at high zoom near the edges. `calmAnchor` therefore slides the anchor exactly as much as needed to keep the view inside 85% of the plane's content (the content extent is the layout bounds ± half their larger side, as `backdrop.ts setLayout` builds it).
  - Measured in the slice: the anchor stays still at zoom 0.5 to 2.5 everywhere in bounds. It slides only at zoom 3 at the far west.

## 4. Routing (D10, 1.3)

**Hub stairs.**
- They are towers in `hop()`. In the city, `hubStairFor` gives the nearest hub column when lo..hi are dug floors of one stratum. It returns nothing across a gallery and nothing for the surface.
- The nearest of hub column / void tower / built stairwell wins, as before.
- With power, a one- or two-storey hop takes the hub stairs on a roll below `CITY_HUB_STAIR_SHARE` (0.5); a void tower stays at 0.4 and a stairwell at 0.3. In a blackout the stairs are always taken.

**Flight direction.**
- `shell/hub.ts` draws the first flight from the top running down to the LEFT, and every hop is an even number of flights.
- So a walker enters and leaves a hub column on its right landing (`x + 19`), with `amp = HUB_STAIR_AMP = -19`. In walkers.ts, `x = start + amp + amp·zig` then zig-zags centre+19 → centre-19, which matches the drawn flights.
- Flights: 4 per storey, 36 high each, lane to lane.

**Lift (balconies).** In the city the walker steps onto the corridor lane, walks along the vestibule and the balcony to `LANDING_X`, and boards there. It gets off on the other floor's lane. In classic the landing stays on the room line.

**No teleports between the slice floors.** If a stair hop makes the trip longer than `MAX_TRIP_S`, `route()` plans again with the lift (roll 1).

**Annex.** It is off in the city (`hasAnnex`). frontChunks already did not draw it.

## 5. Tests and gates

**`routes-test`.**
- The classic cases are unchanged.
- It prints a **classic digest** of 336 plans (airy on and off, lift on and off, rolls low and high, a stairwell, the surface): `261d4638`. That is identical with the pre-change routes.ts and voids.ts, which I checked by stashing them.

City cases (the slice from `buildSliceState('slice')`, airy on):

| Case | Result |
|---|---|
| Stair columns | Equal to `buildCityLayout(...).hubs[].stairs`. |
| `hubStairFor` rules | Undug floor, cross-stratum and nearest column all correct. |
| Annex | Off. |
| Blackout 0→2 | East hub column, right landing, amp -19, 8 flights, lane to lane, the zig-zag inside the 44-wide column. |
| High roll | The lift, boarded and left on the balcony lane. |
| Low roll | The hub stairs. |
| All slot pairs on floors 0-2 (×3 lift modes) | **864 plans, none refused, no ladder.** 576 by stairs, 288 by the lift. The longest is 51.3 s (cap 60). |
| Surface → floor 2 | Climbs the shaft ladder to floor 0 first. |
| Closed door | Blocks the walk (acceptance 6.4). |
| Camera frame | Hub inside content, content inside bounds, bounds tighter than the dressing bounds, hub centred on the spine. |

**Gates.**
- `tsc` is clean.
- `npm run check:full` is green (EXIT 0; every suite, with routes-test as above).
- `vite build` is OK (only the usual chunk-size warning).
- I checked classic in the browser: `cityBounds` is null, and the home view is the classic one (z 1.02, centre x 138 on 375 px).

## 6. Not verified / open

- **Live walkers in the browser.** The hidden pane pauses rAF, so I stepped the camera by hand, and the routes are covered by the Node checks. Watching a survivor walk the hub stairs is for the integration pass, once the shell is plugged in.
- **The shell does not draw in-game at `dae3858`.** `citySeams.setShellMounter` is not registered yet, and the layout provider is the tech-artist's stub. The in-game layout `bounds` (y from -1600) differ from `buildCityLayout`. The camera frame follows whichever layout the host holds.
- **Shared `node_modules` is damaged** (seen around 06:45-07:00):
  - `last-bunker-world/node_modules` → `משחק לשרוד/node_modules` has no `.bin`, no `@pixi/colord`, and no `package.json` in `@rolldown/binding-win32-x64-msvc`;
  - as a result `npx vite` fails ('vite' not recognized), the dev server 500s on `@pixi/colord`, and the sim bundler cannot load rolldown;
  - workaround, with no change to the shared install: I ran `npm ci` into my scratchpad (`.../scratchpad/deps`) and repointed **this worktree's** `node_modules` junction there;
  - `preview_start world-C` cannot work until the shared install is repaired (`npm ci` in `משחק לשרוד`); I ran vite from lbw-C directly on 5177;
  - with the damaged install, the sim tests can still run if `NAPI_RS_NATIVE_LIBRARY_PATH` points at `@rolldown/binding-win32-x64-msvc/rolldown-binding.win32-x64-msvc.node`; with the scratchpad install no override is needed.

## 7. Decisions taken (user asleep)

- **Phone home view.** It is spine-centred, as the brief says. The west half shows the west vestibule and the edge stub, because the slice has no west rooms. If it reads empty once the shell is in, bias it east with one token (`phoneSlots`, or an offset).
- **Pockets.** They count in the bounds (you can pan to their teases) but not in the desktop framing.
- **Reduced-motion parallax.** It is done through the anchor alone, with no renderer change. Zooming under reduced motion still scales the planes a little, which is user-initiated.
- **Hub stair share.** 0.5 is higher than the void tower's 0.4, because the atrium is the showpiece.
