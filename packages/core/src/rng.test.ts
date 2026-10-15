import { describe, expect, it } from "vitest";
import { createSeededRng } from "./rng";

describe("createSeededRng", () => {
  it("is deterministic for a seed", () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("stays in [0, 1)", () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
