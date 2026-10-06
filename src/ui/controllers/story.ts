import { MUTATORS } from '../../data/mutators';
import { SCENARIOS, scenarioUnlocked } from '../../data/scenarios';
import { el } from '../../ui/dom';
import { hideSplash } from '../../ui/splash';
import { DIFFICULTIES } from '../../data/difficulty';
import { AudioEngine } from '../../audio/AudioEngine';
import { i18n } from '../../i18n/I18nManager';
import type { ResourceType } from '../../core/GameState';
import { playIntro } from '../../ui/components/Intro';
import { portraitFor, portraitUrl } from '../../data/portraits';
import { getChapter } from '../../data/story';
import type { GameApp } from '../../app';

/** Story chapters, their replays, and the intro. */
export class StoryController {
  private app: GameApp;

  constructor(app: GameApp) {
    this.app = app;
  }

  /** The strongest adult on the crew speaks for the dig team in the story. */
  crewVoice(): { url: string; name: string } | null {
    const s = [...this.app.state.survivors].filter(x => !x.child).sort((a, b) => b.stats.strength - a.stats.strength)[0];
    return s ? { url: portraitUrl(portraitFor(s)), name: this.app.localName(s.name) } : null;
  }

  chapterOptions(id: string) {
    const ch = getChapter(id)!;
    return {
      chapter: ch,
      crew: this.crewVoice(),
      portraitUrl: (file: string) => `${import.meta.env.BASE_URL}art/portraits/${file}.webp`,
      canChoose: (key: string) => this.app.engine.storySystem.canChoose(id, key),
      costLabel: (cost: Partial<Record<ResourceType, number>>) => (Object.entries(cost) as [ResourceType, number][]).map(([r, v]) => `${i18n.t(`resources.${r}`)} −${v}`).join(' · '),
      sfx: (name: string) => this.app.audio.play(name as Parameters<AudioEngine['play']>[0]),
      joinedName: (n: string) => this.app.localName(n),
    };
  }

  playChapter(id: string): void {
    this.app.pendingChapter = null;
    if (!getChapter(id) || this.app.state.storyFlags.includes(`story:${id}`)) {
      this.app.engine.storySystem.release();
      return;
    }
    this.app.closeSheets();
    this.app.engine.paused = true;
    this.app.storyDialog.play({
      ...this.chapterOptions(id),
      // Seen in an earlier timeline (before Genesis): the scene can be skipped, the decision cannot.
      canSkip: (this.app.state.prestige.storySeen ?? []).includes(id),
      finish: (key: string | null) => {
        const out = this.app.engine.storySystem.finish(id, key);
        this.app.engine.requestSave();
        return out;
      },
      onDone: () => {
        this.app.engine.paused = false;
        this.app.journal.refresh(this.app.state);
      },
    });
  }

  replayChapter(id: string): void {
    const ch = getChapter(id);
    if (!ch) return;
    const choice = ch.choices?.find(c => this.app.state.storyFlags.includes(`choice:${id}:${c.key}`))?.key ?? null;
    this.app.closeSheets();
    this.app.storyDialog.play({
      ...this.chapterOptions(id),
      replay: { choice },
      finish: () => ({ lines: [], gains: {}, joined: null }),
      onDone: () => this.app.journal.show(this.app.state),
    });
  }

  playIntroSequence(): void {
    // [Long game] A new game first asks how hard the world should be.
    if (!this.app.state.storyFlags.includes('difficulty:chosen')) {
      this.chooseDifficulty(() => this.playIntroSequence());
      return;
    }
    this.app.introPlaying = true;
    this.app.engine.paused = true;
    document.body.classList.add('intro-active');
    // Start looking at the dark dormitory where the newcomers make camp.
    this.app.renderer.focusOn(150, 120, 1.6);
    playIntro({
      play: (sfx) => this.app.audio.play(sfx),
      onDone: () => {
        this.app.introPlaying = false;
        this.app.engine.paused = false;
        document.body.classList.remove('intro-active');
        this.app.engine.stateManager.applyDelta({ path: 'storyFlags', value: [...new Set([...this.app.state.storyFlags, 'intro:done'])] });
        this.app.engine.requestSave();
        this.app.toasts.show(`[[flashlight]] ${i18n.t('intro.firstHint')}`, 'info');
      },
    });
  }

  /** [P3-5] After a Genesis: where the next timeline begins (the bunker just finished stays on as a home). */
  chooseScenario(then: () => void): void {
    const locale = i18n.currentLocale;
    const state = this.app.state;
    this.app.modal.show({
      icon: '[[surface]]',
      title: i18n.t('scenario.title'),
      body: i18n.t('scenario.body'),
      actions: SCENARIOS.filter(s => scenarioUnlocked(state, s.id)).map(s => ({
        label: `${s.icon} ${s.name[locale]}`,
        className: s.id === 'bunker17' ? 'btn-secondary' : 'btn-primary',
        detail: el('span', 'difficulty-desc', `${s.tagline[locale]} · ${s.rules[locale]}`),
        onClick: () => {
          this.app.engine.setScenario(s.id);
          this.app.modal.hide();
          this.app.audio.play('click');
          then();
        },
      })),
    });
  }

  /** [P5] After a Genesis: the new run's mutators, toggled on and off, then begun. */
  chooseMutators(picked: string[] = this.app.state.longGame?.meta.mutators ?? []): void {
    const locale = i18n.currentLocale;
    const legacy = MUTATORS.filter(m => picked.includes(m.id)).reduce((s, m) => s + m.legacy, 0);
    this.app.modal.show({
      icon: '[[sparkle]]',
      title: i18n.t('mutators.title'),
      body: i18n.t('mutators.body', { n: Math.round(legacy * 100) }),
      actions: [
        ...MUTATORS.map(m => ({
          label: `${picked.includes(m.id) ? '✓ ' : ''}${m.icon} ${m.name[locale]} (+${Math.round(m.legacy * 100)}%)`,
          className: picked.includes(m.id) ? 'btn-primary' : 'btn-secondary',
          detail: el('span', 'difficulty-desc', m.desc[locale]),
          onClick: () => this.chooseMutators(picked.includes(m.id) ? picked.filter(x => x !== m.id) : [...picked, m.id]),
        })),
        {
          label: i18n.t('mutators.begin'), className: 'btn-primary',
          onClick: () => { this.app.engine.setMutators(picked); this.app.modal.hide(); },
        },
      ],
    });
  }

  /** The three difficulties as one choice; `then` runs once one is picked. */
  chooseDifficulty(then: () => void): void {
    hideSplash();
    this.app.engine.paused = true;
    this.app.modal.show({
      icon: '[[skull]]',
      title: i18n.t('difficulty.title'),
      body: i18n.t('difficulty.body'),
      actions: DIFFICULTIES.map(d => ({
        label: `${d.icon} ${i18n.t(`difficulty.${d.id}`)}`,
        className: d.id === 'warden' ? 'btn-primary' : 'btn-secondary',
        detail: el('span', 'difficulty-desc', i18n.t(`difficulty.${d.id}.desc`)),
        onClick: () => {
          this.app.modal.hide();
          this.app.engine.setDifficulty(d.id);
          this.app.audio.play('click');
          then();
        },
      })),
    });
  }
}
