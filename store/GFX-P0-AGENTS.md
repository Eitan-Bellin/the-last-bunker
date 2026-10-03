# Graphics phase 0 ("quick wins") — shared brief for the parallel agents

Project: `C:\Users\eitan\Desktop\משחק לשרוד` — "The Last Bunker", TypeScript + Vite + PixiJS v8, side cross-section bunker idle game, Hebrew + English.
Why: the user finds the graphics "low-level", "pictures and puppets that move their arms". Seven review agents wrote audits in
`store/gfx-audit/*.md` (rooms, people, structure-lighting, surface-world, ui, vfx-animation, tech-direction). Phase 0 = the
**quick wins** from those audits: no new painted art, days not weeks, big visible improvement. Read your audit file(s) fully first,
and `store/GFX-AGENTS.md` (architecture, art bible, kit pipeline, dev helpers).

## Two teams work at the same time — respect ownership
A different team (balance agents, brief `store/GAME-AGENTS.md`) is editing game logic right now: `src/core/*`, `src/systems/*`,
`src/data/*`, `src/ui/components/BuildingPanel.ts`, research/prestige panels, `src/app.ts`, `src/i18n/*.json`.
**Do not edit those files.** If you truly need a one-line hook in `app.ts` or a new i18n string, keep it to a minimal, clearly marked
edit (`// gfx-p0:` comment), re-read the file right before editing, and add i18n keys to BOTH he.json and en.json as a small block.
Prefer solutions that live entirely in your own files.

## Rules
- Never touch the player's real save (IndexedDB `keyval-store`/`keyval`, key `lastbunker_auto`). Use only `?slot=gfx` (developed
  era-3 test bunker) or your own `?slot=<yourname>` on your OWN browser tab (`mcp__Claude_Browser__tabs_create`; never close or use
  other tabs). Dev server is already running at http://localhost:5173 — don't start/stop it, don't kill processes.
- Other agents' tabs freeze when you front yours (rAF pauses in background tabs). Prefer the dev helpers that pump the renderer by
  hand (`__shotAt(x, y, zoomRel, name, tag)`, `__compare(tag)`, `__cam(id)`, `__perf()`), front your tab only briefly when you must
  watch motion, set viewport 430×932 with `resize_window` on your tab. `window.__forceNight = 0|1` holds day/night.
- Save before/after shots to `store/compare/p0-<your-tag>/` (`before-*.png`, `after-*.png`).
- Type-check: `npx tsc --noEmit -p .` and `npx tsc --noEmit -p tsconfig.tools.json`. If an error is in a file you don't own, wait a
  minute and retry; never fix someone else's file.
- Shell: write patch scripts as .cjs files in your scratchpad (heredocs with backticks break). Re-read a file right before editing it;
  small, local edits; match the surrounding style and comment density. No new npm dependencies.
- Performance: mobile first. Pool objects, no per-frame allocations, respect the quality ladder (`PerformanceMonitor` high/medium/low),
  make every new effect time-based (dt / ms), not frame-based. Check `__perf()` before and after; report the delta.
- Old look switch `?gfx1` must not crash (it may simply not get the new effects).

