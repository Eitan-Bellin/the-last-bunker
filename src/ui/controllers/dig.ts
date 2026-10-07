import { i18n } from '../../i18n/I18nManager';
import { RESOURCE_ICONS, costRow, el } from '../../ui/dom';
import { floorExtent, type ResourceType } from '../../core/GameState';
import { availableDistricts, districtDef, nextDistrict, type DistrictDef, type DistrictKind } from '../../data/districts';
import { maxEast, maxWest, wingOptions } from '../../data/wings';
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
    // [Long game] A dig under way: the sign shows how far it is and who is on it.
    // [plan4:ST-3] With two digs running the sign tells about the floor dig, else the first one.
    const ds = this.app.engine.digSystem;
    const d = ds.dig(state);
    if (d && d.floor != null) {
      const pct = Math.floor((d.progress / Math.max(1, d.total)) * 100);
      const eta = ds.eta(state);
      const crew = `[[people]] ${ds.crew(state).length}/${ds.wanted(state)}`;
      const status = isFinite(eta) ? `${pct}%   ${crew}   [[clock]] ${i18n.formatDuration(eta)}` : `${pct}%   ${crew}   ${i18n.t('dig.noCrew')}`;
      this.app.renderer.setDigSign(true, this.digTitle(d), status);
    } else {
      this.updateIdleDigSign();
    }
    const next = nextDistrict(state);
    this.app.renderer.setDistrictSign(next ? {
      floor: next.floor,
      slot: floorExtent(state, next.floor).e, // [plan4:ST-8]
      text: availableDistricts(state).length > 1 ? i18n.t('district.digMany', { n: availableDistricts(state).length }) : i18n.t('district.dig', { name: next.name[i18n.currentLocale] }),
      cost: (Object.entries(next.cost) as [ResourceType, number][]).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''} ${v}`).join('   '),
    } : null);
  }

  /** Sign/modal title of a running dig: a new floor, or a wing step. */
  private digTitle(d: { floor: number | null; kind?: 'floor' | 'wing'; side?: 'w' | 'e' }): string {
    const n = (d.floor ?? 0) + 1;
    return d.kind === 'wing' ? i18n.t('wing.digging', { n, side: i18n.t(`wing.side.${d.side ?? 'e'}`) }) : i18n.t('dig.digging', { n });
  }

  private updateIdleDigSign(): void {
    const state = this.app.state;
    const bs = this.app.engine.buildingSystem;
    const cost = bs.digCost(state);
    // [Economy] M2: when the price is bigger than storage can hold, the sign says so instead of showing an unreachable cost.
    const over = bs.digOverCap(state);
    const costText = over
      ? `[[storage]] ${i18n.t('dig.needStorage', { cap: over.cap, cost: over.cost })}`
      : (Object.entries(cost) as [ResourceType, number][]).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''} ${v}`).join('   ');
    this.app.renderer.setDigSign(bs.canDig(state), i18n.t('dig.title', { n: state.currentFloors + 1 }), costText);
  }

  /** [Long game] The dig in progress: how far, who is on it, and a button to (re)fill the crew. */
  private showDigStatus(slot?: number): void {
    const state = this.app.state;
    const ds = this.app.engine.digSystem;
    const at = slot ?? ds.primary(state);
    const d = ds.dig(state, at);
    if (!d || d.floor == null) return;
    const eta = ds.eta(state, at);
    const body = el('div', 'modal-result');
    body.append(
      el('p', 'modal-body', i18n.t('dig.statusBody', { pct: Math.floor((d.progress / Math.max(1, d.total)) * 100), crew: ds.crew(state, at).length, want: ds.wanted(state, at) })),
      el('p', 'modal-sub', isFinite(eta) ? i18n.t(d.kind === 'wing' ? 'wing.eta' : 'dig.eta', { t: i18n.formatDuration(eta) }) : i18n.t('dig.noCrewBody')),
    );
    const full = ds.crew(state, at).length >= ds.wanted(state, at);
    this.app.modal.show({
      icon: '[[pick]]',
      title: this.digTitle(d),
      body,
      actions: [
        {
          label: `[[people]] ${i18n.t('dig.staff', { n: ds.wanted(state, at) })}`,
          className: 'btn-primary',
          disabled: full,
          onClick: () => {
            this.app.modal.hide();
            const n = ds.autoStaff();
            this.app.toasts.show(n > 0 ? `[[pick]] ${i18n.t('dig.staffed', { n })}` : i18n.t('dig.nobody'), n > 0 ? 'good' : 'bad');
            this.app.engine.requestSave();
          },
        },
        { label: i18n.t('event.ok'), className: 'btn-secondary', onClick: () => this.app.modal.hide() },
      ],
    });
  }

  /**
   * [plan4:ST-3] Widen one side of a floor by a step (2 slots). The renderer's dig signs call this (BunkerRenderer.onWingDig);
   * a wing already being dug shows its status, a blocked one says why.
   */
  confirmWingDig(floor: number, side: 'w' | 'e'): void {
    const state = this.app.state;
    const bs = this.app.engine.buildingSystem;
    const ds = this.app.engine.digSystem;
    const running = ds.slots(state).find(i => { const d = ds.dig(state, i); return d?.kind === 'wing' && d.floor === floor && d.side === side; });
    if (running !== undefined) { this.showDigStatus(running); return; }
    const opt = wingOptions(state).find(o => o.floor === floor && o.side === side);
    if (!opt) return;
    const sideName = i18n.t(`wing.side.${side}`);
    const ext = floorExtent(state, floor);
    const have = side === 'w' ? ext.w : ext.e;
    const max = side === 'w' ? maxWest(state, floor) : maxEast(state, floor);
    const body = el('div', 'modal-result');
    body.append(el('p', 'modal-body', i18n.t('wing.body', { n: floor + 1, side: sideName, have, max })));
    const blocked = opt.block !== null && opt.block !== 'cost';
    if (blocked) body.append(el('p', 'modal-body negative-text', i18n.t(`wing.block.${opt.block}`)));
    else body.append(el('p', 'modal-sub', i18n.t('wing.takes', { t: i18n.formatDuration(opt.seconds), n: bs.crewFor(state, { floor, paid: [], progress: 0, total: opt.seconds, crew: [], kind: 'wing', side }) })));
    const title = i18n.t('wing.title', { n: floor + 1, side: sideName });
    if (blocked) {
      this.app.modal.show({ icon: '[[pick]]', title, body, actions: [{ label: i18n.t('event.ok'), className: 'btn-secondary', onClick: () => this.app.modal.hide() }] });
      return;
    }
    this.app.modal.show({
      icon: '[[pick]]',
      title,
      body,
      actions: [
        {
          label: i18n.t('wing.yes'),
          className: 'btn-primary',
          disabled: opt.block === 'cost',
          detail: costRow(state, opt.cost),
          onClick: () => {
            this.app.modal.hide();
            if (!bs.digWing(this.app.engine.stateManager, floor, side)) return;
            ds.autoStaff();
            this.app.engine.requestSave();
            this.app.audio.play('drill');
            setTimeout(() => this.app.audio.play('dig'), 700);
            this.app.renderer.shake(2, 1.6);
          },
        },
        { label: i18n.t('placement.cancel'), className: 'btn-secondary', onClick: () => this.app.modal.hide() },
      ],
    });
  }

  /**
   * Tunnel sideways into a natural cavern. [plan4:ST-8] One kind on offer opens the old single dialog; several (the new districts) open a small
   * card list to choose from, and the price of the chosen card is on the button.
   */
  confirmDistrictDig(picked?: DistrictKind): void {
    const state = this.app.state;
    const options = availableDistricts(state);
    if (options.length === 0) return;
    const locale = i18n.currentLocale;
    const chosen = options.find(d => d.kind === picked) ?? options[0];
    const dig = (d: DistrictDef) => {
      this.app.modal.hide();
      if (!this.app.engine.resourceSystem.spend(this.app.engine.stateManager, d.cost as Record<string, number>)) return;
      const b = this.app.engine.buildingSystem.digDistrict(this.app.engine.stateManager, d.kind);
      this.app.engine.requestSave();
      this.app.audio.play('drill');
      if (b) {
        const c = this.app.renderer.roomCenter(b);
        this.app.renderer.focusOn(c.x, c.y + 26, 1.3);
      }
    };
    let body: string | HTMLElement = i18n.t('district.body', { floor: chosen.floor + 1 });
    if (options.length > 1) {
      const list = el('div', 'district-choice');
      list.setAttribute('role', 'radiogroup');
      list.setAttribute('aria-label', i18n.t('district.choose'));
      for (const d of options) {
        const card = el('button', `district-card${d === chosen ? ' selected' : ''}`);
        card.type = 'button';
        card.setAttribute('role', 'radio');
        card.setAttribute('aria-checked', d === chosen ? 'true' : 'false');
        card.append(
          el('span', 'district-card-name', `[[${d.icon}]] ${d.name[locale]}`),
          el('span', 'district-card-floor', i18n.t('district.cardFloor', { floor: d.floor + 1 })),
          el('span', 'district-card-find', d.find[locale]),
          costRow(state, d.cost as Record<string, number>),
        );
        card.addEventListener('click', () => this.confirmDistrictDig(d.kind));
        list.appendChild(card);
      }
      body = list;
    }
    this.app.modal.show({
      icon: '[[pick]]',
      title: i18n.t('district.title'),
      body,
      actions: [
        {
          label: options.length > 1 ? i18n.t('district.yesNamed', { name: chosen.name[locale] }) : i18n.t('district.yes'),
          className: 'btn-primary',
          disabled: !this.app.engine.resourceSystem.canAfford(state, chosen.cost as Record<string, number>),
          detail: costRow(state, chosen.cost as Record<string, number>),
          onClick: () => dig(chosen),
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
    // [plan4:ST-3] A floor dig under way (or every slot busy with wings): the status of the primary dig.
    if (this.app.engine.digSystem.active(state) && !bs.canDig(state)) { this.showDigStatus(); return; }
    if (!bs.canDig(state)) return;
    const cost = bs.digCost(state);
    const affordable = this.app.engine.resourceSystem.canAfford(state, cost);
    // [Economy] M2: explain a dig that storage is too small for.
    const over = bs.digOverCap(state);
    const intro = el('div', 'modal-result');
    intro.append(
      el('p', 'modal-body', i18n.t('dig.body')),
      el('p', 'modal-sub', i18n.t('dig.takes', { t: i18n.formatDuration(bs.digTime(state)), n: bs.digCrew(state) })),
    );
    let body: string | HTMLElement = intro;
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
            // The crew is called at once (idle people first); the player can change it from the people panel.
            this.app.engine.digSystem.autoStaff();
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
