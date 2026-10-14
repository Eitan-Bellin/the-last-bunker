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

## Wave 2 - Quick wins on screens (parallel screen-builders, one worktree each, no file overlap)
- SB-HUD: HUD.ts + style.css HUD part: 4 resources max with trend + rate, danger pulse < 15 %, info row slimmed
  (Act chip, population, alerts), touch targets >= 44 px.
- SB-Build: BuildMenu.ts, buildmenu.css, PlacementBar: kit buttons, cost chips with "missing X" reason.
- SB-Room: BuildingPanel.ts, MaintenanceCard, InfraCard: one primary CTA, numbers <= 7 visible, details on tap.
- SB-People: PeoplePanel.ts: survivor cards, empty states, auto-assign surfaced.
- SB-Menu: MenuPanel.ts settings grouping (Sound / Display / Accessibility / Game / About+version).
Then l10n-a11y: contrast fixes, safe-area pass, RTL checks, plurals keys.

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
