import { describe, expect, it } from "vitest";
import { isRarePlus, PITY_CASTS, priceOf, rarityPercents, rollCatch, SPECIES } from "./fish";
import { createSeededRng } from "./rng";

describe("rollCatch", () => {
  it("is deterministic for a seed", () => {
    const a = createSeededRng(1);
    const b = createSeededRng(1);
    expect(rollCatch(a, { pity: 0 })).toEqual(rollCatch(b, { pity: 0 }));
  });

  it("never goes more than PITY_CASTS casts without a Rare-or-better", () => {
    const rng = createSeededRng(99);
    let pity = 0;
    let longest = 0;
    let run = 0;
    for (let i = 0; i < 20_000; i++) {
      const r = rollCatch(rng, { pity });
      pity = r.pity;
      run = isRarePlus(r.fish.rarity) ? 0 : run + 1;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThan(PITY_CASTS);
  });

  it("keeps rarity rates close to the published table", () => {
    const rng = createSeededRng(7);
    const counts: Record<string, number> = {};
    const N = 50_000;
    // Pity off (always reset) so the raw table is measured.
    for (let i = 0; i < N; i++) {
      const r = rollCatch(rng, { pity: 0 }).fish.rarity;
      counts[r] = (counts[r] ?? 0) + 1;
    }
    const expected = rarityPercents();
    for (const [rarity, pct] of Object.entries(expected)) expect(((counts[rarity] ?? 0) / N) * 100).toBeCloseTo(pct, 0);
  });

  it("weighs millions of kg or more, with mutations stacking", () => {
    const rng = createSeededRng(3);
    let mutated = 0;
    for (let i = 0; i < 5_000; i++) {
      const { fish } = rollCatch(rng, { pity: 0 });
      expect(fish.weightLog10).toBeGreaterThan(5);
      expect(SPECIES.some((s) => s.id === fish.speciesId && s.rarity === fish.rarity)).toBe(true);
      if (fish.mutations.length > 0) mutated++;
    }
    expect(mutated).toBeGreaterThan(0);
  });

  it("prices fish by species, size and mutations", () => {
    expect(priceOf("tilapia", 1, [])).toBe(10);
    expect(priceOf("tilapia", 2, [])).toBe(20); // twice the size, twice the price
    expect(priceOf("tilapia", 1, ["gold"])).toBe(30);
    expect(priceOf("tilapia", 1, ["gold", "diamond"])).toBe(300); // multipliers stack
    expect(priceOf("nagaFish", 1, [])).toBeGreaterThan(priceOf("mekongGiantCatfish", 1, []));
    expect(priceOf("tilapia", 0.01, [])).toBe(1); // never free

    const rng = createSeededRng(21);
    for (let i = 0; i < 1_000; i++) {
      const { fish } = rollCatch(rng, { pity: 0 });
      expect(fish.price).toBe(priceOf(fish.speciesId, fish.size, fish.mutations));
    }
  });

  it("boosts Rare-and-above chances", () => {
    const count = (boost: number) => {
      const rng = createSeededRng(11);
      let n = 0;
      for (let i = 0; i < 10_000; i++) if (isRarePlus(rollCatch(rng, { pity: 0, rareBoost: boost }).fish.rarity)) n++;
      return n;
    };
    expect(count(3)).toBeGreaterThan(count(1) * 2);
  });
});