## Ownership
`BunkerRenderer.ts` is shared: the **Camera** agent owns the camera/input section; everyone else may add only small, marked hook lines.
- **Camera & juice** (tag `camera`): camera code in `src/rendering/BunkerRenderer.ts` (pan/pinch/wheel/inertia, `focusOn`, shake,
  `updateTransform`), `src/ui/components/NumberPopup.ts`. Items: inertia + rubber band, pinch/wheel anchored at fingers, spring
  `focusOn`, trauma-based shake + small zoom punch API (`renderer.punch()`) others can call, double-tap room to frame it, popups
  dt-based + merged per room per wave + capped + hidden in rooms with an active incident (read incident state, don't edit systems),
  fix every frame-rate-dependent lerp you find in the renderer (120 Hz bug).
- **Rooms alive** (tag `rooms`): `src/art/registry.ts` (ROOM_FX / lamp data), `src/rendering/paintedRoom.ts`, `src/rendering/roomArt.ts`,
  `public/art/meta.json` (fx data only). Items: FX spots for ALL 45 paintings + halls (steam, flame pulse, bubbles, drips, screen
  flicker, LED blink, sparks, fans/needles where simple) — look at each painting to place them; tame glow/cones on bright tiers
  (scale by `1 - balance.lum`, skip cones already baked); masked heat/steam shimmer (DisplacementFilter, high quality only);
  painterly upgrade scaffold instead of flat rects if feasible procedurally.
- **Structure & light** (tag `light`): `src/rendering/structure.ts`, `src/rendering/postfx.ts`, `src/rendering/shaft.ts` (shadow strips
  only), `src/rendering/world.ts` underground/rock part, `src/style.css` grain/vignette overlay rules only. Items: bloom fed by
  lights/emissives only (or at least a soft-knee threshold that stops the white-out); slab highlight lip + cut-face casing thickness;
  replace stacked-rect shadows with gradient textures; rock richness + fill the navy void below the bunker; in-engine grain/vignette
  replacing CSS scanlines; underground night dimming (corridors darker, warm night lights) via a small hook on night state.
- **People** (tag `people`): `src/rendering/people.ts`, new `src/rendering/workSpots.ts`, the people part of `BunkerRenderer.renderPeople`
  (marked hook edits). Items: per-room-type work spots that face the equipment (look at the paintings) with spacing so people don't
  overlap; pose cross-fade (~0.2 s) and turn-in-place instead of instant mirror; stride tied to speed (no foot sliding); muted
  casual palette per art bible; child proportions (bigger head, shorter limbs); a soft cast shadow sprite per person sheared away
  from the nearest lamp; name-tag de-collision; hurt/sick body language (limp/hunch). Decide people scale with evidence (rooms audit
  says people are too tall vs painted furniture; people audit says scale is fine) — measure and choose, explain why.
- **Surface** (tag `surface`): `src/rendering/surface2.ts` (and the surface part of `world.ts` if needed — coordinate: Structure owns
  underground). Items: scrolling cloud layers + low fog bands, slight vertical parallax of the backdrop, grass/foliage wind sway
  (DisplacementFilter masked), bird flocks + chimney/vent smoke, organic topsoil cut (noisy edge, not a straight band), era-0 ash
  fall + occasional rain, night sky (stars, moon; hide/dim the painted sun at night), portal colour-graded to the panorama light,
  far-zoom framing (no empty navy box).
- **Crisis FX** (tag `crisis`): `src/rendering/incidentFx.ts`, `src/rendering/atmosphere.ts` (shared particle helpers, coordinate:
  read before editing). Items: fire = flame flicker + dark pooled smoke + ember streaks + scorch decal after + orange into the shared
  `roomFlicker`; blackout drives the real lamps down via `roomFlicker` (stutter back on when fixed) instead of a black box; breach =
  rotating red beacon instead of a full-room wash; flood = better surface line with highlight, darker depth, ripples; move the alarm
  badge up so it doesn't cover the fire; painted raiders using the people rig API from `people.ts` (don't edit people.ts — ask
  via your report if you need a new export). Trigger incidents only in your own slot copy and clear them afterwards.
- **UI** (tag `ui`): `src/style.css` (except grain overlay), `src/styles/*.css`, `src/ui/HUD.ts`, `src/ui/dom.ts`, `src/ui/icons.ts`,
  `src/ui/components/Intro.ts`, `src/ui/components/MenuPanel.ts`, `index.html` (fonts). Items: HUD fits a 360–430 px phone (menu reachable,
  nothing clipped; add phone media rules); hidden sheets cast no shadow over the nav; RTL numbers (`direction:ltr; unicode-bidi:isolate`
  on value chips); readable small-size Hebrew font (Karantina only ≥28 px; e.g. Secular One / Heebo for small titles; tabular digits);
  purge leftover purple/orange to one palette; close plate ✕ + swipe-down on sheets; intro panels reach full opacity; a better first
  ("tap to enter") screen using existing art (e.g. the era-0 backdrop + door + title lockup) — no new art required.

## Report back (final message)
Files changed (`path:line`), what each item does, what you verified (shots in `store/compare/p0-<tag>/`), `__perf()` before/after,
anything skipped and why. Keep it under ~400 words.
