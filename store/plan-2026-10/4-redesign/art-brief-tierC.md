# בריף דרגה C: ציורי חדרים (Canva) ל-20 החדרים החדשים

מסמך מצורף ל-`02-new-buildings.md` §4.5. נכתב על ידי סוכן Room-Art (גל 2). **הציורים אינם חוסמים כלום:** לכל חדר ברשימה כבר יש מראה מלא בקוד (דרגה A/B, `RoomComposer`, שלוש רמות) שמוצג תחת אותו מפתח `rooms/<type>-<tier>` כמו ציור. ציור שנוסף מחליף אותו; ציור שחסר או שנכשל בטעינה נופל חזרה אליו.

## 1. מה צריך לצייר (תקציר)

* **20 סוגי חדר × 3 רמות = 60 ציורים.** סדר עדיפות להלן (§5): קודם החדרים שרואים הכי הרבה, בלי מורל/כוח (זולים לזיהוי), אחר כך שאר הסוגים. אפשר להתחיל מרמה 1 בלבד לכל סוג; רמות 0 ו-2 נופלות חזרה על הבייק עד שיש ציור.
* **גודל ופורמט:** חדר ברוחב **3 משבצות 720×522**, ברוחב **2 משבצות 480×522**, ברוחב **משבצת אחת 240×522** (מגדל תצפית, טורבינת רוח). ייצוא `.webp` (איכות ~82) לשם `public/art/rooms/<type>-<tier>.webp`. רמות: `0` הרוס/ממוחזר, `1` משוקם, `2` מתקדם.
* **תבנית הבקשה (מ-§4.5, ללא שינוי):** *"חתך אופקי של חדר מחסה גרעיני אחרי אסון, סגנון ציור דיגיטלי, תאורת טונגסטן חמה, פינה כהה, פרטי חלודה, ללא אנשים, פרספקטיבה של חתך (קיר אחורי בעומק, רצפה בתחתית), **{תוכן החדר}**, גודל {720×522 | 480×522 | 240×522}, רמה {0/1/2}: {בסיסי/מצויד/מפואר}"* + **שלושה ציורי ייחוס מ-`public/art/rooms/` בכל בקשה** (ראו עוגני סגנון, §3).

## 2. איך מחברים ציור (3 שורות לכל סוג)

1. הקבצים `rooms/<type>-0..2.webp` לתיקיית `public/art/rooms/`, ואז `tools/art.html` (כמו בכל ציור: חיתוך, איזון חשיפה, `meta.json`/`balance.json`).
2. להוסיף את הסוג ל-`PAINTED_TYPES` ב-`src/art/registry.ts` **רק כשכל שלושת הקבצים קיימים**. מאותו רגע הציור מחליף את הבייק של אותו סוג (הבייק נשאר רשת ביטחון: קובץ שנכשל בטעינה מוחלף בו).
3. מנורות ואפקטים: ל-`ROOM_LIGHTS['<type>-<tier>']` ו-`ROOM_FX[...]` (בראש `registry.ts`) נותנים קואורדינטות על הציור. עד שמוסיפים, **הקואורדינטות של הבייק נשארות** (הטבלה בסעיף 4 מראה אותן): לכן עדיף לצייר את המנורות והמסכים בערך במקומות האלה, ואז אין מה לכוונן. כנ"ל מקומות עבודה (`workSpots.ts` `ROOMS`) ומיטות/מושבים (`roomSet.ts`): הבייק רושם אותם לפי אותם מפתחות; ציור חדש עם פריסה שונה דורש כניסה ידנית (כלי הסקירה `/tools/roomset.html`).

## 3. עוגני סגנון (חובה)

