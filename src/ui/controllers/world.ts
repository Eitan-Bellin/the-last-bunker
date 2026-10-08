import { haptic } from '../../utils/haptics';
import { bus } from '../../core/EventBus'; // [plan4:GP-1]
import { statusTint } from '../../utils/a11y';
import { HUD } from '../../ui/HUD';
import { i18n } from '../../i18n/I18nManager';
import { getDef } from '../../data/buildingDefs';
import { allowedFloors } from '../../data/zones';
import { BUILDING_ICONS, RESOURCE_ICONS, costRow, el } from '../../ui/dom';
import type { BuildingType, GameState, Position, ResourceType } from '../../core/GameState';
import { roomFloors, roomSlots } from '../../data/buildingDefs';
import { PlacementBar, type Chip } from '../components/PlacementBar'; // [plan4:ST-19]
import { DropChip } from '../components/DropChip'; // [plan4:UX-20]
import { getHudInsets } from '../../utils/hudInsets';
import { RUIN_KINDS } from '../../data/ruins';
import type { PlaceBlock } from '../../systems/BuildingSystem';
import { bestSpot, floorRangesLabel, nameOf, nearestSpot, placeEffects, spotForTap, validSpots } from '../../systems/placementRank';
import { RELOCATE_SECONDS, relocateBlock, relocateCost, stateWithout } from '../../systems/relocate';
import { SLOT_W, buildingH, floorTop, slotX } from '../../rendering/geom';
import type { IconName } from '../../ui/icons';
import type { GameApp } from '../../app';
import { popupMode } from '../components/NumberPopup'; // [plan4:UX-21]

/** A bubble is worth two minutes of the room's output (NICE1), so a tap still matters after the first hour. */
const BUBBLE_SECONDS = 120;
/** Now and then a bubble holds a surprise instead: salvage or a bit of know-how (share of that store's cap). */
const BUBBLE_SURPRISE_CHANCE = 0.15;
const BUBBLE_SURPRISE_SHARE = 0.04;
export const PRODUCTION_POPUP_MS = 4000;
const MAX_PRODUCTION_POPUPS = 8;
const RESOURCE_COLORS: Partial<Record<ResourceType, number>> = {
  food: 0x7dff6a, water: 0x6ab8ff, power: 0xffdd44, materials: 0xff9a5a, medicine: 0xff7a9a, knowledge: 0xb48cff,
};

/** Placing rooms, tapping bubbles, dragging people, and production popups in the bunker view. */
export class WorldController {
  private app: GameApp;

  constructor(app: GameApp) {
    this.app = app;
  }

  // ───────────────────────────── [plan4:ST-19] placing a room: ghost, confirm bar, best spot, moving a room ─────────────────────────────
  // Choose a type (BuildMenu) -> the camera finds the first floor with room -> tap a green frame: a ghost of the room appears there with a confirm
  // bar (Best spot / Cancel / Build) and chips (what the spot gives or why it is refused). Dragging the ghost slides it between valid spots. Nothing
  // is spent until Build. The same machinery moves a finished room (`relocateId`): the room is judged against the bunker without itself.

  /** After choosing a type, drop the ghost on the recommended spot at once (2 taps to build) instead of waiting for a tap on a frame. */
  private static readonly AUTO_GHOST = false;

  private bar: PlacementBar | null = null;
  /** Valid spots for the room being placed (recomputed when a drag starts and when the mode opens). */
  private spots: Position[] = [];
  private relocateId: string | null = null;
  private costTimer = 0;
  private hooked = false;

  /** The state a spot is judged against: while moving a room, the bunker without that room. */
  private placeState(): GameState {
    return this.relocateId ? stateWithout(this.app.state, this.relocateId) : this.app.state;
  }

  /** Why `type` cannot stand at `pos` right now: placeBlock's reason, 'same' for the spot a moving room already holds, null = it can. */
  private blockAt(type: BuildingType, pos: Position): PlaceBlock | 'same' | null {
    const rel = this.relocateId ? this.app.state.buildings.find(b => b.id === this.relocateId) : null;
    if (rel && rel.position.floor === pos.floor && rel.position.x === pos.x) return 'same';
    return this.app.engine.buildingSystem.placeBlock(type, pos, this.placeState());
  }

