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
}
