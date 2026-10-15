import { createSeededRng, type Rng } from "./rng";

/**
 * Cosmetic look of a viewer's fisher. Derived deterministically from the TikTok userId,
 * so a viewer gets the same character every stream without storing anything.
 * Pure data (hex colours + enums); renderers decide how to draw it.
 */
export interface Avatar {
  skin: string;
  hairColor: string;
  hairStyle: HairStyle;
  hat: Hat;
  hatColor: string;
  eyes: Eyes;
  faceExtra: FaceExtra;
  top: Top;
  topColor: string;
  /** Second colour for stripes, prints, vest straps. */
  topAccent: string;
  neck: Neck;
  neckColor: string;
  bottom: Bottom;
  bottomColor: string;
  shoes: Shoes;
  shoeColor: string;
}

export const HAIR_STYLES = ["short", "long", "bun", "spiky", "bald"] as const;
export const HATS = ["ngob", "cap", "bucket", "strawWide", "bandana", "none"] as const;
export const EYES = ["dot", "happy", "wide"] as const;
export const FACE_EXTRAS = ["none", "mustache", "beard", "glasses", "sunglasses"] as const;
export const TOPS = ["tee", "tank", "longSleeve", "striped", "lifeVest", "hawaiian"] as const;
export const NECKS = ["none", "phaKhaoMa", "towel"] as const;
export const BOTTOMS = ["longPants", "shorts", "fishermanPants"] as const;
export const SHOES = ["sandals", "boots", "barefoot"] as const;

export type HairStyle = (typeof HAIR_STYLES)[number];
export type Hat = (typeof HATS)[number];
export type Eyes = (typeof EYES)[number];
export type FaceExtra = (typeof FACE_EXTRAS)[number];
export type Top = (typeof TOPS)[number];
export type Neck = (typeof NECKS)[number];
export type Bottom = (typeof BOTTOMS)[number];
export type Shoes = (typeof SHOES)[number];

const SKIN = ["#FBDCC0", "#F2C194", "#E0A877", "#C18556", "#93603A"] as const;
const HAIR_NATURAL = ["#22180F", "#3B2618", "#5C3A22", "#8A5A33"] as const;
const HAIR_DYED = ["#E3C063", "#C9C9D2", "#C8453B", "#4366C2", "#E07AA8"] as const;
const CLOTH = [
  "#EDE6D3", "#D2453B", "#E98A2E", "#F2C94C", "#5AAE61", "#2E8C83",
  "#3E7CB1", "#34488A", "#6A4C93", "#E07AA8", "#3A3A44", "#8C6A4A",
] as const;
const PANTS = ["#34488A", "#2B2B33", "#5B4636", "#6D7F8C", "#8A3B2E", "#2F5A4A"] as const;
const HAT_COLORS = ["#D2453B", "#3E7CB1", "#2B2B33", "#5AAE61", "#F2C94C", "#EDE6D3"] as const;
const SHOE_COLORS = ["#6B4226", "#2B2B33", "#E9C13C", "#3E7CB1"] as const;

/** FNV-1a 32-bit. Stable across platforms and runs. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)]!;
}

function weighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r < 0) return item;
  }
  return items[items.length - 1]![0];
}

export function avatarFor(userId: string): Avatar {
  const rng = createSeededRng(hashString(userId));
  const topColor = pick(rng, CLOTH);
  let topAccent = pick(rng, CLOTH);
  if (topAccent === topColor) topAccent = topColor === "#EDE6D3" ? "#3E7CB1" : "#EDE6D3";
  return {
    skin: pick(rng, SKIN),
    hairColor: rng.next() < 0.75 ? pick(rng, HAIR_NATURAL) : pick(rng, HAIR_DYED),
    hairStyle: weighted(rng, [["short", 4], ["long", 3], ["bun", 2], ["spiky", 2], ["bald", 1]]),
    hat: weighted(rng, [["ngob", 2], ["cap", 3], ["bucket", 2], ["strawWide", 2], ["bandana", 2], ["none", 2]]),
    hatColor: pick(rng, HAT_COLORS),
    eyes: weighted(rng, [["dot", 5], ["happy", 2], ["wide", 2]]),
    faceExtra: weighted(rng, [["none", 6], ["mustache", 1], ["beard", 1], ["glasses", 1], ["sunglasses", 2]]),
    top: weighted(rng, [["tee", 3], ["tank", 2], ["longSleeve", 2], ["striped", 2], ["lifeVest", 1], ["hawaiian", 2]]),
    topColor,
    topAccent,
    neck: weighted(rng, [["none", 4], ["phaKhaoMa", 2], ["towel", 1]]),
    neckColor: pick(rng, ["#D2453B", "#3E7CB1", "#5AAE61", "#EDE6D3"] as const),
    bottom: weighted(rng, [["longPants", 2], ["shorts", 2], ["fishermanPants", 2]]),
    bottomColor: pick(rng, PANTS),
    shoes: weighted(rng, [["sandals", 3], ["boots", 1], ["barefoot", 1]]),
    shoeColor: pick(rng, SHOE_COLORS),
  };
}

/** Stable key for caching baked sprites: viewers with identical looks share frames. */
export function avatarKey(a: Avatar): string {
  return Object.values(a).join("|");
}
