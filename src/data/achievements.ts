import type { GameState, ResourceType } from '../core/GameState';
import { getDef } from './buildingDefs';

export interface AchievementDef {
  id: string;
  icon: string;
  name: Record<string, string>;
  desc: Record<string, string>;
  reward: Partial<Record<ResourceType, number>>;
  check: (s: GameState) => boolean;
}

const researched = (s: GameState) => Object.values(s.research).filter(r => r.completed).length;
const built = (s: GameState) => s.buildings.filter(b => !(b.isConstructing && b.level === 1));

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'firstSteps', icon: '[[build]]', reward: { materials: 30 },
    name: { he: 'צעדים ראשונים', en: 'First Steps' }, desc: { he: 'בנה 4 מבנים', en: 'Build 4 rooms' },
    check: s => built(s).length >= 4,
  },
  {
    id: 'growingBunker', icon: '[[district]]', reward: { materials: 100, scrap: 20 },
    name: { he: 'בונקר גדל', en: 'Growing Bunker' }, desc: { he: 'בנה 10 מבנים', en: 'Build 10 rooms' },
    check: s => built(s).length >= 10,
  },
  {
    id: 'allFloors', icon: '[[elevator]]', reward: { materials: 60 },
    name: { he: 'כל הקומות', en: 'Every Level' }, desc: { he: 'מבנה בכל אחת משלוש הקומות', en: 'A room on all three levels' },
    check: s => [0, 1, 2].every(f => s.buildings.some(b => b.position.floor === f)),
  },
  {
    id: 'pop6', icon: '[[people]]', reward: { food: 50, water: 50 },
    name: { he: 'משפחה', en: 'Family' }, desc: { he: '6 ניצולים', en: '6 survivors' },
    check: s => s.survivors.length >= 6,
  },
  {
    id: 'pop12', icon: '[[district]]', reward: { materials: 150 },
    name: { he: 'קהילה', en: 'Community' }, desc: { he: '12 ניצולים', en: '12 survivors' },
    check: s => s.survivors.length >= 12,
  },
  {
    id: 'pop20', icon: '[[district]]', reward: { materials: 300, blueprints: 1 },
    name: { he: 'עיר תת־קרקעית', en: 'Underground City' }, desc: { he: '20 ניצולים', en: '20 survivors' },
    check: s => s.survivors.length >= 20,
  },
  {
    id: 'firstResearch', icon: '[[research]]', reward: { knowledge: 15 },
    name: { he: 'ידע הוא כוח', en: 'Knowledge Is Power' }, desc: { he: 'השלם מחקר', en: 'Complete a research' },
    check: s => researched(s) >= 1,
  },
  {
    id: 'scholar', icon: '[[cap]]', reward: { knowledge: 80 },
    name: { he: 'מלומד', en: 'Scholar' }, desc: { he: '10 מחקרים', en: '10 researches' },
    check: s => researched(s) >= 10,
  },
  {
    id: 'firstExpedition', icon: '[[walker]]', reward: { scrap: 20 },
    name: { he: 'אל האור', en: 'Into the Light' }, desc: { he: 'השלם משלחת ראשונה', en: 'Complete an expedition' },
    check: s => s.stats.totalMissionsCompleted >= 1,
  },
  {
    id: 'explorer', icon: '[[map]]', reward: { scrap: 80, blueprints: 1 },
    name: { he: 'חוקר', en: 'Explorer' }, desc: { he: '20 משלחות', en: '20 expeditions' },
    check: s => s.stats.totalMissionsCompleted >= 20,
  },
  {
    id: 'harvest', icon: '[[wheat]]', reward: { food: 80 },
    name: { he: 'יבול ראשון', en: 'First Harvest' }, desc: { he: 'ייצר 500 אוכל', en: 'Produce 500 food' },
    check: s => s.stats.totalFoodProduced >= 500,
  },
  {
    id: 'feast', icon: '[[food]]', reward: { materials: 200 },
    name: { he: 'שפע', en: 'Abundance' }, desc: { he: 'ייצר 10,000 אוכל', en: 'Produce 10,000 food' },
    check: s => s.stats.totalFoodProduced >= 10000,
  },
  {
    id: 'veteran', icon: '[[star]]', reward: { knowledge: 30 },
    name: { he: 'ותיק/ה', en: 'Veteran' }, desc: { he: 'ניצול/ה ברמה 5', en: 'A survivor at level 5' },
    check: s => s.survivors.some(x => x.level >= 5),
  },
  {
    id: 'maxRoom', icon: '[[crown]]', reward: { scrap: 60 },
    name: { he: 'שלמות', en: 'Perfection' }, desc: { he: 'מבנה ברמה מקסימלית', en: 'A room at max level' },
    check: s => s.buildings.some(b => !b.isConstructing && b.level >= (getDef(b.type)?.maxLevel ?? 99)),
  },
  {
    id: 'reactorOnline', icon: '[[reactor]]', reward: { knowledge: 100 },
    name: { he: 'כור פעיל', en: 'Reactor Online' }, desc: { he: 'הפעל כור גרעיני', en: 'Bring a reactor online' },
    check: s => built(s).some(b => b.type === 'reactor'),
  },
  {
    id: 'contact', icon: '[[dish]]', reward: { knowledge: 40 },
    name: { he: 'יצירת קשר', en: 'Contact' }, desc: { he: 'ענה לשידור המסתורי', en: 'Answer the mysterious broadcast' },
    check: s => s.storyFlags.includes('event:radioSignal2'),
  },
  {
    id: 'vault', icon: '[[isotope7]]', reward: { scrap: 150 },
    name: { he: 'הכספת', en: 'The Vault' }, desc: { he: 'מצא את כספת בראשית', en: 'Find the Genesis Vault' },
    check: s => s.storyFlags.includes('vaultFound'),
  },
  {
    id: 'reborn', icon: '[[refresh]]', reward: { materials: 100, food: 100, water: 100 },
    name: { he: 'לידה מחדש', en: 'Reborn' }, desc: { he: 'השלם את פרויקט בראשית', en: 'Complete Project Genesis' },
    check: s => s.prestige.rebirthCount >= 1,
  },
];
