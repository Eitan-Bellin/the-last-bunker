import { i18n } from '../../i18n/I18nManager';
import { RESOURCE_ICONS, costRow, el } from '../../ui/dom';
import type { ResourceType } from '../../core/GameState';
import { districtDef, nextDistrict } from '../../data/districts';
import type { GameApp } from '../../app';

/** Digging new floors and breaking through to districts. */
export class DigController {
  private app: GameApp;

  constructor(app: GameApp) {
    this.app = app;
  }

  updateDigSign(): void {
    const state = this.app.state;
    const bs = this.app.engine.buildingSystem;
    const cost = bs.digCost(state);
    // [Economy] M2: when the price is bigger than storage can hold, the sign says so instead of showing an unreachable cost.
    const over = bs.digOverCap(state);
    const costText = over
      ? `[[storage]] ${i18n.t('dig.needStorage', { cap: over.cap, cost: over.cost })}`
      : (Object.entries(cost) as [ResourceType, number][]).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''} ${v}`).join('   ');
    this.app.renderer.setDigSign(bs.canDig(state), i18n.t('dig.title', { n: state.currentFloors + 1 }), costText);
    const next = nextDistrict(state);
    this.app.renderer.setDistrictSign(next ? {
      floor: next.floor,
      text: i18n.t('district.dig', { name: next.name[i18n.currentLocale] }),
      cost: (Object.entries(next.cost) as [ResourceType, number][]).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''} ${v}`).join('   '),
    } : null);
  }

  /** Tunnel sideways into the next natural cavern. */
  confirmDistrictDig(): void {
    const state = this.app.state;
    const next = nextDistrict(state);
    if (!next) return;
    const affordable = this.app.engine.resourceSystem.canAfford(state, next.cost as Record<string, number>);
    this.app.modal.show({
      icon: '[[pick]]',
      title: i18n.t('district.title'),
      body: i18n.t('district.body', { floor: next.floor + 1 }),
      actions: [
        {
          label: i18n.t('district.yes'),
          className: 'btn-primary',
          disabled: !affordable,
          detail: costRow(state, next.cost as Record<string, number>),
          onClick: () => {
            this.app.modal.hide();
            if (!this.app.engine.resourceSystem.spend(this.app.engine.stateManager, next.cost as Record<string, number>)) return;
            const b = this.app.engine.buildingSystem.digDistrict(this.app.engine.stateManager, next.kind);
            this.app.engine.requestSave();
            this.app.audio.play('drill');
            if (b) {
              const c = this.app.renderer.roomCenter(b);
              this.app.renderer.focusOn(c.x, c.y + 26, 1.3);
            }
          },
        },
        { label: i18n.t('placement.cancel'), className: 'btn-secondary', onClick: () => this.app.modal.hide() },
      ],
    });
  }

  /** The tunnel broke through: reveal the cavern with its painting. */
  showDistrictFound(kind: string): void {
    const d = districtDef(kind);
    if (!d) return;
    const locale = i18n.currentLocale;
    const body = el('div', 'modal-result');
    const img = el('img', 'biome-art');
    img.src = `${import.meta.env.BASE_URL}art/districts/${kind}.webp`;
    img.alt = '';
    body.append(img, el('p', 'modal-body', d.find[locale]));
    this.app.audio.play('era');
    this.app.modal.show({
      icon: `[[${d.icon}]]`,
      title: i18n.t('district.found', { name: d.name[locale] }),
      body,
      actions: [{ label: i18n.t('event.ok'), onClick: () => this.app.modal.hide() }],
    });
  }

  confirmDig(): void {
    const state = this.app.state;
    const bs = this.app.engine.buildingSystem;
    if (!bs.canDig(state)) return;
    const cost = bs.digCost(state);
    const affordable = this.app.engine.resourceSystem.canAfford(state, cost);
    // [Economy] M2: explain a dig that storage is too small for.
    const over = bs.digOverCap(state);
    let body: string | HTMLElement = i18n.t('dig.body');
    if (over) {
      body = el('div', 'modal-result');
      body.append(el('p', 'modal-body', i18n.t('dig.body')),
        el('p', 'modal-body negative-text', i18n.t('dig.needStorageBody', { cap: over.cap, cost: over.cost, res: i18n.t(`resources.${over.resource}`) })));
    }
    this.app.modal.show({
      icon: '[[pick]]',
      title: i18n.t('dig.title', { n: state.currentFloors + 1 }),
      body,
      actions: [
        {
          label: i18n.t('dig.yes'),
          className: 'btn-primary',
          disabled: !affordable,
          detail: costRow(state, cost),
          onClick: () => {
            this.app.modal.hide();
            if (!this.app.engine.resourceSystem.spend(this.app.engine.stateManager, cost)) return;
            bs.dig(this.app.engine.stateManager);
            this.app.engine.requestSave();
            this.app.audio.play('drill');
            setTimeout(() => this.app.audio.play('dig'), 700);
            this.app.renderer.shake(3, 2.2);
          },
        },
        { label: i18n.t('placement.cancel'), className: 'btn-secondary', onClick: () => this.app.modal.hide() },
      ],
    });
  }
}
