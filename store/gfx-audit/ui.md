# GFX audit: UI / HUD / panels / icons / type / labels / popups / intro & story

Reviewed live at 430×932 on the `?slot=gfx&gfx2` test save (era 3) and a fresh `?slot=uiaudit-new` save (intro and early game). Screenshots are in `store/gfx-audit/shots/ui-*.jpg`.

## 1. What exists
- **Style stack**, imported in this order in `src/app.ts:51-54`: `style.css` (the original purple/orange "web app" theme), then `styles/story.css`, then `styles/bunker-os.css` ("Bunker OS" re-skin: riveted steel HUD, green-phosphor CRT sheets, LED segment bars, dot-matrix toasts), then `styles/depth.css` (alarm strips, incident cards, specialization).
- **Fonts**: Karantina (display) and Rubik (body), both from Google Fonts (`style.css:1`, `bunker-os.css:8`).
- **Icons**: about 119 hand-written 24×24 SVG glyphs in `src/ui/icons.ts`. There are no emoji anywhere in `src/ui`, `src/rendering` or `src/data`.
- **Screens**: HUD (`HUD.ts`); bottom sheets (`Sheet.ts`) for Build, Building, People (with family tree), Research, Journal (finds and story), Era and Menu; full-screen surface hex map (`SurfacePanel.ts`); Modal; Toast; StoryDialog (visual-novel style); lore reader (paper, photo and tape cards); Intro (gate, 3 painted panels, title, flashlight reveal).
- **In-world**: steel tags and zone plates (`signage.ts:74`), the label style (`BunkerRenderer.ts:81`, Rubik 10 px), and NumberPopup (`NumberPopup.ts`).
- **Feel**: haptics (`dom.ts:114`, `HUD.ts:196`), UI sounds (`uiSound`) and a CRT power-on animation (`bunker-os.css:182`).

## 2. Strengths
- There is a real art direction. The steel resource plates with rivets, LED segment bars and the CRT sheet with scanlines are coherent and fit the setting (shots ui-01, ui-02).
- The icons are custom vector art, not emoji, and they read well at 16 px.
- The painted content in the UI is strong: build thumbnails, survivor portraits and story portraits (ui-02, ui-06, ui-11). It is better than most indie mobile games.
- Lore cards have their own materials (paper, photo, cassette with spinning reels). This is exactly the diegetic thinking the rest of the UI needs.
- Haptics and sounds are already wired in, and the RTL logical properties (`inset-inline`) are mostly correct.

## 3. Problems, ranked by impact

