// Clone burst — pure, unit-tested (burst.test.ts). A jump or a very fast move
// kicks a damped spring; its value (0 at rest, ~1 at the peak) throws the
// clones' fan wider and the spring snaps it back, overshooting a little.
import { BURST, FAN } from "./config";

export type Burst = {
  /** Spread: 0 at rest, ~1 at the peak (briefly negative on the snap back). */
  value: number;
  velocity: number;
  cooldown: number;
  /** Bursts fired so far (for the dev hook and prompts). */
  count: number;
};

export const createBurst = (): Burst => ({
  value: 0,
  velocity: 0,
  cooldown: 0,
  count: 0,
});

/** True when this movement should fire a burst (ignoring the cooldown). */
export const isBurstMove = (speed: number, rise: number) =>
  speed > BURST.speed || rise > BURST.jump;

/** Advance the burst; `speed` / `rise` come from motion.ts. Mutates `b`. */
export const stepBurst = (
  b: Burst,
  speed: number,
  rise: number,
  dt: number,
) => {
  const step = Math.max(0, Math.min(dt, 0.1));
  b.cooldown = Math.max(0, b.cooldown - step);
  if (b.cooldown === 0 && isBurstMove(speed, rise)) {
    b.velocity += BURST.kick;
    b.cooldown = BURST.cooldown;
    b.count++;
  }
  const omega = 2 * Math.PI * BURST.freq;
  const n = Math.max(1, Math.ceil(step / (1 / 120)));
  const h = step / n;
  for (let i = 0; i < n; i++) {
    const accel =
      -omega * omega * b.value - 2 * BURST.damping * omega * b.velocity;
    b.velocity += accel * h;
    b.value += b.velocity * h;
  }
};

/**
 * Clone k's sideways offset (share of the screen width) with burst `value`: the
 * clones alternate left / right, each pair a step further out, so they stand
 * beside you rather than on top of you; a burst widens the fan. k = 1 is the
 * newest clone.
 */
export const fanOffset = (k: number, value: number) =>
  (k % 2 === 1 ? -1 : 1) *
  Math.ceil(k / 2) *
  FAN.step *
  (1 + BURST.extra * value);
