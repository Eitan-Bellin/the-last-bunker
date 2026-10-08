import { el } from '../dom';

// [plan4:UX-20] The label over a survivor the player is carrying: "Move to <room>" (green, check) or why the room cannot take them (red, cross).
// It sits above the carried sprite and follows the finger; the room under the sprite gets a ring on the canvas (BunkerRenderer.setDropRing).

export class DropChip {
  private readonly node = el('div', 'placement-chips drop-chip');
  private lastText = '';
  private lastKind = '';

  constructor(parent: HTMLElement = document.body) {
    this.node.style.display = 'none';
    this.node.setAttribute('aria-hidden', 'true'); // a drag has its own keyboard / button alternative (the people panel's "assign to room")
    parent.appendChild(this.node);
  }

  /** Shows the label above (x, y) in screen px (the finger), kept inside the screen. */
  show(text: string, ok: boolean, x: number, y: number, hudTop: number): void {
    const kind = ok ? 'good' : 'bad';
    if (text !== this.lastText || kind !== this.lastKind) {
      this.lastText = text;
      this.lastKind = kind;
      this.node.replaceChildren(el('span', `pl-chip ${kind}`, text));
    }
    this.node.style.display = '';
    const w = this.node.offsetWidth || 160;
    const cx = Math.max(8 + w / 2, Math.min(window.innerWidth - 8 - w / 2, x));
    // Above the sprite (it hovers 44 px over the finger and is about 50 px tall); below the finger when the top of the screen is too near.
    const above = y - 44 - 62;
    const top = above < hudTop + 4 ? y + 36 : above;
    this.node.style.left = `${cx}px`;
    this.node.style.top = `${top}px`;
    this.node.style.transform = 'translate(-50%, 0)';
  }

  hide(): void {
    this.node.style.display = 'none';
    this.lastText = '';
    this.lastKind = '';
  }
}
