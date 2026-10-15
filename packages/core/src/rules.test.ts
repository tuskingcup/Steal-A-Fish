import { describe, expect, it } from "vitest";
import type { GiftEvent, LiveEvent, Viewer } from "./events";
import { RuleEngine, parseRulesConfig, pickLucky, upgradeRulesConfig } from "./rules";
import { createSeededRng } from "./rng";
import { defaultRulesConfig } from "./defaultRules";

const viewer: Viewer = { userId: "u1", uniqueId: "nong_ploy", nickname: "Ploy" };
let seq = 0;
const id = () => `e${++seq}`;

const gift = (giftId: number, diamonds: number, repeatCount = 1): GiftEvent => ({
  type: "gift",
  eventId: id(),
  at: 0,
  viewer,
  giftId,
  giftName: "test",
  diamonds,
  repeatCount,
});

const config = parseRulesConfig({
  rules: [
    { id: "any-1", trigger: { type: "gift", minDiamonds: 1 }, action: { type: "cast", count: 1 } },
    { id: "any-99", trigger: { type: "gift", minDiamonds: 99 }, action: { type: "net", count: 5 } },
    { id: "steal", trigger: { type: "gift", giftId: 7934 }, action: { type: "steal", successRate: 0.3 } },
    { id: "frenzy", trigger: { type: "likes", every: 1000 }, action: { type: "frenzy", durationSec: 30 } },
    { id: "book", trigger: { type: "comment", command: "!สมุด" }, action: { type: "showCollection" } },
    { id: "follow", oncePerUser: true, trigger: { type: "follow" }, action: { type: "cast", count: 1 } },
  ],
});

describe("RuleEngine", () => {
  it("picks the highest met minDiamonds threshold", () => {
    const engine = new RuleEngine(config);
    expect(engine.handle(gift(1, 1)).map((f) => f.rule.id)).toEqual(["any-1"]);
    expect(engine.handle(gift(2, 150)).map((f) => f.rule.id)).toEqual(["any-99"]);
  });

  it("prefers an exact giftId over any value threshold", () => {
    const engine = new RuleEngine(config);
    expect(engine.handle(gift(7934, 199)).map((f) => f.rule.id)).toEqual(["steal"]);
  });

  it("fires once per gift in a streak", () => {
    const engine = new RuleEngine(config);
    const [fired] = engine.handle(gift(1, 1, 5));
    expect(fired?.times).toBe(5);
  });

  it("ignores duplicate event ids", () => {
    const engine = new RuleEngine(config);
    const g = gift(1, 1);
    expect(engine.handle(g)).toHaveLength(1);
    expect(engine.handle(g)).toHaveLength(0);
  });

  it("fires like thresholds as the running total crosses them", () => {
    const engine = new RuleEngine(config);
    const like = (n: number): LiveEvent => ({ type: "like", eventId: id(), at: 0, viewer, likeCount: n });
    expect(engine.handle(like(600))).toHaveLength(0);
    expect(engine.handle(like(600))[0]?.times).toBe(1);
    expect(engine.handle(like(2000))[0]?.times).toBe(2);
  });

  it("matches comment commands", () => {
    const engine = new RuleEngine(config);
    const c: LiveEvent = { type: "comment", eventId: id(), at: 0, viewer, text: "  !สมุด please" };
    expect(engine.handle(c).map((f) => f.rule.id)).toEqual(["book"]);
  });

  it("honours oncePerUser", () => {
    const engine = new RuleEngine(config);
    const follow = (): LiveEvent => ({ type: "follow", eventId: id(), at: 0, viewer });
    expect(engine.handle(follow())).toHaveLength(1);
    expect(engine.handle(follow())).toHaveLength(0);
  });

  it("skips disabled rules", () => {
    const engine = new RuleEngine(parseRulesConfig({ rules: [{ enabled: false, trigger: { type: "follow" }, action: { type: "cast", count: 1 } }] }));
    expect(engine.handle({ type: "follow", eventId: id(), at: 0, viewer })).toHaveLength(0);
  });
});

