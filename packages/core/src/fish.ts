import type { Rng } from "./rng";

/**
 * Catch rolls: species by rarity (with pity and boosts), a size class, a little natural size
 * variation, and stacking mutations. Most fish weigh what real fish weigh; the absurd weights come
 * from rare size classes (giant → colossal) and mutations stacking on top. Weights are kept as
 * log10(kg) so they never overflow, however absurd they get. Every fish also has a sell price in
 * in-game coins (no real-world value) from its species, size class, size and mutations.
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
  /** log10 of a typical weight in kg (a real-world fish of this species). */
  baseLog10: number;
  /** Sell price of a typical-sized, unmutated fish, in coins. */
  price: number;
}

/** Village pond, at real-world weights; names live in the renderer's i18n file. */
export const SPECIES: readonly Species[] = [
  { id: "tilapia", rarity: "common", baseLog10: Math.log10(0.8), price: 10 },
  { id: "walkingCatfish", rarity: "common", baseLog10: Math.log10(1.2), price: 12 },
  { id: "snakehead", rarity: "common", baseLog10: Math.log10(2.5), price: 15 },
  { id: "climbingPerch", rarity: "uncommon", baseLog10: Math.log10(0.15), price: 40 },
  { id: "snakeskinGourami", rarity: "uncommon", baseLog10: Math.log10(0.3), price: 50 },
  { id: "giantGourami", rarity: "rare", baseLog10: Math.log10(5), price: 150 },
  { id: "clownFeatherback", rarity: "rare", baseLog10: Math.log10(4), price: 180 },
  { id: "arowana", rarity: "epic", baseLog10: Math.log10(3), price: 700 },
  { id: "giantSnakehead", rarity: "epic", baseLog10: Math.log10(15), price: 600 },
  { id: "mekongGiantCatfish", rarity: "legendary", baseLog10: Math.log10(250), price: 3_000 },
  { id: "nagaFish", rarity: "mythic", baseLog10: Math.log10(5_000), price: 25_000 },
];

/**
 * Size classes, rolled independently of species. Nearly every fish is normal-sized; the rare
 * giants are where million- and trillion-kilo fish come from. `weightLog10` is the range of the
 * extra weight multiplier (log10); price multipliers are deliberately gentle.
 */
export const SIZE_CLASSES = [
  { id: "normal", chance: 0, weightLog10: [0, 0], priceMultiplier: 1 },
  { id: "big", chance: 0.07, weightLog10: [0.7, 1.3], priceMultiplier: 3 },
  { id: "giant", chance: 0.024, weightLog10: [3, 4], priceMultiplier: 20 },
  { id: "titan", chance: 0.005, weightLog10: [6, 7], priceMultiplier: 150 },
  { id: "colossal", chance: 0.001, weightLog10: [9, 10], priceMultiplier: 1_000 },
] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number]["id"];

/** Chance of a normal-sized fish: whatever the larger classes leave. */
export const NORMAL_SIZE_CHANCE = 1 - SIZE_CLASSES.reduce((s, c) => s + c.chance, 0);

export const isHuge = (c: SizeClass) => c === "titan" || c === "colossal";

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
  sizeClass: SizeClass;
  /** Applied mutations; their multipliers stack. */
  mutations: MutationId[];
  /** log10 of the weight in kg. */
  weightLog10: number;
  /** Natural size variation next to a typical fish of its species and size class (1 = typical). */
  size: number;
  /** Sell price in coins (in-game only). */
  price: number;
}

/**
 * Sell price = species price × size variation (twice the size sells for twice as much) × the size
 * class's price multiplier × every mutation's price multiplier. Whole coins, at least 1.
 */
export function priceOf(speciesId: string, size: number, mutations: readonly MutationId[], sizeClass: SizeClass = "normal"): number {
  const species = SPECIES.find((s) => s.id === speciesId);
  if (!species) return 0;
  const mutation = mutations.reduce((m, id) => m * (MUTATIONS.find((x) => x.id === id)?.priceMultiplier ?? 1), 1);
  const cls = SIZE_CLASSES.find((c) => c.id === sizeClass)?.priceMultiplier ?? 1;
  return Math.max(1, Math.round(species.price * size * cls * mutation));
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

  // Size: natural variation (about ±30%) plus a size class, almost always "normal".
  const sizeLog10 = Math.max(-0.4, Math.min(0.4, normal(rng) * 0.12));
  let classRoll = rng.next();
  let sizeClass: SizeClass = "normal";
  let classLog10 = 0;
  for (const c of SIZE_CLASSES) {
    if (c.chance === 0) continue;
    if (classRoll < c.chance) {
      sizeClass = c.id;
      classLog10 = c.weightLog10[0] + rng.next() * (c.weightLog10[1] - c.weightLog10[0]);
      break;
    }
    classRoll -= c.chance;
  }

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
      sizeClass,
      mutations,
      weightLog10: species.baseLog10 + sizeLog10 + classLog10 + mutationLog10,
      size,
      price: priceOf(species.id, size, mutations, sizeClass),
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
