const { chromium } = require('/opt/node-tools/node_modules/playwright');
const lz = require('/home/user/last-bunker-qa/node_modules/lz-string/libs/lz-string.js');
const fs = require('fs');
const BASE = 'http://127.0.0.1:4310/';
process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
exports.lz = lz; exports.BASE = BASE;
exports.sample = () => { const s = JSON.parse(fs.readFileSync('/home/user/the-last-bunker/store/sim/saves-v6/e30-seed1.json', 'utf8')); s.storyFlags = [...new Set([...(s.storyFlags ?? []), 'intro:done', 'difficulty:chosen'])]; return s; };
exports.launch = async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox','--disable-background-networking','--disable-component-update','--no-pings','--disable-sync','--metrics-recording-only','--disable-default-apps'] });
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${String(e.message).slice(0, 300)}`));
  page.on('dialog', d => { logs.push(`[DIALOG ${d.type()}] ${d.message()}`); d.dismiss().catch(()=>{}); });
  const reqs = [];
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  page.on('request', r => reqs.push(r.url()));
  return { browser, ctx, page, logs, reqs };
};
exports.seed = async (page, state) => {
  await page.goto(BASE + 'accessibility.html');
  const packed = lz.compressToUTF16(typeof state === 'string' ? state : JSON.stringify(state));
  await page.evaluate(async (packed) => {
    await new Promise((res, rej) => {
      const o = indexedDB.open('keyval-store');
      o.onupgradeneeded = () => o.result.createObjectStore('keyval');
      o.onsuccess = () => { const tx = o.result.transaction('keyval', 'readwrite'); tx.objectStore('keyval').put(packed, 'lastbunker_auto'); tx.oncomplete = () => { o.result.close(); res(); }; tx.onerror = () => rej(tx.error); };
      o.onerror = () => rej(o.error);
    });
  }, packed);
};
exports.waitGame = async (page, ms = 150000) => { await page.waitForSelector('.nav-btn', { timeout: ms }); await page.waitForSelector('#splash', { state: 'detached', timeout: ms }).catch(()=>{}); await page.waitForTimeout(1500); for (let i=0;i<4;i++){ const b = await page.$('.modal.show button, .modal button'); if(!b) break; await b.evaluate(e=>e.click()); await page.waitForTimeout(600);} };
