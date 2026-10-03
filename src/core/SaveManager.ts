import { get, set, del } from 'idb-keyval';
import { compressToBase64, compressToUTF16, decompressFromBase64, decompressFromUTF16 } from 'lz-string';
import type { GameState } from './GameState';

/**
 * Dev builds accept ?slot=<name> to play on a separate save (testing a fresh game
 * never touches the real one). Production always uses the main slot.
 */
function slotSuffix(): string {
  if (!import.meta.env.DEV) return '';
  const slot = new URLSearchParams(location.search).get('slot');
  return slot && /^[a-z0-9_-]{1,20}$/i.test(slot) ? `_${slot}` : '';
}

const AUTO_SAVE_KEY = `lastbunker_auto${slotSuffix()}`;
const SAVE_SLOT_PREFIX = `lastbunker_slot${slotSuffix()}_`;

export class SaveManager {
  async save(state: GameState, slot: 'auto' | number = 'auto'): Promise<void> {
    const key = slot === 'auto' ? AUTO_SAVE_KEY : `${SAVE_SLOT_PREFIX}${slot}`;
    const serialized = JSON.stringify(state);
    const compressed = compressToUTF16(serialized);
    await set(key, compressed);
  }

  async load(slot: 'auto' | number = 'auto'): Promise<GameState | null> {
    const key = slot === 'auto' ? AUTO_SAVE_KEY : `${SAVE_SLOT_PREFIX}${slot}`;
    const compressed = await get<string>(key);
    if (!compressed) return null;
    const serialized = decompressFromUTF16(compressed);
    if (!serialized) return null;
    return JSON.parse(serialized) as GameState;
  }

  async deleteSave(slot: 'auto' | number): Promise<void> {
    const key = slot === 'auto' ? AUTO_SAVE_KEY : `${SAVE_SLOT_PREFIX}${slot}`;
    await del(key);
  }

  async hasSave(slot: 'auto' | number = 'auto'): Promise<boolean> {
    const key = slot === 'auto' ? AUTO_SAVE_KEY : `${SAVE_SLOT_PREFIX}${slot}`;
    const val = await get(key);
    return val !== undefined;
  }

  exportSave(state: GameState): string {
    return compressToBase64(JSON.stringify(state));
  }

  /** Parses a pasted save string; returns null for anything that isn't a valid save. */
  importSave(data: string): GameState | null {
    try {
      const serialized = decompressFromBase64(data.trim());
      if (!serialized) return null;
      const parsed = JSON.parse(serialized) as GameState;
      if (!parsed || !Array.isArray(parsed.buildings) || !Array.isArray(parsed.survivors) || typeof parsed.resources !== 'object') {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}
