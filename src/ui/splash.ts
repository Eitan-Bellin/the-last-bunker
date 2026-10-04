/** The dark plate from index.html that covers the first moments (before the game is ready). */
export function hideSplash(): void {
  const el = document.getElementById('splash');
  if (!el) return;
  el.classList.add('gone');
  setTimeout(() => el.remove(), 700);
}
