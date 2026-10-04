import { i18n } from '../../i18n/I18nManager';
import { vibrate } from '../../utils/haptics';
import { CHARACTERS, shownChoices, shownLines, type Chapter, type StoryEffect, type StoryLine } from '../../data/story';
import type { ResourceType } from '../../core/GameState';
import type { ChapterOutcome } from '../../systems/StorySystem';
import { RESOURCE_ICONS, el, setRich } from '../dom';
import { nameGender } from '../../data/portraits';

export interface StoryPlayOptions {
  chapter: Chapter;
  /** Portrait URL and name for the "crew" speaker (one of the player's own people). */
  crew?: { url: string; name: string } | null;
  portraitUrl: (file: string) => string;
  canChoose: (key: string) => boolean;
  costLabel: (cost: Partial<Record<ResourceType, number>>) => string;
  /** Applies the choice (null for chapters without one) and returns what happened. */
  finish: (key: string | null) => ChapterOutcome;
  /** A chapter this player already saw in an earlier timeline: the talk can be skipped (the decision still has to be made). */
  canSkip?: boolean;
  /** Replaying from the journal: no choices, no effects. */
  replay?: { choice: string | null };
  sfx: (name: string) => void;
  onDone: () => void;
  joinedName?: (name: string) => string;
}

/**
 * Story chapters play as a visual novel scene: a painted portrait, a name plate in the character's color,
 * text typing itself out, and the choices at the end.
 */
export class StoryDialog {
  private overlay = el('div', 'story-overlay');
  private typing = 0;
  private opts: StoryPlayOptions | null = null;
  private queue: StoryLine[] = [];
  private finishing = false;
  private lastPortrait: string | null = null;
  private joinedFemale = false;

  constructor() {
    document.body.appendChild(this.overlay);
  }

  get isVisible(): boolean {
    return this.overlay.classList.contains('open');
  }

  play(opts: StoryPlayOptions): void {
    this.opts = opts;
    this.finishing = false;
    this.lastPortrait = null;
    const locale = i18n.currentLocale;
    this.overlay.replaceChildren();
    const card = el('div', 'story-title-card');
    card.append(
      el('div', 'story-chapter', i18n.t('story.chapter', { n: opts.chapter.number })),
      el('div', 'story-chapter-title', opts.chapter.title[locale]),
    );
    this.overlay.appendChild(card);
    this.overlay.classList.add('open');
    opts.sfx('story');
    this.queue = shownLines(opts.chapter.lines);
    window.setTimeout(() => this.next(), 1700);
  }

  private next(): void {
    const opts = this.opts;
    if (!opts) return;
    const line = this.queue.shift();
    if (line) {
      this.showLine(line);
      return;
    }
    if (this.finishing) {
      this.close();
      return;
    }
    const choices = opts.chapter.choices ?? [];
    if (opts.replay) {
      const chosen = choices.find(c => c.key === opts.replay!.choice);
      this.finishing = true;
      if (chosen) {
        this.queue = shownLines(chosen.reply);
        this.next();
      } else this.close();
      return;
    }
    if (choices.length) this.showChoices();
    else this.resolve(null);
  }

  private stage(): { root: HTMLElement; text: HTMLElement } {
    this.overlay.replaceChildren();
    const root = el('div', 'story-stage');
    const text = el('p', 'story-text');
    this.overlay.appendChild(root);
    return { root, text };
  }

  private showLine(line: StoryLine): void {
    const opts = this.opts!;
    const locale = i18n.currentLocale;
    const { root, text } = this.stage();
    const box = el('div', `story-box ${line.who === 'narrator' ? 'narrator' : ''}`);
    if (line.who !== 'narrator') {
      const ch = CHARACTERS[line.who];
      const url = line.who === 'crew' ? opts.crew?.url : ch.portrait ? opts.portraitUrl(ch.portrait) : null;
      this.lastPortrait = url ?? null;
      if (url) {
        const img = el('img', 'story-portrait');
        img.src = url;
        img.alt = '';
        root.appendChild(img);
      }
      const plate = el('div', 'story-name', line.who === 'crew' && opts.crew ? opts.crew.name : ch.name[locale]);
      plate.style.setProperty('--who', ch.color);
      plate.appendChild(el('span', 'story-role', ch.role[locale]));
      box.appendChild(plate);
      opts.sfx(line.who === 'ezra' || line.who === 'noa' ? 'radio' : 'click');
    }
    box.appendChild(text);
    box.appendChild(el('div', 'story-next', '▼'));
    root.appendChild(box);
    if (opts.canSkip && !this.finishing) {
      const skip = el('button', 'btn btn-small btn-ghost story-skip', i18n.t('story.skip'));
      skip.addEventListener('click', (e) => {
        e.stopPropagation();
        window.clearInterval(this.typing);
        this.queue = [];
        this.next();
      });
      root.appendChild(skip);
    }
    const full = line.text[locale];
    let i = 0;
    window.clearInterval(this.typing);
    let ticks = 0;
    this.typing = window.setInterval(() => {
      i = Math.min(full.length, i + 2);
      text.textContent = full.slice(0, i);
      if (++ticks % 4 === 0) opts.sfx('type');
      if (i >= full.length) window.clearInterval(this.typing);
    }, 22);
    // First tap completes the line, the next one moves on.
    const advance = () => {
      if (i < full.length) {
        window.clearInterval(this.typing);
        i = full.length;
        text.textContent = full;
        return;
      }
      root.removeEventListener('click', advance);
      this.next();
    };
    root.addEventListener('click', advance);
  }

