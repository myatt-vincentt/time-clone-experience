import { describe, expect, it } from "vitest";

import { createTimeline, nextCapture, pickClones } from "./timeline";

/** Run captures at `fps` for `seconds`, rendering at `renderFps`. */
const run = (layers: number, fps: number, seconds: number, renderFps = 60) => {
  const tl = createTimeline(layers);
  let t = 0;
  for (; t <= seconds; t += 1 / renderFps) nextCapture(tl, t, fps);
  return { tl, now: t - 1 / renderFps };
};

describe("nextCapture", () => {
  it("captures at the capped rate and goes round the ring", () => {
    const { tl } = run(8, 30, 1, 120);
    const captured = Array.from(tl.times).filter((v) => !Number.isNaN(v));
    expect(captured).toHaveLength(8);
    // ~31 captures in a second, so the ring wrapped and holds the newest 8.
    const sorted = [...captured].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++)
      expect(sorted[i] - sorted[i - 1]).toBeCloseTo(1 / 30, 1);
    expect(sorted[sorted.length - 1]).toBeGreaterThan(0.95);
  });

  it("doesn't catch up on a backlog after a stall", () => {
    const tl = createTimeline(8);
    nextCapture(tl, 0, 30);
    expect(nextCapture(tl, 5, 30)).toBeGreaterThanOrEqual(0);
    // Right after: not due yet.
    expect(nextCapture(tl, 5.001, 30)).toBe(-1);
  });
});

describe("pickClones", () => {
  it("gives clone k the frame about k × spacing old", () => {
    const { tl, now } = run(32, 30, 3);
    const pick = pickClones(tl, now, 8, 0.1, 8);
    for (let k = 1; k <= 8; k++) {
      const age = now - tl.times[pick.layers[k - 1]];
      expect(Math.abs(age - k * 0.1)).toBeLessThan(0.034);
      expect(pick.weights[k - 1]).toBe(1);
    }
  });

  it("fades the last clone in with a fractional count", () => {
    const { tl, now } = run(32, 30, 3);
    const pick = pickClones(tl, now, 2.25, 0.1, 4);
    expect(pick.weights).toEqual([1, 1, 0.25, 0]);
  });

  it("hides clones older than the history (just after start)", () => {
    const { tl, now } = run(32, 30, 0.35);
    const pick = pickClones(tl, now, 8, 0.1, 8);
    expect(pick.weights.slice(0, 3)).toEqual([1, 1, 1]);
    expect(pick.weights.slice(4)).toEqual([0, 0, 0, 0]);
  });

  it("still fills the line on a slow device, without repeating a frame", () => {
    // Rendering (and so capturing) at only 5 fps, clones 0.25 s apart.
    const { tl, now } = run(32, 12, 4, 5);
    const pick = pickClones(tl, now, 8, 0.25, 8);
    const shown = pick.layers.filter((_, i) => pick.weights[i] > 0);
    expect(shown.length).toBeGreaterThanOrEqual(7);
    expect(new Set(shown).size).toBe(shown.length);
  });
});
