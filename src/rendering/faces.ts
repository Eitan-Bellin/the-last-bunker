import { Texture } from 'pixi.js';

/**
 * Plan 2026-10 M4: readable faces for the 3D bodies. The pre-rendered heads are about 20 px wide (80 px per metre), so the
 * eyes, brows and mouth of the render were two-pixel smudges. They are no longer part of the render: the game draws them on a
 * small overlay at four times the resolution, in three moods and with the eyes open or closed (blinking, sleeping), shared by
 * every body (the sprite is scaled by the body's head size). Placed by the same camera maths the people tool uses (yaw 18
 * degrees, elevation 7 degrees, 80 px per metre), relative to the head joint, so it moves and tilts with the head like the hair.
 */
export type FaceMood = 'happy' | 'neutral' | 'sad';

/** Head size of each body type (tools/people3d-rig.ts `headS`): the overlay scales with it. */
export const HEAD_SCALE = { man: 1.05, woman: 1.0, child: 0.95, elder: 1.03 } as const;

const SS = 4; // texture pixels per render pixel
const N = 24; // render pixels per side (the head joint is in the middle)

const cache = new Map<string, Texture>();

/** One face overlay texture (white sclera and dark ink; the figure's own tint lights it). */
export function faceTexture(mood: FaceMood, closed: boolean): Texture {
  const key = `${mood}|${closed ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = N * SS;
  const g = c.getContext('2d')!;
  g.scale(SS, SS);
  g.translate(N / 2, N / 2);
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // Eyes: the near one at the front of the cheek, the far one a little further along and smaller (a three-quarter view).
  const eye = (x: number, y: number, k: number, near: boolean) => {
    if (closed) {
      g.strokeStyle = 'rgba(30,20,14,0.85)';
      g.lineWidth = 0.42 * k;
      g.beginPath();
      g.moveTo(x - 1.2 * k, y - 0.1 * k);
      g.quadraticCurveTo(x, y + 0.7 * k, x + 1.2 * k, y - 0.15 * k);
      g.stroke();
      return;
    }
    // Lid shadow, white of the eye, iris, pupil, highlight.
    g.fillStyle = near ? '#ece6d8' : '#cfc8b8';
    g.beginPath();
    g.ellipse(x, y, 1.3 * k, (mood === 'happy' ? 0.78 : mood === 'sad' ? 0.88 : 0.95) * k, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3a2a1c';
    g.beginPath();
    g.arc(x + 0.35 * k, y + 0.05 * k, 0.74 * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0c0806';
    g.beginPath();
    g.arc(x + 0.4 * k, y + 0.05 * k, 0.4 * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.arc(x + 0.12 * k, y - 0.28 * k, 0.2 * k, 0, Math.PI * 2);
    g.fill();
    // Upper lid line.
    g.strokeStyle = 'rgba(28,18,12,0.8)';
    g.lineWidth = 0.22 * k;
    g.beginPath();
    g.moveTo(x - 1.25 * k, y + 0.05 * k);
    g.quadraticCurveTo(x, y - 1.05 * k, x + 1.25 * k, y + 0.1 * k);
    g.stroke();
  };
  eye(4.7, -7.8, 1, true);
  eye(6.6, -7.9, 0.66, false);

  // Brows: level and calm, lifted when happy, the inner (front) end raised when sad.
  g.strokeStyle = 'rgba(52,36,24,0.62)';
  const brow = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo((x0 + x1) / 2, Math.min(y0, y1) - 0.45, x1, y1);
    g.stroke();
  };
  const dy = mood === 'happy' ? -0.35 : 0;
  const inner = mood === 'sad' ? -0.85 : mood === 'happy' ? -0.2 : 0;
  brow(3.7, -9.7 + dy, 6.4, -10.1 + dy + inner, 0.34);
  brow(5.9, -9.9 + dy, 7.8, -10.2 + dy + inner, 0.26);

  // Mouth: a short line, a smile or a frown, with a darker lip line.
  g.strokeStyle = 'rgba(86,40,32,0.85)';
  g.lineWidth = 0.42;
  g.beginPath();
  if (mood === 'happy') {
    g.moveTo(6.2, -3.55);
    g.quadraticCurveTo(7.6, -2.1, 8.8, -3.75);
  } else if (mood === 'sad') {
    g.moveTo(6.4, -2.9);
    g.quadraticCurveTo(7.6, -4.2, 8.7, -3.05);
  } else {
    g.moveTo(6.5, -3.35);
    g.quadraticCurveTo(7.6, -3.1, 8.6, -3.5);
  }
  g.stroke();
  const t = Texture.from(c);
  cache.set(key, t);
  return t;
}