  private showChoices(): void {
    const opts = this.opts!;
    const locale = i18n.currentLocale;
    const { root } = this.stage();
    if (this.lastPortrait) {
      const img = el('img', 'story-portrait dim');
      img.src = this.lastPortrait;
      img.alt = '';
      root.appendChild(img);
    }
    const box = el('div', 'story-box choices');
    box.appendChild(el('div', 'story-ask', i18n.t('story.decide')));
    for (const c of shownChoices(opts.chapter)) {
      const ok = opts.canChoose(c.key);
      const btn = el('button', 'btn btn-primary story-choice');
      setRich(btn, c.label[locale]);
      if (c.effect.cost) btn.appendChild(el('span', 'story-cost', opts.costLabel(c.effect.cost)));
      const people = this.peopleHint(c.effect);
      if (people) {
        const tag = el('span', 'story-cost');
        setRich(tag, people);
        btn.appendChild(tag);
      }
      if (c.check) btn.appendChild(el('span', 'story-cost', i18n.t('story.risky')));
      btn.disabled = !ok;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!ok) return;
        opts.sfx('choice');
        vibrate(12);
        this.resolve(c.key);
      });
      box.appendChild(btn);
    }
    root.appendChild(box);
  }

  private resolve(key: string | null): void {
    const opts = this.opts!;
    const out = opts.finish(key);
    this.finishing = true;
    this.queue = [...out.lines];
    const gains = Object.entries(out.gains).filter(([, v]) => v);
    if (gains.length || out.joined || out.newcomers || out.left?.length || out.hurt) {
      this.joinedFemale = out.joined ? nameGender(out.joined.name) === 'f' : false;
      const text = this.summary(gains as [ResourceType, number][], out.joined ? opts.joinedName?.(out.joined.name) ?? out.joined.name : null);
      const people: string[] = [];
      if (out.newcomers) people.push(i18n.t('story.newcomers', { n: out.newcomers }));
      if (out.left?.length) people.push(i18n.t('story.left', { names: out.left.map(n => opts.joinedName?.(n) ?? n).join(', ') }));
      if (out.hurt) people.push(i18n.t('story.hurt', { n: out.hurt }));
      const all = [text, ...people].filter(Boolean).join(' · ');
      this.queue.push({ who: 'narrator', text: { he: all, en: all } });
    }
    this.next();
  }

  private summary(gains: [ResourceType, number][], joined: string | null): string {
    const parts = gains.map(([r, v]) => `${v > 0 ? '+' : '−'}${Math.abs(Math.round(v))} ${i18n.t(`resources.${r}`)}`);
    if (joined) parts.push(i18n.t(this.joinedFemale ? 'story.joinsF' : 'story.joinsM', { name: joined }));
    return parts.join(' · ');
  }

  /** What a choice does to the people, shown on its button so the hard choices are informed ones. */
  private peopleHint(e: StoryEffect): string {
    const parts: string[] = [];
    if (e.group) parts.push(`[[people]] ${i18n.t('story.hintGroup', { n: e.group })}`);
    if (e.leaves) parts.push(`[[door]] ${i18n.t('story.hintLeaves', { n: e.leaves })}`);
    if (e.hurt) parts.push(`[[bandage]] ${i18n.t('story.hintHurt')}`);
    return parts.join(' · ');
  }

  private close(): void {
    window.clearInterval(this.typing);
    this.overlay.classList.remove('open');
    this.overlay.replaceChildren();
    const done = this.opts?.onDone;
    this.opts = null;
    done?.();
  }
}

export function gainsText(gains: Partial<Record<ResourceType, number>>): string {
  return (Object.entries(gains) as [ResourceType, number][]).map(([r, v]) => `${RESOURCE_ICONS[r] ?? ''}${v}`).join(' ');
}
