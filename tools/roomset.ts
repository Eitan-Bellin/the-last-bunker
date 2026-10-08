// Plan 2026-10 M1: review sheet for the room set data (src/rendering/roomSet.ts). Open /tools/roomset.html on the dev server.
import { ROOM_SET } from '../src/rendering/roomSet';

const outs = document.getElementById('outs')!;
const cells: HTMLCanvasElement[] = [];
const SCALE = 0.6;

for (const [key, def] of Object.entries(ROOM_SET)) {
  const img = new Image();
  img.src = `/art/${key}.webp`;
  await new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); });
  const w = Math.round(img.width * SCALE), h = Math.round(img.height * SCALE);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, w, h);
  g.font = '11px monospace';
  g.fillStyle = '#0ff';
  g.fillText(key, 4, h - 6);
  // A body is 1.8 m: about 0.34 of a three-slot room's width.
  for (const b of def.beds ?? []) {
    const len = 0.34 * w;
    const x = b.x * w, y = b.y * h;
    g.strokeStyle = '#ff0';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x - len / 2, y);
    g.lineTo(x + len / 2, y);
    g.stroke();
    g.fillStyle = '#f0f';
    g.beginPath();
    g.arc(x + (b.head * len) / 2, y - 2, 4, 0, Math.PI * 2);
    g.fill();
  }
  for (const s of def.seats ?? []) {
    const x = s.x * w, y = s.y * h;
    g.strokeStyle = s.kind === 'eat' ? '#6f6' : '#6cf';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.moveTo(x, y);
    g.lineTo(x + s.face * 14, y);
    g.stroke();
  }
  for (const poly of def.front ?? []) {
    g.strokeStyle = '#f33';
    g.lineWidth = 2;
    g.beginPath();
    poly.forEach(([px, py], i) => (i ? g.lineTo(px * w, py * h) : g.moveTo(px * w, py * h)));
    g.closePath();
    g.stroke();
  }
  outs.appendChild(c);
  cells.push(c);
}

if (new URLSearchParams(location.search).has('auto')) {
  const cols = 3;
  const cw = Math.max(...cells.map(c => c.width)), ch = Math.max(...cells.map(c => c.height));
  const sheet = document.createElement('canvas');
  sheet.width = cols * cw;
  sheet.height = Math.ceil(cells.length / cols) * ch;
  const sg = sheet.getContext('2d')!;
  cells.forEach((c, i) => sg.drawImage(c, (i % cols) * cw, Math.floor(i / cols) * ch));
  const blob = await new Promise<Blob>(r => sheet.toBlob(b => r(b!), 'image/png'));
  await fetch('/__store/save/store/compare/p2-b/rsd-sheet.png', { method: 'POST', body: blob });
}
(window as unknown as { __done: boolean }).__done = true;
