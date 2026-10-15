# Review: Information Architecture & Interruptions (The Last Bunker)

Read-only code review, 2026-10-15, main @ efb8798. Sources: src/ui/** (HUD.ts, popupRules.ts, dialogQueue.ts, Modal.ts, kit/Button.ts,
onboarding/*, controllers/*), src/app.ts (dialogSources, dialogGate, checkShortages), src/systems/EventSystem.ts, src/data/story.ts,
store/playthrough/d1.txt, store/ux-redesign/qa-final.md. Counts marked "~" are estimates derived from code timers, not measured.

## 0. Diagnosis in one paragraph

The UX overhaul built good *plumbing* (one modal at a time, a gate that waits for the finger, tiers, toast lane, fold card) but no
*budget*. Every system still owns its own "tell the player" path, and the plumbing only serialises them; it never asks "has this
player been interrupted enough?". Result: the same fact is shown in 3-5 places at once (power at t=0), the advisor strip is hijacked by
"collect" items that outrank the tutorial goal, the FTUE spotlight re-locks the whole screen every time the advisor line changes, and a
returning player gets a chain of unrelated modals (tip, what's-new, battery offer) ~1.5 s apart. The HUD shows ~14 tappable things on a
375 px screen, three of which open lists of more things. There is also a real tap-loss bug on kit buttons (section 5).

## 1. Surface inventory (what can appear, who triggers it, priority, stacking, caps)

| # | Surface | Code | Trigger | Priority / gate | Stacks with | Cap |
|---|---|---|---|---|---|---|
| H1 | Resource tiles x4 (amount, rate, trend, bar, warn icon, countdown) | HUD.updateTile/pickTiles | always | - | everything | Act III+: tile *set and order* change live (phoneSlots sorts by emptiest; `urgent` swaps tiles in at any Act) |
| H2 | "+N more" chip | HUD.moreBtn | hidden resources of current/previous Act | - | - | none; Act I already "+3/+4" (medicine, knowledge, scrap, components) |
| H3 | Act chip "Act II 38% / Settle" | HUD.actBtn | always (long game) | - | - | opens a panel titled "Command" |
| H4 | Survivors chip n/max | HUD.popBtn | always | - | - | - |
| H5 | Morale chip % + face | HUD.moraleBtn | always; long-press tooltip | - | - | - |
| H6 | Credits chip | HUD.creditsBtn | wide screens only (phone: in bell list) | - | - | - |
| H7 | Clock | HUD.clock | wide screens | - | - | - |
| H8 | Bell "Alerts" + badge (red=act, grey=news) | HUD.alertsBtn/alerts() | inbox, supply, daily, season, journal, shop rows | - | - | none; journal unread counts as news from minute 1 |
| H9 | Objective/advisor strip + "goals" key (flag + n) | HUD.setObjective, advisorRules | always; crisis > collect > goal > upgrade | advisor order | spotlight targets it | none |
| H10 | Power banner "Power shortage! Bunker running at N%" | HUD.update | powerRatio<0.99 && a plant exists | - | duplicates H1 countdown + H9 crisis | none |
| H11 | Incident banner (fire/flood/...) | danger.updateIncidentBanner | incident | - | edge arrow, H9 | none |
| H12 | Placement banner | HUD.showPlacement | build placement | - | - | - |
| H13 | 5 bottom tabs + badges (people=idle-with-job, research "!", surface=missions) + lock icon/popover | HUD.createBottomNav, onboarding.refreshLocks | always | - | - | - |
| H14 | Edge arrows (danger/ready rooms off-screen) | edgeArrows.ts | off-screen fire/raid/ready room | - | - | per target |
| H15 | Back-to-bunker button, zoom buttons (a11y), sound chip, gfx-restoring chip | backToBunker/ZoomButtons/soundChip/pwa | camera far / setting / audio suspended / GPU loss | - | - | - |
| W1 | Survivor bubbles, production popups, number popups, fly-to-HUD | world.ts, NumberPopup, fx | continuous | popups setting all/important/off | - | per-interval |
| T1 | Toast (1 visible, 6 queued, repeats merged "x3") | Toast.ts, popupRules.nextInLane | ~103 call sites; shortage.low, hurt, no_food, achievements, goals, research, etc. | critical>bad>good>info | with everything | none per session |
| C1 | Ceremony (build 1.6s, research 1.4s, act 4.5s, dig 2s, project 3.2s, death 3s, achievement 1.6s...) | ceremony.ts | bus events | prio list, blocks dialogs | toasts | queue |
| G1 | Gesture tip card (pinch, dbltap, hold, wing) with 2 buttons | controllers/tips.ts | after 1st ruin, 2 room taps, etc. | waits for calm, 40 s gap | deferred by any dialog | once per device profile |
| O1 | FTUE spotlight (dim + hole + bubble "Tap here: your next step" + "Skip tutorial" chip; blockers eat all other taps) | onboarding/index.ts desired() | **every new `tutorialStep:advisorKey` pair** during FTUE (5 steps / 20 min) | z 90 (above modals z 40) | holds dialogs up to 20 s | none per pair; re-fires whenever the advisor line changes |
| O2 | Guided spotlight "It lives here" after each system card / tab unlock | onboarding.guideTo/enqueue | sys:* card OK, unlock:surface | queue | - | once per device |
| O3 | Idle hand | onboarding.idleHint | 9 s idle in FTUE or crisis | - | - | 3 per line |
| M1 | Welcome back / check-in | welcome.ts | away > 10 min, or door, or danger | offline 4100 (critical) | - | per return |
| M2 | Memorial, raid result, danger prompt | danger.ts | death / raid / disaster | crisis 50xx (critical) | - | per event |
| M3 | Event (incl. door knocks "wanderer/group") | events.ts | Act I: every event auto-opens; knocks every 75-120 s while beds free | story 3060 | - | Act I gap >= 6 min for non-knock events; knocks uncapped |
| M4 | Mission choice / report | events.ts | expedition | story 3050/3040 | - | Act II+: go to inbox instead |
| M5 | Story chapter (StoryDialog, z 60, multi-line) | story.ts | data/story triggers (4 min, 30 min, 53 min, 57 min in d1 sim) | story 3030 | modal waits behind it | 20 chapters |
| M6 | "New system" card + guided spotlight | systems.ts | act1, inbox, foreman, contracts, seasons, doctrines, outposts, laws, alloys/data/influence/seedCores | unlock 2020 | - | 120 s play between cards |
| M7 | Lore "Found something!" | lore.ts | each of 25 finds | unlock 2015 | - | one per find, no batching |
| M8 | District found | dig.ts | breakthrough | unlock 2010 | - | - |
| M9 | What's new "The bunker can grow" | whatsnew.ts | migrated v6 save, Act II+, play >= 30 min | unlock 2005 | - | once |
| M10 | Offers: Save battery? / Add to Home Screen / Backup | pwa.ts | play >= 5 min (**save total, not session**), power: low fps or >= 15 min | offer 0..4 | - | 1 per session |
| M11 | Fold card "N things are waiting" | dialogQueue.showFolded | >= 3 non-critical pending AND play > 30 min | - | - | - |
| M12 | Supply crate, daily orders, shop, inbox, journal, research etc. | sheets | user taps | - | sheets stack only for readers | - |

Stacking reality: modals are strictly serial (good), but toasts, banners, spotlight, tile flash, ceremony and strip all run in parallel.
The gate (popupRules.gateBlock) blocks only on *physical* conditions (finger, sheet moving, placement, ceremony); there is no notion of
"recently interrupted". After one modal closes the next one can open 1.5 s after the last touch (GESTURE_QUIET_MS), so a pile drains as a
chain. Fold needs >= 3 pending simultaneously *and* > 30 min of play, so the guided first half hour and 2-item piles never fold.

## 2. Navigation map (taps from the bunker view)

| Feature | Path | Taps | Note |
|---|---|---|---|
| Build a room | Build tab > card > place | 2 + placement | fine |
| Room details/upgrade | tap room | 1 | fine; also double-tap zoom (tip) |
| People list / family tree | People tab / > Family tree tab | 1 / 2 | |
| Research | Research tab > branch tab (scrolling tab row) > node > start | 3-4 | Genesis branch also here |
| Expeditions | Surface tab > region > team > send | 4 | locked until radio (lock popover) |
| Trade (caravans) | Surface tab > bunker row (sorted **last**) | 2 + scroll | hidden in the Surface map list |
| Outposts | Surface tab > scroll | 1 + scroll | |
| Command "Now" | Act chip | 1 | chip says "Act", panel says "Command" |
| Projects | Act chip > Act tab > "Projects" button (or tap a surface lot) | 3 | a main progression system, 3 taps deep |
| Laws, Foreman | Act chip > Act tab > scroll to bottom | 2 + scroll | system cards point here; buried below forecast/homes |
| Endings | Act chip > Endings tab | 2 | |
| Decisions inbox | Bell > Decisions inbox | 2 | strip also routes there |
| Supply crate / daily orders | Bell > row (or strip) | 2 | |
| Journal / Shop / Season | Bell > row | 2 | not "alerts"; shop is a store, journal is an archive |
| Other resources | "+N more" > row > resource sheet | 2 | |
| Bunker Book (help) | Menu > (Settings) > More group > Open | 3 | also sheet "?" buttons and "Tell me more" |
| Chronicle | Menu > More > Open | 3 | |
| Rooms list | Menu > More > Open (dup. in Accessibility tab as "Room list") | 3 | |
| Share / Tour / Tips again / Tutorial again / Intro again | Menu > More | 2-3 | |
| Stats / Achievements | Menu > tab | 2 | |
| Genesis (prestige) | Menu > Genesis tab | 2 | top-level tab from day 1, usable ~Act VII |
| Language | Menu > (Game group default) | 1-2 | fine |

Buried >2 taps but core: Projects (3), Research start (3-4), Expeditions (4), Trade (2+scroll, last in list), Laws/Foreman (2+scroll),
Bunker Book (3). Top-level but rarely used: Genesis Menu tab (day 1, matters at the end), Credits chip on wide screens, Morale chip
(tap = list), Act chip % (changes slowly), Bell's Journal/Shop/Season rows that permanently pad the "alerts" list (6 rows, 2 actionable).
The Menu has 5 tabs x Settings has 5 groups = 2 levels of tabs for ~45 rows.

## 3. Unlock schedule & interruption counts

### First 30 minutes (new player, Act I, from code timers + d1 sim)
| Time | Interrupting surface | Kind |
|---|---|---|
| 0:00 | Intro (story) | full-screen |
| 0:00+ | Power banner + power tile countdown + strip crisis/goal + spotlight "Tap here" + Skip chip + `shortage.low` toast & warn sound if < 180 s | 5 layers for one fact |
| 0:01 | first knock (nextArrivalAt=60) then every ~75 s while < 5 survivors and beds free | modal each (M3) |
| every strip change | FTUE spotlight re-locks the screen (new key = new step) | blocking overlay |
| after 1st survivor | supply crate "ready" -> **collect outranks the tutorial goal** -> strip says "Supply crate ready: open it" + spotlight on it | detour |
| ~4:00 | chapter "static" (StoryDialog) + first regular event (nextEventAt=240) | 2 modals |
| after ruin 1 | pinch tip, then hold tip (40 s apart), dbltap tip | 3 cards |
| tutorial done | "Act I" system card + guided spotlight on Act chip | modal + overlay |
| 5:00+ | offer gate opens (backup/install on iOS) | offer |
| 6-12 min | 1-2 more events (Act I gap >= 6 min) | modal |
| 7:00 | era 1 ceremony (d1) | ceremony |
| ~9-12 | lore finds from ruins ("Found something!" each) | modals |
| 15:00 | "Save battery?" (any touch device, or earlier at 5 min if fps low) | offer modal |
| 12-30 | more knocks while beds free, expedition report (14 min), "toll" chapter (30 min) | modals |

Estimate: **~12-18 modal dialogs + ~8-12 spotlight overlays + 3 tip cards + 2 story scenes in the first 30 min**, plus toasts and
ceremonies. Roughly one blocking interruption every 60-90 s of play.

### Act II start
act ceremony 4.5 s -> "inbox" card + guided spotlight -> 120 s later "foreman" card + spotlight -> "doctrines" (when a fork node is
available) + spotlight -> at ~day 4 "seasons" and "contracts" cards + spotlights; events/missions now go to the inbox (good) but the
strip flips to "Decisions waiting: N" which outranks the Act goal. ~4-5 modals + 4-5 spotlights + new bell rows within the first hour of Act II.
### Act III / IV
Act III: outposts + laws (slot 1) cards, Surface/Command spotlights, HUD tiles start re-ordering (phoneSlots). Act IV: alloys card, new
tile replaces a basic, plus chapters (clan/genesis gates). 2-3 modals each, but the HUD layout change is silent and disorienting.

### Returning player (the day-30 load observed)
Gate passes 1.5 s after the last touch, so: pinch tip card (device-profile flag; a new browser = re-taught) -> "The bunker can grow"
(v6 migration) -> "Save battery?" (`promptAllowed` uses the save's total play seconds, so a 30-day save is eligible on second 1 of
the session; low fps in a test browser trips `lowPowerSuspected`). None is about what the player came back to do. Fold card never
triggers (only 2 queued). Strip shows "Decisions waiting: 2", bell 3, research "!", "+5 more" on top.

## 4. Terminology & clarity problems

1. **Power vs battery**: the in-game resource is "Power" (`[[power]]`), the device offer says "The game uses a lot of **power**" and
   uses `[[battery]]`, which is also the icon of the Battery Bank room / `build.rec.battery` ("Power runs low"). A player seeing
   "Save battery?" right after "Power shortage!" will think it is a game mechanic. Rename to "Phone battery saver" / "Save your phone's
   battery?" and use a phone icon.
2. **Act chip vs "Command"**: chip shows "Act II 38%", opens a sheet titled Command / מרכז הפיקוד with tabs Now/Act/Endings; the "Now"
   tab duplicates the strip ("What to do now").
3. **"Alerts" bell** holds Decisions inbox, Supply crate, Daily orders, Season, Journal, Trade shop: two of six are alerts. Same item has
   3 names: "Decisions inbox" (row), "Decisions" (sheet), "Decisions waiting: N" (strip).
4. **Shop / Trade shop / Trade credits / credits chip "Shop"**, and Trade (caravans) lives in Surface: two different "trade" things.
5. **People tab vs Survivors chip** (en); he uses ניצולים for both, en does not.
6. **Supply crate / Daily supply crate / Today's supply crate**; **Rooms list vs Room list** (Menu > More vs Accessibility).
7. **Genesis** = Menu tab (prestige), Research branch, story chapter, ending, Isotope-7 currency: one word, 4 places, explained nowhere
   on the Menu tab before it is usable.
8. Unexplained numbers: Act %, morale % (cause only on long-press), tile rate with trend arrow AND countdown AND bar AND warn icon in a
   ~85 px tile, "+N more", bell grey vs red badge semantics, research "!" badge, surface badge = missions out (not "something to do"),
   people badge = idle-with-job (tooltip only), the goals key shows a bare number next to a flag.
9. Power banner says "running at 63%" (a ratio) while the tile shows a countdown and the strip "Not enough power: see why": three
   framings of one state.
10. `ux2b.more` en "+{n} more" vs he "עוד {n}" fine; but chip appears even in Act I when 3-4 of the hidden resources are useless yet.
11. 8 he strings identical to en are placeholders only (no untranslated text found; 0 missing keys) - l10n coverage is good.

## 5. The "modal buttons don't respond" report: real bugs found

1. **Edge taps are lost on every kit button (real, phone + desktop).** `bindPress` (kit/Button.ts) on `pointerdown` *releases the
   implicit touch pointer capture* and adds `.is-pressed`, which applies `translateY(4px) scale(0.93)` (kit.css 49-50) in 60 ms. The
   button (and its `.k-hit` child, which inherits the transform) shrinks out from under a finger that landed near its edge. Then
   (a) with capture released, `pointerup` is hit-tested and lands on `.modal`/`.modal-actions`, so the browser dispatches `click` to
   the common ancestor and the button's handler never runs; (b) if a click does reach it, `releasedOutside()` measures the *pressed*
   rect and rejects it. On a 320 px wide modal button about 11 px per side and the top ~6 px are dead (~15-20 % of the area), while the
   button visibly "presses". Fix: snapshot the rect on pointerdown and test against it (or track `pointerleave` while down as the only
   cancel), keep implicit capture for touch, and move the press visual to an inner face element so the hit box never transforms.
2. **Tap guard swallows taps silently.** Modal.ts capture-click blocks any pointer click within 600 ms of `show()` (MODAL_TAP_GUARD_MS)
   and every content replacement resets it (`openedAt` in show() and waitBehind release). `pointerdown` still adds `.is-pressed`, so
   the player sees a press with no result. Chained dialogs (queue drains every ~1.5 s) and a 400 ms crt-on + 250 ms grow-in animation
   make "tap as soon as it is readable" land inside the window. Fix: guard only taps whose pointerdown started *before* openedAt (the
   real hazard), or drop to ~250 ms and suppress `.is-pressed` while guarded.
3. **Spotlight above dialogs for up to one tick.** Spotlight is z 90, modal z 40. Dialogs from the queue call `onboarding.defer()`,
   but any modal opened directly (strip tap -> crate, system card "Got it" -> guideTo enqueue, lore "Read now") relies on the
   250 ms onboarding tick to hide the spotlight; until then its blockers eat taps. Low impact, but stack it with #2.
4. `.modal > .modal-actions` is a scroll box with `touch-action: pan-y`; when 4+ actions make it scroll, a slightly moving tap becomes a
   scroll (pointercancel, no click). Minor.
(QA F1, the inert overlay leak, is fixed by inertOwners.forceLive and NEVER_INERT; I found no regression of it.)

## 6. Top 12 fixes (problem -> change -> files -> effort)

1. **No interruption budget.** -> Add a session budget to the gate: max 1 non-critical auto-dialog per 3 min (5 min in the first 30 min
   after FTUE), unlimited only for `critical`; everything else waits silently in the inbox/bell. Track `lastAutoDialogAt` in
   DialogQueue; add `budget` input to `gateBlock`. -> popupRules.ts, dialogQueue.ts, app.ts dialogSources. **M**
2. **Kit button edge-tap loss + silent tap guard (section 5.1/5.2).** -> rect snapshot at pointerdown, keep touch capture, inner
   press face; guard only pre-open pointerdowns, no pressed look while guarded. -> kit/Button.ts, Modal.ts, kit.css, popupRules.tapBlocked. **S**
3. **Door knocks as modals (Act I: up to one every 75 s).** -> knocks become a door chip/edge arrow + bell row; auto-accept toggle;
   modal only for the first knock (teaching). -> EventSystem (no rule change, UI only), inbox.ts autoOpenEvent, events.ts. **M**
4. **Tips/what's-new/system cards/lore as blocking modals.** -> make M6, M7, M8, M9 non-blocking "news" cards in the bell (or a
   bottom card like G1 that auto-hides), never chained; system cards show at most one per Act transition with the rest listed inside
   it ("Act II opens: Decisions, Foreman, Doctrines"). -> systems.ts, lore.ts, whatsnew.ts, dig.ts, app.ts tiers. **M**
5. **One fact, five surfaces (power at t=0).** -> one owner per state: crisis -> strip only (with countdown); tile shows state colour
   only; delete the power banner (or show it only when the strip is not already showing power); no `shortage.low` toast when the
   strip already shows that store. -> HUD.ts (powerBanner), app.ts checkShortages, advisor.ts. **S**
6. **FTUE spotlight re-locks the screen on every advisor change.** -> spotlight only for the 5 scripted tutorial steps (key on
   tutorialStep, not on advisor key); crisis/collect changes get the idle hand or a strip pulse, never blockers. Move "Skip tutorial"
   into the bubble (no separate chip colliding with banners). -> onboarding/index.ts desired(), spotlight.ts, onboarding.css. **S**
7. **Collect outranks the goal (crate detour).** -> advisor order during Act I/FTUE: crisis > goal > collect; collect items appear as a
   bell badge only; after FTUE keep collect above goal only for expiring items. -> advisorRules.adviseOrder (+ advisor-test). **S**
8. **One-row HUD.** -> row 1: 4 resource tiles (amount + one state cue; rate on tap) + bell; move Act/survivors/morale into a single
   compact "status" chip that opens Command (Act %, survivors, morale with cause). Drop "+N more" until Act II; show it as a tile
   overflow arrow. Freeze tile order (no live re-sorting; pin urgent ones with a badge instead). -> HUD.ts, hud.css, touch.css. **M**
9. **Consolidated inbox.** -> bell = "Inbox": only actionable rows (decisions, crate, daily reward, knocks, finds, system news); move
   Journal/Shop/Season out (Journal+Chronicle+Book -> one "Archive" in Menu; Shop -> credits chip / Surface trade). Strip routes
   collect items here. One name everywhere ("Inbox" / תיבה). -> HUD.alerts(), inbox.ts, i18n. **M**
10. **Returning-player chain.** -> on session start: welcome card first, then *nothing else auto* for 2 min; offers gated on *session*
    seconds (>= 10 min this session) not save seconds; profile-seen tips also respect save flags (already) and skip if the save is
    past Act I. -> pwa.ts powerHintDue/installHintDue/backupReminderDue, app.ts gate (session start stamp), tips.ts. **S**
11. **Buried core features / dead top-level ones.** -> Projects and Laws as tabs inside Command (Now / Projects / Laws / Endings);
    Trade as a Surface tab, not the last list row; Bunker Book as a "?" in the top bar or Menu top row (1 tap); Genesis Menu tab hidden
    until Act VI (keep Research branch). -> EraPanel.ts, SurfacePanel.ts, MenuPanel.ts. **M**
12. **Terminology pass.** -> rename battery offer ("phone battery"), unify Command/Act ("Act" everywhere, or chip label "Command"),
    People/Survivors, Supply crate, Rooms list, Decisions; one-line explainer for Genesis/Isotope-7; badge legend in the Book; add a
    glossary test that bans "power" in pwa/settings strings. -> en.json, he.json, tools/glossary test. **S**

Suggested order: 2, 5, 6, 7, 10 (all S, ship together) -> 1, 3, 4 (interruption model) -> 8, 9, 11 (layout/IA) -> 12 continuous.
Expected effect: first 30 min drops from ~12-18 blocking modals + ~10 overlays to ~5 modals (intro, 2 chapters, Act I card, 1 event)
+ 5 tutorial spotlights; HUD from 2 rows + strip + chip (14 targets) to 1 row + strip (~7 targets).
