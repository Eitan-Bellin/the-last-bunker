export type QualityLevel = 'high' | 'medium' | 'low';

/** Seconds after the start (and after coming back to the page) during which frames are not judged: textures decode, the first pictures hitch. */
const WARMUP_MS = 20_000;
/** A window must be bad this many times in a row before the level drops: one hitch (a texture upload, a GC) must not strip the effects. */
const BAD_WINDOWS = 3;

export class PerformanceMonitor {
  private frameTimes: number[] = [];
  private maxSamples = 60;
  private lastTime = 0;
  quality: QualityLevel = 'high';
  /** Automatic quality never climbs past this (phones stay at medium unless the player picks high). */
  maxQuality: QualityLevel = 'high';
  private downgradeThreshold = 40;
  private upgradeThreshold = 55;
  private stableFrames = 0;
  private badWindows = 0;
  private requiredStableFrames = 60;
  private quietUntil = performance.now() + WARMUP_MS;
  lowBattery = false;

  /**
   * `targetMs` is how long the picture wants to take (the engine draws at 60, 30 or 15 fps depending on touch):
   * frames are judged against it, so a deliberate 30 fps is not mistaken for a struggling device.
   */
  recordFrame(timestamp: number, targetMs = 1000 / 60): void {
    if (this.lastTime > 0) {
      const gap = timestamp - this.lastTime;
      // A gap of seconds is the page being away or a hand-off between picture rates, not the speed of the device.
      if (gap > 1000) this.quietUntil = timestamp + 5000;
      else {
        this.frameTimes.push(gap * ((1000 / 60) / targetMs));
        if (this.frameTimes.length > this.maxSamples) this.frameTimes.shift();
      }
    }
    this.lastTime = timestamp;
  }

  /** Typical (median) picture rate in 60-fps terms: a lone slow frame does not move it. */
  get averageFps(): number {
    if (this.frameTimes.length === 0) return 60;
    const s = this.frameTimes.slice().sort((a, b) => a - b);
    return 1000 / s[s.length >> 1];
  }

  /**
   * Judged about once a second. The level only drops after a few bad windows in a row (and never during warm-up), and the
   * rates the picture aims for fall with it (see PostFX.profile), so a step down really cools the device instead of only
   * trading away bloom.
   */
  update(): void {
    if (performance.now() < this.quietUntil) {
      this.badWindows = 0;
      this.stableFrames = 0;
      return;
    }
    const fps = this.averageFps;

    if (fps < this.downgradeThreshold) {
      this.stableFrames = 0;
      if (++this.badWindows >= BAD_WINDOWS) {
        this.badWindows = 0;
        if (this.quality === 'high') this.quality = 'medium';
        else if (this.quality === 'medium') this.quality = 'low';
        this.frameTimes.length = 0; // judge the new level on its own frames
        this.quietUntil = performance.now() + 5000;
      }
    } else if (fps > this.upgradeThreshold) {
      this.badWindows = 0;
      this.stableFrames++;
      if (this.stableFrames > this.requiredStableFrames && !this.lowBattery) {
        if (this.quality === 'low') this.quality = 'medium';
        else if (this.quality === 'medium' && this.maxQuality === 'high') this.quality = 'high';
        this.stableFrames = 0;
        this.frameTimes.length = 0;
        this.quietUntil = performance.now() + 5000;
      }
    } else {
      this.badWindows = 0;
      this.stableFrames = 0;
    }
  }

  checkBattery(): void {
    if ('getBattery' in navigator) {
      (navigator as Navigator & { getBattery: () => Promise<{ level: number; charging: boolean }> })
        .getBattery()
        .then(battery => {
          this.lowBattery = battery.level < 0.15 && !battery.charging;
          if (this.lowBattery && this.quality === 'high') {
            this.quality = 'medium';
          }
        })
        .catch(() => {});
    }
  }
}
