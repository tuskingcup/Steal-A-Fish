import { z } from "zod";
import type { LiveEvent, Viewer } from "./events";

// ---------- Config schema (rules.json) ----------

const giftTrigger = z
  .object({
    type: z.literal("gift"),
    giftId: z.number().int().optional(),
    minDiamonds: z.number().int().nonnegative().optional(),
  })
  .refine((t) => t.giftId !== undefined || t.minDiamonds !== undefined, {
    message: "gift trigger needs giftId or minDiamonds",
  });

const likesTrigger = z.object({ type: z.literal("likes"), every: z.number().int().positive() });
const commentTrigger = z.object({ type: z.literal("comment"), command: z.string().min(1) });
const followTrigger = z.object({ type: z.literal("follow") });
const shareTrigger = z.object({ type: z.literal("share") });

export const triggerSchema = z.union([giftTrigger, likesTrigger, commentTrigger, followTrigger, shareTrigger]);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cast"), count: z.number().int().positive().default(1), bait: z.string().optional() }),
  z.object({ type: z.literal("net"), count: z.number().int().positive() }),
  z.object({ type: z.literal("steal"), successRate: z.number().min(0).max(1) }),
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

export const rulesConfigSchema = z.object({ rules: z.array(ruleSchema) });

export type Trigger = z.infer<typeof triggerSchema>;
export type Action = z.infer<typeof actionSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type RulesConfig = z.infer<typeof rulesConfigSchema>;

export function parseRulesConfig(input: unknown): RulesConfig {
  return rulesConfigSchema.parse(input);
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
  private readonly seenEventIds = new Set<string>();
  private readonly firedOnce = new Set<string>();

  constructor(config: RulesConfig) {
    this.rules = config.rules;
  }

  setConfig(config: RulesConfig): void {
    this.rules = config.rules;
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
        const best = pickGiftRule(enabled, event.giftId, event.diamonds);
        return best ? [{ ...base, rule: best, action: best.action, times: event.repeatCount }] : [];
      }
      case "like": {
        const before = this.likeCounter;
        this.likeCounter += event.likeCount;
        return enabled.flatMap((rule) => {
          if (rule.trigger.type !== "likes") return [];
          const every = rule.trigger.every;
          const times = Math.floor(this.likeCounter / every) - Math.floor(before / every);
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

/**
 * Most specific gift rule wins: an exact giftId beats any minDiamonds rule;
 * among minDiamonds rules the highest threshold that is met wins.
 */
export function pickGiftRule(rules: Rule[], giftId: number, diamonds: number): Rule | undefined {
  let best: Rule | undefined;
  let bestScore = -1;
  for (const rule of rules) {
    const t = rule.trigger;
    if (t.type !== "gift") continue;
    let score = -1;
    if (t.giftId !== undefined) {
      if (t.giftId === giftId) score = Number.MAX_SAFE_INTEGER;
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