  private ensureBar(): PlacementBar {
    if (!this.bar) this.bar = new PlacementBar();
    const bar = this.bar;
    if (!this.hooked) {
      this.hooked = true;
      const r = this.app.renderer;
      bar.onCancel = () => { this.app.audio.play('click'); this.cancelPlacement(); };
      bar.onRecommend = () => this.recommend();
      bar.onConfirm = () => this.confirmPlacement();
      bar.onIdleBuild = () => {
        haptic('error');
        const at = r.ghostSpot;
        const type = this.app.placementMode;
        const block = at && type ? this.blockAt(type, at) : null;
        bar.flash(block && type ? this.reasonText(block, type) : i18n.t('placement.noGhost'), 'warn');
      };
      r.onGhostLift = () => {
        const type = this.app.placementMode;
        if (!type) return;
        this.spots = validSpots(type, this.placeState(), this.app.engine.buildingSystem);
        haptic('tap');
      };
      r.onGhostDrag = (wx, wy) => this.dragGhostTo(wx, wy);
      r.onGhostDrop = () => {
        if (this.app.placementMode) r.revealGhost(bar.coverPx());
      };
      r.onPlacementEmptyTap = () => {
        if (!this.app.placementMode) return;
        this.app.audio.play('click');
        this.cancelPlacement();
      };
    }
    return bar;
  }

  highlightPlacement(type: BuildingType): void {
    const st = this.placeState();
    const bs = this.app.engine.buildingSystem;
    this.app.renderer.setPlacementHighlight(pos => bs.canPlaceBuilding(type, pos, st), roomFloors(type));
  }

  startPlacement(type: BuildingType, relocateId: string | null = null): void {
    this.cancelPlacement();
    this.relocateId = relocateId;
    const state = this.app.state;
    const bs = this.app.engine.buildingSystem;
    const probe = this.placeState();
    const floors = allowedFloors(type, state.currentFloors);
    const target = floors.find(f => bs.findFreeSpot(type, f, probe)) ?? floors[0];
    this.app.renderer.focusFloor(target);
    this.app.placementMode = type;
    document.body.classList.add('placement-mode');
    const name = getDef(type)?.name[i18n.currentLocale] ?? type;
    this.app.hud.showPlacement(name);
    this.highlightPlacement(type);
    // The confirm bar: the price of a new room, or of the move.
    const rel = relocateId ? state.buildings.find(b => b.id === relocateId) : null;
    const cost = rel ? relocateCost(bs, state, rel) : bs.getBuildCost(type, state);
    const bar = this.ensureBar();
    bar.show(name, state, cost, !!rel);
    bar.followGhost(() => this.app.renderer.ghostScreenRect());
    this.app.renderer.setCarryInset(bar.coverPx());
    this.spots = validSpots(type, probe, bs);
    window.clearInterval(this.costTimer);
    this.costTimer = window.setInterval(() => {
      const t = this.app.placementMode;
      if (!t) return;
      const rr = this.relocateId ? this.app.state.buildings.find(b => b.id === this.relocateId) : null;
      bar.setCost(this.app.state, rr ? relocateCost(bs, this.app.state, rr) : bs.getBuildCost(t, this.app.state));
    }, 1000);
    if (WorldController.AUTO_GHOST && !rel) this.recommend();
  }

  cancelPlacement(): void {
    if (!this.app.placementMode) return;
    this.app.placementMode = null;
    this.relocateId = null;
    document.body.classList.remove('placement-mode');
    this.app.hud.hidePlacement();
    this.app.renderer.setPlacementHighlight(null);
    this.app.renderer.hideGhost();
    this.bar?.hide();
    window.clearInterval(this.costTimer);
    this.spots = [];
  }

  /** The chip for a refused spot, in words. */
  private reasonText(block: PlaceBlock | 'same', type: BuildingType): string {
    const state = this.app.state;
    const def = getDef(type);
    if (block === 'zone') return i18n.t('placement.r.zone', { floors: `\u2066${floorRangesLabel(allowedFloors(type, state.currentFloors))}\u2069` }); // LRI..PDI keeps "B3–B14" in one piece inside a Hebrew line
    if (block === 'adjacency') {
      const need = def?.place?.adjacentTo;
      return i18n.t('placement.r.adjacency', { room: need ? nameOf(need, i18n.currentLocale) : '' });
    }
    return i18n.t(`placement.r.${block}`);
  }

