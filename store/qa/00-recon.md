# 00 · דוח סיור (שלב A): הבונקר האחרון

סיכום: העותק הקפוא (`beb07c3`, ענף `plan4/wave3`) **תקין**: `npm run check`, `npm run check:full`, `npm run build` עוברים, והמשחק נטען בלי שגיאות או אזהרות קונסול (עברית ואנגלית).
המלאי: 51 הגדרות מבנה (42 חדרי בנייה + 5 מחוזות + 3 תשתיות + מעלית), 110 מחקרים, 14 פרויקטים, 7 מערכות (Acts), 28 הישגים, 22 הזמנות יום, 12 אתגרי שבוע, 20 פרקי סיפור, 38 ערכי ספר. אין TODO/FIXME ואין `any` בקוד.
הנקודות לבדיקה: `?slot=` לא עובד ב-build ייצור (ראו למטה), CI לא מריץ את מרבית בדיקות הרגרסיה, חבילת ה-JS גבוהה מדוח הביצועים של גל 3, ולכל השחקן החדש הדיאלוג הראשון הוא בחירת קושי (לפני הפתיח).

---

## 1. תוצאות הרצה

**כל ההרצות ירוקות. אין כשל שחייב דיווח בראש הקובץ.**

| פעולה | תוצאה | ראיה |
|---|---|---|
| `git log -15` | ראש: `beb07c3 plan4: STATUS after wave 3`; 15 הקומיטים הם מיזוגי גל 3 (Access, Rooms-Data wave 3, UX-iPhone, Gameplay-1/2, ליטוש) | `git -C /home/user/last-bunker-qa log -15 --oneline` |
| `npm run check` (tsc + smoke + lint) | עבר, 21 שניות. smoke: סימולציית casual יום אחד seed 1 (era 2, 12 אנשים, 22 מחקרים, 0 מתים). lint: `lint OK (1455 keys per language)` | `assets/00/check.log` |
| `npm run check:full` | עבר, 30 שניות: migrate-test (6 שמירות v6->v7 עוברות), placement-test, infra-test, routes-test, rooms-test, openings-test כולם OK | `assets/00/check-full.log` |
| `daily-test.mjs`, `foreman-test.mjs` (לא חלק מ-`check:full`) | שניהם OK (daily: תקרת 1.5 שעות, נמדד 1.400) | הרצה ידנית |
| `npm run build` (tsc + vite build) | עבר, 976 מודולים, 2.2 שניות vite. אזהרה אחת: chunk `index` 1,210 KB ל-minify מעל סף 1,200 KB של vite (לא חוסם) | `assets/00/build.log` |
| עלייה בדפדפן | `vite preview` של `dist` על פורט **4300**, Chromium headless (Playwright 1.56, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`), viewport 400x800 מגע. עלה תוך כ-20 שניות (רינדור תוכנה). **0 שגיאות/אזהרות קונסול, 0 `pageerror`, 0 בקשות שנכשלו, 0 תגובות HTTP >=400** | `assets/00/load.png` |
| עלייה ב-`?debug` בעברית | אותה תוצאה (0 לוגים). נחשפים `__engine`, `__renderer`, `__audio`, `__app`, `__perf2`, `__perfFixture`; כרטיס הקופון מופיע בהגדרות | `assets/00/menu-he.png` (צילום נתפס בזמן הפתיח; ראו הערה) |

### הערות על ההרצה (חשובות לשאר העדשות)
1. **`?slot=<שם>` פועל רק ב-build פיתוח.** `SaveManager.ts:11`, `saveFlag.ts:10`, `singleInstance.ts:10` מחזירים סיומת ריקה כש-`import.meta.env.DEV` שקר. על `vite preview` של `dist` הפרמטר **מתעלם**, והשמירה היא בשקע הראשי. זה בטוח כל עוד כל עדשה עובדת על **פורט משלה** (מקור שונה = IndexedDB/localStorage נפרדים) ובהקשר דפדפן חדש; להשתמש ב-`?slot` רק עם `vite` dev (ואז לשים לב: `node_modules` הוא קישור ל-repo הראשי, ולכן תיקיית ה-cache של vite dev משותפת; לא בדקתי dev כדי לא לגעת בה).
2. `npm run build` יצר `dist/` בתוך העותק הקפוא (מתעלם git; `git status` נקי). `node tools/perf/run.mjs --only none --chunks` ו-`bundleSim` כותבים ל-`node_modules/.cache/` (משותף דרך הקישור).
3. הדיאלוג הראשון למשחק חדש (ללא שמירה) הוא **בחירת קושי** מעל ה-HUD (עם `.modal` פתוח), ורק אחריו מופיע הפתיח הקולנועי ("יום 2,557 אחרי האפר, הקישו כדי להיכנס"). שחקן חדש לכן רואה את המשחק לראשונה כשהוא כבר צריך להחליט על קושי, לפני שראה את העולם. (לעדשת UX/Onboarding.)
4. ב-`MenuPanel.ts:487` ההערה אומרת ש-`powerSaver` "not shown on purpose" בלשונית הנגישות, אך הוא מוצג בלשונית ההגדרות דרך `comfortRows()` (`MenuPanel.ts:156-171`); ההערה מיושנת. כמו כן "גודל טקסט" מופיע פעמיים (הגדרות + נגישות) והגדרת "מספר מספרים צפים" (popups) גם פעמיים באותו מצב; תקין, רק כפילות.

---

## 2. מלאי פיצ'רים

סימונים: **[H]** מוסתר מאחורי פרמטר/דגל; **[P]** בפיתוח/כלי בלבד; **[!]** חסר טקסט/אייקון/צליל/מראה/ערך בספר (פירוט בסוף הסעיף); **[ס]** תלוי התקדמות (נפתח במערכה/מחקר/Genesis).
כל המספרים נמדדו בהרצה (סקריפט שמעמיס את `src/data/*` ומדפיס), לא מקבצי תכנון.

### 2.1 מסכים, תפריטים ופאנלים (מה השחקן רואה)
- **HUD עליון** (`ui/HUD.ts`): שורת משאבים (בטלפון 4 ליבה: אוכל, מים, חשמל, חומרים; השאר מצטרפים רק כשדורשים תשומת לב או לפי "הצג הכל", זכור ב-`lastbunker_hud_more`; מחוון מילוי ושיעור נטו לכל משאב; הקשה פותחת מגירת משאב `ResourceSheet`), אוכלוסייה (הקשה = פאנל אנשים) + מונה הגעות, מורל (%), שעון יום/לילה + שכבת לילה, כפתור יומן, שבב עידן/מערכה (פותח את פאנל "פיקוד"), כפתור עונה [ס, מערכה 2 מאוחרת: אחרי כ-2.5 ימי משחק], כפתור אספקה יומית (מתנה) [ס], תיבת החלטות (Inbox) [ס, מערכה 2], שבב הזמנות יום (עם נקודת התראה), כפתור "מטרה נוכחית" (Objective) עם התקדמות, באנרים (חשמל, אירוע/משבר, מצב הצבה).
- **ניווט תחתון:** בנייה, אנשים (עם תג), מחקר, פני השטח, תפריט (⋯). קיצורי מקלדת (`ui/controllers/keyboard.ts`): B/P/R/L, חיצים, +/-, 1..9 קומה, Escape; אין קיצור לפני השטח (S) או לתפריט.
- **תפריט (5 לשוניות)** (`MenuPanel.ts`):
  1. *הגדרות*: ספר הבונקר, כרוניקה, "הציגו שוב טיפים", "צפו שוב בפתיח", צור תמונת שיתוף, התחל מצב סיור, שפה (he/en), צליל (מתג), עוצמת מוזיקה, עוצמת אפקטים (סליידרים 44px), איכות גרפיקה (אוטומטי/גבוהה/בינונית/נמוכה), מספרים צפים (הכל/חשובים/כבוי), חיסכון בסוללה, בהירות (בהירה/...), גודל טקסט (4 מדרגות 1.1/1.25/1.4/1.6), התראות (מתג; בספארי אייפון בטאב: שורה כנה בלבד), אבחון (העתק), כרטיס קופון **[H `?debug`]**, ייצוא/ייבוא שמירה (קליפבורד וקובץ), "נשמר בקבע" (persist), תאריך גיבוי אחרון, רשימת גיבויים אוטומטיים עם שחזור, "משחק חדש".
  2. *נגישות*: רשימת בונקר (StructurePanel), הפטיקה (כבוי/קל/חזק), צליל במצב שקט, גודל טקסט, תנועה (אוטומטי/מופחת/מלא), הבזקים (רגיל/בטוח), צבע (ללא/דאוטר/פרוטן/טריטן), כתוביות לצלילים, הכרזות לקורא מסך, ניגודיות (רגיל/גבוהה), צפיפות מספרים, יד אחת (כבוי/ימין/שמאל), מטרות מגע גדולות (52px), כפתורי זום צפים, תזמון (רגיל/רגוע), הצהרת נגישות (`public/accessibility.html`).
  3. *סטטיסטיקה* (9 שורות), 4. *הישגים* (28), 5. *בראשית* (איזוטופ, דרישות, כפתור לידה מחדש, 17 שדרוגי Genesis כולל 6 אבני-מפתח, שיתוף).
- **תפריט בנייה** (`BuildMenu.ts`): חיפוש, 10 קטגוריות (מגורים, מזון, חשמל, תעשייה, בריאות, הגנה, פני שטח, תשתית, סחר, מערכה), "מומלץ", סיבות חסימה (מחקר חסר, צפוף, רק עמוק, רק כניסה, דורש דגל, מחיר לפי מערכה, מספר עותקים).
- **פאנל חדר** (`BuildingPanel.ts`): שדרוג, עובדים (הוספה/הסרה/בחירה), התמחות (2 לכל סוג חדר, 75 בסך הכל על 35 סוגי חדרים), "מערך מחדש" (retool), פירוק, העברה (relocate), שרשראות קלט (מוזן/רעב/דחוף), סינרגיות שכנים, ערוץ מורל, משבר פעיל (צוות, חומרה, תיקון מהיר), מזג אוויר לחדרי שמש/רוח, מקום לילדים, מחסן, הגנה, רדיו.
- **פאנל אנשים** (`PeoplePanel.ts`): כרטיס אדם (בריאות, מורל, רמה/ניסיון, תכונות, "מאסטרי" דרגות 1-5 + אימון, משמרת/חדר, בחירת עבודה), עץ משפחה, מקורות מורל, גרירה להעברה עם תווית יעד (`DropChip`).
- **מחקר** (`ResearchPanel.ts`): 7 ענפים, תור (+1 לכל "ספסל מעבדה שני"), מזלג דוקטרינות (בחירה סוגרת אחות), "Refinements" (6, אינסופיים), רמזי "אאוריקה", כפתור Rush.
- **פני השטח** (`SurfacePanel.ts`, `worldMap.ts`): מפת משושים עם ערפל (רדיוס 9 עד 12 לפי מערכה), צוותי משלחת, "ארוך" (שיירה ארוכה), 7 ביומות, 10 נקודות עניין, אירועי משלחת (8) עם בחירה, מאחזים (outposts: בנייה/תביעה/תיקון), סחר (קרוואן, 3 שותפים, 3 דרגות מטען) מעל משושה הבית.
- **פרויקטים** (`ProjectsPanel.ts`): 14 פרויקטים בשלבים (עיצוב A/B, צוות, מסירה ידנית, "הפוך לפעיל"), אתגרי שבוע (12) עם קוסמטיקה (6), אתר פרויקט על הקרקע.
- **יומן** (`JournalPanel.ts`, 3 לשוניות): ממצאים (18 פריטי ידע/הקלטות/מכתבים), סיפור (20 פרקים לשחזור + דמויות), **חנות קרדיטים** (6 פריטים: תוכנית, גרוטאות, האצת מחקר, האצת פרויקט, איזוטופ, ארגז). החנות מקוננת ביומן בלבד (גילוי נמוך).
- **פיקוד/עידן** (`EraPanel.ts`): עידן/מערכה, יעדי מערכה, תחזית, "בתים" (Exodus), סיומות, חוקים (6; חריצים לפי מערכה), מנהל עבודה (הוראות קבע: תחזוקה, הפקדה לפרויקט, איוש, אימון, חוזים, `sealOnAlarm`), מד איום, "מה הלאה".
- **ספר הבונקר** (`HelpPanel.ts`, 38 ערכים ב-4 קבוצות) ו**כרוניקה** (`ChroniclePanel.ts`), **מגירות/מודלים**: חוזרים הביתה (welcome-back report + צ'ק-אין קצר אחרי היעדרות), "מה חדש" (`whatsnew.ts`), כרטיסי "מערכת חדשה" (11 כרטיסים לפי מערכה), טיפים (4: צביטה, הקשה כפולה, לחיצה ארוכה, אגפים), טקסי רגע מפתח.
- **רשימת בונקר** (`StructurePanel.ts`): תצוגת קומות וחדרים כטבלה (נגישות; מפתח L).
- **כלי מצלמה/הכוונה:** סרגל עומק (`DepthRuler`: מופעל במגע או `?ruler`), כפתורי זום (אופציה), מצלמת סקטורים, חיתוך עד קומה 24, גרירה/צביטה/הקשה כפולה.
- **PWA**: מניפסט (display fullscreen, portrait), service worker `lastbunker-v4` עם precache מ-`asset-manifest.json`, שבב "גרסה חדשה" (שומר ואז מרענן), כרטיס התקנה לאייפון, תזכורת גיבוי, רמז חיסכון בסוללה, מסכי splash ל-11 גדלי iPhone.

### 2.2 מערכות משחק (`src/systems`, 37 קבצים; רשימת הצעדים ב-`GameEngine.registerSystems`)
משאבים (7 רגילים + 5 משאבי מערכה: components/alloys/data/influence/seedCores + 4 מטא: isotope7, blueprints, vaultCoins, credits), בנייה, אוכלוסייה (תכונות 15, מורל 3 ערוצים), אירועים (13: wanderer, stash, pipeLeak, argument, trader, powerSurge, sickness, radioSignal 1-3, raiders, group, refugees), מחקר, משלחות, שיקום הריסות (4 סוגים), משברים בחדרים (5: fire, flood, blackout, roaches, breach), אסונות (5: collapse, deepFlood, epidemic, meltdown, steam), משפחה (לידות, ילדים, חבילות משפחה), פרויקטים, חפירה (מטה + אגפים מערב/מזרח + מחוזות), מערכות/Acts (7), איום (Threat director) + הפוגות, חוזים (supply/crew), מאחזים, מנהל עבודה, בתים (Exodus), תחזוקה/בלאי, תיבת החלטות, הישגים, יעדים/מדריך (Objective: 17 צעדים קבועים ועוד יעדים דינמיים "עוד N"), עידנים (4), סיפור, יומי (הזמנות), תשתית (דלתות מחיצה, חדר מדרגות, פיר אוורור), מוות/אזכרה, Rush (מטען האצה), חנות, אספקה (ארגז יומי עם רצף), מטא (Genesis).

### 2.3 חדרים (51 הגדרות ב-`buildings.json`)
- **בסיס (15 חדרי בנייה):** מגורים, גנרטור, חווה, משאבת מים, סדנה, מרפאה, חדר אוכל, מעבדה, חדר רדיו (T2), הידרופוניקה (T2), מטהר מים (T2), חדר כושר (T2), נשקייה (T2), כור (T3), מחסן; **אולמות דו-קומתיים:** אטריום (T4), אולם הכור (T5) (42 חדרי בנייה בסך הכל = 15 + 2 אולמות + 8 + 12 + 5). **מעלית** אוטומטית (לא בנייה).
- **גל 1 (8):** מצבר ענק, אולם מועדון, ספרייה, מרכז מחזור, מעבה אדים, חוות פטריות (עמוק), עמדת שער (כניסה/שורת השער), מגורי שומרים.
- **גל 2 (12):** מחלקת בידוד, שדה פאנלים, טורבינת רוח, מגדל תצפית (שלושתם בשורת בית השער), מוסך שיירות (כניסה/שער), תא טיהור (כניסה), בריכות דגים (צמוד לאגם), שוק, גן ילדים, בית ספר, מקלחות וכביסה, אולם זיכרון (נפתח בדגל `memorial:first` אחרי מוות ראשון).
- **גל 3 (5 חדרי מערכה, תפוקה 0.45x):** מפעל רכיבים, יצקת סגסוגות, מרכז נתונים, פורום האזרחים, מעבדת זרעים (עמוק).
- **מחוזות (5; נחפרים הצידה, 4 משבצות):** מערת גבישים, אגם תת-קרקעי, תחנת מטרו, מערת קיטור (גיאותרמי; מערכה 4 + מחקר `geothermalVents`), כספת טרום-מלחמה (מערכה 5 + מחקר `vaultSurvey`); מערת הגבישים, האגם והמטרו נפתחים לפי התקדמות החפירה (`after`).
- **תשתית (3, לא חדרים, ב-`state.layout`):** דלת מחיצה (3 מצבים: פתוח/סגור/אטום; 3 רמות), חדר מדרגות חירום, פיר אוורור (עד 3).
- **שורת בית השער** (קומה -1, מעל הקרקע): 5 חדרים לפי `place.floors`, מגדל, פאנלים, טורבינה; בניינים בקומה 0: gatePost, garage, decon.

### 2.4 מבנה הבונקר, מפה ועולם
- 3 קומות פתיחה (zones: living, agri, engineering) עד **24 קומות** (`MAX_FLOORS`), גלריות שירות כל 4 קומות (3,7,11,15,19), שכבות סלע/קליפה מדורגת, אגפים מערב/מזרח (`wings.ts`: תקרות 12-22 ו-0-10 משבצות לפי מערכה, "יציבות" מקצצת), חפירה מקבילה (מחקר `parallelDig`), בלוקים נחפרים במחיר זמן.
- עידנים (4): Remnant, Restoration, Colony, Undercity. מערכות (7): Survive, Rebuild, Settle, Expand, Rise, Govern, Genesis (תקרות: רמה 3-10, אוכלוסייה 12-190, קומות 5-24).
- פני שטח: 7 ביומות, 10 POI, מזג אוויר/רוח לחדרי אנרגיה, 4 עונות (4 ימי עולם כל אחת; מתחילות כ-2.5 ימי משחק לתוך מערכה 2), מחזור יום/לילה, מתרוצצים (עד 12 הולכים, מעלית עם נוסעים).
- סוף המשחק: 4 סופים (Commonwealth, Fortress, Garden, Ark) לפי ציון (דוקטרינות, חוקים, פרויקטים, שותפים), בחירה בתיבת ההחלטות.

### 2.5 מצבי משחק וקושי
- 3 קושיות לבחירה בתחילת בונקר (**Settler** אין מוות/פשיטות 0.75; **Warden** ברירת מחדל; **The Last** 1.25 צריכה, 1.3 פושטים), נבחר פעם אחת למשחק; לכל אחת מכפיל Legacy.
- **Genesis** (לידה מחדש) אחרי עידן 3 + מחקר + אוכלוסייה; **Exodus**: 4 תרחישים (Bunker 17, Metro Station, The Mine, Seed Vault; 3 האחרונים אחרי Genesis ראשון) עם "בית" שמעביר הכנסה; **Mutators** (4: Harsh Winters, Scarcity, Restless World, Lean Years) נבחרים בתחילת ריצה חדשה; Vanguard/Seed Bank (העברת אנשים/זרעים).
- מצב היעדרות: סימולציית offline (efficiency, waste tracking), `awayDanger`, עד 3 התראות ביום (אין מנגנון תזמון מקומי בלי Capacitor), נעילה לעותק יחיד (`singleInstance`), גיבוי מתגלגל כל חצי שעה, גיבוי טרום-הגירה, `_prev`, `_bak`, `_corrupt`.
- **מצב סיור** (`ui/tour.ts`): מצלמה משוטטת על מסך נקי, 20fps, Wake Lock. **שיתוף** (`ui/share.ts`): תמונה 1080x1350, `navigator.share` עם קובץ או הורדה.

### 2.6 הזמנות יום, טקסים, שיתוף
- **הזמנות יום** (`DailySystem`, `orders.ts`, `controllers/daily.ts`): החלפת יום ב-04:00, 3 הזמנות מתוך 22 (7 easy, 10 medium, 5 new), הזמנה אחת להחלפה, ארגז יומי, רצף (streak 0.1/צעד), שברי תוכנית (4 = תוכנית), פרס זהב/כסף/Rush; מתחילות אחרי חצי שעה מודרכת או ממערכה 2; קלט גם מההיעדרות (חפירה, מחקר, אוכל).
- **טקסים** (`ui/ceremony.ts`, 8 סוגים): build, roomLevel, research, person, act, dig, death, genesis; הפחתת תנועה = כרטיס סטטי; ניתנים לדילוג בהקשה.
- **אתגרי שבוע** (12, `challenges.ts`): פרס קרדיטים + קוסמטיקה (6 לוחיות/דגלים); חנות קרדיטים ביומן.

### 2.7 מוסתר / דגלים / כלי פיתוח
| דגל | מה עושה | מקור |
|---|---|---|
| `?debug` | חושף `window.__engine/__renderer/__audio/__app`, `__perf2()`, `__perfFixture()`, כרטיס קופון `BUNKER17` (8 שורות: rush, מחקר, בנייה, חפירה, פרויקט, משלחות, הגעות, מילוי מחסנים) | `app.ts:318-326`, `MenuPanel.ts:390`, `CouponPanel.ts:9` |
| `?perf` | שכבת ביצועים | `app.ts:326` |
| `?gx=-wings,-strata,...` / `+x` / `-all` | מכבה/מדליק דגלי מבנה של תוכנית 4 (wings, galleries, strata, walkers, surfaceRow, floorId, openings, bulkheads, branches) | `gfxFeatures.ts:64` |
| דגלי איכות (`GFX`): fade, place, wallShadow, beams, sitSleep, skyLayers | לפי רמת איכות (נמוך מכבה wallShadow/beams/skyLayers); מצב "lite" אחרי 2 יציאות לא תקינות בשעה מכבה אותם | `gfxFeatures.ts:46-56,97` |
| `?gfx1` / `?gfx2` | המראה הישן / הצבוע; **נשמר ב-localStorage** (`lastbunker_gfx2`) | `structure.ts:23-31` |
| `?people3d` / `?people2d` | גופי 3D מול וקטור; **נשמר** (`lastbunker_people3d`) | `people3d.ts:17-26` |
| `?nocomposed` | החדרים החדשים חוזרים לציור ישן (A/B) | `roomComposer.ts:933` |
| `?chunkbuilds=N` | בקרת בניית chunks | `frontChunks.ts:44` |
| `?ruler` | סרגל עומק גם בלי מגע | `DepthRuler.ts:50` |
| `?slot=<שם>` | שמירה נפרדת, **רק ב-DEV** | `SaveManager.ts:11` |
| DEV בלבד | `storeShots`, `camShots`, `structureDev` (דפי כלי: `tools/*.html`) | `app.ts:327-329` |
| `lastbunker_lite` | מצב lite אוטומטי אחרי קריסות; מתאפס בבחירת איכות ידנית | `app.ts:239` |

### 2.8 פיצ'רים שחסר להם טקסט/אייקון/צליל/מראה/ערך (נבדק, [!])
- **אין ערך בספר** (`data/book.ts`) ל: הזמנות יום, טקסים, שיתוף, סיור, דלתות מחיצה/חדר מדרגות/פיר אוורור, אגפים, הולכים; ו**18 מתוך 47 החדרים והמחוזות** לא מוזכרים בספר בשם (עברית/אנגלית) ולא במזהה: generator, waterPump, workshop, medbay, radioTower, hydroponics, waterPurifier, armory, reactor, metro, reactorHall, recycler, condenser, barracks, quarantineWard, solarArray, garage, market. (חיפוש טקסט ב-`data/book.ts`; 38 הערכים הקיימים מרוכזים סביב מושגים ולא חדרים.)
- **מפתחות i18n יתומים** (קיימים בשני הקבצים, אין להם שימוש בקוד ולא תחת קידומת דינמית): כ-30, ביניהם `game.title/subtitle/newGame/continue/settings/loading` (מסך פתיחה ישן), `build.upgrade/cost/level/constructing/complete/workers/production/noSpace/notEnoughResources/time/needsResearch`, `building.output/noWorkersNeeded/neighbours`, `people.unassigned`, `toast.no_food/no_water`, `settings.music/load`, `surface.leavesJob`, `genesis.reqTitle`, `infra.built`, `safety.closed`, `danger.raid.hold`, `danger.toast.saved`, `memorial.hint`, `maintenance.done`, **כל `next.*` (title/short/medium/long/workLeft/noCrew/pick)**, `outpost.started`, `structure.show`, `announce.built/raid`, `daily.inboxDetail`, `a11y.daily`, `a11y.dialog`, `share.done`. מפתח כפול בכתיב שונה: `settings.notifyIOSHint` (יתום) מול `settings.notifyIosHint` (בשימוש).
- `coupon.fill.unit` ריק בשתי השפות (מכוון? לא נבדק אם נקרא).
- **אין התמחויות** לאולמות (אטריום, אולם הכור), למחוזות, ולחמשת חדרי המערכה (ב-`specializations.ts` 75 התמחויות על 35 סוגי חדרים); זו החלטה אפשרית, לא באג.
- **חדרים בלי מחקר פותח** (`research=0`): מגורים, משאבת מים, מטרו (מחוז), אולם זיכרון (נפתח בדגל). לבדוק שמתוכנן.
- אין **טקסי** (ceremony) להתחלת פרויקט/הישג/מערכת חדשה (רק 8 הסוגים).
- אייקונים: 147 מוגדרים, **כל טוקן `[[...]]` בקוד, ב-JSON וב-data מוגדר** (לא נמצא טוקן שירנדר כטקסט גולמי). צלילים: 60 SFX מוגדרים, כל שם שמנגנים מוגדר; 18 מהם לא מנוגנים בקריאה מילולית (`open`, `tape`, `fire`, `splash`, `powerDown`, `skitter`, `extinguish`, `story`, `tab`, `switch`, `modalOpen`, `notify`, `unassign`, `unlock`, `depart`, `type`, `engineStart`, `drip`, `confirm`, `cancel`; חלקם מנוגנים דרך `uiSound` או משתנה: לא אומת).

---

## 3. מפת סיכונים

### 3.1 מה בדוק ומה לא (`tools/sim`)
**בדיקות (נכללות ב-`check`/`check:full`):** smoke (casual יום אחד), lint נתונים (DAG מחקר, עלויות, i18n שוויוני, חסימות מחסן, פריסת חדרים/אגפים/מחוזות, ספר), migrate-test (6 שמירות v6), placement-test (bestSpot ל-42 סוגי חדר), infra-test (דלתות/פיר/מדרגות/משבר), routes-test, rooms-test (אפקטי חדרים, מוות), openings-test; מחוץ ל-`check:full`: `daily-test`, `foreman-test`, `gates.mjs`.
**הבוט (`tools/sim/core.ts`, 1,234 שורות) מפעיל:** בנייה/שדרוג/חפירה/מחוזות/התמחות, מחקר ותור, שיקום הריסות, משלחות ושיירות, אירועים וסיפור, פשיטות/משברים, חוקים, פרויקטים, הזמנות יום, ארגז אספקה, Rush, מחוזות, ו-Genesis (עם `--rebirths`).
**מערכות/פיצ'רים בלי בדיקה אוטומטית שמצאתי (אין אזכור ב-`tools/sim/*.ts`):**
- **Mutators + Exodus/תרחישים** (בחירה ב-`ui/controllers/story.ts:130-153`, `GameEngine.ts:728-736`): אפס כיסוי; כל מה שאחרי Genesis (בית, Vanguard, Seed Bank) רק דרך `--rebirths` בלי בחירת תרחיש/מוטטורים.
- **כל שכבת ה-UI** (פאנלים, טקסים, שיתוף, סיור, PWA, התראות, NumberPopup): אין בדיקות DOM; הכלים היחידים הם `tools/a11y/*`, `tools/compare`, `tools/perf` (ידניים).
- `ThreatSystem`, `ChronicleSystem`, `EraSystem`, `FamilySystem` (לידה/גדילה), `HomeSystem`, `OutpostSystem`, `SupplySystem`, `ShopSystem` (קניות/ramp), `AwayDanger`: מופעלות רק דרך סימולציה כוללת, בלי בדיקת יחידה.
- אתגרי שבוע וקוסמטיקה (`challenges.ts`: `snapshot/challengeProgress`): אין אזכור בסים (חוץ מ-`challenge` אחד ב-`core.ts`).
- `saveWorker`, `crashGuard`, `singleInstance`, `SaveManager` (גיבוי/שחזור/שגיאות כתיבה): אין בדיקה; הכיסוי דרך `migrate-test` בלבד (טעינה).
- **CI** (`.github/workflows/pages.yml`) מריץ רק `tsc`, `smoke`, `lint`, build ו-perf (`continue-on-error`); **`check:full` (6 בדיקות רגרסיה) לא רץ ב-CI**, ו-`store/sim/saves-v6` מתעלם git ולכן הן גם **אינן יכולות** לרוץ שם. `gates.mjs` (דטרמיניזם, זהות אופליין, תקציבי ביצועים) לא מקושר לשום סקריפט, וברירת המחדל שלו מצביעה על `store/sim/saves-v4` שלא קיים.

### 3.2 קבצי data/קוד גדולים (שורות; ל-JSON/JSON-like כולל בייטים)
| קובץ | שורות | הערה |
|---|---|---|
| `src/data/buildings.json` | 1,848 (43 KB) | 51 הגדרות; עריכה ידנית, נטען לתוך חבילת index |
| `src/i18n/he.json` / `en.json` | 1,457 (99 KB / 81 KB) | 1,455 מפתחות; chunk עצל בייצור |
| `src/data/story.ts` | 644 (61 KB) | 20 פרקים, שני לשונות מוטמעות |
| `src/data/specializations.ts` | 425 | 75 התמחויות |
| `src/data/projects.ts` | 357, `book.ts` 343, `research*.ts` ~970 | |
| `src/rendering/BunkerRenderer.ts` | 1,712 (86 KB) | הגדול ביותר; `people.ts` 1,381; `incidentFx.ts` 1,087; `surface2.ts` 1,070; `strata.ts` 1,000 |
| `src/app.ts` | 1,250 (63 KB) | מחבר 12 בקרים + כל הפאנלים |
| `src/core/GameEngine.ts` | 1,000, `GameState.ts` 737 | |
סה"כ `src/*.ts`: 61,348 שורות (2.95 MB).

### 3.3 סימני סיכון בקוד (נספרו ב-`src` בלבד)
- **TODO/FIXME/HACK/XXX: 0.**
- **`any` מפורש: 0** בקוד ייצור. יחיד: `type Any = any` ב-`src/dev/perf.ts:13` (מסומן, דגל `?debug`/`?perf`).
- **`as unknown as`: 54** ב-15 קבצים. החמורים בסוג: `ContractSystem.ts` (8; גישה ל-`item.data` של תיבת החלטות, אין טיפוס מאוחד), `BunkerRenderer.ts` (5), `app.ts` (5, כולל `window as unknown as Record` ל-`__engine`), `dev/*` (8), `AudioEngine.ts` (4), `core/saveWorker.ts` (2), `StateManager.ts` (2), `GameEngine.ts` (2). בנוסף `tools/sim/*-test.ts` משתמשים בהם לבניית מצבי בדיקה.
- **`catch` בולע:** 103 בלוקי catch; רובם מוערים ומכוונים (localStorage חסום, Haptics, Audio, matchMedia). בנתיב השמירה (`SaveManager.ts`): `decode`/`importSave` מחזירים `null` בלי הבחנה בין "פגום" ל"לא קיים" (הטיפול ב-`loadSafe` מבדיל), `maybeRoll`/`keepPreMigration` בולעים בכוונה. `GameEngine.autoSave` (שורה 935) סופר כשלים ומשדר `save:failed` רק ב-2 כשלים ובכל 20 אחריהם. **ראו עדשת שמירות/נתונים לבדיקה אם הכשל הראשון מוצג.** לא מצאתי `catch {}` ריק לחלוטין בנתיב טעינה/שמירה.
- **`innerHTML`: 4 שימושים:** `SurfacePanel.ts:173` (SVG של מפה מבנוי ממספרים וקבועי data; `data-q="${hex.x}"` מגיע מהמצב, כלומר משמירה מיובאת, self-XSS בלבד), `ui/dom.ts:117` ו-`ui/icons.ts:326` (SVG מקבוע), `main.ts:31` (מחרוזת קבועה). אין `outerHTML`/`document.write`.
- **`@ts-ignore`/`@ts-expect-error`/`eslint-disable`: 1** (`dev/perf.ts:13`).
- **קוד מת** (ייצוא ללא אף מייבא; סרקתי `src`, `tools`, `public/*.js`, `index.html`, `vite.config.ts`):
  - **קובץ שלם:** `src/utils/ObjectPool.ts` (35 שורות, אף אחד לא מייבא). (`core/saveWorker.ts` נטען דרך `new Worker(new URL(...))`, לא מת.)
  - **ייצואים מתים (28):** `DISASTER_KINDS`, `PROJECT_IDS`, `doneProjects`, `TIER2_RESOURCES`, `hasFirebreak`, `Tuning`, `floorH`, `doorStateAt`, `people3dFailed`, `signageArtKeys`, `roomWidth`, `raidOdds`, `RUSH_START`, `gainsText`, `popupWanted`, `statusCss`, `isStandalonePwa`, ו-ב-`InfraSystem.ts`: `FIRE_CODE_MULT`, `STAIRWELL_RANGE`, `VENT_RELIEF_PER_STACK`, `nextDoorState`, `emergencyActive`, `fireCodeCovered`; ב-`doors.ts`: `removeDoor`, `closedBetween`, `isShutOff`, `allDoors`.
  - **סיכון סחף (drift):** קבועי "קוד כיבוי אש" בפירוט כפול: `InfraSystem.ts:31-36` (`FIRE_CODE_MULT=1.5`, `STAIRWELL_RANGE=3`, `VENT_RELIEF_PER_STACK=2`) לא בשימוש, בעוד הערכים בפועל מגיעים מ-`roomEffects.ts` (`fireCodeMult`, `ventilationRelief`). שינוי באחד לא ישפיע; ההערה ב-`InfraSystem.ts:33` ("the multiplier is in roomEffects") מעידה שהכפילות מודעת, אך הקבועים המתים מטעים. `emergencyActive`/`nextDoorState`/`fireCodeCovered` לא נקראים: **לבדוק אם הלוגיקה שלהם (למשל חיווי "יש מה לסגור" בשעת חירום) מומשה במקום אחר או נשכחה.**
- **מצב גלובלי ב-`localStorage`:** 25 מפתחות `lastbunker_*` (חלקם מצב גרפי שנדבק מפרמטר URL: `gfx2`, `people3d`).

### 3.4 מקומות ידועים-רגישים (לעדשות)
- 2 מערכות מרכזיות גדלו מאוד בלי פיצול: `BunkerRenderer` ו-`app.ts`.
- שמירת גרסה 7 (`SAVE_VERSION`), 6 שמירות דוגמה v6 (`store/sim/saves-v6`, לא ב-git).
- פעילויות רקע: `saveWorker` (lz-string), `singleInstance` (claim ב-localStorage).
- `Sheet.ts`: פאנלים פתוחים הופכים את ה-HUD והקנבס ל-`inert` (נגישות; לבדוק שאין "מלכודת" אחרי קריסת פאנל).
- פונטים מגוגל (`index.html:28-30`; `Karantina`, `Rubik`, `Secular One`): תלות חיצונית; ה-SW שומר אותם אחרי טעינה ראשונה (ידוע מ-STATUS: "גופנים מקומיים" לא נעשה).

---

## 4. מספרי בסיס

### 4.1 חבילה (gzip)
- `npm run build` (vite, בייטים עשרוניים KB): `index` 393.3, `pixi` 161.5, `ArtLibrary` 46.2, `he` 28.2, `en` 25.8, `book` 10.3, `synth` 6.9, `perf` 3.4, `share` 2.1, `tour` 1.6, `saveWorker` (לא gz) 4.9, CSS 23.9.
- `node tools/perf/run.mjs --only none --chunks` (KiB, כמו `perf-wave3.md`): **סה"כ JS 661 KB; טעינה ראשונה 583 KB; CSS 24 KB** ("within budget" בכלי, הסף 10% מעל `budget.json`: 625 / 560). `index` 381.7, `pixi` 156.4, `ArtLibrary` 44.7, `he` 27.5, `en` 25.0, `book` 10, `synth` 6.7.
- **השוואה ל-`perf-wave3.md`** (623 סה"כ, 556 ראשונה, `index` 398.9): **+38 KB סה"כ ו-+27 KB בטעינה הראשונה**. `index` + `ArtLibrary` (שנטען ב-`modulepreload` בטעינה הראשונה, `dist/index.html`) = 426.4 KB מול 398.9 בדוח, כלומר הגידול הוא בקוד המשחק והדאטה (+27.5 KB) מאז המדידה בדוח; `pixi` (156.4) ללא שינוי. סיבה (חדרי גל 3, הזמנות יום, טקסים, שיתוף) היא **השערה**: לא הרצתי diff היסטורי. הסף ב-`budget.json` (`jsGzKB: 625`, `initialJsGzKB: 560`) נחצה; הבדיקה "עוברת" בזכות טולרנס 10%.
- נכסים: `public/` 11 MB (182 קבצי WebP, `rooms` 2.4 MB, `people` 2.2 MB, `kit` 1.9 MB), `dist/` 13 MB.

### 4.2 שורות קוד לפי תיקייה (`src`, `.ts`/`.css`/`.json`)
| תיקייה | שורות | קבצים |
|---|---|---|
| `rendering` | 24,843 | 55 |
| `systems` | 8,407 | 37 |
| `data` (כולל `buildings.json`) | 8,359 | 43 |
| `ui/components` | 6,348 | 31 |
| `ui/controllers` | 3,411 | 15 |
| `i18n` | 3,059 (he/en 1,457 כ"א + מנהל) | 3 |
| `ui` (שורש) | 2,903 | 18 |
| `styles` + `style.css` | 2,579 + 744 | 15 + 1 |
| `core` (+`state`) | 2,526 + 183 | 10 + 1 |
| `audio` | 2,423 | 9 |
| `app.ts`/`main.ts` (שורש `src`) | 2,101 | 2 |
| `utils` | 772 | 10 |
| `dev` | 586 | 4 |
| `art` | 933 | 2 |
| **סה"כ `src`** | **~61,350** | **257** |
| `tools/sim` | 4,466 | |
| `tools/*.ts/html` (כלי אמנות/איזון) | 3,841 | |
| `tools/perf`, `a11y`, `compare` | 375 / 596 / 293 | |

### 4.3 מפתחות i18n
- **1,455 מפתחות** בכל שפה (שוויון נאכף ב-lint); 1 ריק (`coupon.fill.unit`), 5 עם טקסט זהה (תבניות כמו `{name} ×{n}`, תקין).
- בנוסף **טקסט דו-לשוני מוטמע בקבצי data** (שמות/תיאורים של חדרים 51, מחקרים 110, חוקים, הישגים, סיפור 20 פרקים, ספר 38, הזמנות...) ו-10 מחרוזות קשיחות ב-`ObjectiveSystem.ts` (17 צעדי מדריך), `Intro.ts`, `signage.ts`, `share.ts:144`. לכן אין מקור יחיד לתרגום, והוספת שפה שלישית דורשת לעבור על ~40 קבצי data.
- קבוצות גדולות: `event` 80, `settings` 75, `a11y` 60, `build` 54, `memorial` 50, `building` 45, `daily` 36, `infra` 34, `coupon` 34, `foreman` 31.

### 4.4 זמנים ומדדי ריצה
- `npm run check`: 21.3 שניות; `check:full`: 30.5 שניות; `build`: 15.1 שניות (tsc + vite 2.2 שניות).
- smoke (seed 1, casual, יום אחד): era 2 ב-0:25, B5 ב-3:40, 12 אנשים, 22 מחקרים, אחוז סרק 51% (יחסי; המדידות הארוכות ב-`tools/sim` הן עבודת עדשת האיזון).
- טעינה ראשונה בדפדפן headless: ~20 שניות עד HUD ודיאלוג קושי (רינדור תוכנה, מספר יחסי בלבד).

---

## 5. רשימת בדיקות מומלצות לעדשות (מבוסס ממצאי הסיור)
1. **תשתית/QA:** להוסיף את `check:full` (ואת `daily-test`/`foreman-test`) ל-CI או לספק את `saves-v6` ל-CI; לתקן ברירת מחדל ב-`gates.mjs` ל-`saves-v6`.
2. **חדשים/UX:** סדר הדיאלוגים בהפעלה ראשונה (קושי לפני פתיח); גילוי חנות הקרדיטים (מקוננת ביומן); קיצורי מקלדת חסרים (Surface/Menu).
3. **גודל חבילה:** +27 KB בטעינה ראשונה מעל דוח גל 3 (583 מול 556); לאתר מה גדל (diff של chunks בין הקומיט של הדוח ל-HEAD) ולבדוק אם `ArtLibrary` (44.7 KB gz, `modulepreload`) ניתן לדחייה.
4. **דאטה/שמירה:** נתיב הכשל הראשון של כתיבת שמירה (`GameEngine.ts:935`, התראה רק מהכשל השני); ייבוא שמירה פגומה (`importSave` מחזיר `null` בלי סיבה).
5. **קוד מת/סחף:** לאשר שהקבועים המתים ב-`InfraSystem.ts` ופונקציות `doors.ts` באמת מיותרים ואין תכונה (חיווי חירום) שנשכחה.
6. **תוכן:** ערכי ספר חסרים ל-20 חדרים ולמערכות גל 3; ~30 מפתחות i18n יתומים (כולל `next.*` שנראה כפאנל "הצעד הבא" שנוטש).
7. **אחרי Genesis:** תרחישים (Exodus) ו-Mutators ללא כיסוי סימולציה; מומלץ ריצה ידנית/בוט אחרי `--rebirths`.
