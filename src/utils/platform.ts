/**
 * [plan4:UX-12] The one place that knows where the game is running: a normal browser tab, the installed home-screen app (PWA) or the
 * native shell (Capacitor, built later on a Mac). Everything else asks here instead of sniffing the user agent on its own.
 * The web build never imports a Capacitor package: the shell injects `window.Capacitor`, and without it every answer is "web".
 */

import { isTouchDevice } from './device';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  isPluginAvailable?: (name: string) => boolean;
  Plugins?: Record<string, unknown>;
}

function capacitor(): CapacitorGlobal | undefined {
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True inside the native shell. */
export function isNative(): boolean {
  try {
    return capacitor()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** An iPhone, iPad or iPod (an iPad that says "Macintosh" is told apart by its touch screen). */
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Opened from the home screen (no browser bars): iOS says so on `navigator.standalone`, everything else on the display-mode query. */
export function isStandalone(): boolean {
  try {
    if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true;
    return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches;
  } catch {
    return false;
  }
}

/**
 * Safari on an iPhone/iPad as a plain tab: the one place where "Add to Home Screen" is the way to install, where Safari may clear the
 * site's storage after about a week without a visit, and where the page gets no notifications at all. (Chrome and Firefox on iOS are
 * Safari underneath, but cannot add to the home screen the same way, so the install hint is shown only for real Safari.)
 */
export function isIOSBrowserTab(): boolean {
  return isIOS() && !isStandalone() && !isNative();
}

/** Real Safari (not Chrome/Firefox/Edge/Opera/Google app on iOS): only it offers the Share > Add to Home Screen path. */
export function isIOSSafari(): boolean {
  return isIOS() && !/(CriOS|FxiOS|EdgiOS|OPiOS|GSA\/)/.test(navigator.userAgent);
}

/** A shell plugin by name (`Haptics`, `Share`...), or undefined on the web. */
export function nativePlugin<T = unknown>(name: string): T | undefined {
  const c = capacitor();
  try {
    if (!c || c.isPluginAvailable?.(name) === false) return undefined;
    return c.Plugins?.[name] as T | undefined;
  } catch {
    return undefined;
  }
}

/** Whether notices can work at all here: not in a Safari tab or the iOS home-screen app without a push server (Web Push needs a server). */
export function webNotificationsHonest(): boolean {
  return isNative() || !isIOS();
}

/**
 * [plan4:UX-16] Hands a file to the system share sheet ("Save to Files", AirDrop, Mail...). Only on touch devices: a laptop browser is
 * better served by a plain download. 'unsupported' = nothing was shown, use the download instead; 'cancelled' = the player closed the sheet.
 * Must be called straight from a tap (the browser wants a fresh user gesture).
 */
export async function shareFile(file: File, title: string): Promise<'shared' | 'cancelled' | 'unsupported'> {
  try {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (!isTouchDevice() || typeof nav.share !== 'function' || !nav.canShare?.({ files: [file] })) return 'unsupported';
    await nav.share({ files: [file], title });
    return 'shared';
  } catch (e) {
    return (e as { name?: string } | null)?.name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}
