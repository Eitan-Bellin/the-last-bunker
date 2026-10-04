export type QualityLevel = 'high' | 'medium' | 'low';

export class PerformanceMonitor {
  private frameTimes: number[] = [];
  private maxSamples = 60;
  private lastTime = 0;
  quality: QualityLevel = 'high';
  private downgradeThreshold = 40;
  private upgradeThreshold = 55;
  private stableFrames = 0;
  private requiredStableFrames = 120;
  lowBattery = false;

  /**
   * `targetMs` is how long the picture wants to take (the engine draws at 60, 30 or 15 fps depending on touch):
   * frames are judged against it, so a deliberate 30 fps is not mistaken for a struggling device.
   */
  recordFrame(timestamp: number, targetMs = 1000 / 60): void {
    if (this.lastTime > 0) {
      const delta = (timestamp - this.lastTime) * ((1000 / 60) / targetMs);
      this.frameTimes.push(delta);
      if (this.frameTimes.length > this.maxSamples) {
        this.frameTimes.shift();
      }
    }
    this.lastTime = timestamp;
  }

  get averageFps(): number {
    if (this.frameTimes.length === 0) return 60;
    const avgDelta = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    return 1000 / avgDelta;
  }

  update(): void {
    const fps = this.averageFps;

    if (fps < this.downgradeThreshold) {
      this.stableFrames = 0;
      if (this.quality === 'high') this.quality = 'medium';
      else if (this.quality === 'medium') this.quality = 'low';
    } else if (fps > this.upgradeThreshold) {
      this.stableFrames++;
      if (this.stableFrames > this.requiredStableFrames && !this.lowBattery) {
        if (this.quality === 'low') this.quality = 'medium';
        else if (this.quality === 'medium') this.quality = 'high';
        this.stableFrames = 0;
      }
    } else {
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
