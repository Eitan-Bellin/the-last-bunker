// v2 economy: every price, rate and capacity of the mine in one place (tuned with tools/v2sim.ts).

export interface FloorDef {
  /** Room painting key in public/art/rooms (720x522 paintings only). */
  art: string;
  name: string;
  product: string;
}

export const FLOORS: FloorDef[] = [
  { art: 'recycler', name: 'ממחזרת', product: 'גרוטאות' },
  { art: 'farm', name: 'חווה', product: 'תפוחי אדמה' },
  { art: 'hydroponics', name: 'הידרופוניקה', product: 'ירקות' },
  { art: 'seedLab', name: 'מעבדת זרעים', product: 'זרעים' },
  { art: 'componentsPlant', name: 'מפעל רכיבים', product: 'רכיבים' },
  { art: 'alloyFoundry', name: 'בית יציקה', product: 'סגסוגות' },
  { art: 'dataCenter', name: 'מרכז נתונים', product: 'נתונים' },
  { art: 'reactor', name: 'כור', product: 'אנרגיה' },
];

export const MAX_LVL = 200;
/** Levels that add a worker (floors) or a porter (market). */
export const CREW_STEPS = [10, 25, 50, 100];
/** Levels that multiply output by MILESTONE_MUL. */
export const MILESTONES = [10, 25, 50, 100, 150, 200];
export const MILESTONE_MUL = 1.5;
/** Painting tier by floor level (the three painted tiers of every room). */
export const TIER_AT = [1, 25, 50];

const count = (steps: number[], lvl: number) => steps.filter(s => s <= lvl).length;

export const milestonesPassed = (lvl: number) => count(MILESTONES, lvl);
export const nextMilestone = (lvl: number) => MILESTONES.find(m => m > lvl) ?? null;
export const tierOf = (lvl: number) => (lvl >= TIER_AT[2] ? 2 : lvl >= TIER_AT[1] ? 1 : 0);

// --- floors ---
export const floorWorkers = (lvl: number) => 1 + count(CREW_STEPS, lvl);
/** Goods one worker carries per trip. */
export const floorLoad = (i: number, lvl: number) => 11 * 7 ** i * (1 + 0.35 * (lvl - 1)) * MILESTONE_MUL ** milestonesPassed(lvl);
export const floorUpCost = (i: number, lvl: number) => 8 * 9 ** i * 1.13 ** (lvl - 1);
export const DIG_COST = [0, 100, 2e3, 3e4, 4e5, 5e6, 7e7, 1e9];
export const floorMgrCost = (i: number) => 120 * 12 ** i;

// --- elevator ---
export const elevCap = (lvl: number) => 30 * 1.15 ** (lvl - 1) * MILESTONE_MUL ** milestonesPassed(lvl);
export const elevSpeed = (lvl: number) => Math.min(900, 320 * (1 + 0.02 * (lvl - 1)));
export const elevUpCost = (lvl: number) => 15 * 1.16 ** (lvl - 1);
export const ELEV_MGR_COST = 200;

// --- market (porters carry from the headframe to the stalls) ---
export const porters = (lvl: number) => 1 + count(CREW_STEPS, lvl);
export const porterCap = (lvl: number) => 40 * 1.15 ** (lvl - 1) * MILESTONE_MUL ** milestonesPassed(lvl);
export const porterSpeed = (lvl: number) => Math.min(170, 90 * (1 + 0.01 * (lvl - 1)));
export const marketUpCost = (lvl: number) => 15 * 1.16 ** (lvl - 1);
export const MARKET_MGR_COST = 300;

// --- managers ---
export const BOOST_MUL = 2;
export const BOOST_S = 120;
export const BOOST_CD_S = 600;

/** Offline earnings are credited for at most this long. */
export const OFFLINE_CAP_S = 2 * 3600;

/** Total price of buying `n` levels from `lvl` with a per-level price function. */
export function bulkCost(price: (lvl: number) => number, lvl: number, n: number): number {
  let s = 0;
  for (let k = 0; k < n; k++) s += price(lvl + k);
  return s;
}

/** How many levels `cash` buys from `lvl` (at least 1 when the next level is affordable, capped at MAX_LVL). */
export function maxAffordable(price: (lvl: number) => number, lvl: number, cash: number): number {
  let n = 0;
  let s = 0;
  while (lvl + n < MAX_LVL) {
    const c = price(lvl + n);
    if (s + c > cash) break;
    s += c;
    n++;
  }
  return n;
}
