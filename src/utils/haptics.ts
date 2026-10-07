/**
 * [plan4:UX-2] One haptics API for every platform: `haptic(kind)`.
 *
 *  1. Inside the native shell (Capacitor) the injected Haptics plugin is used (no package import: the plugin only
 *     exists in the shell, the web build never references it).
 *  2. iOS Safari / the installed PWA has no `navigator.vibrate`, but since 17.4 toggling an `<input type="checkbox" switch>`
 *     gives the system tick. A hidden label that we click from inside the player's tap does it [V: needs a real iPhone].
 *  3. Everything else (Android): `navigator.vibrate` patterns.
 *
 * Browsers refuse vibration (and log an error) until the player has touched the page, so ask first.
 */
import { getA11y, reducedMotion } from './a11y';
import { isIOS, nativePlugin } from './platform'; // [plan4:UX-12]

export type HapticKind = 'tap' | 'select' | 'success' | 'warning' | 'error' | 'impact' | 'heavy';

/** Vibration patterns in ms (light strength); 'strong' stretches them. */
const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 8,
  select: 6,
  success: [12, 40, 18],
  warning: [24, 50, 24],
  error: [10, 40, 10, 40, 22],
  impact: 16,
  heavy: 32,
};

interface CapacitorHaptics {
  impact?: (o: { style: 'LIGHT' | 'MEDIUM' | 'HEAVY' }) => unknown;
  notification?: (o: { type: 'SUCCESS' | 'WARNING' | 'ERROR' }) => unknown;
  selectionChanged?: () => unknown;
}

/** Not more often than every 40 ms and at most 6 per second: a stream of ticks stops feeling like feedback. */
const MIN_GAP_MS = 40;
const MAX_PER_SECOND = 6;
const recent: number[] = [];

let switchLabel: HTMLLabelElement | null = null;
let switchBroken = false;

function viaCapacitor(kind: HapticKind, strong: boolean): boolean {
  const plugin = nativePlugin<CapacitorHaptics>('Haptics');
  if (!plugin) return false;
  try {
    if (kind === 'success') void plugin.notification?.({ type: 'SUCCESS' });
    else if (kind === 'warning') void plugin.notification?.({ type: 'WARNING' });
    else if (kind === 'error') void plugin.notification?.({ type: 'ERROR' });
    else if (kind === 'heavy') void plugin.impact?.({ style: 'HEAVY' });
    else if (kind === 'impact') void plugin.impact?.({ style: strong ? 'HEAVY' : 'MEDIUM' });
    else if (kind === 'select') void (plugin.selectionChanged ? plugin.selectionChanged() : plugin.impact?.({ style: 'LIGHT' }));
    else void plugin.impact?.({ style: strong ? 'MEDIUM' : 'LIGHT' });
    return true;
  } catch {
    return false;
  }
}

/** The label is created lazily and kept off-screen (not display:none: Safari ignores clicks on those). */
function viaSwitch(): boolean {
  if (switchBroken || !isIOS()) return false;
  try {
    if (!switchLabel) {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      input.setAttribute('aria-hidden', 'true');
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden';
      label.appendChild(input);
      document.body.appendChild(label);
      switchLabel = label;
    }
    switchLabel.click();
    return true;
  } catch {
    switchBroken = true; // unsupported here: stop trying, never throw
    return false;
  }
}

function viaVibrate(kind: HapticKind, strong: boolean): void {
  try {
    if (typeof navigator.vibrate !== 'function') return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    const p = PATTERNS[kind];
    const k = strong ? 1.6 : 1;
    navigator.vibrate(Array.isArray(p) ? p.map(n => Math.round(n * k)) : Math.round(p * k));
  } catch {
    // no haptics on this device
  }
}

/** Plays one haptic. Never throws; does nothing when the setting is off, or when the system's reduced-motion is on (except success/error). */
export function haptic(kind: HapticKind): void {
  try {
    const mode = getA11y().haptics;
    if (mode === 'off') return;
    if (reducedMotion() && kind !== 'success' && kind !== 'error') return;
    const now = performance.now();
    while (recent.length && now - recent[0] > 1000) recent.shift();
    if (recent.length && now - recent[recent.length - 1] < MIN_GAP_MS) return;
    if (recent.length >= MAX_PER_SECOND) return;
    recent.push(now);
    const strong = mode === 'strong';
    if (viaCapacitor(kind, strong)) return;
    if (viaSwitch()) {
      // A second tick makes success/error/warning feel different from a plain tap (only works while the gesture is fresh).
      if (kind === 'success' || kind === 'error' || kind === 'warning') setTimeout(() => { try { switchLabel?.click(); } catch { /* ignore */ } }, 120);
      return;
    }
    viaVibrate(kind, strong);
  } catch {
    // haptics are a nicety, never a failure
  }
}
