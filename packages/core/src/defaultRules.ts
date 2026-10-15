import type { CastAction, RulesConfig } from "./rules";

/** Bump when the default rules change; rules.json files from older versions are replaced. */
export const RULES_VERSION = 5;

/** Rules reset to the new defaults when a rules.json is upgraded past a version (re-balances). */
export const RULES_REFRESH: Record<number, string[]> = {
  4: ["gift-rose", "gift-finger-heart", "gift-rosa", "gift-doughnut", "gift-hand-hearts", "gift-orange-heart-lucky", "follow-rosa"],
  5: ["gift-hand-hearts", "gift-orange-heart-lucky"],
};

/**
 * Gift tiers: one cast per gift, its points kept within the tier's range and its rarity within a
 * matching band, so the fish fits its points (a rose never lands a 600-point naga):
 * Rose 50–600, Finger Heart 250–3,000, Rosa 500–6,000, Doughnut 2,000–25,000, Hand Hearts 10,000+
 * (always a big catch, so it always gets the full catch scene).
 */
const ROSE: CastAction = { type: "cast", count: 1, minRarity: "uncommon", maxRarity: "rare", minPoints: 50, maxPoints: 600 };
const FINGER_HEART: CastAction = { type: "cast", count: 1, minRarity: "rare", maxRarity: "epic", minPoints: 250, maxPoints: 3_000 };
const ROSA: CastAction = { type: "cast", count: 1, minRarity: "epic", maxRarity: "legendary", minPoints: 500, maxPoints: 6_000 };
const DOUGHNUT: CastAction = { type: "cast", count: 1, minRarity: "epic", maxRarity: "legendary", minPoints: 2_000, maxPoints: 25_000 };
const HAND_HEARTS: CastAction = { type: "cast", count: 1, minRarity: "legendary", minPoints: 10_000 };

/**
 * Rules written to userData/rules.json on first launch. Gifts are matched by coin value
 * (minDiamonds), so similar-priced gifts behave alike; the two special gifts are matched by name
 * (change giftName or use giftId if the live source reports a different name).
 */
export const defaultRulesConfig: RulesConfig = {
  version: RULES_VERSION,
  rules: [
    {
      id: "likes-cast",
      enabled: true,
      oncePerUser: false,
      // Every 50 of a viewer's own likes is one cast for them.
      trigger: { type: "likes", every: 50, perViewer: true },
      action: { type: "cast", count: 1 },
    },
    { id: "gift-rose", enabled: true, oncePerUser: false, trigger: { type: "gift", minDiamonds: 1 }, action: ROSE },
    { id: "gift-finger-heart", enabled: true, oncePerUser: false, trigger: { type: "gift", minDiamonds: 5 }, action: FINGER_HEART },
    { id: "gift-rosa", enabled: true, oncePerUser: false, trigger: { type: "gift", minDiamonds: 10 }, action: ROSA },
    { id: "gift-doughnut", enabled: true, oncePerUser: false, trigger: { type: "gift", minDiamonds: 30 }, action: DOUGHNUT },
    { id: "gift-hand-hearts", enabled: true, oncePerUser: false, trigger: { type: "gift", minDiamonds: 100 }, action: HAND_HEARTS },
    {
      id: "gift-perfume-steal",
      enabled: true,
      oncePerUser: false,
      trigger: { type: "gift", giftName: "Perfume" },
      action: { type: "steal", successRate: 1 },
    },
    {
      id: "gift-orange-heart-lucky",
      enabled: true,
      oncePerUser: false,
      // ใจส้ม: a lucky draw over the five gift tiers (not the steal), cheap tiers more likely.
      trigger: { type: "gift", giftName: "Heart Me" },
      action: {
        type: "lucky",
        options: [
          { weight: 40, label: "rose", cast: ROSE },
          { weight: 25, label: "fingerHeart", cast: FINGER_HEART },
          { weight: 18, label: "rosa", cast: ROSA },
          { weight: 12, label: "doughnut", cast: DOUGHNUT },
          { weight: 5, label: "handHearts", cast: HAND_HEARTS },
        ],
      },
    },
    {
      id: "follow-rosa",
      enabled: true,
      // A new follower gets a Rosa's worth (once per viewer, so re-following doesn't farm it).
      oncePerUser: true,
      trigger: { type: "follow" },
      action: ROSA,
    },
    {
      id: "likes-frenzy",
      enabled: true,
      oncePerUser: false,
      trigger: { type: "likes", every: 10000, perViewer: false },
      action: { type: "frenzy", durationSec: 30, rareMultiplier: 3 },
    },
    {
      id: "show-collection",
      enabled: true,
      oncePerUser: false,
      trigger: { type: "comment", command: "!สมุด" },
      action: { type: "showCollection", cooldownSec: 30 },
    },
  ],
};
