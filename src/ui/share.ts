import { Rectangle } from 'pixi.js';
import type { GameState } from '../core/GameState';
import type { BunkerRenderer } from '../rendering/BunkerRenderer';
import { hudBottom, hudTop, VIEW_TOP } from '../rendering/CameraController';
import { ROOM_H, SHAFT_W, SIDE_MARGIN, SLAB, SLOT_W, buildingX, floorTop } from '../rendering/layout';
import { roomSlots } from '../data/buildingDefs';
import { actOf } from '../data/acts';
import { i18n } from '../i18n/I18nManager';
import { el } from './dom';
import type { Modal } from './components/Modal';
import type { ToastKind } from './components/Toast';
import '../styles/share.css';

/**
 * [plan4:GP-5] "Share your bunker": a 1080x1350 PNG made from the current state, with no personal data (no name, no save contents,
 * only the Act, the day, how many people and floors). The picture is a free "overview" camera render of the live scene, taken once,
 * on request; nothing here runs in the frame loop.
 *
 * How: a veil covers the screen while the camera is moved to a framing of the whole bunker, the engine draws a few pictures there
 * (rooms and chunks near the camera are built lazily), the stage is extracted for just the framed rectangle (renderer.extract with
 * `frame`, so the texture is the size of the output and not of the screen), the camera goes straight back, and the card is composed
 * on a 2D canvas. The result opens in a dialog with Share (navigator.share with a file) and Save (a download): a tap there is a fresh
 * user gesture, which iOS requires for the share sheet and which the seconds spent drawing would have used up.
 */

const OUT_W = 1080;
const OUT_H = 1350;
/** The picture part is OUT_W x IMG_H; the card sits under it. */
const IMG_H = 1000;
const ASPECT = OUT_W / IMG_H;
/** Lowest zoom of the picture: under FAR_ZOOM (0.42) the live city map replaces the rooms. */
const MIN_SHARE_ZOOM = 0.46;

export interface ShareDeps {
  renderer: BunkerRenderer;
  getState: () => GameState;
  modal: Modal;
  toast: (text: string, kind?: ToastKind) => void;
  /** Hides (true) or shows (false) the floating "+N" numbers, so the picture has none of them in it. */
  hideNumbers: (hide: boolean) => void;
  /** Counts as a touch for the picture-rate governor, so the engine draws at full rate while the picture is prepared. */
  wake: () => void;
}

let busy = false;

const frames = (n: number): Promise<void> => new Promise(done => {
  const step = (left: number): void => { if (left <= 0) done(); else requestAnimationFrame(() => step(left - 1)); };
  step(n);
});
const pause = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms));

