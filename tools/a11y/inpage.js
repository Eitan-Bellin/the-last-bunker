// Runs INSIDE the page (evaluated by audit.mjs). Returns a plain object of findings for the current DOM.
(() => {
  const VW = window.innerWidth, VH = window.innerHeight;
  const out = { targets: [], contrast: [], noName: [], noAlt: [], overflow: [], modals: [], docOverflow: document.documentElement.scrollWidth > VW + 1 };
  const sel = (e) => {
    let s = e.tagName.toLowerCase();
    if (e.id) s += '#' + e.id;
    const c = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.') : '';
    if (c) s += '.' + c;
    const p = e.parentElement;
    if (p && p !== document.body) { const pc = typeof p.className === 'string' ? p.className.trim().split(/\s+/)[0] : ''; if (pc) s = pc + ' > ' + s; }
    return s;
  };
  const dead = (e) => !!e.closest('.sheet-overlay:not(.open), .modal-overlay:not(.open), .surface-overlay:not(.open), [hidden], [inert]');
  const visible = (e) => {
    if (dead(e)) return false;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false;
    }
    return getComputedStyle(e).pointerEvents !== 'none' || e.matches('input,button,a');
  };
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, bot) => { const a = top.a + bot.a * (1 - top.a); if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 }; return { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  /** Background behind an element: composites each ancestor's background-color from the nearest opaque one down to the element. */
  const backdrop = (e) => {
    const layers = []; let approx = false, grad = false, opaque = false;
    for (let n = e; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !grad) {
        // CSS lists the top layer first: judge against the bottom-most layer that has opaque colour stops (rivets and sheens on top are thin).
        const parts = []; let depth = 0, cur = '';
        for (const ch of cs.backgroundImage) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
        parts.push(cur);
        grad = true;
        for (let i = parts.length - 1; i >= 0; i--) {
          const stops = (parts[i].match(/rgba?\([^)]+\)/g) || []).map(parse).filter(g => g && g.a >= 0.9);
          if (stops.length) { grad = stops; break; }
        }
      }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 0.9) { opaque = true; break; } }
    }
    // No opaque ancestor: the HUD floats over the canvas, so the real backdrop is the picture; assume the page colour and flag it.
    let acc = opaque ? layers.pop() : { r: 11, g: 12, b: 14, a: 1 };
    if (!opaque) approx = true;
    while (layers.length) acc = over(layers.pop(), acc);
    return { c: acc, approx, grad, stops: Array.isArray(grad) ? grad.map(g => { let a = over(g, acc); a.a = 1; return a; }) : null };
  };
  const accName = (e) => {
    const al = (e.getAttribute('aria-label') || '').trim(); if (al) return al;
    const lb = e.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\s+/).map(i => document.getElementById(i)?.textContent || '').join(' ').trim(); if (t) return t; }
    if (e.tagName === 'INPUT' || e.tagName === 'SELECT' || e.tagName === 'TEXTAREA') {
      if (e.labels && e.labels.length) return [...e.labels].map(l => l.textContent).join(' ').trim();
      return (e.getAttribute('title') || '').trim();
    }
    let t = '';
    const walk = (n) => { for (const ch of n.childNodes) { if (ch.nodeType === 3) t += ch.textContent; else if (ch.nodeType === 1 && ch.getAttribute('aria-hidden') !== 'true') { if (ch.tagName === 'IMG' && ch.alt) t += ch.alt; else if (ch.getAttribute('aria-label')) t += ch.getAttribute('aria-label'); else walk(ch); } } };
    walk(e);
    t = t.trim(); if (t) return t;
    return (e.getAttribute('title') || '').trim();
  };
  const INTERACTIVE = 'button, a[href], [role=button], [role=tab], [role=menuitem], input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  const seen = new Set();
  for (const e of document.querySelectorAll(INTERACTIVE)) {
    if (seen.has(e) || !visible(e)) continue; seen.add(e);
    const r = e.getBoundingClientRect();
    if (r.width < 43.5 || r.height < 43.5) out.targets.push({ sel: sel(e), w: Math.round(r.width), h: Math.round(r.height), text: accName(e).slice(0, 30) });
    if (!accName(e)) out.noName.push({ sel: sel(e), w: Math.round(r.width), h: Math.round(r.height) });
  }
  for (const e of document.querySelectorAll('img, svg[role=img], [role=img]')) {
    if (dead(e) || e.closest('[aria-hidden=true]')) continue;
    const r = e.getBoundingClientRect(); if (r.width < 1) continue;
    if (e.tagName === 'IMG') { if (!e.hasAttribute('alt')) out.noAlt.push({ sel: sel(e) }); }
    else if (!accName(e)) out.noAlt.push({ sel: sel(e) });
  }
  // Text contrast: every element that owns a non-blank text node.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const done = new Set();
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.textContent.trim()) continue;
    const e = t.parentElement;
    if (!e || done.has(e) || e.closest('script,style,canvas,[aria-hidden=true]')) continue;
    done.add(e);
    if (!visible(e) && !e.closest('button,a')) continue;
    if (!visible(e)) continue;
    const cs = getComputedStyle(e);
    let fg = parse(cs.color); if (!fg) continue;
    let op = 1; for (let n = e; n && n !== document.documentElement; n = n.parentElement) op *= +getComputedStyle(n).opacity;
    fg = { ...fg, a: fg.a * op };
    const bd = backdrop(e);
    const eff = over(fg, bd.c);
    let cr = ratio(eff, bd.c);
    // A gradient background: judge the text against its worst colour stop.
    if (bd.stops) for (const st of bd.stops) cr = Math.min(cr, ratio(over(fg, st), st));
    const px = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (cr < need) out.contrast.push({ sel: sel(e), ratio: +cr.toFixed(2), need, px: Math.round(px * 10) / 10, approx: bd.approx || (bd.grad && !bd.stops), text: t.textContent.trim().slice(0, 24) });
  }
  // Horizontal overflow of visible elements, ignoring ones clipped by a scroller/overflow:hidden ancestor that itself fits.
  const clipped = (e) => { for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) { const c = getComputedStyle(n); if (c.overflowX !== 'visible') { const r = n.getBoundingClientRect(); if (r.right <= VW + 1 && r.left >= -1) return true; } } return false; };
  for (const e of document.querySelectorAll('.hud-top *, .hud-bottom, .hud-bottom *, .sheet *, .modal *, .toast, .toast-stack *, .hud-banner, .objective')) {
    if (!visible(e)) continue;
    const r = e.getBoundingClientRect();
    if ((r.right > VW + 1 || r.left < -1) && !clipped(e)) out.overflow.push({ sel: sel(e), left: Math.round(r.left), right: Math.round(r.right) });
  }
  // Open dialogs: the last action must be on screen.
  for (const m of document.querySelectorAll('.modal-overlay.open .modal')) {
    const btns = [...m.querySelectorAll('.modal-actions button')];
    const last = btns[btns.length - 1]; if (!last) continue;
    const r = last.getBoundingClientRect();
    if (r.bottom > VH + 0.5 || r.top < 0 || r.right > VW + 1 || r.left < -1) out.modals.push({ sel: sel(last), bottom: Math.round(r.bottom), vh: VH });
  }
  for (const s of document.querySelectorAll('.sheet-overlay.open .sheet')) {
    const c = s.querySelector('.sheet-close'); if (!c) continue;
    const r = c.getBoundingClientRect();
    if (r.bottom > VH || r.top < 0 || r.right > VW + 1 || r.left < -1) out.modals.push({ sel: 'sheet-close', bottom: Math.round(r.bottom), vh: VH });
  }
  return out;
})()
