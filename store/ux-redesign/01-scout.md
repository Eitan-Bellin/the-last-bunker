# 01 - Scout report (UX/UI overhaul, branch ux-redesign)

Read-only survey, 2026-10-15. Paths relative to project root.

## 1. Stack, UI system, commands

| Item | Value |
|---|---|
| Language/build | TypeScript ~6.0.2, Vite ^8.3.0 (`"type":"module"`) |
| Renderer | pixi.js ^8.22.0 (canvas `#game-canvas`, z 0) |
| Other deps | howler ^2.2.4 (audio, plus own synth in src/audio), idb-keyval ^6.3.0 (saves), lz-string ^1.5.0 |
| Native shell | `capacitor.config.json` only (appId com.lastbunker.game, webDir dist, bg #07090c). No @capacitor packages in package.json: plugins (Haptics etc.) are reached by `nativePlugin()` in src/utils/platform.ts, injected by the shell. No android/ios folders in repo. |
| PWA | public/manifest.webmanifest, public/sw.js, apple splash images (index.html), src/ui/pwa.ts, src/styles/pwa.css |
| Commands | `npm run dev` (vite), `npm run build` (tsc && vite build), `npm run check` (tsc --noEmit + tools/sim smoke + lint + glossary-lint), `npm run check:full` (adds migrate/placement/infra/routes/rooms/openings/daily/foreman tests). Dev-server launch config named `ux` in .claude/launch.json. URL flags: `?slot=NAME` (save slot), `?debug`, `?perf`. |
| UI split | World is Pixi: rooms, people, incidents, ruins, dig/wing-dig buttons (renderer.onDigClick/onWingDig), elevator, project sites, lighting/postfx, floating number popups (NumberPopup.ts attaches to renderer.worldContainer), room signage (signage.ts draws Karantina/Rubik text into canvas). Everything else is DOM overlay: HUD, bottom nav, all sheets, modals, toasts, ceremonies, story dialog, intro, depth ruler, zoom buttons, placement bar, tour shield. Icons are inline SVG via `[[name]]` tokens (src/ui/icons.ts, rendered by `setRich` in dom.ts). |
| Language/dir | `<html lang="he" dir="rtl">`, Hebrew/English switch (I18nManager); logical CSS properties (`inset-inline`, `margin-inline-start`) used. |
| Fonts loaded | Google Fonts link in index.html: Karantina 400/700 (display), Rubik 400-800 (body), Secular One (titles). Tokens `--font-display`, `--font-title`. Network-only (no self-hosted copy). Also `monospace` for timers and 'Courier New' for tape lore. |

## 2. Folder map

| Area | Where |
|---|---|
| Entry | src/main.ts (121), src/app.ts (1294; GameApp wires everything, back navigation, dialog sources, nav handlers) |
| Core/state | src/core: GameEngine, GameState (types incl. A11ySettings), StateManager, SaveManager (+saveWorker, crashGuard, singleInstance), EventBus.ts (`bus`), state/ |
| Systems (logic) | src/systems: 39 files (Building, Resource, Population, Research, Project, Contract, Daily, Threat, Incident, Exploration, Outpost, Foreman, Guide, Objective, Inbox, Shop, Rush, Meta...) |
| Data tables | src/data: acts, eras, resources, buildings.json/buildingDefs, research*, projects, laws, orders, challenges, shop, trade, incidents, expeditionEvents, achievements, story, lore, book, tuning, difficulty |
| Pixi scenes/renderers | src/rendering (~70 files): BunkerRenderer (1739), CameraController, RoomViews, PlacementController/Ghost, roomArt/roomSpecs*, people*, incidentFx, postfx, atmosphere, signage, surface*, cityMap, shaft, walkers, richText, HitSlop, LabelScale |
| DOM UI | src/ui: HUD.ts, dom.ts (helpers), dialogQueue.ts, ceremony.ts, tour.ts, notifications.ts, textSize.ts, a11yDom.ts, icons.ts, splash.ts, viewportUi.ts, rtl.ts, missing.ts, share.ts, pwa.ts |
| Components | src/ui/components (31): Sheet, Modal, Toast, BuildMenu, BuildingPanel, PeoplePanel, ResearchPanel, EraPanel (Command), JournalPanel (+shop tab), ProjectsPanel, ResourceSheet, SurfacePanel, TradePanel, RuinPanel, StructurePanel, HelpPanel (Book), ChroniclePanel, MenuPanel, StoryDialog, Intro, CouponPanel, SafetyCard/InfraCard/MaintenanceCard, DepthRuler, ZoomButtons, PlacementBar, NumberPopup, DropChip, worldMap |
| Controllers | src/ui/controllers (15): welcome, world (taps/placement), danger, dig, events, daily, inbox, feedback, saves, story, lore, tips, systems ("new system" cards), whatsnew, keyboard. `src/ui/screens/` exists but is EMPTY. |
| Styles | src/style.css (744, tokens + HUD + base), src/styles/*.css (15 files, 2,702 lines): bunker-os (519, steel-plate skin, nav, tokens), depth, story, touch (365, landscape/coarse), a11y (212), buildmenu, placement, command, daily, checkin, ceremony, ruler, share, tour, pwa, ux-wp4 |
| Art | public/art/{backdrops,biomes,districts,halls,kit,people,portraits,rooms,ruins,story,ui} (WebP, meta.json, balance.json); art-src/ raw; src/art/ArtLibrary+registry; src/assets/{audio,sprites} are empty |
| Audio | src/audio: AudioEngine, music, ambience, sfx, synth, dsp, beds, uiSound (procedural, no audio files in repo) |
| i18n | src/i18n: I18nManager.ts, he.json, en.json (1,658 lines each), locales.ts |
| Config | vite.config.ts (art-pipeline dev plugin), tsconfig*.json, capacitor.config.json, public/manifest.webmanifest |
| Tools | tools/sim (headless balance sim + tests), tools/*.html dev pages (art, kit, icons, roomset), tools/a11y |
| Reports | store/ux-review/*.md (earlier), store/ux-redesign/ (this) |

## 3. Mechanics in the game

| Mechanic | Note | Key file |
|---|---|---|
| Resources tier 1 | food, water, power (no storage), materials, medicine, knowledge, scrap: ticked, capped | data/resources.ts, systems/ResourceSystem.ts |
| Resources tier 2 | components (Act 3), alloys (4), data (5), influence (6), seedCores (7): appear by Act | data/resources.ts |
| Meta currencies | isotope7 (prestige), blueprints, vaultCoins, credits (storage overflow becomes credits, spent in shop) | data/resources.ts, shop.ts |
| HUD resources | 12 plates possible; phone default shows 4 core (food, water, power, materials); others join when needing attention; "show all" pill; tier-2 only for current+previous Act; tap opens ResourceSheet. Meta currencies not in HUD row (credits shown in shop tab). | ui/HUD.ts |
| Survivors | people with 5 stats, traits, children/families, assignments, morale, arrivals, deaths/memorials | systems/PopulationSystem, FamilySystem, DeathSystem, morale.ts; PeoplePanel (664) |
| Rooms/building | ~42 room types, slot placement on floors, levels (Mk) capped per Act, specialisations + retool, wear (lvl 3+), doors/stairwells/vents (infra) | BuildingSystem, buildingDefs, specializations.ts, MaintenanceSystem, InfraSystem; BuildMenu, BuildingPanel |
| Digs | new floors (Act floor cap), side wings, districts | DigSystem, wings.ts, districts.ts; controllers/dig.ts |
| Ruins restoration | clear collapsed areas with crews, loot + lore | RestorationSystem; RuinPanel |
| Expeditions/surface | hex world map, biomes, teams, choice events, outposts, trade caravans | ExplorationSystem, OutpostSystem, trade.ts; SurfacePanel, TradePanel, worldMap |
| Raids/threats | threat meter, raid profile per Act, disasters, away-danger | ThreatSystem, AwayDanger, DeathSystem; controllers/danger.ts, SafetyCard |
| Incidents | fires, epidemics, malfunctions; tapped on map or banner | IncidentSystem, data/incidents.ts; rendering/incidentFx |
| Research | large tree (long/late/rooms/infra sets); knowledge currency | ResearchSystem, data/research*.ts; ResearchPanel |
| Crafting/retool | production chains from Act 3; room specialisation + retool | specializations.ts, BuildingPanel.onRetool |
| Events | random event dialogs, expedition questions | EventSystem, controllers/events.ts, data/expeditionEvents.ts |
| Projects/charters | staged big projects fed with goods and crew; each Act ends with a charter; weekly challenge + cosmetics | ProjectSystem, data/projects.ts, challenges.ts; ProjectsPanel |
| Acts/eras | 7 Acts (levelCap/popCap/floorCap, goals, charter) + 4 eras + Genesis rebirth | data/acts.ts, eras.ts, ActSystem, EraSystem, MetaSystem |
| Contracts | goods delivered or people sent out for hours; arrive as inbox cards | ContractSystem, InboxSystem |
| Laws | policy slots with morale/output/appetite/threat trade-offs | data/laws.ts; EraPanel |
| Foreman | standing-orders automation | ForemanSystem |
| Rush charges | skip 15 min of build/research/travel | RushSystem |
| Seasons, day/night | season chip from Act 2; clock | data/seasons.ts, dayCycle.ts |
| Daily | 3 orders/day reset 04:00, streak, chest, supply crate | DailySystem, data/orders.ts; controllers/daily.ts, welcome.ts |
| Shop | Real in-game store only, paid with earned credits; no IAP, no ads, no real money (grep for admob/rewarded/billing finds nothing). Items: blueprint, scrap20, researchBoost, projectBoost, isotope, crate, actGoods. Lives as 3rd tab of the Journal sheet. | data/shop.ts, ShopSystem, ShopPanel |
| Ads | none | - |
| Coupon | dev-only code, works only on ?debug page | CouponPanel |
| Achievements | tab in Menu | data/achievements.ts, MenuPanel |
| Prestige | Genesis rebirth, isotope upgrades, earlier-timeline homes pay tribute | MetaSystem, prestige.ts, HomeSystem |
| Story/lore | visual-novel chapters, lore finds, Journal, Bunker Book help, Chronicle | StorySystem, StoryDialog, JournalPanel, HelpPanel, ChroniclePanel |
| Tutorial/guide | onboarding steps (ObjectiveSystem); long game: Guide.ts "what blocks the Act" | ObjectiveSystem, Guide.ts |

## 4. Screen map (taps from main bunker view)

Bottom nav (fixed on body, z 22): Build, People, Research, Surface, plus narrow Menu button. Back button / Esc closes the top panel.

| Screen | How reached | Taps | Owner |
|---|---|---|---|
| Build menu (sheet, tabs/filters) | Nav Build | 1 | components/BuildMenu.ts |
| Placement bar + banner + ghost | pick a room in Build | 2-3 | PlacementBar.ts, HUD placement banner, rendering/PlacementController |
| People panel (list/cards/tree tabs) | Nav People | 1 | PeoplePanel.ts |
| Research sheet (tabs) | Nav Research | 1 | ResearchPanel.ts |
| Surface map (full-screen) | Nav Surface | 1 | SurfacePanel.ts, worldMap.ts |
| Trade sheet | home hex on map | 2 | TradePanel.ts |
| Menu sheet: Settings / Accessibility / Stats / Achievements / Genesis tabs | Nav Menu | 1 | MenuPanel.ts (605) |
| Coupon sheet | Settings + valid code | 3 | CouponPanel.ts |
| Command panel (Act card, guide, laws, foreman, forecast, safety) | HUD era/Act chip | 1 | EraPanel.ts (561) |
| Projects/charter sheet | Command, or tap surface lot | 2 | ProjectsPanel.ts |
| Journal sheet: Finds / Story / Shop tabs | HUD journal button | 1 | JournalPanel.ts, ShopPanel.ts |
| Lore reader (full screen) | Journal item | 2 | JournalPanel.ts (LoreReader) |
| Decision Inbox | HUD inbox button (from Act 2) | 1 | controllers/inbox.ts |
| Daily orders | HUD daily chip | 1 | controllers/daily.ts |
| Supply crate | HUD gift button (when unopened) | 1 | controllers/welcome.ts |
| Season forecast | HUD season chip | 1 | app.ts onSeason |
| Resource drawer | tap resource plate | 1 | ResourceSheet.ts |
| Power-why / morale-why / population toast | tap banner / chip | 1 | app.ts |
| Room panel (upgrade, crew, spec, retool, maintenance, doors) | tap a room | 1 | BuildingPanel.ts (602), MaintenanceCard, InfraCard |
| Ruin panel | tap ruin | 1 | RuinPanel.ts |
| Structure list (a11y) | Menu | 2-3 | StructurePanel.ts |
| Bunker Book (help) | "?" plate on sheets, Menu | 2 | HelpPanel.ts |
| Chronicle | Menu | 2 | ChroniclePanel.ts |
| Objective strip | always, above nav; tap goes to target | 1 | HUD.objective, app.onObjectiveTap |
| Banners: power, incident/danger, placement | automatic | 1 | HUD.ts |
| Dialogs via DialogQueue: welcome-back, memorial, raid result, danger, event, mission choice, mission report, chapter, new-system card, lore find, whatsNew, district, folded "N waiting" | automatic | 0 | dialogQueue.ts + controllers |
| Confirms (dig, new game, restore backup...) | actions | - | Modal.ts |
| Story chapter (visual novel) | auto / replay | 0 | StoryDialog.ts |
| Intro cinematic | new game | 0 | Intro.ts |
| Difficulty pick | new game (before the intro, per playtest P1) | 0 | welcome / saves controller |
| Ceremonies (build, roomLevel, research, person, act, dig, death, genesis) | automatic overlay | 0 | ui/ceremony.ts |
| Toasts (info/good/bad/critical, max 3 visible) | automatic | 0 | Toast.ts |
| Floating numbers (Pixi) | automatic | 0 | NumberPopup.ts |
| Gesture tips, DropChip | automatic | 0 | controllers/tips.ts, DropChip.ts |
| Tour mode (clean screen) | Menu | 2 | tour.ts |
| Share picture | Menu / Genesis | 2 | share.ts |
| Depth ruler, zoom buttons | always / setting | 0 | DepthRuler.ts, ZoomButtons.ts |
| Landscape "turn phone" card | landscape under 500 px | 0 | viewportUi.ts |
| Splash | start | 0 | index.html, splash.ts |

HUD: top = resource grid (3 columns; 2x2 at text size >= 1.25 via `fs-big`) and "show all" pill; info row = era/Act chip, population + arrival timer, morale chip, clock, season, supply, daily, inbox, journal (up to 9 chips); banners = power, incident, placement; objective strip. Bottom nav = 4 tabs + menu, with badges.

## 5. Design-system state

| Aspect | Finding |
|---|---|
| Tokens | ~63 `--var` declarations across style.css (`:root`, 18 vars) and bunker-os.css (palette: --amber/--accent, --phosphor*, --bg-card*, --border, --text-primary/secondary/dim/disabled, --r-s/m/l, --rivet, --font-*). `:root` is redefined in two files (--accent, --bg-card, --border duplicated; --text-primary differs: #e8e2d2 vs #dcffe6; load order decides). 659 `var(--...)` uses. |
| Hard-coded | in src/styles + style.css: ~342 hex literals, ~381 rgba( literals, ~1,795 px values, 164 color/background/border with hex. In src/ui TS: ~53 hex, ~119 inline `.style.` / `cssText` uses (e.g. ShopPanel row cssText). No spacing, shadow or z-index tokens. |
| z-index | ad hoc: 2,3,5,10 (HUD), 12 (ruler), 20 (sheets), 22 (nav), 24-40 (toasts 30, dialogs 40), 60-99000, 100000, splash 100001 |
| Font sizes | all `calc(Npx * var(--fs,1))`; in use: 9, 9.5, 10 (7x), 11 (32x), 11.5, 12 (41x), 12.5, 13 (33x), 14 (25x), 15, 16, 17, 18, 19, 20, 22, 26, 28, 34, 44, 46, 48, 68: ~22 distinct sizes, no scale; most body text is 11-14 px. |
| Breakpoints | max-width 599/479/399/380/374, max-height 720/560, landscape 560/500/499, pointer:coarse, reduced-motion (x4) |
| Helpers | dom.ts (215): `el`, `setRich` (icon tokens + bidi), `button`, `bar/setBar`, `costRow/costAmount`, `rateText`, `signed`, icon maps. Sheet.ts (243): bottom sheet, close plate, "?" help plate, pull-down dismiss, Esc/back via `Sheet.closeTop()`, focus trap, inert background. Modal.ts (120): one centered dialog, action array, backdrop does not dismiss. Toast.ts (188): 4 weights, swipe dismiss, dedupe with count, held during away catch-up. a11yDom.ts: `enhanceTabs`, `setInert`, `trapTab`. Shared CSS classes: `.bp-hint`, `.bp-section-title`, `.btn(-primary/-secondary/-ghost/-small)`, `.tab-row/.tab-btn`, `.cost-chip`, `.modal-body`. No card/row/list component: each panel builds its own markup. |
| Dialog queue | ui/dialogQueue.ts. DialogSource {id, priority, snoozeMs, critical, ready(), open(), icon, label()}. One dialog at a time; gate (`GameApp.dialogGate`) waits for gestures/placement/ceremony; critical sources ignore open sheets. Priorities: welcome 100, memorial 90, raidResult 80, danger 70, event 60, missionChoice 50, missionReport 40, chapter 30, system 20, lore 15, district 10, whatsNew 5 (app.ts ~600-670). After 30 play-minutes, 3+ waiting soft sources fold into one "N things waiting" card (Start / Later snooze). Inbox cards are a separate non-modal channel. |
| Event bus | core/EventBus.ts: global `bus` (on/off/once/emit, string names, untyped args). UI mostly uses direct callbacks (`hud.onX = ...`, set in app.ts), not the bus. |

## 6. Existing infrastructure

| Feature | State | File |
|---|---|---|
| Settings tab | language toggle, SFX on/off, music + fx volume sliders, graphics quality cycle, brightness cycle, text size cycle, notifications, diagnostics copy, privacy page, save export/import (text + file), auto-backups restore, new game, tips-again, replay intro, tour, share, structure list, coupon | ui/components/MenuPanel.ts |
| Accessibility tab | motion auto/reduced/full, flash safe/normal, textScale (1.1 default/1.25/1.4/1.6), contrast normal/high, colorMode none/deuter/protan/tritan, haptics off/light/strong, oneHand off/right/left, largeTargets, popups all/important/off, captions, screen-reader announce, powerSaver, playInSilent, timing normal/relaxed, zoomButtons | utils/a11y.ts, GameState.A11ySettings, styles/a11y.css |
| Text size | CSS var `--fs` multiplies every font-size; HUD switches to 2x2 grid at >= 1.25 | ui/textSize.ts, HUD.watchLayout |
| Tutorial/tour | onboarding steps in objective strip (ObjectiveSystem), gesture tips with ghost hand (pinch, dbltap, hold, wing), "new system" cards that make a HUD button glow (`hud.spotlight`), Bunker Book with per-Act unlock marks, Tour mode (auto camera, 20 fps cap, wake lock) | ObjectiveSystem, controllers/tips.ts, systems.ts, HelpPanel, tour.ts |
| Next-up/advisor | Guide.ts (requirements, blockers, "do it now", ETA), objective strip, Command panel "what to do now", BuildAdvice.ts, Foreman | systems/Guide.ts, EraPanel, BuildAdvice |
| Number formatting | `costAmount` (<10K exact, then 12K, 1.2M, 1.2B, rounded up); `i18n.formatNumber`; `rateText`; `bidiNumbers`/`signed` for RTL; rate uses tabular-nums LTR | ui/dom.ts, I18nManager:101 |
| Plurals | none generic (no Intl.PluralRules); hand-split keys ("x.one" / "x.many") or wording that avoids counts | i18n json |
| Android back | web popstate only: `installBackNavigation()` pushes a history state; closes tour, then modal (blocks), placement, lore reader, surface, top Sheet; with nothing open, press twice within 2.5 s to leave. No Capacitor App.backButton listener. Esc same via Sheet.closeTop and keyboard.ts | app.ts ~1160, Sheet.ts, controllers/keyboard.ts |
| Safe area | `env(safe-area-inset-*)` in ~41 places; viewport-fit=cover; `--hud-top-h`, `--nav-h` and `window.__hudInsets` measured by ResizeObserver (utils/hudInsets.ts) and used by the camera; `--kb-inset` keyboard lift | style.css, hudInsets.ts, viewportUi.ts |
| Haptics | single `haptic(kind)`: tap/select/success/warning/error/impact/heavy; Capacitor plugin, iOS 17.4 switch trick, navigator.vibrate; respects setting and reduced motion | utils/haptics.ts |
| Audio UI | `uiSound(name)`, sound captions chip (soundChip.ts), music/ambience engine | audio/uiSound.ts |
| Landscape | compact side-column layout + "turn phone" card | styles/touch.css, viewportUi.ts |

## 7. Most central UI files (lines)

| File | Lines | Role |
|---|---|---|
| src/rendering/BunkerRenderer.ts | 1739 | Pixi scene root |
| src/app.ts | 1294 | app wiring, dialogs, back nav |
| src/ui/HUD.ts | 677 | top bar, banners, nav, objective |
| src/ui/components/PeoplePanel.ts | 664 | people sheet |
| src/ui/controllers/world.ts | 653 | map taps, placement |
| src/ui/components/MenuPanel.ts | 605 | settings / a11y / stats / achievements |
| src/ui/components/BuildingPanel.ts | 602 | room sheet |
| src/ui/components/EraPanel.ts | 561 | Command panel |
| src/ui/controllers/welcome.ts | 477 | welcome-back, supply, difficulty |
| src/ui/components/BuildMenu.ts | 416 | build sheet |
| src/ui/controllers/feedback.ts | 413 | feedback hooks |
| src/ui/ceremony.ts | 409 | ceremonies |
| src/ui/components/SurfacePanel.ts | 379 | world map |
| src/ui/icons.ts | 375 | icon set |
| src/ui/components/Sheet.ts, dom.ts, Modal.ts | 243 / 215 / 120 | shared primitives |
| src/style.css, styles/bunker-os.css, styles/touch.css | 744 / 519 / 365 | main CSS |

## Observations for the redesign

1. No real component layer: Sheet/Modal/Toast are good primitives, but every panel hand-builds rows and cards; ~119 inline style writes and two `:root` blocks have drifted apart.
2. Keep: the `[[icon]]` token system, `--fs` text scaling, a11y settings, dialog queue. Cheap, high-leverage fixes: a type scale (about 22 sizes down to ~6), spacing and z-index tokens, one `:root`.
3. Shop is honest in-game credits (no ads/IAP) but hidden as the third Journal tab. Daily, inbox, season, journal, supply and the Act chip crowd one info row (up to 9 chips) against only 4 nav tabs; Command, Daily, Inbox and Journal have no nav home.
4. Popup system (priority + fold + gate) is solid; extend it rather than replace. `bus` exists but UI uses callbacks; badge and notification state could move to it.
5. Fonts come from Google over the network: an offline PWA or Capacitor first launch falls back to system sans, so self-hosting is a prerequisite for a consistent look in a store build.
6. Back handling is web popstate only; a Capacitor build should also register App.backButton.