  /** The chips over a ghost: what the spot gives or risks, or the reason it is refused. */
  private chipsFor(type: BuildingType, pos: Position, block: PlaceBlock | 'same' | null): { chips: Chip[]; say: string } {
    if (block) {
      const text = this.reasonText(block, type);
      return { chips: [{ kind: 'bad', text }], say: text };
    }
    const fx = placeEffects(type, pos, this.placeState());
    const chips: Chip[] = [];
    if (fx.compound > 0) chips.push({ kind: 'good', text: i18n.t('placement.chip.compound', { pct: fx.compound * 10 }) });
    if (fx.synergy > 0) chips.push({ kind: 'good', text: i18n.t('placement.chip.synergy', { pct: Math.round(fx.synergy * 100) }) });
    chips.push({ kind: 'info', text: fx.liftDist === 0 ? i18n.t('placement.chip.liftNear') : i18n.t('placement.chip.lift', { n: fx.liftDist }) });
    if (fx.fire) {
      chips.push({
        kind: 'warn',
        text: fx.fire.kind === 'near' ? i18n.t('placement.chip.fireNear', { room: nameOf(fx.fire.room, i18n.currentLocale) }) : i18n.t('placement.chip.fireSelf'),
      });
    }
    const name = nameOf(type, i18n.currentLocale);
    return { chips, say: i18n.t('placement.ghostAria', { name, floor: pos.floor + 1, slot: pos.x }) };
  }

  /** Puts (or moves) the ghost on a spot and updates the chips and the Build button. `quiet` = a drag step (no sound; haptics are the caller's). */
  private setGhost(type: BuildingType, pos: Position, block: PlaceBlock | 'same' | null): void {
    const r = this.app.renderer;
    r.showGhost(type, pos, block === null);
    const { chips, say } = this.chipsFor(type, pos, block);
    this.bar?.setChips(chips, say);
    this.bar?.setReady(block === null);
  }

  /** A tap on a slot (or on a room / ruin that is in the way) while choosing a spot. */
  ghostTap(pos: Position): void {
    const type = this.app.placementMode;
    if (!type) return;
    const { pos: spot, block: found } = spotForTap(type, pos.floor, pos.x, this.placeState(), this.app.engine.buildingSystem);
    const block = this.blockAt(type, spot) ?? found;
    this.setGhost(type, spot, block);
    if (block) this.refuse();
    else { haptic('select'); this.app.audio.play('click'); }
    this.app.renderer.revealGhost(this.bar?.coverPx() ?? 0);
  }

  /** A refused spot: error sound, haptic, and the ghost shakes (not under reduced motion). */
  private refuse(): void {
    this.app.audio.play('error');
    haptic('error');
    this.app.renderer.shakeGhost();
  }

  /** The ghost is dragged: it snaps to the nearest valid spot to where the finger carries it. */
  private dragGhostTo(wx: number, wy: number): void {
    const type = this.app.placementMode;
    if (!type) return;
    const w = roomSlots(type) * SLOT_W, h = buildingH(type);
    const best = nearestSpot(this.spots, type, wx + w / 2, wy + h / 2, (t, p) => ({ x: slotX(p.x) + (roomSlots(t) * SLOT_W) / 2, y: floorTop(p.floor) + buildingH(t) / 2 }));
    if (!best) return;
    const at = this.app.renderer.ghostSpot;
    if (at && at.x === best.x && at.floor === best.floor && this.bar) return;
    this.setGhost(type, best, null);
    haptic('select');
  }

  /** "Best spot": the ghost jumps to the recommended spot and the camera brings it into view. */
  recommend(): void {
    const type = this.app.placementMode;
    if (!type) return;
    const best = bestSpot(type, this.placeState(), this.app.engine.buildingSystem);
    if (!best) {
      haptic('warning');
      this.app.audio.play('error');
      this.bar?.flash(i18n.t('placement.noSpot'), 'warn');
      return;
    }
    this.setGhost(type, best, this.blockAt(type, best));
    haptic('select');
    this.app.audio.play('click');
    this.app.renderer.revealGhost(this.bar?.coverPx() ?? 0, true);
  }

