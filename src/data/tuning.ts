/**
 * Long-game tuning: the numbers the pacing model is built on, in one place (read-only for every system; the balance
 * simulator and linter read them too). See the long-game plan, section 5 ("pacing model").
 */

export const TUNING = {
  /** Switches for whole systems (the simulator turns them off for control runs). */
  flags: {
    danger: true,
  },
  /**
   * Ceiling on the product of all global output modifiers (morale, Echo, research, laws, seasons...) on one room.
   * They used to stack to x12-20; the long game holds them under this. Infinity = no ceiling (today's behaviour) until P1 tunes it.
   */
  multiplierCeiling: Infinity,
  /** L1: a level-L purchase costs `priceMinutes * priceGrowth^(L-1)` minutes of the Act's reference income. */
  priceMinutes: 3,
  priceGrowth: 1.74,
  /** L2: storage holds this many hours of income per Act (index = Act 1..7); a single payment is at most `maxPaymentShare` of it. */
  capHours: [0, 0.9, 4, 6, 8, 9, 10, 10],
  maxPaymentShare: 0.8,
  /** Population ceiling per Act (index = Act 1..7). */
  popCap: [0, 12, 30, 65, 110, 150, 190, 190],
  /** Mk (room level) ceiling per Act. */
  levelCap: [0, 2, 4, 6, 8, 9, 10, 10],
} as const;

export type Tuning = typeof TUNING;
