import { describe, expect, it } from "vitest";
import type { GiftEvent, LiveEvent, Viewer } from "./events";
import { RuleEngine, parseRulesConfig } from "./rules";
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
    const engine = new RuleEngine(defaultRulesConfig);
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
});
