import { i18n } from '../../i18n/I18nManager';
import { el } from '../dom';

interface Panel {
  image: string;
  text: Record<string, string>;
  sound?: 'siren' | 'wind' | 'door';
}

const PANELS: Panel[] = [
  {
    image: 'story/intro-1',
    sound: 'siren',
    text: { he: 'יום האפר. הערים בערו, והעולם השתתק.', en: 'Ashes Day. The cities burned, and the world fell silent.' },
  },
  {
    image: 'story/intro-2',
    sound: 'wind',
    text: { he: 'שבע שנים אחר כך, שלושה ניצולים מצאו דלת חצי קבורה בגבעה. בונקר 17.', en: 'Seven years later, three survivors found a half-buried door in a hillside. Bunker 17.' },
  },
  {
    image: 'story/intro-3',
    sound: 'door',
    text: { he: 'בפנים: חושך, אבק, ופתק אחד. "למי שמוצא את המקום הזה."', en: 'Inside: darkness, dust, and a single note. "To whoever finds this place."' },
  },
];

const PANEL_MS = 6500;

/**
 * Opening sequence: three painted story panels with slow camera drift and narration,
 * the title card, then a flashlight sweep that reveals the dead bunker behind the overlay.
 */
export function playIntro(opts: { play: (s: 'siren' | 'wind' | 'door' | 'click') => void; onDone: () => void }): void {
  const base = import.meta.env.BASE_URL;
  const overlay = el('div', 'intro');
  const stage = el('div', 'intro-stage');
  const caption = el('div', 'intro-caption');
  const skip = el('button', 'intro-skip', i18n.t('intro.skip'));
  overlay.append(stage, caption, skip);
  document.body.appendChild(overlay);

  let index = -1;
  let timer = 0;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timer);
    flashlight();
  };

  const showPanel = (i: number) => {
    index = i;
    window.clearTimeout(timer);
    if (i >= PANELS.length) {
      titleCard();
      return;
    }
    const p = PANELS[i];
    const img = el('div', 'intro-image');
    img.style.backgroundImage = `url(${base}art/${p.image}.webp), radial-gradient(ellipse at 50% 40%, #3a2a1c, #07070a 70%)`;
    img.classList.add(i % 2 ? 'drift-left' : 'drift-right');
    stage.replaceChildren(img);
    // Flush the start state, then fade in. (A requestAnimationFrame here never fires in a
    // throttled tab, which left the panels stuck near-black.)
    void img.offsetWidth;
    img.classList.add('in');
    caption.classList.remove('in');
    caption.textContent = p.text[i18n.currentLocale];
    setTimeout(() => caption.classList.add('in'), 500);
    if (p.sound) opts.play(p.sound);
    timer = window.setTimeout(() => showPanel(i + 1), PANEL_MS);
  };

  const titleCard = () => {
    caption.classList.remove('in');
    const title = el('div', 'intro-title');
    // [ux-wp6: retention R12] The long goal, said once at the very start: seven Acts, then Genesis, and four endings.
    const goal = el('div', 'intro-title-sub intro-title-goal', i18n.t('wp6.intro.goal'));
    goal.style.letterSpacing = 'normal';
    goal.style.marginTop = '18px';
    goal.style.maxWidth = '30em';
    goal.style.marginInline = 'auto';
    title.append(
      el('div', 'intro-title-main', i18n.t('intro.title')),
      el('div', 'intro-title-sub', i18n.t('intro.day')),
      goal,
    );
    stage.replaceChildren(title);
    void title.offsetWidth;
    title.classList.add('in');
    timer = window.setTimeout(finish, 4600);
  };

  /** A torch beam wanders over the dark bunker, then the darkness lifts. */
  const flashlight = () => {
    stage.replaceChildren();
    caption.classList.remove('in');
    skip.remove();
    overlay.classList.remove('at-gate');
    overlay.classList.add('torch');
    const path = [[0.5, 0.42], [0.3, 0.5], [0.62, 0.58], [0.45, 0.66], [0.5, 0.52]];
    const start = performance.now();
    const dur = 4200;
    let done = false;
    const complete = () => {
      if (done) return;
      done = true;
      overlay.classList.add('out');
      setTimeout(() => overlay.remove(), 900);
      opts.onDone();
    };
    // If animation frames stall (tab in the background) the bunker still opens on time.
    setTimeout(complete, dur + 600);
    const step = (now: number) => {
      // rAF timestamps can predate the start mark by a frame; never let k go negative.
      const k = Math.max(0, Math.min(1, (now - start) / dur));
      const seg = Math.min(path.length - 2, Math.floor(k * (path.length - 1)));
      const t = k * (path.length - 1) - seg;
      const e = t * t * (3 - 2 * t);
      const x = path[seg][0] + (path[seg + 1][0] - path[seg][0]) * e;
      const y = path[seg][1] + (path[seg + 1][1] - path[seg][1]) * e;
      const r = 110 + 40 * Math.sin(now / 300) * 0.1 + (k > 0.8 ? (k - 0.8) * 5 * 900 : 0);
      overlay.style.setProperty('--tx', `${(x * 100).toFixed(1)}%`);
      overlay.style.setProperty('--ty', `${(y * 100).toFixed(1)}%`);
      overlay.style.setProperty('--tr', `${r.toFixed(0)}px`);
      if (k < 1 && !done) requestAnimationFrame(step);
      else complete();
    };
    requestAnimationFrame(step);
  };

  // The first tap both starts the story and unlocks audio on mobile.
  const gate = buildGate(base);
  stage.appendChild(gate);
  overlay.classList.add('at-gate');
  let opening = false;
  overlay.addEventListener('click', (e) => {
    if (e.target === skip || finished || opening) return;
    if (index < 0) {
      // The camera pushes into the vault door, then the story begins.
      opening = true;
      opts.play('click');
      gate.classList.add('opening');
      window.setTimeout(() => {
        opening = false;
        overlay.classList.remove('at-gate');
        if (!finished) showPanel(0);
      }, 650);
    } else if (index < PANELS.length) showPanel(index + 1);
  });
  skip.addEventListener('click', (e) => {
    e.stopPropagation();
    finish();
  });
}

