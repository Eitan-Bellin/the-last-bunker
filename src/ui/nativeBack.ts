import { i18n } from '../i18n/I18nManager';
import { nativePlugin } from '../utils/platform';
import { backAction, type BackAction, type BackInput } from './popupRules';

/**
 * [ux-redesign W3b] The Android back button inside the native shell (Capacitor). The web build handles back through `popstate`
 * (app.ts installBackNavigation); in the shell the App plugin's `backButton` event comes instead, and once a listener is registered the
 * shell no longer walks the WebView history, so the two never both run. Same order as the web: the top dialog (an info dialog closes, a
 * decision stays), then placement / the reader / the surface / the top sheet; on the bare bunker screen a "Leave the game?" dialog,
 * and only its "Leave" calls App.exitApp(). On the web (no App plugin) this does nothing.
 */

interface AppPlugin {
  addListener(event: 'backButton', cb: (e: { canGoBack: boolean }) => void): unknown;
  exitApp(): Promise<void> | void;
}

export interface NativeBackHost {
  /** What is open now (the same facts installBackNavigation reads). */
  input: () => BackInput;
  /** Carries out every action but 'leave' and 'modalStay' (the same steps the popstate handler takes). */
  act: (action: Exclude<BackAction, 'leave' | 'modalStay' | 'spotlight'>) => void;
  /** Shows the leave dialog: Stay (the back choice) and Leave. */
  confirmLeave: (title: string, body: string, stay: string, leave: string, onLeave: () => void) => void;
}

/** Registers the listener when the shell has the App plugin; returns whether it did. */
export function installNativeBack(host: NativeBackHost): boolean {
  const app = nativePlugin<AppPlugin>('App');
  if (!app || typeof app.addListener !== 'function') return false;
  app.addListener('backButton', () => {
    const act = backAction(host.input());
    if (act === 'modalStay' || act === 'spotlight') return; // a decision waits for its answer; [w3fix] a spotlight stays (Skip leaves it)
    if (act !== 'leave') { host.act(act); return; }
    host.confirmLeave(i18n.t('ux3b.leave.title'), i18n.t('ux3b.leave.body'), i18n.t('ux3b.leave.stay'), i18n.t('ux3b.leave.go'), () => {
      void Promise.resolve(app.exitApp()).catch(() => undefined);
    });
  });
  return true;
}
