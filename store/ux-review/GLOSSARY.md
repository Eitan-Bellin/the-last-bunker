# מילון מונחים / Glossary (ux-wp6, 2026-10-09)

שם עברי אחד לכל מושג במשחק. חל על `src/i18n/he.json` ועל ספר הבונקר (`src/data/book.ts`), ונבדק ב-`node tools/sim/glossary-lint.mjs`
(שגיאה ב-he.json ובספר; אזהרה בשאר קובצי `src/data/*.ts`, שבבעלות חבילות אחרות; `--strict` מכשיל גם על אזהרות).

One Hebrew name per game concept. Applies to `src/i18n/he.json` and the Bunker Book; checked by `tools/sim/glossary-lint.mjs`.

## פנייה / Address
- פונים לשחקן ברבים: "לחצו", "שדרגו", "שלחו". כפתור הוא פועל ברבים ("שדרגו לרמה 3") או שם פעולה ("סגירה", "חפירת קומה B4").
- Buttons speak to the player in the plural, or name the action as a noun. Never the masculine singular ("שדרג", "שלח", "בנה").

## מונחים / Terms

| מושג (en) | עברית | אסור (במקום זה) | הערות |
|---|---|---|---|
| Act | מערכה | | I עד VII. "פרק" שמור לפרקי הסיפור |
| Era | עידן | | המראה של הבונקר; לא ציר התקדמות |
| Act project / charter | פרויקט המערכה | אמנה, אמנות | ProjectsPanel: "פרויקטים" |
| Command panel | מרכז הפיקוד | לוח הפיקוד | מיקום: "(הדגל למעלה)" |
| Decisions inbox | תיבת ההחלטות | "תיבה" לבד, "בתיבה" | תמיד בשם המלא |
| Day chest (daily orders) | מטמון היום | תיבת יום | |
| Supply crate (daily) | ארגז אספקה | משלוח אספקה | גם כותרת וכפתור |
| The Ark (ending) | התיבה | | השימוש היחיד במילה "תיבה" לבד |
| Trade credits | זיכויי סחר / זיכויים | קרדיט, קרדיטים | |
| Blueprint (piece) | שרטוט (רבע שרטוט) | תוכנית, תוכניות | "תוכניות" בסיפור במובן plans: מותר שם בלבד |
| Rush charge / boost | האצה / האצות; האצת מחקר, האצת פרויקט | זירוז | 15 דקות לכל האצה |
| Survivors (the bunker's people) | ניצולים (או "אנשים") | דיירים, שורדים | "הדיירים הקודמים" רק לתושבי הבונקר הישנים (lore) |
| Room level | רמה (רמה 1 עד 10) | Mk, Mk4 | |
| Specialty | התמחות | "מותאם" | "חדרים בהתמחות" |
| Compound (same-type neighbours) | מתחם | מורכב | |
| Neighbour bonus | שכנים | | |
| Late-Act resources (components, alloys, data, influence, seed cores) | משאבי המערכות המאוחרות / משאב המערכה | מטבע המערכה, tier-2, שכבה 2 | |
| Research tier | שלב | T3 | |
| Doctrine | דוקטרינה | | נשאר המונח (שמות המחקר בנתונים). מוסבר תמיד: "לוקחים דרך אחת, והאחרות נסגרות עד בראשית" |
| Eureka | אאוריקה | | |
| Genesis (prestige) | בראשית / פרויקט בראשית | לידה מחדש, נולדתם מחדש | |
| A run (one timeline, Genesis to Genesis) | סיבוב ("הסיבוב הזה") | ריצה, ציר זמן | en: "run" |
| Genesis payout | איזוטופ-7 | מורשת | en may still say "Legacy" in places |
| Echo modifier | בונוס בראשית | הד | en: "Genesis bonus" |
| Keystone | אבן יסוד | | |
| Hardships (mutators) | קשיים | | |
| Map region (hex) | אזור / אזורים | משושה, משושים | en: "region" |
| Outpost | מאחז | | |
| Expedition | משלחת | | |
| Caravan | שיירה | | |
| Partners | השותפים | | המסוף, שבט החלודה, ד"ר נועה |
| Contract | חוזה | | |
| Foreman / standing orders | מנהל העבודה / פקודות קבע | | |
| Law | חוק | | |
| Daily orders | הזמנות יום | | |
| Weekly challenge | אתגר השבוע | | |
| Ruins / clearing | הריסות / פינוי | חדרים הרוסים, אזורים הרוסים (כשם מושג) | "פנו את ההריסות" |
| Dig / wing | חפירה / אגף (הרחבת אגף) | | |
| Floor names | B1, B2, B3 ("B3 (הקומה השלישית)" בפעם הראשונה) | | השלט בבונקר אומר B3 |
| Morale | מורל | | |
| The Bunker Book | ספר הבונקר | | |
| Chronicle | הכרוניקה | | |
| Journal | יומן | | ממצאים, סיפור, חנות |
| Finds (lore) | ממצאים | | פתקים, קלטות, תמונות |

## Not yet following the glossary (owned by other packages)
`node tools/sim/glossary-lint.mjs` lists them as warnings: `achievements.ts` (singular buttons in titles, "לידה מחדש"),
`challenges.ts` ("משושים"), `districts.ts` / `research.ts` / `researchRooms.ts` ("תוכניות"), `prestige.ts` / `projects.ts`
("הד"), `researchLate.ts` / `researchLong.ts` ("מורשת", "דיירים"), `incidents.ts` ("דיירים"), `ObjectiveSystem.ts`
("משושים", not scanned: it is a system file). The Ark-related "התיבה" in `story.ts`, `acts.ts`, `endings.ts`, `projects.ts`
is correct and can be ignored.
