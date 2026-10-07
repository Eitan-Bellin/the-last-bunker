// [plan4:GP-8 #7] The Foreman's 'sealOnAlarm' order: shuts the doors around a fire / epidemic / raid, opens only its own doors afterwards,
// leaves a door the player changed alone, freezes in a blackout, and forgets its list when switched off. Run by foreman-test.mjs.
import { StateManager } from '../../src/core/StateManager';
import { createInitialState, type BuildingInstance, type GameState } from '../../src/core/GameState';
import { ForemanSystem } from '../../src/systems/ForemanSystem';
import { getDoor, setDoor } from '../../src/systems/doors';

const room = (id: string, x: number, floor: number): BuildingInstance => ({
  id, type: 'quarters', level: 1, position: { x, y: 0, floor }, assignedSurvivorIds: [], constructionProgress: 1, constructionTotal: 1, isConstructing: false, specialization: null,
});

export function foremanChecks(): { problems: string[] } {
  const problems: string[] = [];
  const eq = (what: string, got: unknown, want: unknown): void => { if (got !== want) problems.push(`${what}: got ${String(got)}, wanted ${String(want)}`); };
  const make = (): { sm: StateManager; f: ForemanSystem } => {
    const s = createInitialState();
    s.ruins = []; s.incidents = [];
    s.longGame!.meta.act = 2;
    s.buildings = [room('b_1', 4, 2)];
    for (const r of Object.values(s.resources)) r.amount = r.cap = 500;
    s.powerRatio = 1;
    setDoor(s, 2, 4, 'open'); // the west edge of b_1
    setDoor(s, 2, 9, 'open'); // far from it
    const sm = new StateManager();
    sm.loadState(s);
    const stub = null as never;
    return { sm, f: new ForemanSystem(sm, stub, stub, stub, stub, stub, stub) };
  };
  const fire = (s: GameState): void => { s.incidents.push({ id: 'i_1', kind: 'fire', buildingId: 'b_1', severity: 0.3, progress: 0, startedAt: 0 }); };

  {
    const { sm, f } = make();
    const st = (): GameState => sm.state as GameState;
    fire(st());
    f.update(5);
    eq('order off: nothing shut', getDoor(st(), 2, 4), 'open');
    f.set('sealOnAlarm', true);
    eq('on + a fire: the door at the room shuts at once', getDoor(st(), 2, 4), 'closed');
    eq('a door far from the fire stays open', getDoor(st(), 2, 9), 'open');
    eq('the list holds the door it shut', (st().longGame!.foreman.sealed ?? []).join(','), '2:4');
    st().incidents = [];
    f.update(5);
    eq('trouble over: its door is open again', getDoor(st(), 2, 4), 'open');
    eq('the list is empty again', (st().longGame!.foreman.sealed ?? []).length, 0);
  }
  {
    const { sm, f } = make();
    const st = (): GameState => sm.state as GameState;
    f.set('sealOnAlarm', true);
    fire(st());
    f.update(5);
    eq('shut by the order', getDoor(st(), 2, 4), 'closed');
    setDoor(st(), 2, 4, 'sealed'); // the player welded it
    st().incidents = [];
    f.update(5);
    eq('a door the player changed is left as the player set it', getDoor(st(), 2, 4), 'sealed');
    eq('and it is off the list', (st().longGame!.foreman.sealed ?? []).length, 0);
  }
  {
    const { sm, f } = make();
    const st = (): GameState => sm.state as GameState;
    st().resources.power.amount = 0;
    st().powerRatio = 0.2;
    f.set('sealOnAlarm', true);
    fire(st());
    f.update(5);
    eq('blackout: doors cannot move', getDoor(st(), 2, 4), 'open');
    eq('blackout: the report says so', f.last.sealOnAlarm?.key, 'sealBlackout');
  }
  {
    const { sm, f } = make();
    const st = (): GameState => sm.state as GameState;
    f.set('sealOnAlarm', true);
    st().danger.disasters = [{ id: 'd_1', kind: 'epidemic', buildingId: null, startedAt: 0, deadline: 9999 }];
    f.update(5);
    eq('epidemic: every open door shuts', `${getDoor(st(), 2, 4)}${getDoor(st(), 2, 9)}`, 'closedclosed');
    f.set('sealOnAlarm', false);
    eq('switched off: the list is cleared', (st().longGame!.foreman.sealed ?? []).length, 0);
    st().danger.disasters = [];
    f.update(5);
    eq('switched off: nothing is reopened later', getDoor(st(), 2, 4), 'closed');
  }
  {
    const { sm, f } = make();
    const st = (): GameState => sm.state as GameState;
    st().longGame!.meta.act = 1;
    fire(st());
    f.set('sealOnAlarm', true);
    f.update(5);
    eq('Act I: the Foreman takes no orders', getDoor(st(), 2, 4), 'open');
  }
  return { problems };
}
