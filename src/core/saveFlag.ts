/**
 * [plan4:UX-16] A tiny synchronous note next to the (asynchronous) save. IndexedDB writes are not instant, and a phone can freeze or
 * kill the page between "save requested" and "save stored". localStorage is written at once, so:
 *   pending = when a save was last asked for, saved = when one last reached storage.
 * On the next start, pending newer than saved means the last write never landed: the player is told, instead of the progress
 * silently being a few minutes older than they remember. (Two timestamps, a few bytes; the save itself is untouched.)
 */
const SLOT = (() => {
  if (!import.meta.env.DEV) return '';
  const slot = new URLSearchParams(location.search).get('slot');
  return slot && /^[a-z0-9_-]{1,20}$/i.test(slot) ? `_${slot}` : '';
})();
const PENDING = `lastbunker_save_pending${SLOT}`;
const SAVED = `lastbunker_save_done${SLOT}`;

function put(key: string, value: number): void {
  try { localStorage.setItem(key, String(value)); } catch { /* storage blocked: the note is a nicety */ }
}
function get(key: string): number {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}

/** A save is about to be started (only moves the note forward when none is already pending). */
export function markSavePending(): void {
  if (get(PENDING) <= get(SAVED)) put(PENDING, Date.now());
}

/** A save reached storage. */
export function markSaved(): void {
  put(SAVED, Date.now());
}

/** True once per start when the previous session asked for a save that never reached storage; then the note is cleared. */
export function lastSaveWasInterrupted(): boolean {
  const lost = get(PENDING) > get(SAVED);
  if (lost) put(PENDING, get(SAVED));
  return lost;
}
