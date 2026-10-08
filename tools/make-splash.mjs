// [plan4:UX-18] iPhone launch images ("apple-touch-startup-image"): without them an installed home-screen app shows a blank white
// screen between the tap on the icon and the first paint. One flat #07090c picture with the app icon in the middle per phone size.
//
//   node tools/make-splash.mjs            # writes public/splash/s-<w>x<h>.png and prints the <link> tags for index.html
//
// No dependencies: it drives headless Chrome through the same small client as the performance tools (tools/perf/lib.mjs) and takes
// screenshots at the exact pixel size. Nothing in the game or in any save is touched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './perf/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'splash');
fs.mkdirSync(out, { recursive: true });

// CSS width x height, device pixel ratio (the media query of each iPhone generation).
const SIZES = [
  [375, 667, 2], // SE (2nd/3rd gen), 8
  [414, 736, 3], // 8 Plus
  [375, 812, 3], // X, XS, 11 Pro, 12/13 mini
  [414, 896, 2], // XR, 11
  [414, 896, 3], // XS Max, 11 Pro Max
  [390, 844, 3], // 12, 13, 14
  [428, 926, 3], // 12/13 Pro Max, 14 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [430, 932, 3], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  [402, 874, 3], // 16 Pro
  [440, 956, 3], // 16 Pro Max
];

const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'public', 'icon-512.png')).toString('base64');
const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#07090c}
body{display:flex;align-items:center;justify-content:center}img{width:34vmin;max-width:160px;border-radius:22%}</style><img src="${icon}">`;

const c = await launch();
const links = [];
try {
  await c.send('Page.enable');
  await c.send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
  await sleep(800);
  for (const [w, h, dpr] of SIZES) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true });
    await sleep(500);
    const shot = await c.send('Page.captureScreenshot', { format: 'png' });
    const name = `s-${w * dpr}x${h * dpr}.png`;
    fs.writeFileSync(path.join(out, name), Buffer.from(shot.data, 'base64'));
    links.push(`  <link rel="apple-touch-startup-image" href="./splash/${name}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" />`);
    console.log('wrote', name, fs.statSync(path.join(out, name)).size, 'bytes');
  }
} finally {
  c.close();
}
console.log('\n' + links.join('\n'));
