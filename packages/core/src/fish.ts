import type { Rng } from "./rng";

/**
 * Catch rolls: species by rarity (with pity and boosts), a heavy-tailed size, and stacking
 * mutations. Weights are kept as log10(kg) so they never overflow, however absurd they get.
 * Every fish also has a sell price in in-game coins (no real-world value) from its species,
 * size and mutations.
 */

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"] as const;
export type Rarity = (typeof RARITIES)[number];

/** Relative chance of each rarity per cast (published in settings as drop rates). */
export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 55,
  uncommon: 26,
  rare: 12,
  epic: 5,
  legendary: 1.6,
  mythic: 0.4,
};

/** A Rare-or-better catch is guaranteed on the 30th cast without one. */
export const PITY_CASTS = 30;

export const isRarePlus = (r: Rarity) => RARITIES.indexOf(r) >= RARITIES.indexOf("rare");

export interface Species {
  id: string;
  rarity: Rarity;
  /** log10 of a typical weight in kg. */
  baseLog10: number;
  /** Sell price of a typical-sized, unmutated fish, in coins. */
  price: number;
}

/** Village pond. Base weights grow ~10× per rarity tier; names live in the renderer's i18n file. */
export const SPECIES: readonly Species[] = [
  { id: "tilapia", rarity: "common", baseLog10: 6.0, price: 10 },
  { id: "walkingCatfish", rarity: "common", baseLog10: 6.3, price: 12 },
  { id: "snakehead", rarity: "common", baseLog10: 6.6, price: 15 },
  { id: "climbingPerch", rarity: "uncommon", baseLog10: 7.1, price: 40 },
  { id: "snakeskinGourami", rarity: "uncommon", baseLog10: 7.4, price: 50 },
  { id: "giantGourami", rarity: "rare", baseLog10: 8.1, price: 150 },
  { id: "clownFeatherback", rarity: "rare", baseLog10: 8.4, price: 180 },
  { id: "arowana", rarity: "epic", baseLog10: 9.2, price: 700 },
  { id: "giantSnakehead", rarity: "epic", baseLog10: 9.5, price: 600 },
  { id: "mekongGiantCatfish", rarity: "legendary", baseLog10: 10.6, price: 3_000 },
  { id: "nagaFish", rarity: "mythic", baseLog10: 12, price: 25_000 },
];

/**
 * `multiplier` scales weight; `priceMultiplier` scales the sell price. Price multipliers are
 * deliberately much gentler, so one lucky mutation doesn't decide a whole round on its own.
 */
export const MUTATIONS = [
  { id: "gold", multiplier: 5, priceMultiplier: 3, chance: 0.06 },
  { id: "diamond", multiplier: 50, priceMultiplier: 10, chance: 0.015 },
  { id: "lava", multiplier: 200, priceMultiplier: 25, chance: 0.005 },
  { id: "neutronStar", multiplier: 1e4, priceMultiplier: 100, chance: 0.0006 },
  { id: "blackHole", multiplier: 1e6, priceMultiplier: 1_000, chance: 0.00005 },
] as const;
export type MutationId = (typeof MUTATIONS)[number]["id"];

export interface Catch {
  speciesId: string;
  rarity: Rarity;
  /** Applied mutations; their multipliers stack. */
  mutations: MutationId[];
  /** log10 of the weight in kg. */
  weightLog10: number;
  /** How big this one is next to a typical fish of its species (1 = typical). */
  size: number;
  /** Sell price in coins (in-game only). */
  price: number;
}

/**
 * Sell price = species price × size (relative to a typical fish, so twice the weight sells for
 * twice as much) × every mutation's price multiplier. Whole coins, at least 1.
 */
export function priceOf(speciesId: string, size: number, mutations: readonly MutationId[]): number {
  const species = SPECIES.find((s) => s.id === speciesId);
  if (!species) return 0;
  const mutation = mutations.reduce((m, id) => m * (MUTATIONS.find((x) => x.id === id)?.priceMultiplier ?? 1), 1);
  return Math.max(1, Math.round(species.price * size * mutation));
}

export interface CastOptions {
  /** Casts since the last Rare-or-better catch. */
  pity: number;
  /** Multiplies the chance of Rare and above (frenzy, special bait). 1 = normal. */
  rareBoost?: number;
}

export interface CastResult {
  fish: Catch;
  /** Pity counter after this cast. */
  pity: number;
}

export function rollCatch(rng: Rng, opts: CastOptions): CastResult {
  const forceRare = opts.pity + 1 >= PITY_CASTS;
  const boost = opts.rareBoost ?? 1;
  const rarity = pickWeighted(
    rng,
    RARITIES.filter((r) => !forceRare || isRarePlus(r)).map((r) => [r, RARITY_WEIGHTS[r] * (isRarePlus(r) ? boost : 1)] as const),
  );
  const pool = SPECIES.filter((s) => s.rarity === rarity);
  const species = pool[Math.floor(rng.next() * pool.length)] ?? pool[0]!;

  // Size: mostly near typical, with a heavy tail (log-normal body + occasional Pareto-ish monster).
  let sizeLog10 = normal(rng) * 0.22;
  if (rng.next() < 0.04) sizeLog10 += Math.abs(normal(rng)) * 0.9;

  const mutations: MutationId[] = [];
  let mutationLog10 = 0;
  for (const m of MUTATIONS) {
    if (rng.next() < m.chance) {
      mutations.push(m.id);
      mutationLog10 += Math.log10(m.multiplier);
    }
  }

  const size = 10 ** sizeLog10;
  return {
    fish: {
      speciesId: species.id,
      rarity,
      mutations,
      weightLog10: species.baseLog10 + sizeLog10 + mutationLog10,
      size,
      price: priceOf(species.id, size, mutations),
    },
    pity: isRarePlus(rarity) ? 0 : opts.pity + 1,
  };
}

function pickWeighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r < 0) return item;
  }
  return items[items.length - 1]![0];
}

/** Standard normal via Box–Muller. */
function normal(rng: Rng): number {
  const u = Math.max(rng.next(), 1e-12);
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Public drop table: chance of each rarity per cast, in percent. */
export function rarityPercents(): Record<Rarity, number> {
  const total = RARITIES.reduce((s, r) => s + RARITY_WEIGHTS[r], 0);
  return Object.fromEntries(RARITIES.map((r) => [r, (RARITY_WEIGHTS[r] / total) * 100])) as Record<Rarity, number>;
}
