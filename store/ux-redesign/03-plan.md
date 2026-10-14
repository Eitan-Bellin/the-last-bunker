# 03 - Wave plan (UX/UI overhaul, branch ux-redesign)

Base: `ux/review-fixes` (includes feat/airy-bunker + 43 earlier UX commits), tag `ux-baseline`.
Engine adaptation: web (TS + Vite + Pixi DOM overlay) -> tokens are CSS variables, components are TS DOM helpers,
tests are `tools/sim/*-test.mjs` (Node) + tsc + lint, layout checks in the browser pane.
Owner instruction 2026-10-15: "don't stop, no questions" -> the approval stop after stage 3 is waived;
hard limits stay: no game-logic/balance/save-format changes, no push/merge to main, no --force, no deletes.

## Wave 1 - Design foundation (tokens first, everything reads from them)
Owner: design-system (serial, runs first).
- One `:root` (merge style.css + bunker-os.css, resolve the --text-primary drift) in new `src/styles/tokens.css`:
  colour tokens from the brief (surface-0..2, text, primary amber, success/danger/warning/info, per-resource colours),
  spacing 4/8/12/16/24/32/48/64, radius, elevation, z-index layers (world, hud, panels, popups, toasts, system, tutorial),
  type scale (caption 12 / body 14 / body-l 16 / subtitle 18 / title 22 / headline 28 / hero 40) x `--fs`,
  motion durations + easings (press 60/150, popup 250/180, screen 300, toast 200/2500/200, stagger 40).
- Self-host fonts (Rubik, Secular One, Karantina) under public/fonts -> offline/Capacitor safe.
- `src/ui/kit/`: Button (primary/secondary/tertiary/icon/close, states default/pressed/disabled+reason/loading/highlighted,
  action on release, 300 ms debounce, blocked = shake + "no" sound + reason tooltip), ResourceChip, ProgressBar(value/max, ghost),
  Card/Row, Badge (99+), Tabs, EmptyState, Timer, Tooltip/long-press.
- `src/ui/format.ts`: compact numbers (9,999 exact, 15.2K, 1.52M, B, T), timers (2d 4h / 4h 12m / 12:05 / 45s),
  Hebrew/English plurals via Intl.PluralRules.
- Token test: every token defined, text/background contrast >= 4.5:1 (tools/sim/tokens-test.mjs); format test.

## Wave 2 - Quick wins from the audit (02-audit.md issue #), parallel screen-builders after wave 1 merges,
one worktree each, disjoint files; new strings in a top-level i18n block per agent ("ux2a".."ux2f").
- A Interruptions & layering: dialogQueue.ts, app.ts, Modal.ts, Toast.ts, ceremony.ts, controllers/{feedback,events,
  welcome,tips,saves,story,lore}.ts, core/saveFlag.ts -> #4 #5 #6 #7 #11 #12 #18 #19 #20 #21 #22 #39.
- B HUD: HUD.ts, style.css (HUD/nav), touch.css -> #8 #27 #31 #35 #37 #44, UI half of #1 (time-to-empty on tiles,
  morale top cause), shop entry chip (#23 HUD side), resource danger pulse, max 4 resources + "more".
- C Build/placement/ruins: BuildMenu.ts, PlacementBar.ts, controllers/world.ts, RuinPanel.ts, buildmenu.css,
  placement.css -> #2 #3 #16 (+#17 camera framing via hudInsets if contained in world.ts).
- D Research/Surface/Shop/Journal: ResearchPanel, SurfacePanel, worldMap, ShopPanel, JournalPanel -> #9 #13 #14 #15 #23 #24.
- E Room/People/Menu/Command: BuildingPanel, PeoplePanel, MenuPanel, EraPanel -> #25 #28 #29 #32 #33 #45.
- F Small tech: BunkerRenderer resize (#26), NumberPopup default (#36), Sheet speed/cross-fade (#38),
  depth ruler/badge sizes (#42), audio unlock on splash (#43), RTL floor tags (#41).
Not UI (game logic, owner approval needed, written up as proposals only): #1 Act I drain rates, #10 mid-game economy
(stores full by day 10), #30 duplicate names, #40 language switch without reload (kept for wave 5 if cheap).

## Wave 3 - Simplify (onboarding + HUD/bunker)
- onboarding: "What now?" advisor button driven by Guide.ts (crisis -> reward -> active task -> upgrade),
  idle hint hand after 9 s, spotlight overlay for FTUE steps, "collect all".
- Popup policy: extend dialogQueue (priority order per brief, one at a time, sale max 1/session).
- Android back: Capacitor App.backButton hook next to popstate (no-op on web).

## Wave 4 - Pleasant (motion-audio)
- Press feedback everywhere via kit, popup open/close motion, toast motion, list stagger, count-up numbers,
  fly-to-HUD particles on collect with icon pulse, combo pitch, haptics map per event, reduce-motion fallbacks.

## Wave 5 - Polish
- l10n-a11y: full RTL review, longest-string overflow, 130 % text, settings completeness.
- qa-tester: full regression (fresh install -> tutorial -> 10 min -> exit -> welcome back; old saves load).

Each wave: agents -> merge -> qa-tester (check:full, build, layout at 4:3/16:9/19.5:9/21:9 he+en) -> reviewer
(fresh eyes, diff only) -> fixes -> commits -> push ux-redesign -> tag ux-wave-N -> report in store/ux-redesign/wave-N.md.