/** The other language's name under the main title, so the lockup reads as a logo in both. */
const SUBTITLE: Record<string, string> = { he: 'THE LAST BUNKER', en: 'הבונקר האחרון' };

/**
 * The first screen: the era-0 wasteland at dusk, the title lockup, vault door 17 with a live
 * hub lamp, drifting ash and a lit "tap to enter" plate. Existing art only, CSS motion only.
 */
function buildGate(base: string): HTMLElement {
  const gate = el('div', 'intro-gate');
  const sky = el('div', 'gate-sky');
  sky.style.backgroundImage = `url(${base}art/backdrops/surface-0.webp)`;

  const ash = el('div', 'gate-ash');
  for (let i = 0; i < 22; i++) {
    const flake = el('span');
    // Deterministic scatter: same look every launch, no Math.random clumps.
    const r = (k: number) => ((Math.sin((i + 1) * 12.9898 * k) * 43758.5453) % 1 + 1) % 1;
    flake.style.setProperty('--x', `${(r(1) * 100).toFixed(1)}%`);
    flake.style.setProperty('--d', `${(9 + r(2) * 9).toFixed(1)}s`);
    flake.style.setProperty('--delay', `${(-r(3) * 18).toFixed(1)}s`);
    flake.style.setProperty('--s', `${(1.5 + r(4) * 2.5).toFixed(1)}px`);
    flake.style.setProperty('--sway', `${(-30 + r(5) * 60).toFixed(0)}px`);
    ash.appendChild(flake);
  }

  const lockup = el('div', 'gate-lockup');
  lockup.append(
    el('div', 'gate-title', i18n.t('intro.title')),
    el('div', 'gate-sub', SUBTITLE[i18n.currentLocale] ?? SUBTITLE.en),
    el('div', 'gate-day', i18n.t('intro.day')),
  );

  const door = el('div', 'gate-door');
  const doorImg = el('div', 'gate-door-img');
  doorImg.style.backgroundImage = `url(${base}art/ui/gate-door.webp)`;
  door.append(doorImg, el('div', 'gate-hub'));

  const cta = el('div', 'gate-cta');
  cta.append(el('span', 'gate-lamp'), el('span', 'gate-cta-text', i18n.t('intro.tap')));

  gate.append(sky, ash, door, lockup, cta);
  return gate;
}
