# נושא B: 30 מבנים חדשים, מגוון, מספרים, חיווט, אמנות

מסמך 3 מתוך 5 בחבילה `4-redesign`. הנחות: `00-master-plan.md` §3 (עקרונות) ו-§6 (החלטות D5, D6, D12, D13).
כל המספרים כאן הם **נקודת פתיחה**; הסימולטור וה-lint מכריעים. מקור הבסיס (כל בסיס מצוטט בקובץ:שורה): `buildingDefs.ts`, `buildings.json`, `ResourceSystem.ts:281-303`, `PopulationSystem.ts:33,294-303`, `chains.ts:17-28`, `incidents.ts:30-66`, `ResearchSystem.ts:74`.

## 1. הפערים שהמבנים החדשים סוגרים (מהקוד, לא מניחוש)

| פער | עדות | מבנה שסוגר |
|---|---|---|
| אין מקומות עבודה ל-190 תושבים: ~62 משבצות עבודה ב-45 חדרים | סכום `maxWorkers`; `acts.ts:107-133` תקרות 150/190/190 (F8 בתוכנית 1) | כל החדרים החדשים (≈ +100 משבצות), וחדרי Act (15) |
| ילדים אינם יכולים לעבוד/ללמוד (`assignSurvivorToBuilding` מחזיר false); גדילה רק דרך `familySuites` | `PopulationSystem.ts:~320`, `FamilySystem.ts:67` | גן ילדים, בית ספר |
| תקרת מורל 22 משותפת לכל החדרים; אין חדר פנאי/תרבות/זיכרון | `PopulationSystem.ts:33` | אולם מועדון, ספרייה, אולם זיכרון, מקלחות |
| אין אחסון חשמל מעבר ל-`storage` (+50/רמה) ואין ייצור אוטומטי | `buildings.json` | מצבר, סולארי, טורבינת רוח |
| רפואה: חדר אחד (`medbay`) ונקודת כשל יחידה | `ResourceSystem.ts:276` | בידוד, פטריות (+תרופה קטנה), מקלחות (מונע) |
| אין מקור ישיר לגרוטאות מלבד metro/ספקים/משלחות | טבלת מקורות | מרכז מחזור |
| אין מקור לאבני בלו-פרינט | נמצא רק בהפצות/הישגים | כספת טרום-מלחמה (מחוז) |
| אין חדר למשלחות/שיירות (רק חלון UI) | `ExplorationSystem`, `trade.ts` | מוסך שיירות, תא טיהור, שוק, מגדל תצפית |
| הגנה: רק `armory`; אין קו קדמי | `EventSystem.ts:358-380` | עמדת שער, מגדל, מגורי שומרים |
| מטבעות Acts (רכיבים/סגסוגות/נתונים/השפעה/ליבות זרע) מיוצרים רק כ"תפקיד" של חדר קיים, **לכן Acts V-VII לא מוסיפים מכניקה** | `specializations.ts`; סעיף 3.4(5) בדוח הלולאה | חמישה חדרי Act |
| אין דלתות/חירום/אוורור | `IncidentSystem:195-201` (אש רק לשכן) | דלת מחיצה, חדר מדרגות, פיר אוורור |

## 2. הקטלוג (30 סוגים)

**מפתח:** `slots` = רוחב במשבצות (חדש: שדה מפורש `slots` בהגדרה, 1-5; היום נגזר ממידות). ‏`T` = tier. ‏`L1/Lspec/Lmax` = תפוקה לשנייה (חדר מאויש מלא, לפני מורל/חשמל/מחקר), לפי `1 + 0.5·(L−1)^0.85` ⇒ ×1 / ×2.62 (L5) / ×4.24 (L10); בחדרי 5 רמות ×1 / ×1.90 (L3) / ×2.62 (L5). ‏`draw` = צריכת חשמל ל-L1 (גדלה 0.5/רמה). **מחיר = חומרים/גרוטאות/ידע/תרופה/אבנית-תכנית** × `costMult` לכל עותק קיים. ‏`unlock` = צומת מחקר יחיד (הכלל ב-`ResearchSystem.ts:74`: רק צומת ראשון בעל `unlock` נספר).

### 2.1 קטלוג משחקי

