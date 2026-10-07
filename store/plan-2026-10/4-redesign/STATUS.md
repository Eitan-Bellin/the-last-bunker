# מצב ביצוע תוכנית 4 (לקריאה בתחילת כל סשן/אחרי קומפקט)

עודכן: 2026-10-07 (אחרי גל 2) · ענף עבודה: `plan4/wave0` (ב-GitHub, מקושר ל-PR #1 כטיוטה, **לא מוזג ל-main**) · ענף התוכנית: `plan4-redesign-docs`.

## איך עובדים (שיטה שהוכחה)
1. כל סוכן רץ ב-worktree (`isolation: worktree`), ענף `worktree-agent-<id>`; הפרומפט מתחיל ב-`git merge --no-edit plan4/wave0`, `ln -s /home/user/the-last-bunker/node_modules node_modules`, והעתקת `store/sim/saves-v6` (שמירות דוגמה, gitignored; לייצור מחדש: `node tools/sim/run.mjs --mode casual --days 3 --seeds 1-3 --dump-save store/sim/saves-v6/c`, ו-e10/e30/e55 לפי `tools/sim/README.md`).
2. ממזגים ל-`plan4/wave0` בעותק הראשי (`git merge --no-edit worktree-agent-<id>`), פותרים קונפליקטים ידנית, ואז: `npx tsc --noEmit -p .`, `npx tsc --noEmit -p tsconfig.tools.json`, `node tools/sim/smoke.mjs`, `node tools/sim/lint.mjs`, `node tools/sim/placement-test.mjs`, `node tools/sim/migrate-test.mjs store/sim/saves-v6`, `npm run build`. רק אחרי שכולם ירוקים: commit + push.
3. הסביבה: אין WebKit/אייפון; Chromium בלבד עם רינדור תוכנה (~1fps) ולכן מדידות ביצועים הן יחסיות בלבד. כלי השוואת צילומים: `node tools/compare/run.mjs capture --tag T --save <save.json> --sizes 390x844` (רעש 3-4%).
4. ה-trailers של commit: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` ו-`Claude-Session: https://claude.ai/code/session_013joQQmR5MWaYDSYMQE2RU4`.

## הושלם ומוזג ל-plan4/wave0
- גל 0: X-1 (פיצול BunkerRenderer ל-CameraController/PlacementController/RoomViews), X-2 (geom.ts), X-3/X-6 (state.layout, SAVE_VERSION 7, דגלים), X-4/X-5 (כלי QA, `tools/compare`, `check:full`), UX-1..4 (אודיו/האפטיקה/מודלים/קלט), AC-1/3 (a11y.ts, טאב נגישות, ניגודיות).
- גל 1: UX-5..9 + AC-12, ST-12 (מצלמת סקטורים, LabelScale, HitSlop, DepthRuler), AC-2/5..11/15 (הבזקים בטוחים, צבעים, ARIA, כלי audit), UX-10/11 + GP-3 (תור דיאלוגים, טיפים, צ'ק-אין), BL-1..5/8 (סכמת BuildingDef, ערוצי מורל, ילדים), ST-3/5 (אגפים, חפירה כללית, `wings.ts`), ST-1/4/6/7 (גלריות, אגפים, קליפה מדורגת, chunks), ST-8/9 (מחוזות לפי מיקום, אולמות מול גלריות, "מה חדש"), ST-19/UX-20 (הצבה, relocate), ST-10 (שכבות סלע), BL-9..14/19/33/39 (8 מבנים + תפריט בנייה).

- גל 2: ST-14/15 (דלתות מחיצה, חדר מדרגות, פיר אוורור: לוגיקה + `src/systems/doors.ts` + ציור + כרטיסי "דלתות ויציאות"/"בטיחות"), סינרגיות ואפקטי חדרים פועלים בכלכלה, ST-18 (הולכים ומעלית עם נוסעים, מאחורי דגל `walkers`, מכבדים דלתות סגורות), ST-11/13/17 (זהות קומה, פתחי חדרים, צנרת נחתכת בדלת סגורה), ST-16/20 (שורת בית השער בקומה -1: gatePost, פאנלים, טורבינה, מגדל; סקר S0), BL-15..18/20..23/26/30..32 (12 חדרים), BL-6/7 (RoomComposer + מראה ל-20 חדרים; `art-brief-tierC.md`).

## בעיות פתוחות ידועות (עדכון אחרי גל 2: gatePost נפתר דרך שורת בית השער, סינרגיות הופעלו, לוחות מחוז נבדקו)
- חבילת JS ~625KB gz מול תקציב 520 (`tools/perf/budget.json`); קריאות ציור היו מעל התקציב כבר בגל 0. צריך חיתוך/פיצול בגל 3. הפריסה לא נחסמת על כך.
- סימולציה: Genesis 87 (היה 85) ו-firstVote/decision +2 ימים על seed אחד (100 יום). 14 יום: זהה לבסיס.
- לא נראו בצילום: פירי אוורור על הקרקע והריסת בית שער ישן (אין שמירה מלפני Act II); תוויות חדרי 1-משבצת חופפות.
- מראה חדרי גל 2 נבדק בדף כלי בלבד ולא במשחק; פירוק חדר משאיר דלתות; בריכות דגים לא נבדקו ליד אגם.
- סעיפי 02 §13 שלא נבדקו: משקלי `incidents.ts`, `HOT_ROOMS`, `signage.ts`, `decals.ts`.
- [V] בכל מה שנוגע בקצה מסך, מגע, צליל, הפטיקה, ביצועים באייפון.

## (ישן) בעיות פתוחות ידועות
- `gatePost` לא נבנה בפועל (קומה 0 מלאה ב-Act II; דורש אגף או שורת בית השער).
- סינרגיות שכנות (SYNERGIES) מוצגות אך אין מערכת שמפעילה אותן.
- אין שלטים/דקלים/צלילים/מראה עשיר למבנים החדשים (RoomComposer BL-6/7 טרם נעשו); ערכי Bunker Book חסרים.
- סלע: רך מציורי החדרים, בלוק יסודות גנרי, גוון בזלת כחלחל, ללא `lightOf()`.
- לוחות ושלט קומה לא מורחבים כשמחוז נדחף (structure.ts).
- תוויות שם ארוכות עלולות לחפוף בזום גבוה; אזור גרירה בקצה המסך (18px) מול מחוות iOS [V].
- סימולציה: Acts 5-7 התאחרו ב-2-3 ימים; Genesis מצב רגוע 80→86 (בטווח); Genesis מעורב לא נמדד (>60 ימים).
- `windAt` ב-surface2 משתמש בשעון הרנדרר ולא בזמן משחק (ויזואלי בלבד).
- חומרי ניקוי: סוכנים הריצו `pkill` על שרתי vite פעם אחת.

## צריך מהמשתמש
בדיקת אייפון אמיתית (רשימת 30 הבדיקות ב-`04-agents-and-qa.md` §6), אישור מיזוג PR #1 ל-main (מפעיל פריסה לשחקנים), בקשה/אישור לפונטים מקומיים, ציורי Canva, Mac עבור Capacitor.

## גל 2 (לא התחיל) — תוכנית
- People-Circulation: ST-18 (הליכה בין חדרים/קומות, מעלית עם נוסעים; ≤12 הולכים, קוסמטי).
- Rooms-Systems: ST-14/15 לוגיקה (דלתות מחיצה, חדר מדרגות, פיר אוורור) + קוראי אפקטים + SYNERGIES.
- Structure-Render: ST-13 (פתחי חדרים), ST-17 (צנרת מסועפת), ST-11 (זהות קומה), תיקון לוחות מחוז.
- Surface-Annex: S0 סקר + ST-16 (שורת בית השער) + ST-20.
- Rooms-Data גל 2: BL-15..18, 20..23, 26..32 (+ RoomComposer BL-6/7 של Room-Art).
- Gameplay: GP-2 (טקסים), GP-1 (הזמנות יום) ב-גל 3.
שערים: ראו `04-agents-and-qa.md` §5.
