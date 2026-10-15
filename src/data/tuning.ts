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
  priceScale: 3.5,
  /** From Act III on, this share of a price is also asked in each older currency (in its own reference income). */
  olderCurrencyShare: 0.4,
  /**
   * L2: each Act's currency can be stored for this many hours of its reference income (index = current Act).
   * [ux-wp2 R7/R10] Act I (2.5, was 0.9): food, water and knowledge hold at least this many hours of the bunker's own
   * production (ResourceSystem.computeCaps), so the first night away fills the stores instead of spilling after an hour.
   */
  capHours: [0, 2.5, 4, 6, 8, 9, 10, 10],
  maxPaymentShare: 0.8,
  /** Digging to B7 costs this many hours of income; each floor deeper costs digHoursGrowth times more. */
  digHours: 1.2,
  digHoursGrowth: 1.15,
  /**
   * [ux-wp2 S3] Tier-2 roles (assembly line, arc furnace, data vault, council hall, seed forge) now go through their crew and the
   * modifier stack (morale, laws, research, Echo...), about x6-8 in a developed bunker; their base rates are divided by this.
   */
  roleOutputNorm: 8,
  /** Charter project stages, in hours of their Act's income (index = Act). */
  charterStageHours: [0, 3, 17, 12, 9, 9, 9, 9],
  /** [P4] Contracts: an offer every so many world seconds, open this long, at most this many waiting; paid in hours of income. */
  contractEvery: 3600,
  contractDeadline: 14400,
  contractMaxOpen: 3,
  contractRewardHours: 3,
  /** [Q5] A supply contract asks this many hours of the bunker's own production of one scarce good (x0.8..1.2 by roll). */
  contractAskHours: 1,
  /** [Q5] A supply contract is safe to take automatically while the asked store stays above this share of its cap. */
  contractSafeShare: 0.3,
  /** [P4] Outposts: cost and build time in hours (x1.1 / x1.12 per outpost already held), yield in hours of income per hour. */
  outpostHours: 3,
  outpostBuildHours: 4,
  outpostYieldHours: 0.12,
  /**
   * [Q10] From this Act, storage overflow turns into this share of the credits it used to. [ux-wp2 R5] From Act III and to a twentieth
   * (it was Act IV and a quarter): 1-6M credits of nothing piled up; credits now come mostly from the daily orders and buy Act goods.
   */
  overflowDecayAct: 3,
  overflowDecay: 0.05,
  /** [Q10] Shop prices rise by this share of the base price for every Act after the first. */
  shopActRamp: 0.5,
  /** Longest a single room upgrade takes. [ux-wp2 M1] 12 h (was 20): Mk9/Mk10 upgrades were day-long waits with nothing to decide. */
  maxUpgradeSeconds: 12 * 3600,
  /** Digging: seconds per new floor (index = floors after the dig); deeper floors grow by digTimeGrowth each. */
  digSeconds: [0, 0, 0, 0, 60, 300, 1800, 3600, 7200],
  digTimeGrowth: 1.15,
} as const;

export type Tuning = typeof TUNING;