describe("parseRulesConfig", () => {
  it("rejects a gift trigger with no condition", () => {
    expect(() =>
      parseRulesConfig({ rules: [{ trigger: { type: "gift" }, action: { type: "cast", count: 1 } }] }),
    ).toThrow();
  });

  it("accepts the default rules", () => {
    expect(() => parseRulesConfig(defaultRulesConfig)).not.toThrow();
  });

  it("counts each viewer's own likes for per-viewer rules", () => {
    const engine = new RuleEngine(parseRulesConfig({ rules: [{ id: "cast", trigger: { type: "likes", every: 50, perViewer: true }, action: { type: "cast", count: 1 } }] }));
    const a: Viewer = { userId: "a", uniqueId: "a", nickname: "A" };
    const b: Viewer = { userId: "b", uniqueId: "b", nickname: "B" };
    const like = (v: Viewer, likeCount: number): LiveEvent => ({ type: "like", eventId: id(), at: 0, viewer: v, likeCount });
    expect(engine.handle(like(a, 30))).toHaveLength(0);
    expect(engine.handle(like(b, 30))).toHaveLength(0); // the room has 60, but nobody has 50 of their own
    const fired = engine.handle(like(a, 25));
    expect(fired.map((f) => [f.viewer.userId, f.times])).toEqual([["a", 1]]);
    expect(engine.handle(like(b, 120)).map((f) => f.times)).toEqual([3]); // 30 + 120 = 150 → three casts
  });

  it("matches gifts by name between giftId and value thresholds", () => {
    const engine = new RuleEngine(
      parseRulesConfig({
        rules: [
          { id: "by-value", trigger: { type: "gift", minDiamonds: 10 }, action: { type: "cast", count: 1 } },
          { id: "by-name", trigger: { type: "gift", giftName: "Perfume" }, action: { type: "steal" } },
          { id: "by-id", trigger: { type: "gift", giftId: 42 }, action: { type: "cast", count: 9 } },
        ],
      }),
    );
    const named = (giftId: number, giftName: string): GiftEvent => ({ ...gift(giftId, 20), giftName });
    expect(engine.handle(named(1, "perfume")).map((f) => f.rule.id)).toEqual(["by-name"]); // case-insensitive
    expect(engine.handle(named(42, "Perfume")).map((f) => f.rule.id)).toEqual(["by-id"]);
    expect(engine.handle(named(2, "Doughnut")).map((f) => f.rule.id)).toEqual(["by-value"]);
  });

  it("ships default rules that parse, with likes casting per viewer", () => {
    const parsed = parseRulesConfig(defaultRulesConfig);
    expect(parsed.rules.find((r) => r.id === "likes-cast")?.trigger).toEqual({ type: "likes", every: 50, perViewer: true });
  });
});

describe("default rules", () => {
  it("reward a new follower like a Rosa, once per viewer", () => {
    const engine = new RuleEngine(parseRulesConfig(defaultRulesConfig));
    const follow = (): LiveEvent => ({ type: "follow", eventId: id(), at: 0, viewer });
    const fired = engine.handle(follow());
    const rosa = defaultRulesConfig.rules.find((r) => r.id === "gift-rosa")!.action;
    expect(fired.map((f) => f.action)).toEqual([rosa]);
    expect(engine.handle(follow())).toHaveLength(0); // re-following doesn't farm it
  });

  it("upgrade older rules.json files, keeping the streamer's edits from version 2 on", () => {
    const v2 = { version: 2, rules: defaultRulesConfig.rules.filter((r) => r.id !== "follow-rosa").map((r) => (r.id === "likes-cast" ? { ...r, trigger: { type: "likes" as const, every: 30, perViewer: true } } : r)) };
    const up = upgradeRulesConfig(v2, defaultRulesConfig, 3);
    expect(up.version).toBe(3);
    expect(up.rules.find((r) => r.id === "likes-cast")!.trigger).toEqual({ type: "likes", every: 30, perViewer: true });
    expect(up.rules.some((r) => r.id === "follow-rosa")).toBe(true);
    expect(upgradeRulesConfig({ rules: [] }, defaultRulesConfig, 3)).toBe(defaultRulesConfig); // v1: replaced
  });

  it("reset re-balanced gift rules when upgrading past their version", () => {
    const v3 = { version: 3, rules: defaultRulesConfig.rules.map((r) => (r.id === "gift-rose" ? { ...r, action: { type: "cast" as const, count: 1, minPoints: 50 } } : r)) };
    const up = upgradeRulesConfig(v3, defaultRulesConfig, 4, { 4: ["gift-rose"] });
    expect(up.rules.find((r) => r.id === "gift-rose")!.action).toEqual(defaultRulesConfig.rules.find((r) => r.id === "gift-rose")!.action);
  });
});

describe("pickLucky", () => {
  it("picks options in proportion to their weight", () => {
    const rng = createSeededRng(8);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 20_000; i++) counts[pickLucky(rng, [{ weight: 3, k: "a" as const }, { weight: 1, k: "b" as const }]).k]++;
    expect(counts.a / 20_000).toBeCloseTo(0.75, 1);
  });
});
