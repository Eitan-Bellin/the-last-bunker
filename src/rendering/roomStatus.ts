import type { BuildingInstance, GameState } from '../core/GameState';
import { getDef } from '../data/buildingDefs';

/**
 * [clean:0] A room's one status, the single dot the clean front shows on it (and the room screen's state line later):
 *   ok    green: working (fully staffed, or a room that needs nobody)
 *   warn  amber: being built / upgraded, or short of workers
 *   bad   red:   needs workers and has none, shut down (danger.disabled), or a crisis / disaster in it
 * Pure and cheap (a few compares, one scan of the open incidents and disasters): the renderer asks it for every room every picture.
 */
export type RoomStatus = 'ok' | 'warn' | 'bad';

/** Dot colours: the prototype's (tools/viewproto.html --ok / --warn / --bad). */
export const ROOM_STATUS_COLOR: Record<RoomStatus, number> = { ok: 0x6cc28f, warn: 0xe8ae4c, bad: 0xec8070 };

type StatusState = Pick<GameState, 'incidents'> & { danger?: Pick<GameState['danger'], 'disabled' | 'disasters'> };

export function roomStatus(state: StatusState, b: BuildingInstance, now = Date.now()): RoomStatus {
  if ((state.danger?.disabled?.[b.id] ?? 0) > now) return 'bad';
  const incidents = state.incidents;
  if (incidents) for (let i = 0; i < incidents.length; i++) if (incidents[i].buildingId === b.id) return 'bad';
  const disasters = state.danger?.disasters;
  if (disasters) for (let i = 0; i < disasters.length; i++) if (disasters[i].buildingId === b.id) return 'bad';
  if (b.isConstructing) return 'warn';
  const max = getDef(b.type)?.maxWorkers ?? 0;
  if (max <= 0) return 'ok';
  const n = b.assignedSurvivorIds.length;
  if (n === 0) return 'bad';
  return n < max ? 'warn' : 'ok';
}
