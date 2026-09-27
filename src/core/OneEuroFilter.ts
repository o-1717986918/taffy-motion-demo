import { clamp } from "./math";

class LowPassFilter {
  private value: number | undefined;

  filter(value: number, alpha: number): number {
    this.value = this.value === undefined ? value : alpha * value + (1 - alpha) * this.value;
    return this.value;
  }

  reset(): void {
    this.value = undefined;
  }
}

export class OneEuroFilter {
  private readonly valueFilter = new LowPassFilter();
  private readonly derivativeFilter = new LowPassFilter();
  private lastValue: number | undefined;
  private lastTimeMs: number | undefined;

  constructor(
    private readonly minCutoff = 1.2,
    private readonly beta = 0.08,
    private readonly derivativeCutoff = 1
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return clamp(1 / (1 + tau / dt));
  }

  filter(value: number, timeMs: number): number {
    if (this.lastTimeMs === undefined || this.lastValue === undefined) {
      this.lastTimeMs = timeMs;
      this.lastValue = value;
      return this.valueFilter.filter(value, 1);
    }
    const dt = clamp((timeMs - this.lastTimeMs) / 1000, 1 / 240, 1 / 5);
    const derivative = (value - this.lastValue) / dt;
    const smoothedDerivative = this.derivativeFilter.filter(derivative, this.alpha(this.derivativeCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDerivative);
    const filtered = this.valueFilter.filter(value, this.alpha(cutoff, dt));
    this.lastTimeMs = timeMs;
    this.lastValue = value;
    return filtered;
  }

  reset(): void {
    this.valueFilter.reset();
    this.derivativeFilter.reset();
    this.lastValue = undefined;
    this.lastTimeMs = undefined;
  }
}
