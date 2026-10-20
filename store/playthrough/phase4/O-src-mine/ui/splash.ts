/** The dark plate from index.html that covers the first moments (before the game is ready). */
export function hideSplash(): void {
  const el = document.getElementById('splash');
  if (!el) return;
  el.classList.add('gone');
  setTimeout(() => el.remove(), 700);
}

/**
 * [plan4:UX-18] A thin bar under the title that moves as the start really progresses (graphics ready, save loaded and the time away
 * worked through, paintings decoded), so a slow first start on a phone does not look like a hang. 0..1.
 */
export function setSplashProgress(fraction: number): void {
  const el = document.getElementById('splash');
  if (!el) return;
  let bar = el.querySelector<HTMLElement>('.splash-progress > i');
  if (!bar) {
    const track = document.createElement('div');
    track.className = 'splash-progress';
    track.setAttribute('aria-hidden', 'true');
    bar = document.createElement('i');
    track.appendChild(bar);
    el.appendChild(track);
  }
  bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}