  /** Build (or Move) was pressed: the only place resources are spent. */
  confirmPlacement(): void {
    const type = this.app.placementMode;
    const at = this.app.renderer.ghostSpot;
    if (!type || !at) { this.bar?.onIdleBuild?.(); return; }
    const block = this.blockAt(type, at);
    if (block) { this.setGhost(type, at, block); this.refuse(); return; }
    if (this.relocateId) {
      if (!this.moveRoom(this.relocateId, at)) return;
    } else if (!this.tryPlaceBuilding(type, at)) {
      this.refuse();
      return;
    }
    this.app.audio.play('place');
    const c = this.app.renderer.slotCenter(at);
    this.app.renderer.burstAt(c.x, c.y + 30, 80);
    this.app.renderer.shake(2, 0.25);
    this.cancelPlacement();
  }

  /** Moves a room and says so; false (with a toast) when it did not happen. */
  private moveRoom(id: string, to: Position): boolean {
    const bs = this.app.engine.buildingSystem;
    const b = this.app.state.buildings.find(x => x.id === id);
    if (!b) return false;
    const cost = relocateCost(bs, this.app.state, b);
    if (!this.app.engine.resourceSystem.canAfford(this.app.state, cost)) {
      this.app.toasts.show(`[[warning]] ${i18n.t('relocate.noMoney')}`, 'bad');
      return false;
    }
    if (!bs.relocate(this.app.engine.stateManager, id, to)) {
      this.app.toasts.show(`[[warning]] ${i18n.t('relocate.blocked')}`, 'bad');
      return false;
    }
    this.app.engine.requestSave();
    haptic('success');
    this.app.toasts.show(`${BUILDING_ICONS[b.type] ?? ''} ${i18n.t('relocate.done', { name: getDef(b.type)?.name[i18n.currentLocale] ?? b.type })}`, 'good');
    return true;
  }

  /** Starts moving a finished room: closes the sheets and opens the placement console for it (what a "Move" button in the room panel calls). false = refused (a toast says why). */
  beginRelocate(buildingId: string): boolean {
    const app = this.app;
    const b = app.state.buildings.find(x => x.id === buildingId);
    if (!b) return false;
    const block = relocateBlock(app.state, b);
    if (block) {
      app.toasts.show(`[[warning]] ${i18n.t(`relocate.blocked.${block}`)}`, 'bad');
      return false;
    }
    app.modal.hide();
    app.closeSheets();
    this.startPlacement(b.type, b.id);
    return true;
  }

  /** Long press on a room: its action sheet (Move). The room's panel has no "Move" button of its own yet (see beginRelocate). */
  roomActions(buildingId: string): void {
    const app = this.app;
    if (app.placementMode || app.modal.isVisible || app.introPlaying) return;
    const b = app.state.buildings.find(x => x.id === buildingId);
    const def = b ? getDef(b.type) : undefined;
    if (!b || !def) return;
    haptic('impact');
    const bs = app.engine.buildingSystem;
    const block = relocateBlock(app.state, b);
    const cost = relocateCost(bs, app.state, b);
    const name = def.name[i18n.currentLocale] ?? def.name.en;
    const body = block ? i18n.t(`relocate.blocked.${block}`) : i18n.t('relocate.hint', { name, cost: Object.entries(cost).map(([r, v]) => `${v} ${i18n.t(`resources.${r}`)}`).join(', '), t: i18n.formatDuration(RELOCATE_SECONDS) });
    app.modal.show({
      icon: BUILDING_ICONS[b.type],
      title: `${i18n.t('relocate.title')}: ${name}`,
      body,
      actions: [
        {
          label: i18n.t('relocate.button'), className: 'btn-primary', disabled: !!block, detail: costRow(app.state, cost),
          onClick: () => { this.beginRelocate(b.id); },
        },
        { label: i18n.t('placement.cancel'), className: 'btn-secondary', onClick: () => app.modal.hide() },
      ],
    });
  }

  /** What the plain build used to do on one tap; now called by Build after the ghost is shown. */
  tryPlaceBuilding(type: BuildingType, pos: Position): boolean {
    const state = this.app.state;
    if (!this.app.engine.buildingSystem.canPlaceBuilding(type, pos, state)) return false;
    const cost = this.app.engine.buildingSystem.getBuildCost(type, state);
    if (!this.app.engine.resourceSystem.spend(this.app.engine.stateManager, cost)) {
      this.app.toasts.show(i18n.t('toast.notEnough'), 'bad');
      return false;
    }
    this.app.engine.buildingSystem.placeBuilding(type, pos, this.app.engine.stateManager);
    this.app.engine.requestSave();
    haptic('success');
    return true;
  }