* **שלושה ציורי ייחוס להדבקה בכל בקשה:** `generator-1.webp` (אור חם מלמעלה, צנרת בתקרה, רצפה עם השתקפות), `workshop-1.webp` (קיר עמוס, ציוד קטן וקריא), `canteen-0.webp` (פינות חמות, חומרים אורגניים). לחדרי מים/רפואה להוסיף `waterPurifier-1` או `medbay-1`; לירוק `hydroponics-0`.
* **שער הסגנון (6 שאלות, `GFX-AGENTS.md`):** (1) בלי קווי מתאר. (2) רוויה מתחת ל-0.6, חוץ ממסכים, התראות ואש. (3) האור הראשי חם ומלמעלה (טונגסטן ~2700K). (4) הקרקע ב-0.84 מגובה הציור (קו הרצפה האחורי; אנשים עומדים בין 0.87 ל-0.97). (5) מבריחים דרך אותו גימור (`bake-tier2.py`, גרגר, איזון). (6) נבדק בשלוש רמות ובשתי רמות בהירות.
* **בלי טקסט בציור.** חדרים משוקפים לכל שכן שני (`mirror`), והמשחק דו-לשוני: שלטים הם **סמלים** (פיקטוגרמות) ולא מילים. ספרות סימטריות בלבד אם חייבים.
* **גודל אדם:** מבוגר ≈ 50 יחידות מתוך 100 גובה חדר (מחצית מגובה הציור). שולחנות 15-25, ארונות 44-63, דרגשים 42 (כמו הציורים הקיימים).
* **בהירות ממוצעת (luma) מומלצת:** רמה 0 ≈ 0.16-0.20, רמה 1 ≈ 0.26-0.30, רמה 2 ≈ 0.33-0.40 (כמו הציורים הקיימים; ה-`balance.json` מתקן את השאר).
* **איפה האנשים:** השאירו רצפה פנויה בחלק התחתון (קו 0.87-0.97 לאורך כמעט כל הרוחב); ריהוט שאנשים משתמשים בו (דרגש, ספה, ספסל, שולחן) באותם מקומות כמו הבייק (טבלה §4).
* **מה לא לצייר:** אנשים, אור חזק ורווי בצבע, חלונות לשמיים (חוץ מ-3 חדרי העילי), לוגואים.

## 4. רמות: מה משתנה (אותה פריסה, אחרת בלאי/ציוד/צבע)

| רמה | מראה | בלאי | תאורה | ציוד |
|---|---|---|---|---|
| 0 | הרוס/ממוחזר | כתמים, חלודה, סדקים, סרטי הדבקה, קירות דהויים | נורה חשופה על כבל | פריטים לא תואמים, ארגזים/חביות במקום ציוד |
| 1 | משוקם | מעט כתמים, צבע טרי | צינור פלורסנט | ציוד תואם, שילוט נקי |
| 2 | מתקדם | כמעט נקי, פאנלים בהירים | רצועת LED, מסכים | מודולרי, מדי מד/מסכים, צבע קר יותר |

## 5. החדרים (לפי סדר עדיפות) והתוכן שיש לצייר

כל סעיף: **גודל** (משבצות · פיקסלים), **תוכן לבקשה** (באנגלית, להדבקה בתבנית של §1 במקום `{תוכן החדר}`), **שינוי לפי רמה**, **אנשים** (איפה עובדים/ישנים/יושבים; מה שהבייק כבר רושם). הפריסה (מי עומד איפה) זהה בבייק ובציור כדי שהאנשים והאורות יתיישרו.

### 5.1 גל 1: שמונת החדרים שכבר במשחק (עדיפות עליונה)

**מצבר ענק `batteryBank` (2 · 480×522).**
*Content:* "two tall steel racks of heavy lead-acid battery cells on shelves with copper busbars, a grey charge-controller cabinet with a round load gauge, a small green bar-graph display and three status lamps (green, amber, red), thick cable bundles sagging between racks, a hazard-striped cable duct along the floor, a yellow enamel lightning-bolt warning plate on the wall".
*Tiers:* 0 mismatched car batteries, one cell pulled, a leak stain, a crate; 1 matching blue bank with labelled ends, fluorescent tube; 2 three sealed modular cabinets with cyan bar-graph meters, LED strip light. *People:* two work spots at the racks (`tend`), no seating.

**אולם מועדון `commons` (2 · 480×522).**
*Content:* "a worn sofa against the back wall, a low coffee table with playing cards and a mug on a round rug, a cork pinboard with notices and a photo, a small tube radio on a shelf with a glowing amber dial, a potted sprout in a can, string lights"; plate: a cup pictogram.
*Tiers:* 0 faded green sofa, torn plaster; 1 brown sofa, string lights; 2 teal leather sofa, a framed print, LED strip. *People:* two sofa seats (`sit`, facing each other), one idle spot.

