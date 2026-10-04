# The Last Bunker · הבונקר האחרון

A post-apocalyptic idle/survival bunker game (side cross-section like Fallout Shelter), in Hebrew and English.
TypeScript, Vite and PixiJS v8. Plays in the browser, installs as a PWA, and is prepared for a Capacitor Android/iOS build.

Play: https://eitan-bellin.github.io/the-last-bunker/ · [Privacy policy](public/privacy.html)

## Develop

```bash
npm install
npm run dev        # http://localhost:5173  (add ?slot=test for a throw-away save, ?debug on a build for console handles)
npm run build      # type-check + production build into dist/
npm run check      # type-check + a one-day simulation of the game logic (what CI runs)
```

Every push to `main` is checked and deployed to GitHub Pages (`.github/workflows/pages.yml`).

## Layout

| Path | What |
|---|---|
| `src/core` | game loop and engine, state, **saving** (`SaveManager.ts`: backups, recovery, off-thread compression), crash guard |
| `src/systems` | the rules: resources, population, buildings, events, raids, exploration, research, story, prestige… |
| `src/data` | content tables (buildings, research, story, eras, projects…) |
| `src/rendering` | the PixiJS scene: rooms, people, lighting, surface world, post-processing |
| `src/audio` | the soundtrack and effects, synthesized at runtime |
| `src/ui` | HUD, panels, dialogs (DOM) |
| `src/i18n` | Hebrew and English strings (`he.json`, `en.json` must keep the same keys; `{g}` picks a gender in Hebrew) |
| `tools` | art pipeline pages and the **balance simulator** (`tools/sim`, see its README) |
| `store` | store listing text and assets, design notes |

## Saves (important when changing anything under `src/core`)

The save lives in IndexedDB under `lastbunker_auto` as LZ-compressed JSON. **Its key and format must never change**: the game on players' phones depends on it.
Next to it the game keeps `_bak` (start of the session), `_roll` (every half hour), `_prev` (before a new game / import / Genesis / restore) and `_corrupt` (an unreadable save, kept for repair).
Adding a field to the state? Give it a default in `migrateState` (`src/core/GameState.ts`).

## Balance

`node tools/sim/run.mjs --mode casual --days 7 --seeds 1-3` runs the real systems with a bot (see `tools/sim/README.md`).
