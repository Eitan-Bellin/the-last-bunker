/**
 * [ux-redesign final F1] Who holds a page part inert. The tutorial spotlight, a dialog and a sheet each make parts of the page inert,
 * and their lifetimes overlap (a dialog opens over the spotlight, the spotlight goes while the dialog is up). Each one now holds a
 * part under its own name and lets go of only what it held: a part stays inert while anyone holds it, and is live again when the last
 * holder lets go. A part made inert by something outside this registry is "foreign" and never touched.
 *
 * Pure (no `document`): the nodes are anything with an `inert` flag, so tools/sim/popup-test.mjs checks it with plain objects.
 */

/** The DOM surface this needs (an Element in the game; a plain object in the test). */
export interface InertNode {
  inert?: boolean;
  tagName: string;
  matches(sel: string): boolean;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
  toggleAttribute(name: string, on: boolean): boolean;
}

export type InertOwner = 'spotlight' | 'modal' | 'sheet';

const holders = new WeakMap<InertNode, Set<InertOwner>>();

/** Layers that are never made inert by a page-wide walk: dialogs, story scenes, the lore reader, toasts, ceremonies, flying icons, the spotlight. */
export const NEVER_INERT = '.modal-overlay, .story-overlay, .lore-overlay, .toast-stack, .ceremony, .fx-layer, .sr-only, #splash, .ob-spot, .ob-hand, .ob-ring';

function apply(node: InertNode, on: boolean): void {
  if ('inert' in node) node.inert = on;
  else node.toggleAttribute('aria-hidden', on);
}

/** Is this part inert (or aria-hidden) because of something outside the registry? */
export function isForeign(node: InertNode): boolean {
  if (holders.get(node)?.size) return false;
  return !!node.inert || node.hasAttribute('aria-hidden');
}

/** Should a page-wide walk (spotlight, dialog) make this body child inert? `keep` adds the walker's own exceptions. */
export function shouldInert(node: InertNode, keep = ''): boolean {
  if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return false;
  if (node.matches(keep ? `${NEVER_INERT}, ${keep}` : NEVER_INERT)) return false;
  return !isForeign(node);
}

/** `owner` holds `node` inert. Returns false when it already did. */
export function holdInert(node: InertNode, owner: InertOwner): boolean {
  let set = holders.get(node);
  if (!set) holders.set(node, (set = new Set()));
  if (set.has(owner)) return false;
  set.add(owner);
  if (set.size === 1) apply(node, true);
  return true;
}

/** `owner` lets go of `node`: it is live again when nobody else holds it. */
export function dropInert(node: InertNode, owner: InertOwner): void {
  const set = holders.get(node);
  if (!set?.delete(owner)) return;
  if (set.size === 0) apply(node, false);
}

/** Who holds `node` now (for tests and debugging). */
export function inertHolders(node: InertNode): InertOwner[] {
  return [...(holders.get(node) ?? [])];
}

/**
 * A layer that must take taps now (a dialog that just opened): every holder lets go, and `inert` / `aria-hidden` are cleared on it
 * and its ancestors up to (not including) `stop`.
 */
export function forceLive(node: InertNode & { parentElement?: unknown }, stop?: unknown): void {
  for (let n: (InertNode & { parentElement?: unknown }) | null = node; n && n !== stop; n = (n.parentElement as typeof n) ?? null) {
    holders.delete(n);
    if ('inert' in n) n.inert = false;
    if (n.hasAttribute('aria-hidden')) n.removeAttribute('aria-hidden');
  }
}
