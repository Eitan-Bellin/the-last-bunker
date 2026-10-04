const SECONDS_PER_GAME_HOUR = 50;

/** Bunker clock: a full day lasts 20 real minutes; night returns 0..1 darkness. */
export function timeOfDay(playSeconds: number): { hour: number; minute: number; night: number } {
  const hours = (6 + playSeconds / SECONDS_PER_GAME_HOUR) % 24;
  const hour = Math.floor(hours);
  const minute = Math.floor((hours - hour) * 60);
  const daylight = Math.cos(((hours - 13) / 24) * Math.PI * 2);
  const night = Math.max(0, Math.min(1, (-daylight + 0.15) / 0.85));
  return { hour, minute, night };
}
