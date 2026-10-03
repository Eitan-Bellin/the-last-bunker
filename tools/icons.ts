/**
 * Builds the app icons and the store feature graphic from the painted icon (art-src/raw/app-icon.png)
 * and the game's own paintings. Open /tools/icons.html?auto on the dev server.
 */

const log = document.getElementById('log')!;
const write = (s: string) => { log.textContent += `${s}\n`; };

async function load(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  return [c, ctx];
}

async function save(c: HTMLCanvasElement, path: string): Promise<void> {
  const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'));
  await fetch(`/__store/save/${path}`, { method: 'POST', body: blob });
  write(`${path}  ${c.width}x${c.height}  ${(blob.size / 1024).toFixed(0)} KB`);
  const img = document.createElement('img');
  img.src = URL.createObjectURL(blob);
  img.style.maxWidth = '260px';
  img.style.margin = '6px';
  document.body.appendChild(img);
}

/** The painting scaled down in halves for a clean small icon. */
function sized(src: CanvasImageSource & { width: number; height: number }, size: number, pad = 0, bg = '#0e0b08'): HTMLCanvasElement {
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  let cur: CanvasImageSource & { width: number; height: number } = src;
  while (cur.width / 2 >= size * (1 - pad * 2)) {
    const [h, hctx] = canvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
    hctx.drawImage(cur, 0, 0, h.width, h.height);
    cur = h;
  }
  const inner = size * (1 - pad * 2);
  ctx.drawImage(cur, size * pad, size * pad, inner, inner);
  return c;
}

async function run(): Promise<void> {
  log.textContent = '';
  await document.fonts.load('700 64px Karantina');
  await document.fonts.load('700 40px Rubik');
  const icon = await load('/__art/raw/raw/app-icon.png');
  await save(sized(icon, 512), 'public/icon-512.png');
  await save(sized(icon, 192), 'public/icon-192.png');
  await save(sized(icon, 180), 'public/apple-touch-icon.png');
  await save(sized(icon, 64), 'public/favicon-64.png');
  // Maskable: the round door inside the 80% safe zone on the bunker's dark steel.
  await save(sized(icon, 512, 0.1), 'public/icon-maskable-512.png');
  await save(sized(icon, 1024), 'store/icon-1024.png');

  // Feature graphic 1024×500: the surface panorama, the door, the title in both languages.
  const [f, ctx] = canvas(1024, 500);
  const back = await load('/art/backdrops/surface-2.webp');
  const s = Math.max(1024 / back.width, 500 / back.height);
  ctx.drawImage(back, (1024 - back.width * s) / 2, (500 - back.height * s) * 0.8, back.width * s, back.height * s);
  const shade = ctx.createLinearGradient(0, 0, 1024, 0);
  shade.addColorStop(0, 'rgba(6,5,4,0.85)');
  shade.addColorStop(0.55, 'rgba(6,5,4,0.35)');
  shade.addColorStop(1, 'rgba(6,5,4,0.1)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 1024, 500);
  ctx.save();
  ctx.beginPath();
  ctx.arc(820, 250, 190, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(icon, 820 - 210, 250 - 210, 420, 420);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,181,71,0.6)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(820, 250, 190, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f4ecd8';
  ctx.shadowColor = 'rgba(255,170,60,0.55)';
  ctx.shadowBlur = 24;
  ctx.font = '700 100px Karantina';
  ctx.fillText('THE LAST BUNKER', 48, 210);
  ctx.font = '700 96px Karantina';
  ctx.fillStyle = '#ffb547';
  ctx.fillText('הבונקר האחרון', 48, 320);
  ctx.shadowBlur = 0;
  ctx.font = '700 26px Rubik';
  ctx.fillStyle = 'rgba(244,236,216,0.85)';
  ctx.fillText('Rebuild. Survive. Remember.', 52, 380);
  await save(f, 'store/feature-graphic.png');
  write('done');
  (window as unknown as { __iconsDone: boolean }).__iconsDone = true;
}

if (new URLSearchParams(location.search).has('auto')) void run();
