# חלוקת עבודה לסוכנים, סדר מיזוג, אימות ופרוטוקול מכשיר

מסמך 5 מתוך 5 בחבילה `4-redesign`. מבוסס על פורמט הבית (`store/GAME-AGENTS.md`, `GFX-AGENTS.md`, `GFX-P0-AGENTS.md`): כללים, בעלות לפי קבצים, דיווח.
**הערת הערכה:** אומדני "שבועות" למטה הם לפי מפתח אחד עם Claude (כמו בתוכניות 1-3). עם 8-10 סוכנים במקביל בכל גל, זמן הלוח מתכווץ בערך לשליש, אבל זמן המיזוג והאימות נשאר.

## 1. כללים (העתק לכל בריף סוכן)

1. **שמירות:** לעולם לא לגעת בשמירת המשתמש (IndexedDB `lastbunker_auto`). בדפדפן להשתמש רק ב-`?slot=<שמך>` (שמירה נפרדת למפתחים).
2. **מצב חדש:** כל שדה חדש ב-`GameState` (`src/core/GameState.ts`) עם ברירת מחדל ב-`createInitialState()` **וגם** ב-`migrateState()`. `SAVE_VERSION` עולה פעם אחת (6→7) על ידי סוכן Architect בלבד; אחרים לא נוגעים בו.
3. **i18n:** כל מחרוזת ב-`src/i18n/he.json` ו-`en.json` עם אותם מפתחות וה-`{placeholders}`; עברית פשוטה וטבעית; `{g}` למגדר. שני הקבצים משותפים: **לקרוא מחדש רגע לפני עריכה**, להוסיף בלוק קטן ליד מפתחות קרובים עם כותרת-הערה `plan4:<agent>`, לא לעצב מחדש. שמות/תיאורי חדרים נמצאים בתוך `buildings.json` (לא ב-i18n).
4. **סגנון קוד:** עריכות קטנות וממוקדות, הערות "למה" כמו בסביבה, תגי `[plan4:<wp>]`, ללא תלות חדשה (חריג יחיד: קליפת Capacitor ב-UX-12, מבוצעת על ידי המשתמש).
5. **הקלדה:** אחרי כל שינוי `npx tsc --noEmit -p .` ו-`npx tsc --noEmit -p tsconfig.tools.json`. אם שגיאה בקובץ שאינו שלך, **לחכות ולנסות שוב**, לא לתקן אותו.
6. **קבצי עזר:** סקריפטי תיקון כקבצי `.cjs` בתיקיית ה-scratchpad (לא heredocs עם backtick). לקרוא קובץ מחדש רגע לפני עריכה.
7. **שרת פיתוח:** `http://localhost:5173`; לא להפעיל/לעצור, לא להרוג תהליכים.
8. **ביצועים:** כל תוספת גרפית עומדת בחוזה 10 הכללים (`3-mobile-performance.md §7.3`) ובשער הסגנון (6 השאלות ב-`GFX-AGENTS.md`).
9. **בוט:** כל מבנה/מערכת חדשים נלמדים בבוט (`tools/sim/core.ts`) ובבדיקות `lint`.
10. **hooks בקבצים משותפים:** עריכה בקובץ שאינו בבעלותך רק בהערה `// plan4:<wp>` של שורות בודדות מתוך הרשימה ב-§4; כל אחר מבקש מהבעלים.
11. **ענפים:** ענף לכל סוכן `plan4/<agent>` (worktree נפרד: `isolation: "worktree"`), commit לכל WP עם הודעה `plan4(<wp>): <מה>`; מיזוג לפי §5. אין force-push, אין שכתוב היסטוריה על ענף של אחר.
12. **סיום WP:** `npm run check` ירוק + בדיקות ה-WP (שבסעיף ה-WP) + צילום לפני/אחרי (`__compare`) כשיש שינוי חזותי.

## 2. הסוכנים (13) והבעלות

סימון: ✎ = בעלות מלאה על הקובץ; ⚑ = רק hook מסומן.

