// The frame history's bookkeeping — pure, unit-tested (timeline.test.ts).
// Frames go round a fixed ring of texture layers at a capped rate; each clone
// shows the layer captured closest to "now − k × spacing", so the delays stay
// right at any frame rate.

export type Timeline = {
  /** Capture time (s) of each layer; NaN until written. */
  times: Float64Array;
  /** The layer written last (−1 before the first capture). */
  head: number;
  /** Earliest time the next capture may happen. */
  nextAt: number;
};

export const createTimeline = (layers: number): Timeline => ({
  times: new Float64Array(layers).fill(NaN),
  head: -1,
  nextAt: -Infinity,
});

/**
 * The layer to capture into at `now` (s), or −1 when it isn't time yet. Marks
 * the layer as captured at `now`.
 */
export const nextCapture = (tl: Timeline, now: number, fps: number): number => {
  if (now < tl.nextAt) return -1;
  // Keep the cadence, but never try to catch up on a backlog after a stall.
  const step = 1 / fps;
  tl.nextAt = Math.max(tl.nextAt + step, now + step * 0.5);
  tl.head = (tl.head + 1) % tl.times.length;
  tl.times[tl.head] = now;
  return tl.head;
};

export type Pick = {
  /** Texture layer per clone (index 0 = newest clone). */
  layers: number[];
  /** 0..1 visibility per clone: the count's fraction fades the last one in. */
  weights: number[];
};

/**
 * Which layer each clone shows at `now`: clone k (1 = newest) is `k × spacing`
 * seconds old. `count` may be fractional. A clone older than the history (just
 * after start), or one that would repeat the previous clone's frame (a very slow
 * device), gets weight 0.
 */
export const pickClones = (
  tl: Timeline,
  now: number,
  count: number,
  spacing: number,
  max: number,
): Pick => {
  const layers: number[] = [];
  const weights: number[] = [];
  const n = tl.times.length;
  for (let k = 1; k <= max; k++) {
    const target = now - k * spacing;
    let best = -1;
    let bestErr = Infinity;
    for (let i = 0; i < n; i++) {
      const t = tl.times[i];
      if (Number.isNaN(t)) continue;
      const err = Math.abs(t - target);
      if (err < bestErr) {
        bestErr = err;
        best = i;
      }
    }
    // The best frame must be roughly that old (within one gap, so a slow device
    // still fills the line) and not the frame the previous clone already shows.
    const ok = best >= 0 && bestErr <= spacing && best !== layers[k - 2];
    layers.push(Math.max(0, best));
    weights.push(ok ? Math.min(1, Math.max(0, count - (k - 1))) : 0);
  }
  return { layers, weights };
};
