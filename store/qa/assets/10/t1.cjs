const L = require('./lib.cjs');
(async () => {
  for (const q of ['', '?debug']) {
    const { browser, page, logs, reqs } = await L.launch();
    await L.seed(page, L.sample());
    await page.goto(L.BASE + q);
    console.log('waiting game'); await L.waitGame(page); console.log('game up');
    const info = await page.evaluate(() => ({
      globals: Object.keys(window).filter(k => k.startsWith('__') || /engine|renderer|perf/i.test(k)),
      engine: typeof window.__engine,
      perf2: typeof window.__perf2,
    }));
    console.log('QUERY', JSON.stringify(q), JSON.stringify(info));
    // open menu
    await page.evaluate(()=>document.querySelector('.nav-menu').click());
    await page.waitForTimeout(800);
    const coupon = await page.evaluate(() => ({ codeInput: !!document.querySelector('.coupon-code'), text: [...document.querySelectorAll('.bp-section-title')].map(e => e.textContent).filter(t => /קופון|coupon|code|קוד/i.test(t)) }));
    console.log('  coupon UI', JSON.stringify(coupon));
    if (q) {
      await page.evaluate(()=>{const i=document.querySelector('.coupon-code'); i.value='bunker 17'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));});
      await page.waitForTimeout(800);
      const sheet = await page.evaluate(() => ({ open: !!document.querySelector('#coupon-sheet.show, .coupon-amount'), amounts: document.querySelectorAll('.coupon-amount').length }));
      console.log('  coupon sheet after "bunker 17":', JSON.stringify(sheet));
      const r = await page.evaluate(() => { const e = window.__engine; const s = e.stateManager.state; const before = { food: s.resources.food.amount, cap: s.resources.food.cap, credits: s.resources.credits?.amount, iso: s.resources.isotope7?.amount }; e.stateManager.applyDelta({ path: 'resources.credits.amount', value: 999999 }); e.stateManager.applyDelta({ path: 'resources.isotope7.amount', value: 500 }); return { before, after: { credits: s.resources.credits.amount, iso: s.resources.isotope7.amount } }; });
      console.log('  console edit', JSON.stringify(r));
      await page.screenshot({ path: '/home/user/the-last-bunker/store/qa/assets/10/debug-coupon.png'}).catch(()=>{});
    }
    const ext = reqs.filter(u => !u.startsWith(L.BASE));
    console.log('  external requests:', JSON.stringify([...new Set(ext.map(u => new URL(u).host))]));
    console.log('  logs:', logs.filter(l => !/Failed to load resource/.test(l)).slice(0, 8).join(' | '));
    await browser.close();
  }
})().catch(e => { console.error('ERR', e); process.exit(1); });
