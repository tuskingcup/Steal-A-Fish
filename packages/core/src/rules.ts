import { z } from "zod";
import type { LiveEvent, Viewer } from "./events";
import { RARITIES } from "./fish";
import type { Rng } from "./rng";

// ---------- Config schema (rules.json) ----------

const giftTrigger = z
  .object({
    type: z.literal("gift"),
    giftId: z.number().int().optional(),
    /** The gift's name as the live source reports it (case-insensitive), e.g. "Perfume". */
    giftName: z.string().min(1).optional(),
    minDiamonds: z.number().int().nonnegative().optional(),
  })
  .refine((t) => t.giftId !== undefined || t.giftName !== undefined || t.minDiamonds !== undefined, {
    message: "gift trigger needs giftId, giftName or minDiamonds",
  });

/**
 * Likes. `perViewer: true` counts each viewer's own likes (every N of *their* likes fires the
 * action for them); otherwise the whole room's likes count together.
 */
const likesTrigger = z.object({ type: z.literal("likes"), every: z.number().int().positive(), perViewer: z.boolean().default(false) });
const commentTrigger = z.object({ type: z.literal("comment"), command: z.string().min(1) });
const followTrigger = z.object({ type: z.literal("follow") });
const shareTrigger = z.object({ type: z.literal("share") });

export const triggerSchema = z.union([giftTrigger, likesTrigger, commentTrigger, followTrigger, shareTrigger]);

/**
 * Cast `count` times. Gifts keep each fish within a rarity range (`minRarity`…`maxRarity`) and
 * a points range (`minPoints`…`maxPoints`), so a gift is never a dud and never more than it's worth.
 */
const castAction = z.object({
  type: z.literal("cast"),
  count: z.number().int().positive().default(1),
  bait: z.string().optional(),
  minRarity: z.enum(RARITIES).optional(),
  maxRarity: z.enum(RARITIES).optional(),
  minPoints: z.number().int().nonnegative().optional(),
  maxPoints: z.number().int().positive().optional(),
});

export const actionSchema = z.discriminatedUnion("type", [
  castAction,
  /** A lucky draw: one of the options is picked at random (by weight) and cast. */
  z.object({
    type: z.literal("lucky"),
    options: z.array(z.object({ weight: z.number().positive(), label: z.string().optional(), cast: castAction })).min(1),
  }),
  z.object({ type: z.literal("net"), count: z.number().int().positive() }),
  /** Steal one random fish from the #1 player (from #2 if the thief is #1). */
  z.object({ type: z.literal("steal"), successRate: z.number().min(0).max(1).default(1) }),
  z.object({ type: z.literal("guard"), durationSec: z.number().positive() }),
  z.object({
    type: z.literal("frenzy"),
    durationSec: z.number().positive(),
    rareMultiplier: z.number().positive().default(3),
  }),
  z.object({ type: z.literal("showCollection"), cooldownSec: z.number().nonnegative().default(30) }),
  z.object({ type: z.literal("boost"), multiplier: z.number().positive(), durationSec: z.number().positive() }),
]);

export const ruleSchema = z.object({
  id: z.string().optional(),
  enabled: z.boolean().default(true),
  /** Fire at most once per viewer (e.g. follow rewards). */
  oncePerUser: z.boolean().default(false),
  trigger: triggerSchema,
  action: actionSchema,
});

/** Bounds for the round timing in settings. */
export const ROUND_SEC_MIN = 60;
export const ROUND_SEC_MAX = 60 * 60;
export const SUMMARY_SEC_MIN = 10;
export const SUMMARY_SEC_MAX = 10 * 60;

export const rulesConfigSchema = z.object({
  /** Bumped when the default rules change shape; older files are replaced (and backed up). */
  version: z.number().int().optional(),
  rules: z.array(ruleSchema),
  /** Round timing set in settings; missing fields use the built-in defaults (5 min play, 60 s summary). */
  round: z
    .object({
      /** How long a round is open for play. */
      roundSec: z.number().int().min(ROUND_SEC_MIN).max(ROUND_SEC_MAX).optional(),
      /** How long the summary shows before the next round opens. */
      summarySec: z.number().int().min(SUMMARY_SEC_MIN).max(SUMMARY_SEC_MAX).optional(),
    })
    .optional(),
});

export type Trigger = z.infer<typeof triggerSchema>;
export type Action = z.infer<typeof actionSchema>;
export type CastAction = z.infer<typeof castAction>;
export type Rule = z.infer<typeof ruleSchema>;
export type RulesConfig = z.infer<typeof rulesConfigSchema>;

export function parseRulesConfig(input: unknown): RulesConfig {
  return rulesConfigSchema.parse(input);
}

/**
 * Bring a rules.json from an older version up to date. Before version 2 the rules had a different
 * shape, so they are replaced outright. From version 2 on, the streamer's edits are kept: default
 * rules they don't have yet (by id) are added, and rules listed in `refresh` for a version passed
 * (re-balances) get the new default reward (action) while keeping their trigger.
 */
