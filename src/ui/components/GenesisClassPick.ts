import type { GameEngine } from '../../core/GameEngine';
import type { GameState } from '../../core/GameState';
import { i18n } from '../../i18n/I18nManager';
import { fmtNum } from '../format';
import { el } from '../dom';
import { kButton, setKButtonLabel } from '../kit';
import { uiSound } from '../../audio/uiSound';
import { CLASS_LINES, classDefs, upgradeCost, type PrestigeUpgradeDef } from '../../data/prestige';
import '../../styles/p5-g.css';

/**
 * [phase5] The class pick (strategy-systems C10, "keystones first"): at the start of the run after a Genesis, a full-screen choice of the
 * bunker's class (the founding keystones) with what each one changes in plain words. It is the first thing Isotope-7 buys: until a class
 * is owned the rest of the Genesis shop waits (MetaSystem.buy). Choosing takes two taps (it holds for every run to come); "Decide later"
 * leaves it on the Genesis tab. The overlay carries the `ceremony` class, so the dialog queue holds other dialogs back.
 */

/** [phase5] Whether the pick should open by itself now: a run that came from a Genesis, with no class and the Isotope-7 to buy one. */
export function classPickDue(engine: GameEngine, state: GameState): boolean {
  return state.prestige.rebirthCount > 0 && engine.metaSystem.classPickDue(state);
}

/** The class's name without the "Keystone:" prefix. */
export function className(def: PrestigeUpgradeDef): string {
  return (def.name[i18n.currentLocale] ?? def.name.en).replace(/^[^:]*:\s*/, '');
}

/** [phase5] The perk the previous ending gave this run, as one line (or '' on a first run). */
export function perkLine(engine: GameEngine, state: GameState): string {
  const p = engine.metaSystem.endingPerkOf(state);
  if (!p) return '';
  const locale = i18n.currentLocale;
  return i18n.t('p5g.cls.perk', { ending: `${p.ending.icon} ${p.ending.name[locale]}`, perk: p.perk.name[locale], desc: p.perk.desc[locale] });
}

export function showClassPick(engine: GameEngine, onDone: (chosen: string | null) => void = () => {}): void {
  document.querySelector('.p5g-cls')?.remove();
  const sm = engine.stateManager;
  const meta = engine.metaSystem;
  const locale = i18n.currentLocale;
  const overlay = el('div', 'ceremony block p5g-cls');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', i18n.t('p5g.cls.title'));
  const inner = el('div', 'p5g-cls__inner');
  inner.append(
    el('div', 'p5g-cls__kicker', `[[isotope7]] ${i18n.t('p5g.cls.kicker')}`),
    el('h2', 'p5g-cls__title', i18n.t('p5g.cls.title')),
    el('p', 'p5g-cls__hint', i18n.t('p5g.cls.hint', { n: fmtNum(meta.isotope(sm.state)) })),
  );
  const perk = perkLine(engine, sm.state);
  if (perk) inner.appendChild(el('p', 'p5g-cls__perk', perk));
  let closed = false;
  const close = (chosen: string | null) => {
    if (closed) return;
    closed = true;
    overlay.classList.remove('in');
    window.setTimeout(() => overlay.remove(), 300);
    onDone(chosen);
  };
  const grid = el('div', 'p5g-cls__grid');
  let armed: { id: string; btn: HTMLButtonElement; label: string } | null = null;
  for (const def of classDefs()) {
    const col = el('section', 'p5g-cls__col');
    col.append(
      el('div', 'p5g-cls__icon', def.icon),
      el('h3', 'p5g-cls__name', className(def)),
      el('div', 'p5g-cls__label', i18n.t('p5g.cls.lines')),
    );
    const ul = el('ul', 'p5g-cls__lines');
    for (const line of CLASS_LINES[def.id] ?? [def.desc]) ul.appendChild(el('li', '', line[locale] ?? line.en));
    col.appendChild(ul);
    const cost = upgradeCost(def, 0);
    const label = i18n.t('p5g.cls.choose', { n: fmtNum(cost) });
    const btn = kButton({
      variant: 'primary', className: 'btn-primary p5g-cls__choose', label,
      disabledReason: meta.isotope(sm.state) < cost ? i18n.t('p5g.cls.cant', { n: fmtNum(cost) }) : null,
      onPress: () => {
        if (!armed || armed.id !== def.id) {
          if (armed) setKButtonLabel(armed.btn, armed.label);
          armed = { id: def.id, btn, label };
          setKButtonLabel(btn, i18n.t('p5g.cls.confirm', { name: className(def) }));
          return;
        }
        // GameEngine.chooseClass (lead wiring) also brings the Founders' two people at once; MetaSystem alone when it is not wired.
        const choose = (engine as unknown as { chooseClass?: (id: string) => boolean }).chooseClass?.bind(engine) ?? ((id: string) => meta.chooseClass(id));
        if (choose(def.id)) {
          uiSound('confirm');
          engine.requestSave();
          close(def.id);
        }
      },
    });
    col.appendChild(btn);
    grid.appendChild(col);
  }
  inner.appendChild(grid);
  inner.appendChild(kButton({ variant: 'tertiary', className: 'btn-ghost p5g-cls__later', label: i18n.t('p5g.cls.later'), onPress: () => close(null) }));
  overlay.appendChild(inner);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('in'));
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
  requestAnimationFrame(() => overlay.querySelector<HTMLElement>('.p5g-cls__choose')?.focus());
}
