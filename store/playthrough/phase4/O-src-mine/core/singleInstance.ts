/**
 * Only one copy of the game may save at a time. Two copies open together (the installed app and a browser tab, or an old tab
 * that wakes up) would each overwrite the other's progress with whatever they last knew.
 *
 * Every copy writes a claim ({ id, at }) to localStorage when it starts; the newest claim wins. A copy that finds a newer claim
 * than its own stops saving and tells the player. localStorage is shared and synchronous, so even a tab that was frozen in the
 * background finds out the moment it wakes up (and before its next save).
 */
/** Test copies (dev ?slot=name) have their own save, so they claim separately. */
const slot = import.meta.env.DEV ? (new URLSearchParams(location.search).get('slot') ?? '') : '';
const OWNER_KEY = `lastbunker_owner${slot ? '_' + slot : ''}`;

interface Claim {
  id: string;
  at: number;
}

const me: Claim = { id: Math.random().toString(36).slice(2), at: Date.now() };
let usable = true;

function readClaim(): Claim | null {
  try {
    const raw = localStorage.getItem(OWNER_KEY);
    return raw ? (JSON.parse(raw) as Claim) : null;
  } catch {
    return null;
  }
}

/** Takes ownership (call once at start). */
export function claimOwnership(): void {
  try {
    localStorage.setItem(OWNER_KEY, JSON.stringify(me));
  } catch {
    usable = false; // no storage for the claim: nothing to guard
  }
}

/** True while no newer copy of the game has started. */
export function stillOwner(): boolean {
  if (!usable) return true;
  const c = readClaim();
  return !c || c.id === me.id || c.at < me.at;
}

/** Calls back right away when another copy takes over (also fires for a frozen tab as soon as the browser wakes it). */
export function onSuperseded(cb: () => void): void {
  window.addEventListener('storage', e => {
    if (e.key === OWNER_KEY && !stillOwner()) cb();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !stillOwner()) cb();
  });
}
