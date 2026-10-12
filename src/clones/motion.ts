// Movement from the person mask — pure, unit-tested (motion.test.ts).
// A coarse occupancy grid: the share of the silhouette that changes per second,
// smoothed, is the "pulse" that brings the clones out.
import { MOTION } from "./config";

export type Motion = {
  cols: number;
  rows: number;
  occ: Uint8Array;
  /** 0..1, smoothed movement. */
  pulse: number;
  /** Occupied grid cells (0 when nobody is in view). */
  active: number;
  /** This frame's silhouette change (share of it per second), unsmoothed. */
  speed: number;
  /** Body centre height (0 bottom … 1 top) and its upward speed (screen heights / s). */
  centreY: number | null;
  rise: number;
  primed: boolean;
};

export const createMotion = (cols: number, rows: number): Motion => ({
  cols,
  rows,
  occ: new Uint8Array(cols * rows),
  pulse: 0,
  active: 0,
  speed: 0,
  centreY: null,
  rise: 0,
  primed: false,
});

/** Rise smoothing rate (1/s). */
const RISE_RATE = 15;

export type MaskLike = { width: number; height: number; indices: Uint8Array };

/** Feed a new mask; `dt` = seconds since the previous mask. */
export const updateMotion = (
  m: Motion,
  mask: MaskLike,
  personIndex: number,
  dt: number,
) => {
  const { cols, rows, occ } = m;
  const prevActive = m.active;
  let changed = 0;
  let active = 0;
  let sumRow = 0;
  for (let r = 0; r < rows; r++) {
    const y = Math.min(
      mask.height - 1,
      Math.floor(((r + 0.5) / rows) * mask.height),
    );
    for (let c = 0; c < cols; c++) {
      const x = Math.min(
        mask.width - 1,
        Math.floor(((c + 0.5) / cols) * mask.width),
      );
      const v = mask.indices[y * mask.width + x] === personIndex ? 1 : 0;
      const i = r * cols + c;
      if (v !== occ[i]) changed++;
      occ[i] = v;
      active += v;
      sumRow += v * (r + 0.5);
    }
  }
  m.active = active;

  // Centre height (grid row 0 = top) and how fast it rises, lightly smoothed
  // (one noisy mask shouldn't read as a jump). Frames where the silhouette's
  // size jumps (someone stepping in or out) don't count.
  const centreY = active > 0 ? 1 - sumRow / active / rows : null;
  const steady = Math.abs(active - prevActive) <= 0.3 * Math.max(active, 1);
  const rawRise =
    m.centreY !== null && centreY !== null && dt > 0 && steady
      ? (centreY - m.centreY) / dt
      : 0;
  m.rise += (rawRise - m.rise) * Math.min(1, dt * RISE_RATE);
  m.centreY = centreY;
  m.speed = m.primed && dt > 0 && active > 0 ? changed / active / dt : 0;

  // Movement: share of the silhouette that changed, per second (first frame primes only).
  if (m.primed && dt > 0 && active > 0) {
    const target = Math.min(1, m.speed / MOTION.full);
    const rate = target > m.pulse ? MOTION.attack : MOTION.release;
    m.pulse += (target - m.pulse) * Math.min(1, dt * rate);
  } else if (active === 0) {
    m.pulse = Math.max(0, m.pulse - dt * MOTION.release);
  }
  m.primed = true;
};
