/**
 * [phase1 cheat] DEV-only playthrough kit: walk the whole game fast and count what interrupts the player.
 *
 * Console (dev server, `?slot=<name>&debug`, never the real save):
 *   __pt.stages()          stage saves made by `node tools/playthrough.mjs` (store/playthrough/saves/d<N>-seed1.json)
 *   __pt.load('d10')       loads that stage into the current slot and reloads
 *   __pt.speed(10)         game runs 10x (1 = normal; max 50)
 *   __pt.reset()           clears the interruption log
 *   __pt.report()          what interrupted the player since the page opened / reset: dialogs, story, spotlights, toasts
 *
 * Everything is observed from the DOM (no UI code is changed), so the counts match what the player sees.
 */

interface Hit { kind: 'dialog' | 'story' | 'spotlight' | 'toast' | 'sheet'; text: string; wall: number; game: number }

const STAGES = ['d1', 'd4', 'd10', 'd20', 'd35', 'd50', 'd70'];

export function installPlaythrough(getPlayTime: () => number): void {
  const log: Hit[] = [];
  let t0 = performance.now();
  let g0 = getPlayTime();
  const text = (e: Element) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 90);
  const push = (kind: Hit['kind'], e: Element) => log.push({ kind, text: text(e), wall: (performance.now() - t0) / 1000, game: getPlayTime() - g0 });

  const opened = (e: Element, cls: string) => e.classList.contains(cls);
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'attributes' && m.target instanceof HTMLElement) {
        const el = m.target;
        const was = (m.oldValue ?? '').split(/\s+/);
        if (el.classList.contains('modal-overlay') && opened(el, 'open') && !was.includes('open')) push('dialog', el);
        else if (el.classList.contains('story-overlay') && opened(el, 'open') && !was.includes('open')) push('story', el);
        else if (el.classList.contains('ob-spot') && opened(el, 'in') && !was.includes('in')) push('spotlight', el);
        else if (el.classList.contains('sheet-overlay') && opened(el, 'open') && !was.includes('open')) push('sheet', el);
      }
      if (m.type === 'childList') {
        for (const n of m.addedNodes) if (n instanceof HTMLElement && n.classList.contains('toast')) queueMicrotask(() => push('toast', n));
      }
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });

  const w = window as unknown as Record<string, unknown>;
  w.__pt = {
    stages: () => STAGES,
    speed: (n: number) => { w.__speed = Math.max(1, Math.min(50, n)); return w.__speed; },
    async load(stage: string) {
      const res = await fetch(`/store/playthrough/saves/${stage}-seed1.json`);
      if (!res.ok) throw new Error(`no stage save ${stage}: run node tools/playthrough.mjs`);
      for (let i = 0; i < 80 && !w.__engine; i++) await new Promise(r => setTimeout(r, 250));
      const engine = w.__engine as { importState(s: string): Promise<boolean>; forceSave(): Promise<void>; saveManager: { exportSave(o: unknown): string } };
      if (!(await engine.importState(engine.saveManager.exportSave(await res.json())))) throw new Error(`stage ${stage} was refused`);
      await engine.forceSave();
      setTimeout(() => location.reload(), 300);
      return `loading ${stage}`;
    },
    reset() { log.length = 0; t0 = performance.now(); g0 = getPlayTime(); return 'reset'; },
    log: () => log.slice(),
    /** A naive new player: answers dialogs with their main button, follows the "next step" strip and presses a sheet's main
     *  button. Starts the game through intro and difficulty if needed. `__pt.autoplay(false)` stops. */
    autoplay(on = true) {
      clearInterval(w.__ptAuto as number);
      if (!on) return 'off';
      const vis = (e: Element | null): e is HTMLElement => {
        if (!e || !e.isConnected) return false;
        const cs = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && r.width > 0 && r.height > 0;
      };
      const press = (b: HTMLElement) => b.click(); // kit buttons accept script clicks (detail 0)
      let tick = 0;
      let lastPressed: HTMLElement | null = null;
      w.__ptAuto = setInterval(() => {
        tick++;
        const intro = document.querySelector<HTMLElement>('.intro');
        if (intro && intro.isConnected && getComputedStyle(intro).display !== 'none' && getComputedStyle(intro).opacity !== '0') {
          const skip = intro.querySelector<HTMLElement>('.intro-skip');
          press(skip && vis(skip) ? skip : intro); // skip the story, then tap the gate to enter
          return;
        }
        const story = [...document.querySelectorAll('.story-overlay.open')].find(vis);
        if (story) { // a chapter: take the first choice, else skip the scene, else tap to the next line
          const choice = [...story.querySelectorAll<HTMLElement>('.story-choice')].find(b => vis(b) && !b.classList.contains('is-disabled'));
          const skip = story.querySelector<HTMLElement>('.story-skip');
          if (choice) press(choice);
          else if (skip && vis(skip)) press(skip);
          else (story.lastElementChild as HTMLElement | null ?? story).click();
          return;
        }
        const modal = [...document.querySelectorAll('.modal-overlay.open')].find(vis);
        if (modal) {
          const bs = [...modal.querySelectorAll<HTMLElement>('button')].filter(b => vis(b) && !b.classList.contains('is-disabled'));
          const main = bs.find(b => b.classList.contains('btn-primary') || b.classList.contains('k-btn--primary')) ?? bs[0];
          if (main) press(main);
          return;
        }
        const sheet = [...document.querySelectorAll('.sheet-overlay.open')].find(vis);
        if (sheet) {
          const main = [...sheet.querySelectorAll<HTMLElement>('.k-btn--primary, .btn-primary')].find(b => vis(b) && !b.classList.contains('is-disabled'));
          if (main && main !== lastPressed) { lastPressed = main; press(main); } // each main button once, then close the sheet
          else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          return;
        }
        if (tick % 3 === 0) {
          const app = w.__app as { onboarding?: { advisor?: { advice(force: boolean): { go(): void } } } } | undefined;
          try { app?.onboarding?.advisor?.advice(true).go(); } catch { /* the strip may be empty */ }
        }
      }, 1500);
      return 'on';
    },
    report() {
      const count = (k: Hit['kind']) => log.filter(h => h.kind === k).length;
      const blocking = log.filter(h => h.kind === 'dialog' || h.kind === 'story');
      return {
        wallSeconds: Math.round((performance.now() - t0) / 1000),
        gameMinutes: Math.round((getPlayTime() - g0) / 60),
        dialogs: count('dialog'), story: count('story'), spotlights: count('spotlight'), toasts: count('toast'), sheets: count('sheet'),
        blocking: blocking.map(h => `${Math.round(h.game / 60)}m ${h.kind}: ${h.text}`),
      };
    },
  };
}
