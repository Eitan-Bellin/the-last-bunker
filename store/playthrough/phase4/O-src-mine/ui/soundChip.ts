import { el } from './dom';
import { i18n } from '../i18n/I18nManager';

/**
 * [plan4:UX-1] "Tap to enable sound": shown while the audio context is suspended/interrupted although the player wants sound.
 * Icon + text (never colour alone). The tap itself is the gesture the browser needs: AudioEngine listens for it on the window.
 */
let chip: HTMLButtonElement | null = null;

export function setSoundChip(visible: boolean): void {
  if (visible && !chip) {
    chip = el('button', 'sound-chip', `[[mute]] ${i18n.t('audio.tapToEnable')}`);
    chip.setAttribute('role', 'status');
    document.body.appendChild(chip);
  }
  if (chip) chip.classList.toggle('show', visible);
}
