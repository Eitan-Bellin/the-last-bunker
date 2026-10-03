// Graphics overhaul G5: measures every room/hall/district/ruin painting (mean luminance and colour cast)
// and writes public/art/balance.json; the game tints each painting toward one shared exposure and white balance.
import { ART } from '../src/art/registry';
const out: Record<string, unknown> = {};
const lums: number[] = [];
const log = document.getElementById('log')!;
for (const e of ART.filter(a => ['room', 'hall', 'district', 'ruin'].includes(a.kind))) {
  const img = new Image();
  img.src = `/art/${e.key}.webp`;
  // onload, not decode(): decode() never settles in a background tab.
try { await new Promise((res, rej) => { img.onload = res; img.onerror = rej; }); } catch { continue; }
  const c = document.createElement('canvas');
  c.width = 96; c.height = Math.round(96 * img.height / img.width);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let r = 0, g = 0, b = 0, n = 0, hi = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    if (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2] > 215) hi++;
  }
  r /= n; g /= n; b /= n;
  const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
  out[e.key] = { lum: +lum.toFixed(3), rgb: [Math.round(r), Math.round(g), Math.round(b)], hot: +(hi / n).toFixed(3) };
  if (e.kind === 'room') lums.push(lum);
  log.textContent += `${e.key.padEnd(28)} lum ${lum.toFixed(3)}  rgb ${[r, g, b].map(Math.round).join(',')}  blown ${(hi / n * 100).toFixed(1)}%\n`;
}
lums.sort((a, b) => a - b);
out._target = +lums[Math.floor(lums.length * 0.4)].toFixed(3);
await fetch('/__art/save/balance.json', { method: 'POST', body: JSON.stringify(out) });
log.textContent += `target ${out._target}\ndone\n`;
(window as unknown as { __lumDone: boolean }).__lumDone = true;