export function upgradeRulesConfig(config: RulesConfig, defaults: RulesConfig, version: number, refresh: Record<number, string[]> = {}): RulesConfig {
  const from = config.version ?? 1;
  if (from >= version) return config;
  if (from < 2) return defaults;
  const reset = new Set<string>();
  for (const [v, ids] of Object.entries(refresh)) if (Number(v) > from && Number(v) <= version) for (const id of ids) reset.add(id);
  const byId = new Map(defaults.rules.filter((r) => r.id !== undefined).map((r) => [r.id!, r]));
  const kept = config.rules.map((r) => (r.id !== undefined && reset.has(r.id) && byId.has(r.id) ? { ...r, action: byId.get(r.id)!.action } : r));
  const have = new Set(kept.map((r) => r.id));
  return { ...config, version, rules: [...kept, ...defaults.rules.filter((r) => r.id === undefined || !have.has(r.id))] };
}

// ---------- Engine ----------

export interface FiredAction {
  rule: Rule;
  action: Action;
  /** Who caused it. For like thresholds this is the viewer whose likes crossed it. */
  viewer: Viewer;
  /** How many times the action fires (e.g. 5 roses → cast rule fires 5 times). */
  times: number;
  sourceEventId: string;
}

/**
 * Turns normalized live events into game actions according to rules.json.
 * Stateful only for like counting, once-per-user tracking and de-duplication.
 */
export class RuleEngine {
  private rules: Rule[];
  private likeCounter = 0;
  private readonly viewerLikes = new Map<string, number>();
  private readonly seenEventIds = new Set<string>();
  private readonly firedOnce = new Set<string>();

  constructor(config: RulesConfig) {
    this.rules = config.rules;
  }

  setConfig(config: RulesConfig): void {
    this.rules = config.rules;
  }

  /** Every like this viewer has sent (for "N more likes to your next cast" hints). */
  viewerLikeCount(userId: string): number {
    return this.viewerLikes.get(userId) ?? 0;
  }

  handle(event: LiveEvent): FiredAction[] {
    if (this.seenEventIds.has(event.eventId)) return [];
    this.seenEventIds.add(event.eventId);

    const fired = this.match(event);
    return fired.filter((f) => {
      if (!f.rule.oncePerUser) return true;
      const key = `${ruleKey(f.rule)}:${f.viewer.userId}`;
      if (this.firedOnce.has(key)) return false;
      this.firedOnce.add(key);
      return true;
    });
  }

  private match(event: LiveEvent): FiredAction[] {
    const enabled = this.rules.filter((r) => r.enabled);
    const base = { viewer: event.viewer, sourceEventId: event.eventId };

    switch (event.type) {
      case "gift": {
        const best = pickGiftRule(enabled, event.giftId, event.diamonds, event.giftName);
        return best ? [{ ...base, rule: best, action: best.action, times: event.repeatCount }] : [];
      }
      case "like": {
        const before = this.likeCounter;
        this.likeCounter += event.likeCount;
        const mineBefore = this.viewerLikes.get(event.viewer.userId) ?? 0;
        const mine = mineBefore + event.likeCount;
        this.viewerLikes.set(event.viewer.userId, mine);
        return enabled.flatMap((rule) => {
          if (rule.trigger.type !== "likes") return [];
          const every = rule.trigger.every;
          const [from, to] = rule.trigger.perViewer ? [mineBefore, mine] : [before, this.likeCounter];
          const times = Math.floor(to / every) - Math.floor(from / every);
          return times > 0 ? [{ ...base, rule, action: rule.action, times }] : [];
        });
      }
      case "comment": {
        const text = event.text.trim();
        return enabled.flatMap((rule) =>
          rule.trigger.type === "comment" && text.startsWith(rule.trigger.command)
            ? [{ ...base, rule, action: rule.action, times: 1 }]
            : [],
        );
      }
      case "follow":
      case "share":
        return enabled.flatMap((rule) =>
          rule.trigger.type === event.type ? [{ ...base, rule, action: rule.action, times: 1 }] : [],
        );
    }
  }
}

/** Pick one option of a lucky draw, by weight. */
export function pickLucky<T extends { weight: number }>(rng: Rng, options: readonly T[]): T {
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = rng.next() * total;
  for (const o of options) {
    r -= o.weight;
    if (r < 0) return o;
  }
  return options[options.length - 1]!;
}

/**
 * Most specific gift rule wins: an exact giftId beats a giftName, which beats any minDiamonds
 * rule; among minDiamonds rules the highest threshold that is met wins.
 */
export function pickGiftRule(rules: Rule[], giftId: number, diamonds: number, giftName = ""): Rule | undefined {
  let best: Rule | undefined;
  let bestScore = -1;
  for (const rule of rules) {
    const t = rule.trigger;
    if (t.type !== "gift") continue;
    let score = -1;
    if (t.giftId !== undefined) {
      if (t.giftId === giftId) score = Number.MAX_SAFE_INTEGER;
    } else if (t.giftName !== undefined) {
      if (t.giftName.trim().toLowerCase() === giftName.trim().toLowerCase()) score = Number.MAX_SAFE_INTEGER - 1;
    } else if (t.minDiamonds !== undefined && diamonds >= t.minDiamonds) {
      score = t.minDiamonds;
    }
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

function ruleKey(rule: Rule): string {
  return rule.id ?? JSON.stringify(rule.trigger);
}
