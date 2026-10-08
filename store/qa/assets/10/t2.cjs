const L = require('./lib.cjs');
const lz = L.lz;
(async () => {
  const { browser, page, logs } = await L.launch();
  await L.seed(page, L.sample());
  await page.goto(L.BASE + '?debug');
  await L.waitGame(page);
  const imp = async (label, obj, opts = {}) => {
    const raw = typeof obj === 'string' ? obj : lz.compressToBase64(JSON.stringify(obj));
    const n0 = logs.length; const t = Date.now();
    const r = await page.evaluate(async (raw) => { try { const ok = await window.__engine.importState(raw); return { ok }; } catch (e) { return { threw: String(e && e.message || e).slice(0,200) }; } }, raw);
    await page.waitForTimeout(opts.wait ?? 4000);
    const xss = await page.evaluate(() => window.__xss ?? null);
    console.log(label, JSON.stringify(r), 'ms', Date.now() - t, 'xss', xss, 'newlogs:', logs.slice(n0).filter(l => /error|pageerror/i.test(l) && !/WebGL|ResizeObserver/.test(l)).slice(0, 3).join(' | '));
  };
  // XSS: names + hex injection
  const s = L.sample();
  s.survivors[0].name = '<img src=x onerror="window.__xss=1">[[vault]]{name}';
  s.explorationMap[0].x = '1" onmouseover="window.__xss=2" x="';
  await imp('B xss-names+hex', s);
  // open people panel + surface panel and hover
  const dom = await page.evaluate(() => {
    document.querySelector('.nav-btn[data-key="people"]')?.click();
    return null;
  });
  await page.waitForTimeout(3000);
  const seen = await page.evaluate(() => ({ imgs: document.querySelectorAll('img[src="x"]').length, hasText: document.body.innerText.includes('<img src=x') , xss: window.__xss ?? null }));
  console.log('  people panel after import:', JSON.stringify(seen));
  await page.evaluate(() => document.querySelector('.nav-btn[data-key="surface"]')?.click());
  await page.waitForTimeout(4000);
  const hex = await page.evaluate(() => { const g = [...document.querySelectorAll('.surface-overlay g.hex, g.hex')]; const bad = g.filter(e => e.hasAttribute('onmouseover')); if (bad[0]) bad[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return { hexes: g.length, injectedAttr: bad.length, xss: window.__xss ?? null }; });
  console.log('  surface hex injection:', JSON.stringify(hex));
  // Minimal save
  await imp('A minimal {resources,buildings,survivors}', { resources: {}, buildings: [], survivors: [] });
  const persisted = await page.evaluate(() => new Promise(res => { const o = indexedDB.open('keyval-store'); o.onsuccess = () => { const g = o.result.transaction('keyval').objectStore('keyval').get('lastbunker_auto'); g.onsuccess = () => res(g.result ? g.result.length : null); }; }));
  console.log('  main save length after minimal import:', persisted);
  console.log('  logs all errors:', logs.filter(l => /pageerror|\[error\]/.test(l) && !/WebGL|ResizeObserver/.test(l)).slice(0, 6).join(' | '));
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
