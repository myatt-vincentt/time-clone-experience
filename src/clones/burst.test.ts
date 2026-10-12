import { describe, expect, it } from "vitest";

import { createBurst, fanOffset, isBurstMove, stepBurst } from "./burst";
import { BURST, FAN } from "./config";

const run = (
  b: ReturnType<typeof createBurst>,
  seconds: number,
  speed = 0,
  rise = 0,
) => {
  let peak = 0;
  let low = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    stepBurst(b, speed, rise, 1 / 60);
    peak = Math.max(peak, b.value);
    low = Math.min(low, b.value);
  }
  return { peak, low };
};

describe("burst", () => {
  it("fires on a jump or a very fast move, not on dancing", () => {
    expect(isBurstMove(BURST.speed * 1.1, 0)).toBe(true);
    expect(isBurstMove(0, BURST.jump * 1.1)).toBe(true);
    expect(isBurstMove(1.2, 0.2)).toBe(false);
  });

  it("fans out, snaps back past rest, then settles", () => {
    const b = createBurst();
    stepBurst(b, 0, BURST.jump * 2, 1 / 60);
    const { peak, low } = run(b, 3);
    expect(b.count).toBe(1);
    expect(peak).toBeGreaterThan(0.6);
    expect(peak).toBeLessThan(1.3);
    expect(low).toBeLessThan(-0.05); // the snap
    expect(Math.abs(b.value)).toBeLessThan(0.02);
  });

  it("respects the cooldown", () => {
    const b = createBurst();
    run(b, BURST.cooldown * 0.8, BURST.speed * 2);
    expect(b.count).toBe(1);
    run(b, BURST.cooldown, BURST.speed * 2);
    expect(b.count).toBe(2);
  });

  it("stands clones beside you, alternating sides, wider in a burst", () => {
    // At rest: one step per pair, alternating sides.
    expect(fanOffset(1, 0)).toBeCloseTo(-FAN.step);
    expect(fanOffset(2, 0)).toBeCloseTo(FAN.step);
    expect(fanOffset(3, 0)).toBeCloseTo(-2 * FAN.step);
    expect(fanOffset(4, 0)).toBeCloseTo(2 * FAN.step);
    // A burst at its peak widens the fan.
    expect(fanOffset(3, 1)).toBeCloseTo(-2 * FAN.step * (1 + BURST.extra));
  });
});
