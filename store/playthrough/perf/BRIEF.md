# Performance pass — "the game must not freeze or heat the phone" — brief

Work ONLY in the worktree `C:\Users\eitan\Desktop\משחק לשרוד\.claude\worktrees\perfbase` (branch `perf-pass`, = today's main). `node_modules` there is
a JUNCTION to the main project's: never delete it, never `npm install/ci`, never `git worktree remove`. Never kill processes by name (only PIDs
you started; `tools/perf/run.mjs` closes its own Chrome). Don't commit or push (the lead commits). Two other agents are editing gameplay in the
MAIN checkout at the same time (branch `phase4b`): to keep the merge clean, DO NOT edit `src/ui/HUD.ts`, `src/styles/hud.css`, `src/systems/**`,
`src/data/**` (except a pure perf fix you report), `src/ui/components/{SurfacePanel,TradePanel,ShopPanel,JournalPanel}.ts`,
`src/ui/controllers/{danger,inbox,daily}.ts`. Your area: `src/rendering/**`, `src/world/render/**`, `src/art/**`, `src/core/GameEngine.ts`
(frame/tick governor only), `src/utils/**`, `src/main.ts`, `src/app.ts` (lazy loading only), `vite.config.ts`, `src/audio/**`, `tools/perf/**`.

The gate: `npx vite build` then `node tools/perf/run.mjs --dist dist --out store/playthrough/perf/after.json` (and `--throttle 4` for a mid-range
phone feel, information only). Budgets: `tools/perf/budget.json` (read its notes; never loosen a limit without writing why). Baseline of today's
main: `store/playthrough/perf/perf-base.log` — OVER BUDGET there:
- `f24-far-medium` (zoomed far out, the city map view): draw calls 554 > 220, objects drawn 5138 > 800, texture 334 MB > 290, 24.7 fps,
  frames 19/44 ms, 15 long tasks. Since the "clean front" step 0/2 the far zoom shows the city rock/strata/shell again — at far zoom the
  rooms should collapse to the cheap city map (`src/rendering/cityMap.ts`) and anything not visible must not be drawn or animated.
- `f24-idle-medium`: busy 20.6% > 12% (an idle phone heats up): check the picture-rate governor (`GameEngine.pictureInterval`), animations
  that keep the frame rate high (celebration glow, floor tag, ambient FX), timers.
- bundle: all JS 877 KB gz > 625, first load 722 KB gz > 560: lazy-load what the first screen does not need (story data, Bunker Book, Genesis
  screens, Crossroads, RoomScreen "More", tools), check for accidentally bundled dev code (`src/dev/**` must stay out of production).
- memory: RSS 700–900 MB and 280–330 MB of GPU textures: phones kill tabs around there. Check texture sizes/mipmaps of the 18 new room
  paintings (public/art/rooms, 480x522 / 720x522 webp) and that off-screen room textures are released (ArtLibrary memory sweep).
- `f24-close-high` measured 0 fps / 0 draw calls: find out whether the scenario or the game is broken at High quality, fix it.
Also check the new features for per-frame cost: RoomScreen camera framing, floor snap, floor-tag overlay, success glow, signature/siege
countdown, Crossroads overlay. No visual change the player would notice at normal zoom (screenshots before/after with
`node tools/playthrough-measure.mjs` need a dev server: you may start `npx vite --port 5190 --strictPort` in this worktree and stop it by PID).
Gates before you finish: `npx tsc --noEmit`, `npm run check:full`, `node tools/sim/migrate-test.mjs store/playthrough/saves`, the perf run.
Final message: before/after table per scenario (calls, objects, fps, frame p95, busy, texture MB, RSS, bundle), what you changed (file:line), what's
still over budget and why.
