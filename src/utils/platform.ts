/**
 * [plan4:UX-15] Which kind of host the page runs in. The game ships as a web page / home-screen PWA only (no native shell on this branch).
 */

/** iPhone / iPod / iPad (iPadOS reports itself as a Mac with a touch screen). */
export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Launched from the home screen (no browser bars): iOS reports it on navigator.standalone, others through the display-mode query. */
export function isStandalonePwa(): boolean {
  try {
    return (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/**
 * Safari (or another iOS browser) in a normal tab: a web page there cannot show notifications and is suspended in the background
 * within seconds, so the notification switch would promise something the page cannot keep.
 */
export function isIosBrowserTab(): boolean {
  return isIOS() && !isStandalonePwa();
}
