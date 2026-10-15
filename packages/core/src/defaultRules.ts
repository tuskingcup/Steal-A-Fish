import type { RulesConfig } from "./rules";

/**
 * Rules written to userData/rules.json on first launch.
 * Gift ids are placeholders until they are picked from the live gift list in settings.
 */
export const defaultRulesConfig: RulesConfig = {
  rules: [
    {
      id: "small-gift-cast",
      enabled: true,
      oncePerUser: false,
      trigger: { type: "gift", minDiamonds: 1 },
      action: { type: "cast", count: 1 },
    },
    {
      id: "special-bait",
      enabled: true,
      oncePerUser: false,
      trigger: { type: "gift", minDiamonds: 10 },
      action: { type: "cast", count: 1, bait: "special" },
    },
    {
      id: "trawl-net",
      enabled: true,
      oncePerUser: false,
      trigger: { type: "gift", minDiamonds: 99 },
      action: { type: "net", count: 5 },
    },
    {
      id: "likes-frenzy",
      enabled: true,
      oncePerUser: false,
      trigger: { type: "likes", every: 10000 },
      action: { type: "frenzy", durationSec: 30, rareMultiplier: 3 },
    },
    {
      id: "show-collection",
      enabled: true,
      oncePerUser: false,
      trigger: { type: "comment", command: "!สมุด" },
      action: { type: "showCollection", cooldownSec: 30 },
    },
    {
      id: "follow-free-cast",
      enabled: false,
      oncePerUser: true,
      trigger: { type: "follow" },
      action: { type: "cast", count: 1 },
    },
  ],
};