  rejectAt(pos: Position): void {
    const c = this.app.renderer.slotCenter(pos);
    this.app.popups.spawn(c.x, c.y, '[[close]]', statusTint('bad'));
    haptic('error'); // [plan4:UX-2] every invalid placement is rejected through here
  }

  /** Working rooms now and then offer a bonus to tap: about half a minute of their output. */
  spawnBubbles(): void {
    if (document.hidden || this.app.introPlaying) return;
    const state = this.app.state;
    for (const b of state.buildings) {
      if (this.app.renderer.hasBubble(b.id) || b.assignedSurvivorIds.length === 0 || Math.random() > 0.28) continue;
      const out = this.app.engine.resourceSystem.getBuildingOutput(state, b);
      const entry = (Object.entries(out) as [ResourceType, number][]).find(([, v]) => v > 0);
      if (!entry) continue;
      this.app.renderer.showBubble(b.id, entry[0] as IconName);
    }
  }

  collectBubble(buildingId: string): void {
    const state = this.app.state;
    const b = state.buildings.find(x => x.id === buildingId);
    const pos = this.app.renderer.popBubble(buildingId);
    if (!b || !pos) return;
    const out = this.app.engine.resourceSystem.getBuildingOutput(state, b);
    const entry = (Object.entries(out) as [ResourceType, number][]).find(([, v]) => v > 0);
    if (!entry) return;
    const [made, rate] = entry;
    let r: ResourceType = made;
    let amount = Math.max(1, Math.round(rate * BUBBLE_SECONDS));
    if (Math.random() < BUBBLE_SURPRISE_CHANCE) {
      r = Math.random() < 0.5 ? 'scrap' : 'knowledge';
      amount = Math.max(3, Math.round(state.resources[r].cap * BUBBLE_SURPRISE_SHARE));
    }
    this.app.engine.resourceSystem.gain(this.app.engine.stateManager, { [r]: amount });
    this.app.audio.play(r === 'water' ? 'drip' : r === 'materials' || r === 'scrap' ? 'coin' : 'collect');
    if (r === 'water') this.app.audio.play('collect', { volume: 0.6 });
    haptic('tap');
    this.flyToHud(r, pos.x, pos.y, `+${amount}`);
    this.app.engine.notifyInteraction();
    bus.emit('bubble:collected', buildingId); // [plan4:GP-1] the "collect 10 bubbles" order
  }

  /** A collected resource icon arcs up into its HUD counter, which then pulses. */
  flyToHud(r: ResourceType, x: number, y: number, label: string): void {
    const target = this.app.hud.resourceRect(r);
    const fly = el('div', 'fly-icon', `${RESOURCE_ICONS[r] ?? ''} ${label}`);
    fly.style.left = `${x}px`;
    fly.style.top = `${y}px`;
    document.body.appendChild(fly);
    requestAnimationFrame(() => {
      fly.classList.add('go');
      if (target) {
        fly.style.left = `${target.left + target.width / 2}px`;
        fly.style.top = `${target.top + target.height / 2}px`;
      }
    });
    setTimeout(() => {
      fly.remove();
      this.app.hud.pulseResource(r);
    }, 650);
  }

  // ───────────────────────────── [plan4:UX-20] carrying a survivor: the label and ring over the room under them ─────────────────────────────

  private dropChip: DropChip | null = null;

