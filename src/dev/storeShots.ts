import { Rectangle, type Application } from 'pixi.js';

/**
 * Dev-only: composes store screenshots (1080×1920) from the live game picture with a caption band,
 * and saves them through the dev server into store/screenshots. Never included in production builds.
 */
export function installStoreShots(app: Application): void {
  const w = window as unknown as Record<string, unknown>;
  w.__shot = async (name: string, title: string, sub = '', image?: string, whole = false) => {
    await document.fonts.load('700 64px Karantina');
    const W = 1080, H = 1920, BAND = 330;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#07090c';
    ctx.fillRect(0, 0, W, H);
    let src: CanvasImageSource & { width: number; height: number };
    if (image) {
      const img = new Image();
      img.src = image;
      await img.decode();
      src = img;
    } else {
      // The visible screen by default; the whole world (sky to bedrock) for the overview shot.
      src = app.renderer.extract.canvas({
        target: app.stage, resolution: 2,
        ...(whole ? {} : { frame: new Rectangle(0, 0, app.screen.width, app.screen.height) }),
      }) as HTMLCanvasElement;
    }
    // Fill below the caption band; the world shot keeps its full width and sits at the bottom.
    const s = whole ? Math.max(W / src.width, (H - 160) / src.height) : Math.max(W / src.width, (H - BAND) / src.height);
    const dw = src.width * s, dh = src.height * s;
    ctx.drawImage(src, (W - dw) / 2, whole ? H - dh : BAND + (H - BAND - dh) / 2, dw, dh);
    const band = ctx.createLinearGradient(0, 0, 0, BAND + 120);
    band.addColorStop(0, 'rgba(7,9,12,1)');
    band.addColorStop(0.72, 'rgba(7,9,12,0.96)');
    band.addColorStop(1, 'rgba(7,9,12,0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, W, BAND + 120);
    const rtl = /[֐-׿]/.test(title);
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f4ecd8';
    ctx.shadowColor = 'rgba(255,170,60,0.5)';
    ctx.shadowBlur = 30;
    ctx.font = '700 104px Karantina';
    ctx.fillText(title, W / 2, 170);
    ctx.shadowBlur = 0;
    if (sub) {
      ctx.font = '600 38px Rubik';
      ctx.fillStyle = '#ffb547';
      ctx.fillText(sub, W / 2, 250);
    }
    const blob = await new Promise<Blob>(r => c.toBlob(b => r(b!), 'image/png'));
    await fetch(`/__store/save/store/screenshots/${name}.png`, { method: 'POST', body: blob });
    return `${name}.png ${(blob.size / 1024).toFixed(0)} KB`;
  };
}