| # | סוכן | WPs | קבצים בבעלות ✎ | hooks ⚑ |
|---|---|---|---|---|
| 1 | **Split** (גל 0 בלבד; אחר כך נהפך ל-Camera-Input) | X-1 | `BunkerRenderer.ts` (פיצול), `CameraController.ts`, `PlacementController.ts`, `RoomViews.ts` | — |
| 2 | **Architect** | X-2, X-3, X-6, ST-1(לוגיקה), ST-2, ST-3, ST-5, ST-8(לוגיקה), ST-9 | `rendering/layout.ts`, `rendering/geom.ts`, `core/GameState.ts`, `systems/BuildingSystem.ts`, `systems/DigSystem.ts`, `data/zones.ts`, `data/districts.ts`, `data/wings.ts`, `core/SaveManager.ts` (מיגרציה) | `GameEngine.ts` (`adoptState`, פירוק חפירות) |
| 3 | **Structure-Render** | ST-1(רינדור), ST-4, ST-6, ST-7, ST-10, ST-11, ST-13, ST-17 | `rendering/structure.ts`, `rendering/world.ts` (underground, utilities), `rendering/perfFx.ts` (bandize, chunks), `rendering/decals.ts`, `rendering/signage.ts`, `rendering/atmosphere.ts`, `rendering/gfxFeatures.ts` | `shaft.ts` (נחיתות, בעלות People), `BunkerRenderer.ts` (קריאות לבנייה) |
| 4 | **Camera-Input** | ST-12, ST-19, UX-20, GP-6 (מצלמה) | `CameraController.ts`, `PlacementController.ts`, `ui/components/DepthRuler.ts`, `rendering/LabelScale.ts`, `ui/components/BuildMenu.ts` (הצבה) | `app.ts` (מצב הצבה), `ui/controllers/world.ts` |
| 5 | **People-Circulation** | ST-18 | `rendering/people.ts`, `rendering/workSpots.ts`, `rendering/routes.ts` (חדש), `rendering/shaft.ts`, `rendering/people3d.ts` | `RoomViews.ts` (כניסה/יציאה מתצוגה) |
| 6 | **Surface-Annex** | S0 סקר, ST-16, ST-20, ST-8(רינדור מחוזות) | `rendering/surface2.ts`, `rendering/projectSites.ts`, `rendering/surfaceLife.ts`, `data/ruins.ts` | `BuildingSystem.ts` (`placeBlock` 'surface'), `EventSystem.ts` (`wreckRoom` עילי) |
| 7 | **Rooms-Data** | BL-9..BL-38 (נתונים), BL-39, BL-2 (צמתי מחקר) | `data/buildings.json`, `data/research*.ts`, `data/specializations.ts`, `data/chains.ts`, `data/incidents.ts`, `data/book.ts`, `ui/icons.ts`, `ui/dom.ts` (`BUILDING_ICONS`), `ui/components/BuildMenu.ts` (קטגוריות/חיפוש, תיאום עם #4), `ui/components/BuildingPanel.ts` | `GameState.ts` (איחוד `BuildingType`) |
| 8 | **Rooms-Systems** | BL-1(קוד), BL-3, BL-4, BL-5, BL-8, אפקטי BL §3, ST-14(לוגיקה), ST-15(לוגיקה), GP-8(Foreman) | `data/buildingDefs.ts`, `systems/ResourceSystem.ts`, `PopulationSystem.ts`, `FamilySystem.ts`, `EventSystem.ts`, `IncidentSystem.ts`, `MaintenanceSystem.ts`, `ForemanSystem.ts`, `ResearchSystem.ts`, `data/trade.ts`, `data/dayCycle.ts` | `ExplorationSystem.ts`, `AwayDanger.ts`, `DeathSystem.ts` |
| 9 | **Room-Art** | BL-6, BL-7, GP-9, ST-13(מסגרות) | `rendering/roomComposer.ts` (חדש), `rendering/roomArt.ts`, `rendering/paintedRoom.ts`, `art/registry.ts`, `rendering/roomSet.ts`, `tools/roomfx.ts`, `tools/roomset.ts` | `ArtLibrary.ts` |
| 10 | **UX-iPhone** | UX-1..UX-9, UX-12(platform), UX-13..UX-18, UX-21, UX-22, UX-24 | `audio/AudioEngine.ts`, `utils/haptics.ts`, `utils/viewport.ts`, `utils/platform.ts` (חדש), `src/style.css`, `src/styles/*.css`, `ui/components/Sheet.ts`, `Modal.ts`, `Toast.ts`, `ui/HUD.ts`, `index.html`, `public/sw.js`, `public/manifest.webmanifest`, `ui/controllers/saves.ts`, `ui/notifications.ts` | `app.ts`, `MenuPanel.ts` (בלוק הגדרות) |
| 11 | **Access** | AC-1..AC-16 | `utils/a11y.ts` (חדש), טאב נגישות ב-`MenuPanel.ts`, `tools/a11y/audit.mjs`, `public/accessibility.html`, aria ב-`Sheet/Modal/Toast/HUD` (**אחרי** מיזוג UX-3/5/8/9) | `incidentFx.ts`, `surface2.ts` (תקציב הבזקים), CSS טוקנים |
| 12 | **Gameplay** | UX-10, UX-11, UX-19, GP-1, GP-2, GP-3, GP-5, GP-7, GP-10, GP-12 | `systems/DailySystem.ts`, `data/orders.ts`, `data/arcs.ts`, `ui/ceremony.ts`, `ui/share.ts`, `ui/controllers/welcome.ts`, `systems/Guide.ts`, `ui/components/CouponPanel.ts` | `app.ts` (`dialogGate`), `feedback.ts` |
| 13 | **QA-Sim-Perf** | X-4, X-5, QA-1..QA-9, GP-11, ST-21 (בוט/כלים) | `tools/sim/*`, `tools/perf/*`, `src/dev/*`, `.github/workflows/pages.yml`, `store/plan-2026-10/4-redesign/DONE-*.md` | — |

### 2.1 תלויות בין סוכנים

```
Split ──► Camera-Input ──► (ST-12, ST-19)
Architect ──► Structure-Render ──► People-Circulation / Surface-Annex
Architect ──► Rooms-Systems ──► Rooms-Data ──► Room-Art
UX-iPhone ──► Access (Sheet/Modal/Toast/HUD קבצים משותפים)
כולם ──► QA-Sim-Perf (שערים) ──► Gameplay (GP-1.. אחרי שלב 3)
```

### 2.2 מי נוגע בקבצים "חמים" (מניעת קונפליקט)

| קובץ | בעלים | מי עוד (hook) | כלל |
|---|---|---|---|
| `BunkerRenderer.ts` | Split ← אחר כך כל אחד בקובץ שלו | Structure-Render, People, Camera | **אסור להתחיל ST/ UX-20 לפני סיום X-1**. אחרי הפיצול הקובץ הוא רק חזית |
| `GameState.ts` | Architect | Rooms-Data (BuildingType), Gameplay (`daily`), Access (`a11y`), Rooms-Systems (`schoolTime`) | כל תוספת בבלוק עם הערה `plan4:` ובקשת מיזוג לאחר: מומלץ **סוכן אחד מאחד** (Architect) לכל שבוע |
| `he.json`/`en.json` | QA (מאחד) | כולם | כל סוכן מוסיף בלוק; QA מריץ lint ומסדר קודם מיזוג |
| `buildings.json` | Rooms-Data | Rooms-Systems (שדות חדשים) | Rooms-Systems מגדיר סכמה ב-BL-1 לפני שRooms-Data מתחיל |
| `app.ts` | UX-iPhone / Gameplay | Camera, Access | שורות בודדות מסומנות; `dialogGate` בבעלות Gameplay |
| `MenuPanel.ts` | UX-iPhone | Access (טאב נגישות), Gameplay (שיתוף/סיור) | כל סוכן מוסיף בלוק נפרד לפונקציה נפרדת |
| `style.css`/`styles/*.css` | UX-iPhone | Access (טוקנים בקובץ חדש `styles/a11y.css`) | Access לא עורך קבצים קיימים; יוצר `a11y.css` ומוסיף `@import` אחד |
| `structure.ts` | Structure-Render | Architect (`occupancy`) | `occupancy()` מוגדר על ידי Architect ב-ST-2 ואז נמסר |
| `people.ts` | People | Room-Art (`ROOM_ACTIVITY`) | Room-Art משנה רק טבלאות `ROOM_ACTIVITY/JOB_OUTFIT` |

## 3. בריפים מוכנים להדבקה (תקציר לכל סוכן)

כל בריף = כללי §1 + "מקור: `store/plan-2026-10/4-redesign/<קבצים>`" + רשימת ה-WP + קבצים + תוצר.

**Split:** "בצע את X-1: פצל `BunkerRenderer.ts` ל-`CameraController`, `PlacementController`, `RoomViews` לפי שורות הפיצול ב-01 §1. אפס שינוי התנהגות. אימות: `__compare` זהה ±1% על 12 צילומי פרוטוקול (QA מכין ב-X-5), `tsc`, `perf run.mjs --check`. אל תוסיף תכונות."

**Architect:** "בצע X-2, X-3, X-6, ST-1(`floorTop/floorAtY` בלבד, ללא גלריות עד שה-X-2 עבר ✓), ST-2, ST-3, ST-5, ST-8, ST-9. ודא שכל `rg '/ ?FLOOR_H'` מחוץ ל-`geom.ts` ריק. `placeBlock` מחזיר סיבות. מיגרציה v6→v7 מאומתת ב-5 שמירות."

**Structure-Render:** "בצע ST-1 (רינדור גלריות), ST-4, ST-6, ST-7, ST-10, ST-11, ST-13, ST-17. שער סגנון + חוזה ביצועים; `f24w-*` בתקציב. הוסף `GFX_FEATURES` ל-wings/galleries/strata."

**Camera-Input:** "בצע ST-12, ST-19, UX-20. מטרה: זום סקטור ≥ 0.9, תוויות ≥ 10px מסך, hit-slop 44, הצבה ב-2 הקשות עם רוח, סרגל עומק. בדוק ב-375×667/390×844/430×932."

**People-Circulation:** "בצע ST-18. תקציב: ≤ 12 הולכים, ≤ 0.3ms, 0 הקצאות/פריים. אין השפעה על לוגיקת קצב עבודה (D4)."

**Surface-Annex:** "בצע S0 (סקר, דוח כתוב) ואז ST-16, ST-20. קבל החלטות הצטלבות (פורטל, אביזרים, project lots) ותעד בראש הדוח."

**Rooms-Systems:** "בצע BL-1, BL-2(קוד), BL-3, BL-4, BL-5, BL-8 ואז אפקטי BL §3 ו-ST-14/15 (לוגיקה) בסדר: אש/בידוד/קונסל. הוסף שדות `BuildingDef` לפי 02 §3 BL-1 והודע ל-Rooms-Data."

**Rooms-Data:** "אחרי שה-BL-1 מוזג: הוסף סוגי חדר לפי טבלת 02 §2.1 (גל 1: BL-9..14,19,33; גל 2: ...; גל 3: ...), רשימת חיבור 02 §6 לכל סוג, ו-BL-39 (תפריט בנייה). מספרי פתיחה בלבד; lint וסימולציה מכריעים."

**Room-Art:** "בצע BL-6 (RoomComposer) ו-BL-7 (מסלול A). כל חדר חדש מקבל מראה (A או B) לפני מיזוג. שער סגנון. הכן בריף Canva לדרגה C לפי 02 §4.5."

**UX-iPhone:** "בצע P0: UX-1, UX-2, UX-3, UX-4, UX-5, ואז UX-6..UX-9, UX-13..UX-18, UX-21, UX-22, UX-24 לפי 03. שים לב: [V] = חייב מכשיר, אל תכריז 'תוקן' בלי בדיקה במכשיר; כתוב בדוח 'נבדק בדפדפן בלבד'."

**Access:** "בצע AC-1 (שכבת הגדרות+טאב), AC-3 (ניגודיות), ואז AC-2, AC-5..AC-14 לפי 03; AC-15 (כלי בדיקה) מוקדם כדי לשמש את כולם. Sheet/Modal/Toast/HUD רק אחרי שUX-iPhone מיזג."

**Gameplay:** "בצע UX-10, UX-11, GP-3 (שלב 2), GP-2, GP-1, GP-5, GP-7, GP-12 (שלב 3), ובסוף GP-10 אם השער עבר. סטייה כלכלית ≤ 1.5 שעות ייצור/יום (GP-1)."

**QA-Sim-Perf:** "בצע X-4, X-5 (שלב 0), ואז QA-1..QA-9. אחראי על מיזוג i18n (lint) ועל דוח DONE לכל גל."

## 4. פירוט QA (QA-1 עד QA-9)

| # | מה | פירוט | קבצים |
|---|---|---|---|
| QA-1 | **צינור `npm run check` מורחב** | `tsc` (שני קונפיגים) + `smoke` + `lint` + `migrate-test` (על `store/sim/saves-v6`) + `gates` על שמירה אחת; `package.json` scripts `check:full` (לא משנה `check` ש-CI משתמש בו עד שיציב) | `package.json`, `.github/workflows/pages.yml` |
| QA-2 | **פרוטוקול צילום** | קבועים: 12 צילומי תוכנית 2 §8.1 × 4 גדלי מכשיר (375×667, 375×812, 390×844, 430×932) × 3 איכויות × 2 שפות (he/en) × 2 גדלי טקסט = 576; ממוינים: ליבה 48 + מורחבים. סקריפט `tools/compare/run.mjs` מפעיל וגזר `store/compare/<tag>/` | `tools/*`, `src/dev/camShots.ts` |
| QA-3 | **הרחבות lint** | (א) סכמת `buildings.json`: שם/תיאור he+en, `slots` חוקי, `unlock` יחיד, קלט `chains` תואם, `incidents` משקלים קיימים, `PALETTES`/`BUILDING_ICONS` קיימים לכל סוג, `memorial.line.*` בשני השפות; (ב) `rg` אסור: `(y - TOPSOIL) / FLOOR_H`, `SLOTS_PER_FLOOR` מחוץ ל-geom/Architect, `0x7dff9e` מחוץ ל-`a11y.ts`; (ג) i18n parity לטבלאות `{he,en}` בנתונים (היום מחוץ לבדיקה); (ד) lint חדר ב-Act: `storage-fit` (L2) ממשיך לחול | `tools/sim/lint.ts` |
| QA-4 | **הרחבת הבוט** | `want` ל-30 סוגים עם תנאי Act ותקרות עותקים; חפירת אגפים כשהיא יעילה; דלתות באש/מגפה; הזמנות יום (1.5 מתוך 3); גן/בית ספר; מצבר/סולארי; מדדי GP-11; דוח "סוגים שנבנו" | `tools/sim/core.ts`, `report-core.mjs` |
| QA-5 | **תקציב ביצועים** | תרחישי `f24w-*` (X-4) + אחרי BL: `f24w-close-medium` עם 30 סוגים; תקציבי זיכרון GPU פר-תכונה; בדיקת אפס הקצאות בפריים; שער CI חוסם לאחר G1 | `tools/perf/*` |
| QA-6 | **מיגרציה** | `migrate-test` על Acts I/II/III/V/VII; השוואת צילום לפני/אחרי; בדיקה ש-`SAVE_VERSION` נשמר ושמירה v6 נשמרת כגיבוי `lastbunker_auto_v6` | `tools/sim/migrate*.ts` |
| QA-7 | **פרוטוקול מכשיר** | §6 למטה; דוח בתבנית | המסמך |
| QA-8 | **מבחן שימושיות** | §7 למטה | המסמך |
| QA-9 | **רשימת שחרור** | §8 | המסמך |

## 5. סדר מיזוג ושערים

הענפים מתמזגים ל-`main` **בגלים**, כל מיזוג אחרי `npm run check` + בדיקות הגל. סדר בתוך גל:

| גל | סדר מיזוג | שער (חייב להתקיים לפני המיזוג הבא) |
|---|---|---|
| **0** | 1. QA (X-4/5 קבצי כלים) → 2. Split (X-1) → 3. Architect (X-2, X-3, X-6) → 4. UX-iPhone P0 (UX-1..4) ← במקביל → 5. Access (AC-1, AC-3, AC-15 כלי) | **G0:** `check` ירוק, צילומים זהים ±1%, מיגרציה על 5 שמירות, `rg` נקי, P0 אודיו/קלט/מודל נבדקו בדפדפן, `audit.mjs` רץ |
| **1** | 1. Rooms-Systems (BL-1,2,3,4,5,8) → 2. Architect (ST-2,3,5,9) → 3. Structure-Render (ST-1,4,6,7,10,11) → 4. Camera-Input (ST-12,19) → 5. Rooms-Data (גל 1) → 6. Room-Art (BL-6,7) → 7. UX-iPhone (UX-5..9...) → 8. Access (AC-2,5..8) | **G1:** `f24w-close-medium` בתקציב; הצבה ב-2 הקשות; בוט בונה את כל סוגי גל 1; יום Genesis ±3; מיגרציה; צילומי מבנה מאושרים; מכשיר: P0 סגורים (QA-7 סבב 1) |
| **2** | 1. Rooms-Systems (אפקטים, ST-14/15) → 2. Structure-Render (ST-13,17) → 3. People (ST-18) → 4. Surface-Annex (ST-16,20) → 5. Rooms-Data (גל 2) → 6. Gameplay (UX-10,11, GP-3, GP-2) → 7. Access (AC-9..14) | **G2:** אנשים עוברים בין קומות; דלתות עוצרות אש; `f24w-*` + `walkers` בתקציב; טקסי GP-2; מכשיר סבב 2; מבחן שימושיות #1 |
| **3** | 1. Rooms-Data (מחוזות + חדרי Act) → 2. Gameplay (GP-1,5,7,10,12) → 3. UX-iPhone (שאריות + קליפה: מסמך) → 4. QA (איזון מלא) → 5. Access (בדיקה סופית + הצהרה) | **G3 (שחרור):** כל מדדי 00 §5; מכשיר סבב 3 מלא; מבחן שימושיות #2; `DONE` מלא |

**כלל ביצוע:** מיזוג שנכשל בשער נחזר לבעליו; לא ממשיכים לגל הבא עם שער אדום. כל מיזוג מגיע עם `store/plan-2026-10/4-redesign/DONE-<gl>.md` קצר.

## 6. פרוטוקול מכשיר (אייפון)

**מי מריץ:** המשתמש (אין כאן מכשיר). **איך:** פרוס את ה-build (GitHub Pages), פתח ב-Safari באייפון עם `?slot=review` (שמירה נפרדת), ובמקביל התקן כ"הוסף למסך הבית". **איסוף:** כפתור "העתק אבחון" בהגדרות (`crashGuard.ts:104-120`) מעתיק דוח (UA, מסך, זיכרון, יומן) ← הדבק בצ'אט; צילום מסך לכל כשל.

### 6.1 מטריצת מכשירים
| מכשיר | CSS px | DPR | הערה |
|---|---|---|---|
| iPhone SE (2/3) | 375×667 | 2 | **מכשיר לחץ** (מודלים, HUD, זיכרון) |
| iPhone 13 mini / 12 mini | 375×812 | 3 | |
| iPhone 14 / 15 | 390×844 | 3 | ייחוס |
| iPhone 15 Pro Max | 430×932 | 3 | ProMotion 120Hz |
| iPad (בונוס) | 810×1080 | 2 | מסך רחב, אין לוגיקה מיוחדת |

לכל מכשיר: Safari רגיל **וגם** מסך הבית (standalone); גרסת iOS מצוינת.

### 6.2 רשימת 30 בדיקות (סימון ✓/✗ + הערה)

| # | קבוצה | בדיקה | ציפייה |
|---|---|---|---|
| 1 | אודיו | פתיחה קרה, הקשה ראשונה על הכניסה | צליל מוזיקה+צליל לחיצה |
| 2 | אודיו | מתג שקט פעיל / כבוי | מכובד לפי הגדרה "קול גם במצב שקט" |
| 3 | אודיו | שיחה נכנסת ← חזרה | אודיו חוזר תוך 2 שניות או צ'יפ "הקש להפעלה" |
| 4 | אודיו | רקע 30 שניות ← חזרה | ללא הדים/כפילות |
| 5 | אודיו | טעינה על אייפון SE | אין קריסה/רענון אוטומטי |
| 6 | האפטיקה | בנייה/שדרוג/שגיאה/איסוף בועה | רטט מתאים או שקט תקין (PWA) |
| 7 | HUD | כל כפתור HUD נלחץ בקלות באגודל | 0 החמצות ב-20 לחיצות |
| 8 | HUD | גדלי טקסט 1.1/1.25/1.4/1.6 | HUD לא נחתך, נשבר יפה |
| 9 | HUD | פינות/Dynamic Island/קו הבית | אין חיתוך |
| 10 | HUD | סיבוב לאורך | מסך "הפוך" או פריסה דחוסה |
| 11 | מצלמה | ברירת מחדל: טקסט חדר קריא | ≥ 10px; אדם ניתן ללחיצה |
| 12 | מצלמה | פאן, קמצוץ, הקשה כפולה | חלק, ללא רעד |
| 13 | מצלמה | סרגל עומק, צ'יפי אגפים | קופץ נכון |
| 14 | מצלמה | שינוי סרגל הכתובת של ספארי | הזום לא אובד |
| 15 | הצבה | בנה חדר ב-2 הקשות, ביטול, הזזה | עובד; סיבה מוצגת כשלא חוקי |
| 16 | הצבה | אגף מערבי, אגף מזרחי | נחפרים, מוצבים בו חדרים |
| 17 | מודלים | פתח כל אחד מ-10 המודלים ב-SE+XL | כפתור אחרון נגיש בגלילה |
| 18 | קלט | הקלד בקוד קופון/חיפוש ספר | המקלדת מופיעה, מקלידים |
| 19 | קלט | מחוון קול | נגרר בלי לסגור את הגיליון |
| 20 | גיליון | החלפת טאבים בלי סגירה | עובד, ה-nav גלוי |
| 21 | שמירה | סגירה כפויה באמצע חפירה ← חזרה | התקדמות נשמרה, דוח צ'ק-אין |
| 22 | שמירה | ייצוא ושיתוף גיבוי | גיליון שיתוף מופיע |
| 23 | שמירה | עדכון גרסה | טוסט "גרסה חדשה" |
| 24 | ביצועים | 10 דקות בבונקר רחב, זום קרוב | ≥ 24fps, בלי חום קיצוני |
| 25 | ביצועים | `?perf` overlay: קריאות ציור/זיכרון | בתקציב (`budget.json`) |
| 26 | ביצועים | מצב חיסכון | 24fps ללא ויזואליה שבורה |
| 27 | RTL | 10 מסכים: HUD, בנייה, אנשים, מחקר, סחר, תפריט, ספר, מודלים, טוסטים, מפת השטח | אין חיצים הפוכים, מספרים תקינים |
| 28 | נגישות | VoiceOver: HUD, גיליון, טוסט | נקרא, פוקוס נכון |
| 29 | נגישות | הפחתת תנועה (הגדרת iOS) | אין רעידה/הבזק |
| 30 | נגישות | מצבי צבע | הכול מובחן גם בלי צבע |

### 6.3 תבנית דיווח
`מכשיר / iOS / מצב (Safari|Standalone) / # בדיקה / ✓✗ / מה ראיתי / צילום`; כל ✗ הופך ל-issue עם תג WP המתאים.

## 7. מבחן שימושיות (QA-8)

3 משתתפים (לפחות אחד לא-מפתח; אחד עם גודל טקסט גדול), עברית, iPhone 375×812 או 390×844, 45 דקות כל אחד, שמירה `?slot=ux-test` מוכנה ב-Act III.

| משימה | הצלחה | זמן יעד |
|---|---|---|
| "מה עושים עכשיו?" | מציין פעולה הגיונית | ≤ 60s |
| בנה גן ילדים | חדר מוצב ומאושר | ≤ 90s |
| חפור אגף מערבי בקומה 1 | חפירה התחילה | ≤ 90s |
| באש: סגור דלת | האש לא מתפשטת | ≤ 45s |
| מצא את הזמנות היום ובצע אחת | הושלמה | ≤ 120s |
| שנה גודל טקסט ופלטת צבע | נבחר, ה-HUD לא נשבר | ≤ 60s |
| שתף תמונת בונקר | נפתח גיליון שיתוף | ≤ 60s |
**מדדים:** 0 חסימות; ≥ 80% הצלחה במשימה 1; שאלון: "הבונקר נראה מגוון" ≥ 4/5; "קל להבין מה לעשות" ≥ 4/5. פלט: `store/plan-2026-10/4-redesign/usability-<תאריך>.md`.

## 8. רשימת שחרור (QA-9)

- [ ] `npm run check` + `check:full` ירוק.
- [ ] `node tools/perf/run.mjs --check` בכל תרחישי `f8`, `f24`, `f24w`, `audio-start`, `offline-24h` בתקציב; חוסם ב-CI.
- [ ] סימולציה: 3 זרעים × (engaged 80 ימים, casual 140 ימים): יום Genesis, מוות 0-2, סוגי חדר שנבנו, סרק, החלטות.
- [ ] מיגרציה: כל 5 הדוגמאות; גיבוי `lastbunker_auto_v6` נוצר.
- [ ] `audit.mjs`: 0 יעדי מגע < 44, 0 כשלי ניגודיות ≤ 14px, 0 כפתורים ללא שם.
- [ ] מכשיר: 30 בדיקות ב-SE, 14/15, Pro Max; Safari + standalone.
- [ ] מבחן שימושיות #2.
- [ ] `store/listing.md`, צילומי חנות, `privacy.html`, `accessibility.html` מעודכנים.
- [ ] מדריך עדכון/העברת שמירה מ-PWA לאפליקציה (אם קליפה).
- [ ] `store/plan-2026-10/4-redesign/DONE.md` מלא.

## 9. תבנית דוח סוכן (לפי פורמט הבית)

עד 400 מילים: **מה נבנה** (טבלה: WP | מה | קבצים `path:line`), **איך אומת** (פקודות + מספרים לפני/אחרי + קישורי צילום תחת `store/compare/<tag>/`), **מה נדחה ולמה**, **סיכוני מיזוג** (קבצים משותפים שנגעו), **שדות שמירה חדשים**, **המלצות**. דוחות DONE לפי גל: `Built / Deferred (and why) / Simulation (baseline-after-target) / Verified / Save migration / Merge risks`.

## 10. מפת מזהים (מי נמצא היכן)

| תחילית | נושא | קובץ |
|---|---|---|
| `X-` | יסודות | `01` §1 |
| `ST-` | מבנה (A) | `01` |
| `BL-` | מבנים (B) | `02` |
| `UX-` | חוויה ואייפון (C) | `03` |
| `AC-` | נגישות (D) | `03` |
| `GP-` | שיחוק ושימור (F) | `03` |
| `QA-` | אימות | `04` |
| `D1..D14` | החלטות | `00` §6 |
| `R1..R10` | סיכונים | `00` §7 |