1. **The HUD info row is wider than a phone screen.** It measures 465 px inside a 430 px viewport. The **Menu button sits at x = −45 px, fully off-screen and impossible to tap**, and the era chip is clipped on the right (ui-01, ui-17). There are no `@media` rules at all in any stylesheet.
2. **The first screen a player sees is a black page with grey "tap to enter" text** (ui-16). There is no logo, key art or title. In my captures the three intro panels also stayed almost black (the `.intro-image` measured opacity 0.22 two seconds into a panel, under a 0.75–0.85 vignette). This is the first impression of the game, and it matches the "low quality" complaint.
3. **Number popups pile up into unreadable clumps** of 3–4 overlapping "+12 +12 +12" (ui-03). Their lifetime is counted in frames (`NumberPopup.ts:45`, `maxLife: 64`, `life++`), not in time. At low fps on a phone they live 3–4 s and overlap the next 4-second wave (`app.ts:65`). They are also passive: you cannot tap or collect them, and nothing flies to the HUD counter.
4. **Closed sheets darken the bottom nav.** Eight closed sheets are parked just under the screen at `top: 932`, and each casts `0 -10px 40px rgba(0,0,0,.7)` plus a 2 px grey ring upward (`bunker-os.css:165`). This makes the nav labels muddy and leaves a stray grey line along the bottom edge (ui-01; compare the label colour #d8ccb4 in the code with what is on screen).
5. **Panels hide what they talk about.** The Building or Incident sheet covers about 60% of the screen while the selected room, even a room on fire, stays hidden behind it (ui-04, ui-14). The camera does not frame the selected room above the sheet. The sheets also have no close button and no swipe-down (the handle is decorative, `Sheet.ts`), and tapping the backdrop sometimes missed in my testing.
6. **The UI does not have one consistent visual language; four themes are mixed.**
   - Leftovers from the purple/orange theme: `style.css:451` trait chips, `:559` active research card, `:544` tabs.
   - Bright saturated yellow CTAs ("כבו!", "לבחור") that do not match the amber/steel palette.
   - Brown paper journal items inside a green CRT sheet.
   - A 999 px "pill" era chip next to 3–4 px plates.
   - Room-level-up markers are huge flat clip-art stars in the world (store/screenshots/01-bunker-he.png).
7. **Typography problems.**
   - Karantina at 15–26 px makes ה look like ק ("בנייה" reads as "בנייק", ui-02), and its digits blur together ("28/28" reads like "20/20", "0/18" like "0/10", ui-06, ui-10).
   - The 15 px Karantina nav labels are hard to read.
   - Mixed Latin inside Karantina breaks up ("B3" in the alarm strip, ui-14).
8. **RTL number bugs.** Signed values flip their sign to the wrong side: "2.9+ לשנייה", "10%+", "1–" (ui-04, ui-02). `unicode-bidi: isolate` without `direction: ltr` puts the sign at the end.
9. **The surface map looks like a prototype** (ui-08). It is flat SVG hexes in beige and yellow with "?" glyphs on a plain gradient. There is no terrain art, fog texture, radar sweep or landmarks. The SVG has `min-width: 460px` (`style.css:591`), so the edge hexes are clipped. Team picking is a wall of 28 identical text chips with no portraits (ui-09).
10. **Big milestones get no ceremony.**
    - Era: the final era is a small text card (ui-13).
    - Research: a flat list, not a tree (ui-07).
    - Level-ups: a toast with gendered-slash copy ("עלה/תה", "פרנואיד/ית").
    - There are no count-up numbers, no rewards flying to the HUD, and no `prefers-reduced-motion` handling.
11. **In-world labels are unreadable at the default zoom.** Rubik 10 px in world units comes out at roughly 4–5 px on screen at overview zoom, so the zone plates and tags look like smudges (ui-01). Portraits are painted while the in-world people are pixel puppets, and the contrast between the two makes the puppets look cheaper.
12. **Clutter.** On minute one the HUD shows six resource plates, most at "0 / 0.00", plus a 4-chip info row, an objective strip and a toast. Together these take about 25% of the screen before any gameplay (ui-17).

## 4. Improvements

Effort: S / M / L / XL. Impact: 1–5.

| # | Change | Technique | Effort | Impact | Depends on |
|---|---|---|---|---|---|
| A | Make the HUD fit | Split into two rows or turn the time and morale chips into icons only; add `@media (max-width:440px)`; move Menu into the bottom nav or a top-corner bolt button | S | 5 | none |
| B | Fix the nav shadow | Add `visibility:hidden` or `box-shadow:none` on `.sheet-overlay:not(.open) .sheet` | S | 3 | none |
| C | Make popups time-based and aggregated | Use dt-based life; keep one popup per room per wave (merge and update the value); cap on screen; add tap-to-collect that flies an icon to the HUD plate, with a bump and count-up | M | 4 | none |
| D | Fix RTL numbers | `.bp-value, .cost-chip, .stat-chip, .gain-chip { direction:ltr; unicode-bidi:isolate }` | S | 3 | none |
| E | Type pass | Keep Karantina only for 28 px+ titles; for nav, titles and digits use a sturdier Hebrew display face (Secular One, Heebo 800 or Suez One) plus a stencil Latin for codes; use tabular Rubik for all numbers | S–M | 4 | fonts |
| F | One palette | Purge the leftover purple and orange; turn the yellow CTA into an amber "lit button" with a lamp, keeping one alert red and one success green; set radius tokens to 2/4/8 | M | 4 | none |
| G | Frame the selected room | When a sheet opens, pan and zoom so the room sits in the top 40%; add an `✕` close plate and swipe-down to the sheet | M | 4 | renderer camera API |
| H | Title screen | Painted key art of the bunker door plus a logo lockup, used as the gate screen; fix the intro fade so panels reach full opacity; lighten the vignette | M | 5 | key art, logo |
| I | Diegetic materials | Use 9-slice painted textures instead of CSS gradients for plates, the CRT bezel (glass glare, curvature, bezel screws) and stamped buttons; generate them through the kit pipeline | L | 4 | painted UI kit (6–10 textures) |
| J | Ceremony moments | Full-screen era-change card with painted art and a camera sweep; level-up and research-complete stingers (ribbon, light burst, sound); replace the clip-art stars with a stamped steel badge | M–L | 4 | 4 era illustrations |
| K | Surface map as an artefact | Painted wasteland map under the hex grid (or a parchment/radar hybrid), fogged tiles with a noise texture, landmark icons, an animated radar sweep, team picker using portrait cards sorted by fit | L | 4 | 1 painted map, landmark icons |
| L | Research as a tree | Show branches as a node graph on the CRT with circuit lines and locked nodes dimmed | L | 3 | none |
| M | Progressive HUD | Hide resource plates until the resource matters; collapse the info row into one status plate | S–M | 3 | game design sign-off |
| N | Readable world labels | Make labels zoom-aware: show nameplates only at zoom ≥ 0.8; at overview, show one icon badge per room, sized in screen space | M | 3 | Signage owner |
| O | Copy | Use gender-neutral or gender-resolved strings instead of "עלה/תה" (a `nameGender` helper already exists) | S | 2 | none |

## 5. Quick wins vs big moves

**Quick wins (about one day, no art):** A, B, D, the font swap part of E, popup life → dt in C, O, and the purple purge in F. Together these remove most of the "web page" feel: clipped HUD, muddy nav, popup clumps, backwards numbers and wrong letterforms.

**Big moves (these change perceived quality):**
1. **H, title and key art.** The first 10 seconds currently sell nothing.
2. **I, a painted UI material kit.** This turns CSS gradients into physical steel, glass and paper, matching the painted rooms.
3. **G with C, camera framing plus collectible rewards.** This makes the UI feel connected to the world, the way Fallout Shelter does.
4. **J and K, ceremony and the surface map.** These are the two screens where progress should feel big.

The biggest single driver of "low-level" in the UI is not missing effects. It is that the chrome is drawn with CSS gradients while the content (rooms, portraits) is painted, and the two never meet.
