import { describe, expect, it } from "vitest";

import { createMotion, updateMotion } from "./motion";

const box = (
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) => {
  const indices = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) indices[y * w + x] = 1;
  return { width: w, height: h, indices };
};

describe("motion", () => {
  it("counts the silhouette's cells", () => {
    const m = createMotion(10, 10);
    updateMotion(m, box(100, 100, 20, 30, 60, 70), 1, 1 / 24);
    expect(m.active).toBe(16);
  });

  it("stays calm when still, rises when moving, settles slowly", () => {
    const m = createMotion(20, 20);
    const a = box(100, 100, 20, 20, 50, 80);
    const b = box(100, 100, 45, 20, 75, 80);
    for (let i = 0; i < 24; i++) updateMotion(m, a, 1, 1 / 24);
    expect(m.pulse).toBeLessThan(0.01);
    for (let i = 0; i < 12; i++) updateMotion(m, i % 2 ? a : b, 1, 1 / 24);
    expect(m.pulse).toBeGreaterThan(0.5);
    const peak = m.pulse;
    for (let i = 0; i < 12; i++) updateMotion(m, a, 1, 1 / 24);
    expect(m.pulse).toBeGreaterThan(peak * 0.4); // clones linger…
    for (let i = 0; i < 96; i++) updateMotion(m, a, 1, 1 / 24);
    expect(m.pulse).toBeLessThan(0.05); // …then step back
  });

  it("calms down with nobody in view", () => {
    const m = createMotion(10, 10);
    m.pulse = 1;
    const empty = { width: 10, height: 10, indices: new Uint8Array(100) };
    for (let i = 0; i < 48; i++) updateMotion(m, empty, 1, 1 / 24);
    expect(m.pulse).toBe(0);
    expect(m.active).toBe(0);
  });

  it("reads a jump as the centre rising, but not someone stepping in", () => {
    const m = createMotion(20, 40);
    const at = (top: number) => box(100, 200, 40, top, 60, top + 120);
    for (let i = 0; i < 12; i++) updateMotion(m, at(60), 1, 1 / 24);
    expect(m.rise).toBeCloseTo(0, 3);
    // Up 40 px of 200 in 0.17 s ≈ 1.2 screen heights per second.
    for (let i = 1; i <= 4; i++) updateMotion(m, at(60 - i * 10), 1, 1 / 24);
    expect(m.rise).toBeGreaterThan(0.6);

    const n = createMotion(20, 40);
    updateMotion(
      n,
      { width: 100, height: 200, indices: new Uint8Array(20000) },
      1,
      1 / 24,
    );
    updateMotion(n, at(20), 1, 1 / 24); // appears high up in one frame
    expect(n.rise).toBe(0);
  });
});