**ספרייה `library` (2 · 480×522).**
*Content:* "two floor-to-ceiling bookcases full of muted book spines, a rolling ladder between them, a reading table with a green-shaded desk lamp and an open book, a chair on each side, books piled on the floor, a small globe"; plate: an open-book pictogram.
*Tiers:* 0 toppled stacks, water stains; 1 tidy, brass lamp; 2 steel shelving, a lit reading screen. *People:* two chairs (`sit`), two reading spots (`inspect`).

**מרכז מחזור `recycler` (3 · 720×522).**
*Content:* "a scrap hopper with a heap of cans and metal on the left, a conveyor belt carrying cans toward a toothed shredder with a hazard band, a gauge and two status lamps in the middle, three colour-sorted bins and compacted bales on the right, a ceiling gantry rail with a magnet crane"; plate: a recycling-arrows pictogram.
*Tiers:* 0 rusty, yellow hopper, crates; 1 green hopper, neat bins; 2 blue powder-coated machinery, clean floor. *People:* three work spots (`hammer`: hopper, belt, bins). *Live:* the belt scrolls only while someone works there (`work` effect); keep the belt strip a plain dark band so the moving ribs read.

**מעבה אדים `condenser` (2 · 480×522).**
*Content:* "a tall finned condenser coil unit with two large fans on top, condensate trays dripping into a steel collecting tank with a lit water level and a tap, a vertical pipe with a red valve wheel, a round gauge, a drop-shaped teal plate".
*Tiers:* 0 rusty coil, mismatched fans, a bucket; 1 clean coil; 2 stainless unit with a small status screen. *People:* none (automatic); one visit spot at the tank.

**חוות פטריות `mushroomFarm` (2 · 480×522).**
*Content:* "two steel racks of dark soil trays full of pale glowing mushrooms under violet grow-light tubes, a humidifier with a plume of mist, a water barrel; damp, almost dark, purple light"; plate: a mushroom pictogram.
*Tiers:* 0 sparse, mould patches; 1 dense; 2 automated trays with a screen. Saturation exception: the violet grow light. *People:* two tending spots.

**עמדת שער `gatePost` (2 · 480×522).**
*Content:* "a heavy blast door with a red hatch wheel and a hazard-striped frame on the left, a guard desk with two green camera screens and a notice on the right, a floodlight and a beacon, sandbags and a striped barrier arm up front"; plate: a shield pictogram.
*Tiers:* 0 scratched tally marks, rust; 1 repainted; 2 hazard frame lit, steel desk. *People:* a guard stands by the door (`idle`), one at the desk (`type`), a chair.

**מגורי שומרים `barracks` (3 · 720×522).**
*Content:* "two steel bunk beds with olive blankets, two grey lockers, a wall-mounted weapon rack, a duty roster with a red lamp, boots under the bunks"; plate: stacked-chevrons pictogram.
*Tiers:* 0 rough blankets, tally marks; 1 neat; 2 slate-blue blankets, lockers in steel-blue. *People:* **four beds** (lower and upper of each bunk, head to the left), two bunk-edge seats; three idle spots.

### 5.2 גל 2: שנים עשר חדרים שיגיעו עם Rooms-Data (לצייר אחרי גל 1)

**מחלקת בידוד `quarantineWard` (2 · 480×522).** "two glass-walled isolation pods side by side, each with a white hospital bed and an IV stand, a cardiac monitor between them, a red biohazard plate with a flashing beacon, a sealed hazard-striped hatch on the right, a yellow quarantine line on the floor". Tiers: 0 taped plastic sheeting instead of glass; 1 glass; 2 white modular pods. *People:* two beds, tending spots in front of the glass.

**שדה פאנלים `solarArray` (2 · 480×522, חוץ).** "a low sun over a broken skyline, rows of tilted solar panels on steel frames with cell grids and glints, an inverter box with a small amber screen, cables to the ground; open air, no back wall". Tiers: 0 cracked, one patched panel; 1 clean; 2 two rows, bright grid. (Surface-Annex draws the ground-level look; this is only the room-path picture.)

