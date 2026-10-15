import type { CastAction, RulesConfig } from "./rules";

/** Bump when the default rules change; rules.json files from older versions are replaced. */
export const RULES_VERSION = 2;

/**
 * Gift tiers. Every gift is a cast with a guarantee, so no gift is ever a dud: a minimum rarity
 * and a minimum number of points per fish. Bigger gifts guarantee more points per coin
 * (rose 50/coin … hand hearts 80/coin) and more casts, so more chances at a legend on top.
 * A cast still lands whatever fish it rolls; the guarantee only lifts the floor.
 */
const ROSE: CastAction = { type: "cast", count: 1, minRarity: "uncommon", minPoints: 50 };
const FINGER_HEART: CastAction = { type: "cast", count: 2, minRarity: "rare", minPoints: 150 };
const ROSA: CastAction = { type: "cast", count: 3, minRarity: "rare", minPoints: 200 };
const DOUGHNUT: CastAction = { type: "cast", count: 3, minRarity: "epic", minPoints: 700 };
const HAND_HEARTS: CastAction = { type: "cast", count: 5, minRarity: "epic", minPoints: 1_600 };

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
