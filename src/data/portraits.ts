import type { SurvivorState } from '../core/GameState';

export type Gender = 'm' | 'f' | 'n';
export type HairStyle = 'short' | 'curly' | 'bald' | 'bun' | 'braids' | 'long' | 'cropped';

/** A painted portrait and the matching look of the in-world character. */
export interface PortraitDef {
  file: string;
  gender: 'm' | 'f';
  child?: boolean;
  /** Reserved for a story character; never handed to a random survivor. */
  story?: boolean;
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  beard?: number;
  glasses?: boolean;
}

export const PORTRAITS: PortraitDef[] = [
  { file: 'p01', gender: 'f', skin: 0xdcae8a, hair: 0x4a3f3a, hairStyle: 'short' },
  { file: 'p02', gender: 'm', skin: 0xe2b48e, hair: 0x5a3820, hairStyle: 'curly' },
  { file: 'p03', gender: 'm', skin: 0xf0c8a6, hair: 0xdedad2, hairStyle: 'short', beard: 0xe8e4dc, glasses: true },
  { file: 'p04', gender: 'f', skin: 0x7a5236, hair: 0x1c1612, hairStyle: 'braids' },
  { file: 'p05', gender: 'm', skin: 0xc68a5e, hair: 0x2a1d14, hairStyle: 'bald', beard: 0x2a1d14 },
  { file: 'p06', gender: 'f', skin: 0xf1c9a5, hair: 0xa04a2a, hairStyle: 'bun' },
  { file: 'p07', gender: 'f', child: true, skin: 0xe8bc96, hair: 0x2a1d14, hairStyle: 'braids' },
  { file: 'p08', gender: 'm', child: true, skin: 0xf2caa8, hair: 0x8a5a2a, hairStyle: 'cropped' },
  { file: 'p09', gender: 'm', story: true, skin: 0x9c6a44, hair: 0x1a1a1a, hairStyle: 'short', beard: 0x1a1a1a },
  { file: 'p10', gender: 'f', skin: 0xe8c0a0, hair: 0xd8b060, hairStyle: 'long' },
  { file: 'p11', gender: 'm', skin: 0xdcae8a, hair: 0x6a4a2a, hairStyle: 'short', glasses: true },
  { file: 'p12', gender: 'f', skin: 0x6e4a30, hair: 0x1a1a1a, hairStyle: 'curly' },
  { file: 'p13', gender: 'm', story: true, skin: 0xf1c9a5, hair: 0xc04a2a, hairStyle: 'cropped', beard: 0xb04a2a },
  { file: 'p14', gender: 'f', story: true, skin: 0xc68a5e, hair: 0x3a2a1c, hairStyle: 'short', glasses: true },
];

/** Gender of each first name (the Hebrew name decides; some names are unisex). */
const NAME_GENDER: Record<string, Gender> = {
  Maya: 'f', Gideon: 'm',
  Alex: 'm', Sam: 'f', Jordan: 'm', Taylor: 'f', Morgan: 'm', Casey: 'f', Riley: 'm', Avery: 'f', Quinn: 'n', Dana: 'f',
  Max: 'm', Eli: 'f', Kai: 'n', Sage: 'f', Rowan: 'm', River: 'f', Sky: 'n', Phoenix: 'f', Blake: 'm', Drew: 'n',
};

export function nameGender(name: string): Gender {
  return NAME_GENDER[name] ?? 'n';
}

/** Painted portraits that actually exist on disk (the rest fall back to adults of the same gender). */
export const PAINTED_PORTRAITS = new Set(PORTRAITS.map(p => p.file));

export function portraitFor(s: Pick<SurvivorState, 'name' | 'portraitIndex'> & { child?: boolean; portrait?: string }): PortraitDef {
  if (s.portrait) {
    const fixed = PORTRAITS.find(p => p.file === s.portrait);
    if (fixed) return fixed;
  }
  const g = nameGender(s.name);
  const usable = (p: PortraitDef) => PAINTED_PORTRAITS.has(p.file) && !p.story;
  const pool = PORTRAITS.filter(p => usable(p) && !!p.child === !!s.child && (g === 'n' || p.gender === g));
  const list = pool.length ? pool : PORTRAITS.filter(p => usable(p) && !p.child);
  return list[Math.abs(s.portraitIndex) % list.length];
}

export function portraitUrl(def: PortraitDef): string {
  return `${import.meta.env.BASE_URL}art/portraits/${def.file}.webp`;
}

/** The grammatical gender to use for a person in Hebrew sentences: their name decides, and for unisex names the painted face does. */
export function genderOf(s: Pick<SurvivorState, 'name' | 'portraitIndex'> & { child?: boolean; portrait?: string }): 'm' | 'f' {
  const g = nameGender(s.name);
  return g === 'n' ? portraitFor(s).gender : g;
}

/** The same, for someone known only by name: null when the name is unisex and nothing else says which. */
export function genderOfName(name: string): 'm' | 'f' | null {
  const g = nameGender(name);
  return g === 'n' ? null : g;
}