**טורבינת רוח `windTurbine` (1 · 240×522, חוץ).** "a tall tapering white mast with a nacelle and a red aviation light, a small base shed; **paint the rotor hub only, without blades**: the three blades are a live effect". Tiers: 0 rusty mast; 1 white; 2 taller, cleaner.

**מגדל תצפית `watchtower` (1 · 240×522, חוץ).** "a braced steel lookout tower with a ladder, a cabin with a lit window, a roof searchlight, sandbags at the base". Tiers: 0 rust; 1 grey; 2 blue-grey, antenna.

**מוסך שיירות `garage` (3 · 720×522).** "an old olive truck seen from the side with a tarped bed, cab window and headlight, a ceiling hoist with chain and hook, a workbench with a vise and a red toolbox, a pegboard of tools, stacked tyres, a drum"; plate: a truck pictogram. Tiers: 0 rust patches, flat colour; 1 repainted with a stripe; 2 armoured, roof lights. *People:* work spots at the truck rear and cab (`wrench`) and the bench (`hammer`); the welding spot is a live effect.

**תא טיהור `decon` (2 · 480×522).** "an airlock blast door on the left, a glass shower stall with a grated floor and two shower heads in the middle, two hanging yellow hazmat suits, a green neon strip, chemical drums, a biohazard plate". Tiers: 0 improvised sheeting and drums; 1 proper stall; 2 UV-light tunnel. *People:* `idle` spots by the stall.

**בריכות דגים `aquaculture` (3 · 720×522).** "three glass fish tanks along the back wall with fish, weed and gravel under blue-white grow lights, a pipe run with red valve wheels, a bucket and a net"; plate: a fish pictogram. Tiers: 0 open tubs; 1 glass tanks; 2 modular LED tanks. Saturation exception: water, keep it dull teal. *People:* three tending spots in front.

**שוק `market` (3 · 720×522).** "two market stalls with striped fabric awnings, shelves of jars and bundles, counters with crates of goods, a balance scale, a hand cart, hanging lanterns and string lights, a coin plate"; Tiers: 0 grey tarps and crates; 1 red-and-cream awnings; 2 teal awnings and a lit sign. *People:* three carry spots.

**גן ילדים `nursery` (2 · 480×522).** "two wooden cribs with soft blankets and a teddy, a mobile of small toys, a chalk drawing of a house, a sun and a stick family, a toy shelf, a stool, a play mat with soft blocks"; plate: a toy-block pictogram. Tiers: 0 bare wood, grey; 1 warm wood; 2 white cribs, pastel mat. Muted pastels only. *People:* two beds (cribs, for the children), a stool seat, two tending spots.

**בית ספר `school` (3 · 720×522).** "a big green blackboard with chalk pictograms (sun, cog, drop, apple) and a tally, a teacher's desk with a plant, a world map, four small wooden desks with benches, a bell"; plate: an apple pictogram. Tiers: 0 crates for desks; 1 wooden desks; 2 steel-blue desks. *People:* four child seats at the desks (`sit`), teacher spots (`inspect`).

**מקלחות וכביסה `bathhouse` (2 · 480×522).** "white tiled walls with a teal border, three shower heads on pipes with falling water and steam, a slatted wooden bench, a wooden tub with steam, towels on a line, a drain grate; plate: a steam pictogram". Tiers: 0 chipped tiles, rusty pipes; 1 clean; 2 brass fittings. Keep the tile grey-white, not bright.

**אולם זיכרון `memorialHall` (2 · 480×522).** "a wall of small slate name plaques in rows (blank, unreadable marks), a ledge of lit candles, a stone pedestal with a small gold star, two dark red banners with a star, two low benches"; tiers: 0 names on cardboard scraps and few plaques; 1 most of the wall; 2 full wall plus an eternal-flame bowl in front. Dim: this is the darkest room, warm candle light only.

## 6. קואורדינטות: איפה המנורות, האפקטים והאנשים (מהבייק, רמה 1)

