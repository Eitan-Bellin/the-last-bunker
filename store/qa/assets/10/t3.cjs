const L = require('./lib.cjs');
(async () => {
  // Boot with a minimal / null-building save as the main save
  for (const [label, st] of [['minimal', { resources: {}, buildings: [], survivors: [] }], ['buildings:[null]', { resources: {}, buildings: [null], survivors: [] }]]) {
    const { browser, page, logs } = await L.launch();
    await L.seed(page, st);
    await page.goto(L.BASE);
    let up = true;
    try { await page.waitForSelector('.nav-btn', { timeout: 100000 }); } catch { up = false; }
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => ({ splash: !!document.getElementById('splash'), modal: (document.querySelector('.modal')?.innerText || '').slice(0, 160), body: document.body.innerText.slice(0, 160) }));
    console.log('BOOT', label, 'hud:', up, JSON.stringify(info), 'errors:', logs.filter(l => /pageerror|crashGuard/.test(l)).slice(0, 2).join(' | ').slice(0, 300));
    await browser.close();
  }
  // Size bomb through the import path
  const { browser, page, logs } = await L.launch();
  await L.seed(page, L.sample());
  await page.goto(L.BASE + '?debug');
  await L.waitGame(page);
  const big = JSON.stringify({ resources: {}, buildings: [], survivors: [], junk: 'a'.repeat(40 * 1024 * 1024) });
  const raw = L.lz.compressToBase64(big);
  console.log('bomb: compressed chars', raw.length, 'decompressed bytes', big.length);
  const r = await page.evaluate((raw) => { const t = performance.now(); const o = window.__engine.saveManager.importSave(raw); return { ok: !!o, ms: Math.round(performance.now() - t) }; }, raw);
  console.log('bomb importSave (sync, main thread):', JSON.stringify(r));
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
