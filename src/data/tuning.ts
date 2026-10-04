/**
 * Long-game tuning: the numbers the pacing model is built on, in one place (read-only for every system; the balance
 * simulator and linter read them too). See the long-game plan, section 5 ("pacing model"), and src/data/pricing.ts.
 * The Acts' ceilings (room level, people, depth) live with the Acts in src/data/acts.ts.
 */

export const TUNING = {
  /** Switches for whole systems (the simulator turns them off for control runs). */
  flags: {
    danger: true,
  },
  /**
   * Ceiling on the product of all global output modifiers (morale, Echo, research, laws, seasons...) on one room.
   * They used to stack to x12-20; the long game holds them under this. Infinity = no ceiling.
   */
  multiplierCeiling: Infinity,
  /** L1: an upgrade to level L costs `priceMinutes * priceGrowth^(L-1)` minutes of its Act's reference income. */
  priceMinutes: 3,
  priceGrowth: 1.74,
  /** Reference income of each Act's currency per hour (index = Act; see ACT_CURRENCY in pricing.ts). */
  refIncome: [0, 3000, 80000, 400, 120, 90, 60, 20],
  /**
   * [P4] From Act II every price (and the storage that holds it) is this many times its hours: contracts and outposts
   * bring income on top of the rooms, so the same Acts take the same days.
   */
  priceScale: 2.8,
  /** From Act III on, this share of a price is also asked in each older currency (in its own reference income). */
  olderCurrencyShare: 0.4,
  /** L2: each Act's currency can be stored for this many hours of its reference income (index = current Act). */
  capHours: [0, 0.9, 4, 6, 8, 9, 10, 10],
  maxPaymentShare: 0.8,
  /** Digging to B7 costs this many hours of income; each floor deeper costs digHoursGrowth times more. */
  digHours: 1.2,
  digHoursGrowth: 1.15,
  /** Charter project stages, in hours of their Act's income (index = Act). */
  charterStageHours: [0, 3, 17, 12, 9, 9, 9, 9],
  /** [P4] Contracts: an offer every so many world seconds, open this long, at most this many waiting; paid in hours of income. */
  contractEvery: 1800,
  contractDeadline: 5400,
  contractMaxOpen: 6,
  contractRewardHours: 2,
  /** [P4] Outposts: cost and build time in hours (x1.1 / x1.12 per outpost already held), yield in hours of income per hour. */
  outpostHours: 3,
  outpostBuildHours: 4,
  outpostYieldHours: 0.12,
  /** Longest a single room upgrade takes. */
  maxUpgradeSeconds: 20 * 3600,
  /** Digging: seconds per new floor (index = floors after the dig); deeper floors grow by digTimeGrowth each. */
  digSeconds: [0, 0, 0, 0, 60, 300, 1800, 3600, 7200],
  digTimeGrowth: 1.25,
} as const;

export type Tuning = typeof TUNING;