כל המספרים שברים של הציור (x מ-0 משמאל ל-1, y מ-0 למעלה ל-1). **מנורה** = מקור אור חי (הבוהק של `paintedRoom.ts` יושב עליה); **אפקט** = אנימציה חיה (`blink` נורית, `screen` מסך, `needle` מחוג, `fan` מאוורר, `belt` מסוע, `rotor` רוטור, `flame` להבה, `drip`/`stream`/`bubbles`/`steam`/`mist` חלקיקי מים; `work` = רק כשהחדר מאויש); **עבודה** = `[x, כיוון, פעילות, עומק]`; **מיטה/מושב** = מקומות שבהם אנשים שוכבים/יושבים. רמות 0 ו-2 זהות בפריסה (שינוי קל בפריטים).

| חדר | מנורות (x,y,רדיוס) | אפקטים (סוג@x,y) | עבודה | מיטות / מושבים |
|---|---|---|---|---|
| `batteryBank` | 0.5,0.095,0.243 | blink@0.424,0.32 · blink@0.185,0.32 · blink@0.707,0.32 · blink@0.511,0.32 · needle@0.785,0.49 · screen@0.785,0.61 · blink@0.75,0.7 · blink@0.785,0.7 · blink@0.82,0.7 | [0.22, 1, tend, 0.2] [0.62, -1, tend, 0.3] |  |
| `commons` | 0.5,0.095,0.256 | screen@0.724,0.34 · twinkle@0.252,0.175 · twinkle@0.45,0.194 · twinkle@0.649,0.188 | [0.7, -1, idle, 0.3] | מושב 0.315,0.76 · מושב 0.489,0.76 |
| `library` | 0.5,0.095,0.243 · 0.598,0.755,0.135 | pulse@0.641,0.72 | [0.46, -1, inspect, 0.15] [0.12, 1, inspect, 0.5] | מושב 0.38,0.78 · מושב 0.663,0.78 |
| `recycler` | 0.29,0.095,0.171 · 0.725,0.095,0.171 | belt*@0.42,0.63 · needle@0.725,0.57 · blink*@0.612,0.59 · blink*@0.641,0.59 · sparks*@0.696,0.82 | [0.18, 1, hammer, 0.3] [0.42, 1, hammer, 0.15] [0.7, -1, hammer, 0.5] |  |
| `condenser` | 0.5,0.095,0.229 | fan*@0.261,0.4 · fan*@0.457,0.4 · drip@0.242,0.83 · drip@0.362,0.83 · drip@0.482,0.83 · stream*@0.828,0.85 · needle@0.761,0.47 · blink*@0.674,0.47 | [0.62, -1, tend, 0.3] |  |
| `mushroomFarm` | 0.5,0.095,0.202 | tube@0.293,0.216 · tube@0.663,0.216 · pulse@0.293,0.4 · pulse@0.663,0.4 · mist@0.864,0.7 · twinkle@0.326,0.5 · twinkle@0.674,0.44 · twinkle@0.5,0.58 | [0.46, 1, tend, 0.3] [0.8, -1, tend, 0.5] |  |
| `gatePost` | 0.565,0.095,0.229 · 0.696,0.13,0.175 | blink@0.38,0.28 · screen@0.603,0.42 · screen@0.745,0.42 | [0.3, -1, idle, 0.45] [0.7, -1, type, 0.15] | מושב 0.5,0.79 |
| `barracks` | 0.333,0.095,0.18 · 0.725,0.095,0.144 | blink@0.645,0.096 | [0.4, 1, idle, 0.4] [0.72, -1, idle, 0.3] [0.9, -1, idle, 0.6] | מיטה 0.254,0.73 · מיטה 0.254,0.49 · מיטה 0.572,0.73 · מיטה 0.572,0.49 · מושב 0.261,0.76 · מושב 0.58,0.76 |
| `quarantineWard` | 0.5,0.095,0.243 | screen@0.409,0.54 · ecg@0.409,0.54 · blink@0.435,0.3 · pulse@0.435,0.32 | [0.46, 1, tend, 0.55] [0.7, -1, tend, 0.5] |  |
| `solarArray` | 0.3,0.65,0.35 | pulse@0.3,0.65 · screen@0.826,0.823 · blink@0.807,0.855 · blink@0.837,0.855 | [0.46, 1, idle, 0.6] |  |
| `windTurbine` |  | rotor@0.5,0.195 · blink@0.574,0.214 | [0.5, 1, idle, 0.6] |  |
| `watchtower` | 0.783,0.17,0.323 | screen@0.435,0.29 · pulse@0.783,0.17 · blink@0.435,0.07 | [0.52, -1, idle, 0.5] |  |
| `garage` | 0.261,0.095,0.18 · 0.725,0.095,0.153 | weld*@0.754,0.72 | [0.2, 1, wrench, 0.5] [0.52, -1, wrench, 0.6] [0.78, -1, hammer, 0.25] |  |
| `decon` | 0.5,0.095,0.229 | stream*@0.5,0.27 · stream*@0.587,0.27 · steam@0.543,0.77 · tube@0.777,0.166 | [0.4, 1, idle, 0.55] [0.78, -1, idle, 0.4] |  |
| `aquaculture` | 0.507,0.095,0.198 | tube@0.23,0.474 · bubbles@0.145,0.85 · bubbles@0.301,0.85 · tube@0.51,0.474 · bubbles@0.446,0.85 · bubbles@0.58,0.85 · tube@0.789,0.474 · bubbles@0.748,0.85 · bubbles@0.86,0.85 | [0.18, 1, tend, 0.7] [0.5, 1, tend, 0.7] [0.82, -1, tend, 0.7] |  |
| `market` | 0.261,0.12,0.162 · 0.739,0.12,0.162 | twinkle@0.181,0.133 · twinkle@0.341,0.157 · twinkle@0.5,0.165 · twinkle@0.659,0.157 · twinkle@0.819,0.133 | [0.2, 1, carry, 0.55] [0.5, 1, carry, 0.55] [0.8, -1, carry, 0.55] |  |
| `nursery` | 0.5,0.12,0.256 | twinkle@0.5,0.344 · twinkle@0.565,0.344 · twinkle@0.63,0.344 | [0.42, 1, tend, 0.6] [0.7, -1, tend, 0.5] | מושב 0.783,0.806 |
| `school` | 0.362,0.095,0.189 · 0.725,0.095,0.144 |  | [0.16, 1, inspect, 0.45] [0.46, -1, inspect, 0.7] | מושב 0.252,0.852 · מושב 0.404,0.852 · מושב 0.557,0.852 · מושב 0.709,0.852 |
| `bathhouse` | 0.5,0.095,0.243 | stream*@0.239,0.406 · stream*@0.37,0.406 · stream*@0.5,0.406 · steam@0.37,0.59 · drip@0.239,0.41 · steam@0.739,0.75 | [0.5, 1, idle, 0.55] | מושב 0.326,0.78 · מושב 0.457,0.78 |
| `memorialHall` | 0.5,0.095,0.175 | flame@0.217,0.536 · flame@0.304,0.536 · flame@0.391,0.536 · flame@0.609,0.536 · flame@0.696,0.536 · flame@0.783,0.536 | [0.5, 1, idle, 0.55] | מושב 0.315,0.92 · מושב 0.685,0.92 |

(* = אפקט `work`.)

## 7. רשימת בדיקה למסירה

1. שלוש רמות לסוג, באותו גודל; אותה פריסה בכל הרמות (מיקום ציוד זהה).
2. בלי טקסט, בלי אנשים, בלי קווי מתאר; שיא רוויה < 0.6 חוץ ממסכים/אש/אור גידול.
3. הרצפה פנויה בין 0.87 ל-0.97 מגובה הציור.
4. הציור נבדק ב-`/tools/roomfx.html?type=<type>` לצד שאר החדרים (בהירות דומה, אותו גוון חם).
5. רק אז: הקבצים ל-`public/art/rooms/`, הסוג ל-`PAINTED_TYPES`, והרצת `tools/art.html` (מאזנת ומייצרת `meta.json`/`balance.json`).
6. אם משהו נכשל בטעינה, החדר מציג את הבייק (אין חור ריק).