  /** The carried survivor hovers over a room or ruin (or nothing): ring it (green: takes them, red: does not) and say so in a label that follows the finger. */
  hoverPerson(survivorId: string, targetId: string | null, sx: number, sy: number): void {
    const app = this.app;
    const state = app.state;
    const s = state.survivors.find(x => x.id === survivorId);
    const clear = (): void => { app.renderer.setDropRing(null, true); this.dropChip?.hide(); };
    if (!s || !targetId) { clear(); return; }
    const chip = this.dropChip ?? (this.dropChip = new DropChip());
    let ok = true;
    let text = '';
    if (targetId.startsWith('r_')) {
      const ruin = state.ruins.find(r => r.id === targetId);
      if (!ruin) { clear(); return; }
      text = i18n.t('drag.moveToRuin', { room: RUIN_KINDS[ruin.kind]?.name[i18n.currentLocale] ?? '' });
    } else {
      const b = state.buildings.find(x => x.id === targetId);
      const def = b ? getDef(b.type) : undefined;
      if (!b || !def) { clear(); return; }
      const room = def.name[i18n.currentLocale] ?? def.name.en;
      if (def.maxWorkers === 0 && !s.child) { ok = false; text = i18n.t('drag.noJobs'); }
      else if (s.assignedBuildingId === b.id) { ok = false; text = i18n.t('drag.same', { ...app.gOf(s) }); }
      else if (!app.engine.populationSystem.canAssign(state, b.id, !!s.child)) { ok = false; text = i18n.t('drag.full', { room }); }
      else text = i18n.t('drag.moveTo', { room });
    }
    app.renderer.setDropRing(targetId, ok);
    chip.show(text, ok, sx, sy, getHudInsets().top);
  }

  /** Dropping a carried survivor on a room puts them to work there. */
  dropSurvivor(survivorId: string, targetId: string | null): void {
    const state = this.app.state;
    const s = state.survivors.find(x => x.id === survivorId);
    if (!s || !targetId || targetId === s.assignedBuildingId) return;
    const ps = this.app.engine.populationSystem;
    const name = this.app.localName(s.name);
    if (targetId.startsWith('r_')) {
      const ruin = state.ruins.find(r => r.id === targetId);
      if (!ruin) return;
      if (!ruin.started) {
        this.app.openRuin(targetId);
        return;
      }
      if (!this.app.engine.restorationSystem.assign(targetId, survivorId)) {
        this.app.audio.play('error');
        haptic('error');
        this.app.toasts.show(`[[warning]] ${i18n.t('people.full')}`, 'bad');
        return;
      }
      this.app.toasts.show(`[[pick]] ${i18n.t('drag.toRuin', { name, ...this.app.gOf(s) })}`, 'good');
    } else {
      const b = state.buildings.find(x => x.id === targetId);
      if (!b) return;
      const def = getDef(b.type);
      if (!def || def.maxWorkers === 0) {
        this.app.audio.play('error');
        haptic('error');
        this.app.toasts.show(`[[warning]] ${i18n.t('drag.noJobs')}`, 'bad');
        return;
      }
      if (!ps.assignSurvivorToBuilding(this.app.engine.stateManager, survivorId, targetId)) {
        this.app.audio.play('error');
        haptic('error');
        this.app.toasts.show(`[[warning]] ${i18n.t('drag.full', { room: def.name[i18n.currentLocale] ?? def.name.en })}`, 'bad');
        return;
      }
      this.app.toasts.show(`${BUILDING_ICONS[b.type] ?? ''} ${i18n.t('drag.assigned', { name, room: def.name[i18n.currentLocale] ?? def.name.en, ...this.app.gOf(s) })}`, 'good');
    }
    this.app.audio.play('assign');
    haptic('impact');
    this.app.engine.requestSave();
  }

  spawnProductionPopups(): void {
    // [plan4:UX-21] The routine numbers only in the "all" mode; bubbles, events and upgrades have their own, always shown popups.
    if (document.hidden || popupMode() !== 'all') return;
    const state = this.app.state;
    let shown = 0;
    for (const b of state.buildings) {
      if (shown >= MAX_PRODUCTION_POPUPS) break;
      const out = this.app.engine.resourceSystem.getBuildingOutput(state, b);
      const entry = (Object.entries(out) as [ResourceType, number][]).find(([r, v]) => v > 0 && r !== 'power');
      if (!entry) continue;
      const [r, rate] = entry;
      const amount = rate * (PRODUCTION_POPUP_MS / 1000);
      const c = this.app.renderer.roomCenter(b);
      const delay = Math.random() * 1500;
      setTimeout(() => this.app.popups.spawn(c.x, c.y + 10, `+${amount >= 10 ? Math.round(amount) : amount.toFixed(1)} ${RESOURCE_ICONS[r] ?? ''}`, RESOURCE_COLORS[r]), delay);
      shown++;
    }
  }
}