/** The sharing sheet can take files in this browser. */
export function canShareFiles(): boolean {
  try {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
    return navigator.canShare({ files: [new File([new Blob(['x'])], 'x.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

/** Frames the whole bunker top-down into a canvas the size of the picture part. Puts the player's camera back before it returns. */
async function captureOverview(d: ShareDeps): Promise<HTMLCanvasElement> {
  const r = d.renderer;
  const cam = r.camera;
  const app = r.app;
  const state = d.getState();
  const saved = cam.view;
  const sw = app.screen.width;
  const sh = app.screen.height;
  // The crop is the part of the screen between the HUD bands, in the picture's shape; the world's top is lined up with its top edge.
  const top = hudTop();
  const usable = Math.max(120, sh - top - hudBottom());
  const ch = Math.min(usable, sw / ASPECT);
  const cw = ch * ASPECT;
  // The picture frames what is built (the shaft and the rooms), not the whole reach of the floors: a dug but empty wing is just rock.
  let wl = 0, wr = SHAFT_W;
  for (const b of state.buildings) {
    wl = Math.min(wl, buildingX(b));
    wr = Math.max(wr, buildingX(b) + roomSlots(b.type) * SLOT_W);
  }
  const worldTop = VIEW_TOP - 60;
  const contentH = floorTop(state.currentFloors) + ROOM_H + SLAB - worldTop;
  const zoom = Math.max(MIN_SHARE_ZOOM, Math.min(1, cw / (wr - wl + 2 * SIDE_MARGIN), ch / contentH));
  const centreX = (wl + wr) / 2;
  const place = (): void => cam.setView(centreX, -Infinity, zoom);
  try {
    place();
    d.wake();
    await frames(3);
    await pause(700);
    place(); // a sheet closing a moment ago may have moved the bounds
    await frames(2);
    d.hideNumbers(true);
    const frame = new Rectangle(Math.round((sw - cw) / 2), Math.round(top), Math.round(cw), Math.round(ch));
    // Synchronous: the stage is drawn into a texture of the output's size and read back before anything else runs.
    return app.renderer.extract.canvas({ target: app.stage, resolution: Math.min(3, OUT_W / cw), frame }) as HTMLCanvasElement;
  } finally {
    d.hideNumbers(false);
    cam.setView(saved.x, saved.y, saved.z);
  }
}

/** Waits for the two fonts the card uses, but never longer than a moment (offline: the fallback font draws instead). */
async function fontsReady(): Promise<void> {
  try {
    await Promise.race([
      Promise.all([document.fonts.load('700 96px Karantina'), document.fonts.load('600 36px Rubik'), document.fonts.load('500 30px Rubik')]),
      pause(1500),
    ]);
  } catch {
    // the page's own fallback fonts are fine
  }
}

/** The card under the picture: title, the Act, and three numbers. Nothing that identifies the player. */
function drawCard(ctx: CanvasRenderingContext2D, state: GameState): void {
  const he = i18n.currentLocale === 'he';
  const locale = i18n.currentLocale;
  const worldT = state.longGame?.meta.worldT ?? state.stats.totalPlayTime;
  const stats: [number, string][] = [
    [Math.floor(worldT / 86400) + 1, i18n.t('share.card.day')],
    [state.survivors.length, i18n.t('share.card.people')],
    [state.currentFloors, i18n.t('share.card.floors')],
  ];
  if (he) stats.reverse(); // right to left: the first number sits on the right
  ctx.direction = he ? 'rtl' : 'ltr';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0b0c0e';
  ctx.fillRect(0, IMG_H - 1, OUT_W, OUT_H - IMG_H + 1);
  // The picture fades into the card.
  const fade = ctx.createLinearGradient(0, IMG_H - 160, 0, IMG_H);
  fade.addColorStop(0, 'rgba(11,12,14,0)');
  fade.addColorStop(1, 'rgba(11,12,14,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, IMG_H - 160, OUT_W, 160);
  ctx.fillStyle = '#ffb547';
  ctx.fillRect(OUT_W / 2 - 60, IMG_H + 14, 120, 4);
  ctx.shadowColor = 'rgba(255,170,60,0.45)';
  ctx.shadowBlur = 26;
  ctx.fillStyle = '#f4ecd8';
  ctx.font = '700 96px Karantina, Rubik, sans-serif';
  ctx.fillText(he ? 'הבונקר האחרון' : 'THE LAST BUNKER', OUT_W / 2, IMG_H + 98);
  ctx.shadowBlur = 0;
  ctx.font = '600 36px Rubik, sans-serif';
  ctx.fillStyle = '#ffb547';
  ctx.fillText(actOf(state).name[locale], OUT_W / 2, IMG_H + 154);
  const cols = [OUT_W * 0.2, OUT_W * 0.5, OUT_W * 0.8];
  stats.forEach(([n, label], i) => {
    ctx.font = '700 92px Karantina, Rubik, sans-serif';
    ctx.fillStyle = '#f4ecd8';
    ctx.fillText(String(n), cols[i], IMG_H + 262);
    ctx.font = '500 30px Rubik, sans-serif';
    ctx.fillStyle = '#b9b2a2';
    ctx.fillText(label, cols[i], IMG_H + 308);
  });
}

async function buildPng(d: ShareDeps): Promise<Blob> {
  const shot = await captureOverview(d);
  await fontsReady();
  const out = document.createElement('canvas');
  out.width = OUT_W;
  out.height = OUT_H;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#0b0c0e';
  ctx.fillRect(0, 0, OUT_W, OUT_H);
  ctx.drawImage(shot, 0, 0, shot.width, shot.height, 0, 0, OUT_W, IMG_H);
  shot.width = shot.height = 0; // give the big extraction canvas back at once
  drawCard(ctx, d.getState());
  return new Promise<Blob>((resolve, reject) => out.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
}

/** A download: the fallback where the browser cannot share files (and a deliberate "save" choice everywhere). */
function download(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'the-last-bunker.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Makes the picture and opens the dialog with Share / Save. Safe to call from a button; one run at a time. */
export async function shareBunker(d: ShareDeps): Promise<void> {
  if (busy) return;
  busy = true;
  const veil = el('div', 'share-veil');
  veil.setAttribute('role', 'status');
  veil.append(el('div', 'share-veil-text', i18n.t('share.making')));
  document.body.appendChild(veil);
  let blob: Blob | null = null;
  try {
    await frames(2); // the veil is on screen before the camera moves under it
    blob = await buildPng(d);
  } catch (err) {
    console.warn('[plan4:GP-5] share picture failed', err);
    d.toast(`[[warning]] ${i18n.t('share.failed')}`, 'bad');
  } finally {
    veil.remove();
    busy = false;
  }
  if (!blob) return;
  const png = blob;
  const url = URL.createObjectURL(png);
  const img = el('img', 'share-preview');
  img.src = url;
  img.alt = i18n.t('share.menu');
  const body = el('div', 'share-body');
  body.append(img, el('p', 'bp-hint', i18n.t('share.hint')));
  const actions = [];
  if (canShareFiles()) {
    actions.push({
      label: `[[upload]] ${i18n.t('share.send')}`,
      onClick: () => {
        const file = new File([png], 'the-last-bunker.png', { type: 'image/png' });
        navigator.share({ files: [file], title: i18n.t('share.shareTitle'), text: i18n.t('share.shareText') })
          .then(() => d.modal.hide())
          .catch(() => undefined); // closing the share sheet is not an error: the dialog stays for another try
      },
    });
  }
  actions.push({
    label: `[[download]] ${i18n.t('share.download')}`,
    className: actions.length ? 'btn-secondary' : 'btn-primary',
    onClick: () => { download(png); d.modal.hide(); d.toast(`[[download]] ${i18n.t('share.saved')}`, 'good'); },
  });
  actions.push({ label: i18n.t('building.close'), className: 'btn-ghost', onClick: () => d.modal.hide() });
  d.modal.show({ title: i18n.t('share.menu'), body, actions, onDismiss: () => URL.revokeObjectURL(url) });
}