| id | שם (עב / En) | T | slots | קומות/חוקי מקום | unlock (צומת: מחיר, זמן, Act) | בנייה | maxL (spec) | תפוקה / אפקט (L1 / Lspec / Lmax) | draw | עובדים · סטט · baseEff | קלט שרשרת | מגבלת עותקים |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BL-9 `batteryBank` | מצבר ענק / Battery Bank | 2 | 2 | כל קומה | `energyStorage`: ידע 50+חומרים 60, 360s, Act II; requires: מחקר חשמל הבסיסי הקיים (לאתר ב-`research.ts`) | חומרים 120, גרוט 25, ×1.8, 100s | 10 (5) | `storageCap.power` +150/רמה (150 / 750 / 1500); אין ייצור | 0 | 0 | — | 3 |
| BL-10 `commons` | אולם מועדון / Commons | 2 | 2 | אזור מגורים או עמוק | `communityHall`: ידע 25+חומרים 30, 180s, Act I-II | חומרים 70, מזון 10, ×1.8, 70s | 10 (5) | מורל **נוחות** 2 +1/רמה (2 / 6 / עד התקרה 6 של הערוץ, ראו BL-3) | 1 | 1 · charisma · 0.2 | — | 2 |
| BL-11 `library` | ספרייה / Library | 3 | 2 | אזור מחקר/עמוק | `libraryScience`: ידע 70+חומרים 80, 600s, Act II | חומרים 110, גרוט 10, ×1.9, 120s | 10 (5) | ידע 0.06 / 0.157 / 0.254; `storageCap.knowledge` +60/רמה; מורל **תרבות** 1 +0.5/רמה | 1 | 1 · intelligence · 0.2 | — | 2 |
| BL-12 `recycler` | מרכז מחזור / Recycler | 3 | 3 | אזור הנדסה או עמוק | `recyclingTech`: ידע 90+חומרים 120, 900s, Act III | חומרים 200, גרוט 20, ×2.0, 240s | 10 (5) | גרוטאות 0.14 / 0.367 / 0.594 | 3 | 2 · strength · 0.2 | חומרים 0.12 (+0.3/רמה), נדרש (×0.35 בלעדיו) | 2 |
| BL-13 `condenser` | מעבה אדים / Air Condenser | 2 | 2 | כל קומה | `atmosphericWater`: ידע 45+גרוט 15, 300s, Act II; requires `waterFiltration` | חומרים 110, גרוט 20, ×1.8, 120s | 10 (5) | מים 0.7 / 1.83 / 2.97 (אוטומטי, ללא עובדים) | 5 | 0 | — | 3 |
| BL-14 `mushroomFarm` | חוות פטריות / Mushroom Farm | 2 | 2 | **קומות עמוקות בלבד (f ≥ 3)** | `mycology`: ידע 40+גרוט 10, 240s, Act I-II; requires `waterFiltration` | חומרים 90, גרוט 10, ×1.7, 120s | 10 (5) | מזון 0.9 / 2.36 / 3.82; תרופה 0.01 / 0.026 / 0.042 | 2 | 2 · endurance · 0.2 | — | 3 |
| BL-15 `quarantineWard` | מחלקת בידוד / Quarantine Ward | 3 | 2 | אזור מגורים; סמוך ל-`medbay` מומלץ | `epidemiology`: ידע 100+חומרים 100, 900s, Act III; requires מחקר ה-medbay | חומרים 150, גרוט 20, תרופה 20, ×1.9, 150s | 10 (5) | `quarantine.capacity` 3+L; חולים מתאוששים ×2; הדבקה מהם 0; בעת מגפה סוגר דלתות | 2 | 2 · intelligence · 0.2 | תרופה 0.02 (boost) | 1 |
| BL-16 `solarArray` | שדה פאנלים / Solar Array | 2 | 2 | **שורה עילית (קומה −1) בלבד** | `photovoltaics`: ידע 60+גרוט 20, 600s, Act II | חומרים 100, גרוט 30, ×1.8, 90s | 10 (5) | חשמל 3.0 / 7.9 / 12.7 **× אור יום** (`shape:'daylight'`) | 0 | 0 | — | 4 |
| BL-17 `windTurbine` | טורבינת רוח / Wind Turbine | 3 | 1 | **שורה עילית בלבד** | `windPower`: ידע 80+גרוט 40, 600s, Act III | חומרים 140, גרוט 40, ×2.0, 150s | 10 (5) | חשמל 2.4 / 6.3 / 10.2 **× (0.4+0.9·רוח)** (`shape:'wind'`) | 0 | 0 | — | 4 |
| BL-18 `watchtower` | מגדל תצפית / Watchtower | 2 | 1 | **שורה עילית בלבד** | `observation`: ידע 40+גרוט 15, 240s, Act II | חומרים 80, גרוט 20, ×1.7, 80s | 10 (5) | הגנה 4 +2/רמה; **התראת פשיטה** +30s/רמה (עד +5 דק'); ראייה +1 משושה מ-L5 | 0.5 | 1 · agility · 0.2 | — | 2 |
| BL-19 `gatePost` | עמדת שער / Gate Post | 2 | 2 | קומה −1 או 0 (ליד הפיר) | `perimeter`: ידע 50+חומרים 80, 360s, Act II; requires `armoryResearch` | חומרים 120, גרוט 30, ×1.9, 100s | 10 (5) | הגנה 6 +3/רמה; משקל פריצה ב-`incidents.breach` ×0.5 בקומות −1/0 | 1 | 2 · strength · 0.2 | — | 2 |
| BL-20 `garage` | מוסך שיירות / Motor Pool | 3 | 3 | קומה −1 או 0 | `vehicles`: ידע 110+גרוט 60, 1200s, Act III | חומרים 220, גרוט 50, ×2.0, 240s | 10 (5) | צוותי משלחת +1 ב-L3, +2 ב-L8; מהירות −2%/רמה; מטען שיירה +5%/רמה | 2 | 2 · agility · 0.2 | גרוטאות 0.02 | 1 |
| BL-21 `decon` | תא טיהור / Decon Chamber | 3 | 2 | **קומה 0 בלבד** (כניסה) | `decontamination`: ידע 90+חומרים 100, 900s, Act III | חומרים 140, גרוט 30, ×1.9, 150s | 10 (5) | פציעות/מחלה בחזרת משלחות ×(1−0.04·L, מינ' 0.5); `AwayDanger` מופחת | 2 | 1 · endurance · 0.2 | מים 0.1 (נדרש) | 1 |
| BL-22 `aquaculture` | בריכות דגים / Fish Ponds | 3 | 3 | **צמוד** למחוז `lake` באותה קומה (`place.adjacentTo:'lake'`) | `aquaculture`: ידע 90+גרוט 30, 900s, Act III; דורש מחוז lake קיים | חומרים 260, גרוט 40, ×2.0, 240s | 10 (5) | מזון 1.1 / 2.88 / 4.66; מים +0.2 | 2 | 2 · endurance · 0.25 | — | 1 |
| BL-23 `market` | שוק / Market | 3 | 3 | קומה −1/0/1 | `marketplace`: ידע 100+חומרים 140, 900s, Act III; requires מחקר ה-trade | חומרים 240, גרוט 30, ×2.0, 240s | 10 (5) | מטען שיירה +10%/רמה (עד +60%); **לוח טרוק** (BL-23b): 1+⌊L/3⌋ הצעות מתחלפות ביום | 1 | 3 · charisma · 0.2 | — | 1 |
| BL-24 `geothermal` | מערת קיטור / Geothermal Vent | 4 | 4 (מחוז) | **מחוז**, קומה ≥ 6 | `geothermal`: ידע 220+גרוט 80, 3600s, Act IV | חומרים 900, גרוט 180, תכנית 1, ×2.2, 600s | 5 (3) | חשמל 8 / 15.2 / 21 (ללא דלק); סיכון קיטור ב-incidents | 0 | 3 · endurance · 0.4 | — | 1 |
| BL-25 `oldVault` | כספת טרום-מלחמה / Pre-War Vault | 4 | 4 (מחוז) | **מחוז**, קומה ≥ 5 | `vaultSurvey`: ידע 240+גרוט 90, 3600s, Act V | חומרים 1000, גרוט 200, ×2.2, 600s | 5 (3) | **תכניות** 0.00005 / 0.0000950 / 0.000131 לשנייה (≈ 1 ל-5.5ש' ב-L1 מאויש; ≈ 1 ל-2.9ש' ב-L3; ≈ 1 ל-2.1ש' ב-L5); גם משתנה בשער סימולציה | 1 | 3 · intelligence · 0.25 | — | 1 |
| BL-26 `nursery` | גן ילדים / Nursery | 2 | 2 | אזור מגורים | `childcare`: ידע 30+חומרים 50, 240s, Act II (אירוע eureka: ילד ראשון נולד) | חומרים 80, מזון 20, ×1.7, 90s | 10 (5) | **קיבולת ילדים** 4+2/רמה; `childGrowth` ×1.25 (+0.05/רמה); מורל נוחות 1 +0.5/רמה | 1 | 2 מטפלים · charisma · 0.3 | — | 2 |
| BL-27 `bulkhead` | דלת מחיצה / Bulkhead | 2 | **0** (גבול בין משבצות) | בין שני חדרים/מסדרון | `bulkheads`: ידע 35+חומרים 60, 240s, Act II | חומרים 40, גרוט 5 (לדלת) | 3 | ראו ST-14 | 0 | 0 | — | ללא |
| BL-28 `stairwell` | חדר מדרגות חירום / Emergency Stairwell | 2 | 1 | כל קומה (אורך 1 קומה, ניתן לחבר) | `emergencyExits`: ידע 40+חומרים 70, 300s, Act II | חומרים 70, גרוט 10, ×1.6 | 3 | ראו ST-15 | 0.5 | 0 | — | ללא |
| BL-29 `ventStack` | פיר אוורור / Vent Stack | 3 | 1 | רצף קומות (עד 4) | `ventilation`: ידע 80+גרוט 20, 600s, Act III | חומרים 120, גרוט 20 לכל קומה | 3 | ראו ST-15 | 1 | 0 | — | 3 |
| BL-30 `school` | בית ספר / School | 3 | 3 | אזור מגורים/מחקר | `education`: ידע 120+חומרים 150, 1200s, Act III; requires `childcare` | חומרים 180, ידע 40, ×2.0, 240s | 10 (5) | קיבולת ילדים 6+3/רמה; **בוגר**: +1 סטט (עד 10) בגיל בגרות (+2 ב-`academy`); ידע 0.05 / 0.131 / 0.212 | 2 | 3 מורים · intelligence · 0.25 | — | 1 |
| BL-31 `bathhouse` | מקלחות וכביסה / Bathhouse | 2 | 2 | אזור מגורים | `sanitation`: ידע 35+חומרים 40, 240s, Act II | חומרים 90, גרוט 10, ×1.8, 90s | 10 (5) | מורל נוחות 1.5 +0.5/רמה; **היגיינה**: משקל `epidemic`/`roaches` ×(1−0.04·L, מינ' 0.5) לכל הבונקר | 2 | 1 · endurance · 0.2 | מים 0.08 (נדרש) | 2 |
| BL-32 `memorialHall` | אולם זיכרון / Memorial Hall | 2 | 2 | אזור מגורים | **דגל סיפור** `memorial:first` (מוות ראשון שהונצח); ללא מחקר (הרחבת `isBuildingUnlocked` ל-`unlockFlag`) | חומרים 100, ×1.7, 100s | 10 (5) | מורל **תרבות** 2 +1/רמה; עונש אבל ×(1−0.1·L, מינ' 0.4); **קיר כוכבים** (פרסי שבוע ב-GP-9) | 1 | 1 · charisma · 0.2 | — | 1 |
| BL-33 `barracks` | מגורי שומרים / Barracks | 3 | 3 | אזור מגורים; קומה 0/−1 מומלץ | `militia`: ידע 80+גרוט 40, 600s, Act III; requires `armoryResearch` | חומרים 200, גרוט 40, ×1.9, 180s | 10 (5) | `maxPopulation` +6 (+2/רמה); הגנה 8 (+5/רמה) | 1 | 3 שומרים · strength · 0.2 | — | 2 |
| BL-34 `componentsPlant` | מפעל רכיבים / Components Plant | 4 | 3 | הנדסה/עמוק | `microfab`: ידע 200+גרוט 100, 3600s, Act III | מחיר Act | 5 (3) | רכיבים = **1.5×** תפוקת תפקיד `assemblyLine` ברמה זהה | 4 | 3 · agility · 0.3 | גרוטאות 0.05, חומרים 0.1 | 1 |
| BL-35 `alloyFoundry` | יצקת סגסוגות / Alloy Foundry | 4 | 3 | הנדסה/עמוק | `alloyCasting`: Act IV | מחיר Act | 5 (3) | סגסוגות = 1.5× `arcFurnace` | 5 | 3 · strength · 0.3 | חומרים 0.4, גרוט 0.04 | 1 |
| BL-36 `dataCenter` | מרכז נתונים / Data Center | 5 | 3 | מחקר/עמוק | `dataCenter`: Act V | מחיר Act | 5 (3) | נתונים = 1.5× `dataVault` | 6 | 3 · intelligence · 0.3 | ידע 0.3 | 1 |
| BL-37 `forum` | פורום האזרחים / Citizens' Forum | 5 | 3 | מגורים | `civicForum`: Act VI | מחיר Act | 5 (3) | השפעה = 1.5× `councilHall` | 3 | 3 · charisma · 0.3 | מזון 0.3 | 1 |
| BL-38 `seedLab` | מעבדת זרעים / Seed Lab | 5 | 3 | עמוק | `seedGenetics`: Act VII | מחיר Act | 5 (3) | ליבות זרע = 1.5× `seedForge` | 6 | 3 · intelligence · 0.3 | סגסוגות, נתונים (כמו seedForge) | 1 |

**הערות כיול:**
1. בסיס תפוקות: חוות 0.6, הידרופוניקה 1.4 (T2) ⇒ חוות פטריות 0.9 במחיר זול יותר אך **רק בעומק**; מעבה אדים 0.7 מים אוטומטי אך יקר בחשמל (5); מחזור 0.14 גרוטאות מול `metro` 0.4.
2. מגבלת עותקים (`maxCopies`, שדה חדש): אין ספאם של סוג אחד; בוט וחנות מכבדים.
3. מחירי T2-T3 לפי **Act** (D13): `getBuildCost` מקבל `actMult(act) = [1,1,1.5,2.2,3,4,5][act-1]` רק לסוגים חדשים בגל 1, ואחר כך לכולם (BL-5) לאחר שהסימולציה אישרה.
4. חדרי Act (BL-34..38): "מחיר Act" = `actPrice(act, hours)` מ-`pricing.ts` (כמו שדרוגי Mk4+). תוצר 1.5× של התפקיד **ברמה זהה** משמעו: `level × specOutput(role, level) × 1.5`; הסוכן קורא את המספרים מ-`specializations.ts` ולא ממציא; שער: יום Genesis ±3 ימים.
5. כספת טרום-מלחמה היא **מקור התכניות** היחיד מחדר: ב-L5 מאויש מלא ≈ 11/יום (24ש'/2.1ש') + 3/יום בחנות ≈ 14 ⇒ משלים (לא מחליף) הפצות. שער: סך תכניות/יום ≤ 14, ובדרך כלל נמוך כי החדר לא מאויש מלא תמיד.
6. אם בדיקת ה-lint [L2] (storage-fit) נופלת על מחיר שדרוג של רמות 2-3: הנוסחה `base·costMult·(costMult+0.6)^(L−1)·1.5 ≤ 0.8·cap(Act)`; מורידים `baseCost` או `costMultiplier` של הסוג, לא את המגבלה.

### 2.2 סוגים נגזרים שדורשים התאמות בקוד קיים (כולל הטבלה המלאה שלהם ב-§3)
מצבר (אין קוד: `effects.storageCap` כללי), מועדון (קוד: ערוצי מורל BL-3), ספרייה (כללי + ערוץ תרבות), מחזור/מעבה/פטריות/מצבר/עמדת שער/מגורי שומרים (**נתונים בלבד** + שורות incidents ו-lint). יתר הסוגים: קוד קטן מוגדר ב-§3.

### 2.3 תפקידים (specializations) לכל סוג (2 לכל אחד; מחיר אחיד `SPEC_COST` 160 חומרים + 60 ידע; ברמה `specLevel`)

| סוג | תפקיד א | תפקיד ב |
|---|---|---|
| batteryBank | `deepCells`: caps.power ×1.4 | `safeCells`: risk ×0.5 (אש) |
| commons | `gameRoom`: morale +3 | `stage` (Act IV): culture +3 |
| library | `archivists`: outputMult ×1.3 | `readingCircle`: xpMult ×1.2 |
| recycler | `sorting`: outputMult ×1.25 | `smeltery`: extra materials 0.05 |
| condenser | `desiccant`: outputMult ×1.25, draw ×1.3 | `recovery`: draw ×0.8 |
| mushroomFarm | `shiitake`: outputMult ×1.2 | `medicinal`: extra medicine ×3 |
| quarantineWard | `isolationPods`: capacity +4 | `fieldHospital`: healMult ×1.5 |
| solarArray | `trackers`: outputMult ×1.25 | `cells`: ליל 20% |
| windTurbine | `tall`: outputMult ×1.2 | `gridTied`: factor min 0.7 |
| watchtower | `radar`: warning +60s | `sniperNest`: defense +6 |
| gatePost | `checkpoint`: recruitMult ×1.1 | `killZone`: defense +8 |
| garage | `convoy`: cargo +10% | `recon`: expeditionChance +0.05 |
| decon | `uvLock`: returnSafety +0.15 | `salvageWash`: expeditionLoot ×1.1 |
| aquaculture | `tilapia`: outputMult ×1.2 | `purifyingPonds`: extra water +0.3 |
| market | `auctionHall`: cargo +10% | `guild`: barter slots +1 |
| nursery | `playground`: comfort +2 | `kindergarten`: childGrowth ×1.15 |
| school | `academy`: graduate stat +2 | `apprenticeship`: mastery start rank 2 |
| bathhouse | `sauna`: comfort +2 | `laundry`: hygiene ×1.3 |
| memorialHall | `eternalFlame`: culture +3 | `archiveOfNames`: ידע +0.03 |
| barracks | `drillYard`: defense +6 | `bunks`: population +4 |
| bulkhead / stairwell / ventStack / districts / חדרי Act | ללא תפקידים | |

### 2.4 תקלות (incidents), בלאי, אסונות: משקלים חדשים (`incidents.ts:30-66`, `MaintenanceSystem.ts:16`, `IncidentSystem.ts:304-310`)

| סוג תקלה | הוספות |
|---|---|
| fire | batteryBank 2.5, recycler 1.5, commons 0.5, library 1.0, condenser 0.5, garage 1.0, geothermal 0.5, dataCenter 1.5, componentsPlant 1, alloyFoundry 2 |
| flood | condenser 1.5, mushroomFarm 1.0, aquaculture 2.0, bathhouse 1.5, decon 1 |
| blackout | (שורה חדשה) אין תקלה על סוללה/סולארי; **חדר נפרד**: `batteryBank` מקטין את קנס החושך (מחיר חשמל מצטבר) |
| roaches | mushroomFarm 3, bathhouse −(מניעה), market 1, nursery 0.5, library 0.5 |
| breach (קומה 0/−1 בלבד) | gatePost −0.5 (חוסם), garage 1, market 1, solarArray 1 (עילי), watchtower 0.5 |
| בלאי ×2 (`HOT_ROOMS`) | batteryBank, recycler, dataCenter, alloyFoundry, geothermal |
| אסון: קריסה | `disasterPool` ממשיך לא לכלול halls/districts/elevator/quarters; להוסיף `solarArray/windTurbine` ל"סופה" (חדש, עילי, ללא פצועים) |
| אסון: התפרצות קיטור (חדש) | `geothermal` רמה ≥ 3, בלאי ≥ 40 (כמו meltdown) |

### 2.5 סינרגיות בין חדרים (חיוני למגוון המשחק)

היום קיימים רק בונוס מורכב (+10% לשכן אותו סוג ורמה) והתפשטות אש. מתווספים **בונוסי שכנות** (נקראים מ-`touching()` של ST-2, מוצגים כצ'יפים בהצבה):

| זוג שכנים | אפקט | נימוק |
|---|---|---|
| `canteen` ↔ `commons` | +5% מורל שני החדרים (ערוץ הבסיס) | חיי חברה |
| `library` ↔ `laboratory` | ידע +8% בשניהם | מחקר ותיעוד |
| `bathhouse` ↔ `quarters` | היגיינה ×1.2 | נוחות |
| `nursery` ↔ `quarters` | `childGrowth` +0.05 | קרבה למשפחה |
| `school` ↔ `nursery` | קיבולת ילדים +2 | רצף חינוכי |
| `recycler` ↔ `workshop` | קלט חומרים −20% | אותו מחסן |
| `batteryBank` ↔ `generator`/`reactor` | אובדן חשמל −5% | קרוב למקור (אך אש מתפשטת, אלא אם דלת סגורה, ST-14) |
| `mushroomFarm` ↔ `waterPump` | תפוקה ×1.1 | לחות |
| `garage` ↔ `armory` | מטען שיירה +5% | ביטחון שיירה |
| `quarantineWard` ↔ `medbay` | healMult ×1.15 | אותו צוות |

כללי יישום: הבונוס מצטבר עד 3 שכנים; מקסימום +20%; אינו חל על חדרים בבנייה; מוצג בפאנל החדר בשורה "שכנים". קוד: `compoundNeighbors` מורחב ל-`synergyOf(state, b)`.

---

## 3. שינויים במכניקה (הקוד שחסר ל-JSON)

כל שינוי עם: קובץ, שורות מוצא, מה, בדיקה. ‏`BuildingDef` (`buildingDefs.ts:10-31`) מקבל שדות אופציונליים (תאימות לאחור מלאה).

### BL-1 הרחבת `BuildingDef` וסכמת JSON
```ts
// buildingDefs.ts (תוספות, כולן אופציונליות)
slots?: 1|2|3|4|5;          // מבטל את הגזירה מ-size (roomSlots)
maxCopies?: number;
place?: {
  floors?: 'surface' | 'entrance' | 'deep' | 'zone';   // surface=−1, entrance=0, deep=f>=3
  adjacentTo?: BuildingType;                           // נוגע באותה קומה
  needsFlag?: string;                                   // דגל story
  minFloor?: number;
};
shape?: 'daylight' | 'wind';                            // צורת ייצור
effects?: { ...קיים, moraleKind?: 'base'|'comfort'|'culture',
  childCapacity?: Entry, childGrowth?: Entry, quarantine?: Entry,
  earlyWarning?: Entry /*שניות*/, expeditionTeams?: ..., cargo?: Entry,
  returnSafety?: Entry, hygiene?: Entry, mourning?: Entry,
  evacuation?: boolean, ventilation?: Entry, firebreak?: boolean };
```
- `roomSlots()` (`:91`): `def.slots ?? (נגזר כרגיל)`; `BuildMenu` מציג רוחב.
- `allowedFloors(type, total)` (`zones.ts:63`): תמיכה ב-`place.floors` (surface=[−1], entrance=[0], deep=f≥3) ו-`minFloor`.
- `placeBlock` (ST-2): בודק `adjacentTo`, `needsFlag`, `maxCopies`.
- **lint חדש** (QA-3): לכל def: שם/תיאור `he`+`en` לא ריקים, `slots` ≤ רוחב אגף מינימלי, `baseCost` על משאבים קיימים, `unlock` צומת יחיד.
**קבצים:** `buildingDefs.ts`, `zones.ts`, `BuildingSystem.ts`, `buildings.json`. **מאמץ:** M.

### BL-2 פתיחת מבנים: דגלים ו-eureka
- `isBuildingUnlocked` (`ResearchSystem.ts:74`) מוסיף: `if (def.place?.needsFlag) return state.storyFlags.includes(...)`.
- צומת מחקר "eureka" (קיים מנגנון `eureka triggers`, ראו `ResearchSystem`): `childcare` נפתח כשנולד ילד ראשון; `mycology` כשנחפרה קומה 3; `aquaculture` כשנבנה `lake`.
- כל צומת חדש: `act` כשצריך (Act II-VII), מחיר בידע+גרוטאות/חומרים (בלבד: כדי לעמוד ב-lint L2), ובודק DAG (`tools/sim/lint.ts`).
**מאמץ:** S.

### BL-3 ערוצי מורל (D5)
**היום:** `getCanteenBonus` (`PopulationSystem.ts:294-303`) מסכם `effects.morale` של כל החדרים כפול `workforce × powerRatio × researchBuildingMult × min(1,chain)` וחותך ב-22 (`MAX_CANTEEN_BONUS`, `:33`).
**חדש:** שלושה ערוצים: `base` (22, כמו היום, ברירת מחדל כשאין `moraleKind`: canteen, lake, atrium), `comfort` (תקרה 6: commons, nursery, bathhouse, barracks-ללא), `culture` (תקרה 6: library, memorialHall). סך מקסימום 34. מתווסף שדה `moraleBreakdown` למסך האנשים (טבלה קטנה "מקורות מורל").
**חשוב:** קבוע `MAX_CANTEEN_BONUS` נשאר למאפיין הבסיס; ערוצים חדשים נכנסים לאותו לולאת סיכום, ללא שינוי בנוסחת הקצב (1% מהפער לשנייה). ב-`MenuPanel`/`PeoplePanel` מוצג פירוט.
**בדיקה:** סימולציה: ממוצע מורל Act I-III לא עולה > +4 נקודות מול היום (כי החדרים החדשים נפתחים מאוחר); ללא שינוי בפתיחת 30 דקות.
**מאמץ:** S. **תלוי:** BL-1.

### BL-4 ילדים: הקצאה לגן/בית ספר וסינון כוח עבודה
**היום:** `assignSurvivorToBuilding` מחזיר false לילד (`PopulationSystem.ts:~320`); `workforceMultiplier` (`buildingDefs.ts:124-150`) סופר `assignedSurvivorIds` ללא סינון ילדים; `FamilySystem.growthOf` (`:71-75`) תלוי ב-`specMax('childGrowth','quarters')`.
**חדש:**
1. `assignSurvivorToBuilding(child)` מותר רק ל-`nursery`/`school` (`def.effects.childCapacity`); קיבולת ילדים נפרדת מ-`maxWorkers`.
2. **סינון:** `workforceMultiplier` מסנן `!s.child` (גם היום תקין כי אין ילדים ב-assigned, אך נדרש עתידית); `PeoplePanel` מציג ילדים בקטגוריה "בגן/בבית ספר".
3. `FamilySystem.childGrowth(state)` = `max(specMax(..quarters..), nurseryMax)`, כשילד בגן מקבל ×1.25 וב-school הצטברות `schoolTime`.
4. **סיום ילדות:** כשהילד הופך בוגר (`FamilySystem:79-84`) ואם `schoolTime ≥ 60%` מהילדות: `+1` לסטט אקראי (עד 10), (`+2` ב-`academy`), וה-`xp` ההתחלתי +1 רמה.
5. נתונים חדשים בשמירה: `survivor.schoolTime?` (אופציונלי; ברירת מחדל 0 ב-`migrateState`).
**בדיקה:** סימולציה עם `FamilySystem` פעיל: נולדים ילדים; בוט מציב בגן; אף ילד לא ב-`maxWorkers`; `gates.mjs` דטרמיניזם.
**מאמץ:** M. **תלוי:** BL-1.

### BL-5 מחירי חדרים לפי Act (D13, F12 מתוכנית 1)
`getBuildCost` (`BuildingSystem.ts:67-80`) = `ceil(base · costMult^count)` בלי Act. חדש: `· actMult(actOf(state))`, `actMult = [1, 1, 1.5, 2.2, 3, 4, 5]` (Acts I..VII). שלב 1: **רק** סוגים עם `def.priceByAct === true` (החדשים). שלב 2 (אחרי אישור סימולציה): לכל הסוגים תוך כיול `baseCost` של הישנים כך ש-Act I/II לא משתנים. ‏UI: `BuildMenu` מציג מחיר עם אייקון Act.
**מאמץ:** S.

### BL-8 תשתית קטנה
- `isPowerPlant(type)` (ב-`buildingDefs.ts`) = `def.production?.power` נוכחי; החלפת רשימות שמות ב: `HUD.ts:445`, `ui/controllers/feedback.ts:49`, `MaintenanceSystem.ts:16`, `incidents.ts` (blackout).
- `windAt(t)` ב-`data/dayCycle.ts`: `0.5 + 0.5·sin(t/1800 + 2·sin(t/7300))`; `surface2.ts` (`wind` שורה 39) משתמש באותה פונקציה (התאמה ויזואלית ללוגיקה).
- `shape` ב-`ResourceSystem.ts:281-303`: `factor = shape==='daylight' ? max(0, 1 − timeOfDay(t).night) : shape==='wind' ? 0.4 + 0.9·windAt(t) : 1`, מוכפל בייצור. בסימולציית אוף-ליין (`GameEngine.simulate`) חייב להשתמש ב-`totalPlayTime` שמתקדם בפרוסות (אימות `gates.mjs` הזהות ±3%).
- `Guide.ts`, ערכי `acts.ts` ללא שינוי.
**מאמץ:** S.

### תוספות אפקט קטנות לפי סוג (קוד + בדיקה)

| BL | אפקט | איפה | מה בדיוק |
|---|---|---|---|
| 15 | `quarantine` | `EventSystem.ts:257` (sick), `IncidentSystem.ts:310` (epidemic) | חולים מוקצים ל-ward מקבלים healMult ×2 ו-`contagion=0`; מגפה פעילה סוגרת דלתות (ST-14) |
| 18 | `earlyWarning` | `EventSystem` (`raidWarning` מחושב) | `warningLead += Σ level·30s` (תקרה 300s) ו-UI מציג "התראה מוקדמת +Xs" |
| 20 | `expeditionTeams` | `ExplorationSystem` (צוותים בו-זמנית: 2 + `scoutTeams` + זה) | L3:+1, L8:+2; `cargo` מושפע גם משוק |
| 21 | `returnSafety` | `AwayDanger.ts`, `ExplorationSystem` החזרה | הסתברות פציעה/מחלה × (1−min(0.5, 0.04·L)) |
| 23 | `cargo` + לוח טרוק | `trade.ts`, חדש `TradeBoard` (UI) | הצעות: `give X get Y` (יחס 1:1.2 ל-3 יחסי משאב), מתחלפות כל 8ש' משחק |
| 31 | `hygiene` | `incidents.ts` (roaches), `EventSystem` (epidemic prob) | הכפלה לפי רמה (BL-31 לעיל) |
| 32 | `mourning` | `DeathSystem` / `PopulationSystem` (עונש אבל) | קיצור אבל |
| 33 | `maxPopulation` | כללי | כבר נתמך בבתי `quarters` |

---

## 4. אמנות, אנימציה ואפקטים: איך מגיעים לתמונה אחת אחידה (D6)

### 4.1 שלוש דרגות
| דרגה | מה | מי | רמת איכות | מתי |
|---|---|---|---|---|
| **A** שימוש חוזר | ציור קיים (45 ציורים) + החלפת גוון (`tint`/`ColorMatrix`), הוספת אביזרי `wprop`/`decal` (קוד), שינוי זווית אור | סוכן Room-Art | טוב; קל לזיהוי כ"אח" | מיד, לסוגים דומים (למשל bathhouse מבוסס `medbay`/`waterPurifier`) |
| **B** מרכיב חדרים (`RoomComposer`) | בנייה בקוד של פנים חדר מרכיבי ה-kit + פרימיטיבים בסגנון DECORATORS, **אפייה** (bake) ל-`RenderTexture` פעם אחת בגודל הנכון (2/3 משבצות) ואז מתייחסים אליה כציור: אורות, חיסכון, אנשים | סוכן Room-Art | בינוני-טוב אם שומרים על שער סגנון | לכל 30 הסוגים בשלב 3-4 |
| **C** ציור | 3 ציורים לסוג (720×522 / 480×522, `rooms/<type>-0..2.webp`); הוספה ל-`PAINTED_TYPES` רק כשהקבצים קיימים | המשתמש (Canva) לפי בריף (§4.5) | הכי טוב | בהמשך, לפי חשיבות |

### 4.2 `RoomComposer` (BL-6), מפרט
- קובץ חדש `src/rendering/roomComposer.ts`, ממשק: `composeRoom(type, tier, slotsW, rnd) → {texture, lights, fx, spots, seats}`; מזכיר את `roomArt.buildRoomVisual` (קיים: `PALETTES` + `DECORATORS`, `roomArt.ts:15,119`) אבל מוסיף: עומק (קיר אחורי עם `DEPTH_X/TOP/BOTTOM`, רצפה בנקודת ההיעלמות), 6-14 אביזרי קדמה לפי סוג (שולחנות, מדפים, מכונות, גלגלי שסתומים), תאורה (נורות חמות או פלורסנט), קווי צל, כתמי חלודה, ואז:
  1. **אפיית סגנון**: Gaussian ~0.6px + גרגר 4% + ויניטה + תיקון צבע מהבסיס של `balance.json` (כמו `tools/bake-kit-soft.py` אבל בזמן ריצה חד-פעמי).
  2. **הוצאת אורות**: מחזיר `lights` בקואורדינטות מנורמלות כדי שה-`ROOM_LIGHTS` יצבע אנשים/חלקיקים (כמו ציור).
  3. **מקומות עבודה/ישיבה**: `spots` (שברים) ל-`workSpots.ts`, `seats` ל-`roomSet.ts`.
  4. **שלוש רמות**: tier 0 = בסיסי, tier 1 = מצויד, tier 2 = מפואר/מודרני, בהפרש פריטים וצבע בלבד (אותה גיאומטריה).
- מטמון ב-`ArtLibrary` תחת `composed/<type>-<tier>-<w>` ונפרק בהתאם ל-`sweepArt`; זיכרון: ≤ 0.6MB לטקסטורה (720×522 RGBA8 ≈ 1.5MB, מניחים 0.5× רזולוציה בקוד) ⇒ 30 סוגים × 3 רמות × ~1MB = 90MB **מפוזר ונטען לפי הצורך** (מרבית 6 במקביל ⇒ ≤ 8MB לתכונה).
- בכללי חוזה ביצועים: אפייה = חד-פעמי, ≤ 12ms בפריים (פרוסות, `buildsLeft` קיים).

### 4.3 מיפוי פנים לכל חדר חדש (למסלול A ו-B)

| id | בסיס A (ציור קיים) | תיאור B (פריטים מרכזיים) | `ROOM_ACTIVITY` | `JOB_OUTFIT` | `AMBIENCE_FOR` |
|---|---|---|---|---|---|
| batteryBank | `generator-1` קר | שורות תאי סוללות על מדפים, מד עומס, כבלי עב | `tend` (קיים אם יש; אחרת idle) | engineer | machine |
| commons | `canteen-0` חם | ספות, שולחן קלפים, רדיו, מחצלת | `idle`+seat | casual | kitchen (נמוך) |
| library | `laboratory-0` חם | מדפי ספרים, שולחן קריאה, מנורת שולחן | `read` / idle | scholar | air |
| recycler | `workshop-1` כהה | מסוע, מגרסה, ערימות פחים, מגנט | `repair` | worker | workshop |
| condenser | `waterPurifier-1` | סלילי קירור, מאווררים גדולים, טפטוף | `tend` | engineer | water |
| mushroomFarm | `hydroponics-0` כהה | מדפי פטריות זוהרות, אוויר לח | `tend` | farmer | air |
| quarantineWard | `medbay-1` צבע אדום | מיטות מבודדות, זכוכית, חדרי שמירה | `treat` | medic | medical |
| solarArray | ציור חדש קוד (חוץ) | פאנלים על מסגרת, שמיים (ללא ציור חדר) | — (אוטומטי) | — | air |
| windTurbine | קוד (חוץ) | תורן ופרופלר מסתובב | — | — | air |
| watchtower | קוד (חוץ) | מגדל, זרקור, צופה | `watch` / idle | guard | air |
| gatePost | `armory-0` | דלת הדף, שלט, מדחס | `guard` | guard | base |
| garage | `workshop-0` רחב | רכב, ארגז כלים, מנוף, חביות | `repair` | worker | workshop |
| decon | `waterPurifier-0` | תא רחצה כימי, מקלחות, ירוק | `idle` | medic | water |
| aquaculture | `lake` | בריכות, רשתות, צינורות, מנורות כחולות | `tend` | farmer | water |
| market | `canteen-1` רחב | דוכנים, מאזניים, שלט מחירים | `trade` / idle | casual | kitchen |
| nursery | `quarters-0` רך | צעצועים, מיטות קטנות, מחצלת | `play` / idle | casual | base |
| school | `laboratory-0` | לוח, שולחנות, מפה | `teach` / idle | scholar | base |
| bathhouse | `waterPurifier-0` | מקלחות, ספסלים, אדים | `idle` | casual | water |
| memorialHall | `quarters-2` | קיר שמות, נרות, פסל | `idle` | casual | air (שקט) |
| barracks | `quarters-1` | דרגשים, מתקן נשק, שלט משמרת | `idle`/`guard` | guard | base |
| geothermal (מחוז) | `cave` | סדקי אש, צינורות קיטור | `tend` | engineer | reactor |
| oldVault (מחוז) | `metro` | דלת כספת עצומה, מדפים | `search` | scholar | air |
| bulkhead / stairwell / ventStack | קוד חזית (ST-13..15) | | | | |
| חדרי Act | `workshop/laboratory/canteen/reactor` ב-tint | | | | |

### 4.4 אנימציה, צליל, אפקט (כל סוג)
- **אנימציה חדרית (ROOM_FX):** מסלול שלישי של `ROOM_FX` (`registry.ts:130`): מאוורר מסתובב (condenser), מסוע (recycler), נוריות סוללה (batteryBank), רוח על הדגלים (windTurbine), שמש עוקבת (solarArray), אדים (bathhouse), נרות (memorialHall). כל אפקט ≤ 1 `Sprite` אנימציה מ-atlas קיים (`flipbook` M10 של תוכנית 2 אם נבנה).
- **צליל (`sfx.ts`):** `door.clunk`, `bulkhead.seal`, `lift.ding` (קיים?), `battery.hum`, `fan.loop`, `bell.school`, `wind.loop` (כבר `ambience.ts`); כל צליל חדש נוסף ל-`uiSound`/`sfx` בסינתזה מדורגת (staged) כדי לא להאריך הפעלה (תוכנית 3).
- **שמיעה לנגישות:** כל צליל אזהרה (`warn`/`pulse`) מקבל תאום חזותי (AC-9).
- **אייקונים:** 30 אייקוני SVG 24×24 ב-`ui/icons.ts` + `ui/dom.ts BUILDING_ICONS`; ללא צבע בלעדי (AC-7); צורת קו עקבית עם הסט הקיים.
- **שמות:** בתוך `buildings.json` (`name.he/en`, `description.he/en`); שורות הזיכרון `memorial.line.<type>` ב-i18n.
- **Bunker Book:** 6 ערכים חדשים (`data/book.ts`): "אגפים ואיך חופרים", "דלתות מחיצה", "שורת בית השער", "ילדים וחינוך", "מורל: שלושה ערוצים", "שכנות". `HELP_TOPICS` מצביע על ערכים אמיתיים (lint).

### 4.5 בריף Canva לדרגה C (לשמירה בצד; מועבר למשתמש)
תבנית לכל חדר: *"חתך אופקי של חדר מחסה גרעיני אחרי אסון, סגנון ציור דיגיטלי, תאורת טונגסטן חמה, פינה כהה, פרטי חלודה, ללא אנשים, פרספקטיבה של חתך (קיר אחורי בעומק, רצפה בתחתית), **{תוכן החדר}**, גודל 720×522 (3 משבצות) או 480×522 (2 משבצות), רמה {0/1/2}: {בסיסי/מצויד/מפואר}"* + שלושה ציורי ייחוס מ-`public/art/rooms/` להדבקה בכל בקשה. ייצוא `.webp`, ואז `tools/sheets.ts` + `tools/art.html` כבר מייצרים `meta.json`/`balance.json`.

---

## 5. תפריט הבנייה ומסך החדר (BL-39 UX של 47 סוגים)

**בעיה:** `BuildMenu.ts` (97 שורות) מציג רשימה שטוחה של 17 סוגים; ב-47 זה בלתי שמיש בנייד.
**חדש:**
1. **קטגוריות** (צ'יפים גלילה אופקית): `מגורים וחברה`, `מזון ומים`, `חשמל`, `תעשייה`, `בריאות`, `הגנה`, `עילי`, `תשתית`, `משלחות/סחר`, `Act` (רק פתוחות).
2. **חיפוש** (שדה 16px, ללא זום-אין) וסינון "ניתן לבנייה עכשיו".
3. **כרטיס חדר** (גובה 88px): אייקון, שם, תפוקה עיקרית (שורת צ'יפים), מחיר צ'יפים (ירוק/אדום+אייקון, לא רק צבע), רוחב במשבצות (נקודות), תג "נעול": מראה מה פותח אותו (מחקר/דגל/Act) ובלחיצה פותח את המחקר.
4. **מומלץ:** שורת "מומלץ עכשיו" מתוך `Guide.ts` (המגבלה הנוכחית: חשמל נמוך ⇒ מצבר/גנרטור; ילדים ⇒ גן).
5. **פאנל החדר** (`BuildingPanel.ts` 493 שורות): שורות חדשות לסינרגיות שכנות, ערוץ מורל, קיבולת ילדים, מצב דלת, וכפתור "העבר".
**קבצים:** `BuildMenu.ts`, `BuildingPanel.ts`, CSS ב-`bunker-os.css`. **מאמץ:** M. **תלוי:** BL-1.

---

## 6. רשימת חיבור לכל מבנה חדש (העתק מהמחקר; סדר מחייב)

לכל `X` (פרטי הקבצים מוצגים בדוח הקטלוג; כל שורה = משימה קטנה בבריף של הסוכן):
1. `GameState.ts:36` הוספה ל-`BuildingType` · 2. `buildings.json` הגדרה (+ `slots`, `place`, `shape`, `effects`) · 3. `roomArt.ts:15 PALETTES[X]` (שגיאת tsc אחרת) · 4. `buildingDefs.ts:38 BUILDABLE_TYPES` (או `DISTRICT_KINDS`) · 5. צומת מחקר יחיד עם `unlock` · 6. `zones.ts:45 BUILDING_ZONE` או `place` · 7. `chains.ts:17` אם יש קלט · 8. `incidents.ts` משקלים, `MaintenanceSystem HOT_ROOMS`, `IncidentSystem` disasterPool · 9. `specializations.ts` (2 תפקידים) · 10. `ui/icons.ts` + `ui/dom.ts:34 BUILDING_ICONS` · 11. i18n: `memorial.line.X` ב-he ו-en (ה-lint משווה) · 12. אמנות: A/B/C, `registry.ts`, `workSpots.ts`, `people.ts:36,61`, `cityMap.ts:13 CATEGORY`, `signage.ts:37`, `decals.ts:154`, `ambience.ts:8`, `roomSet.ts` אם יש מיטות/מושבים · 13. **בוט** (`tools/sim/core.ts:611 want`, `:616` מגבלת עותקים) · 14. `npm run check`, ריצת סימולציה 3 זרעים, מיגרציה.

**מלכודות מהמחקר (לשמור):** (א) רק הצומת הראשון עם `unlock` נספר; (ב) הסרה/שינוי שם `BuildingType` מסוכן לשמירות; (ג) `ResourceSystem.ts:276` ייצור חשמל לא מתערבב עם תוצרים אחרים (כל מפיק חשמל חייב להיות "חשמל בלבד"); (ד) חדר ללא `PALETTES` נכשל ב-`tsc`; (ה) HUD כותב כוח לפי רשימת שמות (תקן ב-BL-8); (ו) `storageCap` לוקח רמה ולא ברירת מחדל גבוהה: חשבו את תקרת Act בהתאם.

---

## 7. איזון ואימות (חוזה)

| מדד | כלי | יעד |
|---|---|---|
| הבוט בונה כל סוג חדש לפחות פעם (3 זרעים × 60 ימים) | `run.mjs --mode engaged --days 60 --seeds 1-3` + דוח "types built" חדש | ≥ 90% מהסוגים; כל סוג עד יומו ה-Act שלו |
| יום Genesis | כנ"ל + `--days 100 --mode casual` | 55-65 / 80-95 |
| סכום תוספת מזון Acts I-III | דוח ייצור/ביקוש | ≤ +10% מעודף חציוני |
| משבצות עבודה מול אוכלוסייה | דוח חדש `jobs` ב-`tools/sim/report-core.mjs` | ≥ 70% מהאוכלוסייה |
| כספת: תכניות ליום | דוח | ≤ 14 (כולל חנות) |
| מורל ממוצע Acts I-III | דוח | ±4 מההיום |
| אוף-ליין | `gates.mjs` | זהות ±3% (כולל solar/wind) |
| lint | `node tools/sim/lint.mjs` | ירוק, כולל lint BL-1 |
| ביצועים של רנדר החדרים | `f24w-close-medium` עם 30 סוגים בכל קומה | בתקציב |

## 8. סדר ביצוע (גלים)

| גל | פריטים | מי | תלוי |
|---|---|---|---|
| **1 (שלב 3)** | BL-1, BL-2, BL-3, BL-4, BL-5, BL-6, BL-7, BL-8; סוגים נתונים-בלבד: BL-9, BL-10, BL-11, BL-12, BL-13, BL-14, BL-19, BL-33; BL-39 תפריט בנייה | Rooms-Data, Rooms-Systems, Room-Art | X-3, ST-2 |
| **2 (שלב 4)** | BL-15, BL-16, BL-17, BL-18, BL-20, BL-21, BL-22, BL-23, BL-26, BL-27, BL-28, BL-29, BL-30, BL-31, BL-32 | כנ"ל | גל 1, ST-14..16 |
| **3 (שלב 5)** | BL-24, BL-25 (מחוזות), BL-34..BL-38 (חדרי Act), סינרגיות §2.5, כוונון איזון | כנ"ל + QA | גל 2 |
