import { describe, expect, it } from "vitest";
import { createSeededRng } from "./rng";
import { RoundGame, sumLog10, type RoundConfig } from "./round";

const CONFIG: RoundConfig = { roundMs: 300_000, summaryMs: 60_000, autoCastMs: 30_000, firstCastMs: 3_000 };
const newGame = () => new RoundGame(createSeededRng(5), CONFIG);

describe("RoundGame", () => {
  it("only lets joined players cast, and only while the round is open", () => {
    const g = newGame();
    expect(g.cast("a", 1, 0)).toEqual([]); // idle
    g.start(0);
    expect(g.cast("a", 1, 10)).toEqual([]); // not joined
    expect(g.join("a", "A", 10)).toBe("joined");
    expect(g.join("a", "A2", 11)).toBe("already");
    const events = g.cast("a", 3, 20);
    expect(events).toHaveLength(3);
    expect(events[0]!.name).toBe("A2");
  });

  it("casts for every joined player on the auto-cast timer", () => {
    const g = newGame();
    g.start(0);
    g.join("a", "A", 0);
    g.join("b", "B", 0);
    expect(g.tick(2_000).catches).toHaveLength(0);
    expect(g.tick(3_000).catches.map((c) => c.userId).sort()).toEqual(["a", "b"]);
    expect(g.tick(20_000).catches).toHaveLength(0);
    expect(g.tick(33_000).catches).toHaveLength(2);
  });

  it("runs round → summary → next round, with summary joiners playing next round", () => {
    const g = newGame();
    g.start(0);
    g.join("a", "A", 0);
    g.cast("a", 5, 1_000);
    const end = g.tick(300_000);
    expect(end.ended?.round).toBe(1);
    expect(g.state().phase).toBe("summary");
    expect(g.cast("a", 1, 300_500)).toEqual([]);
    expect(g.join("b", "B", 301_000)).toBe("queued");
    const next = g.tick(360_000);
    expect(next.started).toBe(true);
    expect(g.state()).toMatchObject({ phase: "open", round: 2, players: 1 });
    expect(g.isPlaying("b")).toBe(true);
    expect(g.isPlaying("a")).toBe(false); // must type the join command again
  });

  it("ranks by total value and lists everyone's catches most valuable first", () => {
    const g = newGame();
    g.start(0);
    for (const id of ["a", "b", "c", "d"]) g.join(id, id.toUpperCase(), 0);
    for (const id of ["a", "b", "c"]) g.cast(id, 10, 1_000);
    const s = g.end(2_000);
    expect(s.players.map((p) => p.rank)).toEqual([1, 2, 3, 4]);
    expect(s.players[3]!.userId).toBe("d"); // caught nothing: last
    for (let i = 0; i < 2; i++) expect(s.players[i]!.totalValue).toBeGreaterThanOrEqual(s.players[i + 1]!.totalValue);
    const fish = s.players[0]!.fish;
    expect(fish).toHaveLength(10);
    expect(s.players[0]!.totalValue).toBe(fish.reduce((sum, f) => sum + f.price, 0));
    for (let i = 1; i < fish.length; i++) expect(fish[i - 1]!.price).toBeGreaterThanOrEqual(fish[i]!.price);
    expect(g.podium().map((p) => p.userId)).toEqual(s.players.slice(0, 3).map((p) => p.userId));
  });

  it("sums weights in log space", () => {
    expect(sumLog10([6, 6])).toBeCloseTo(6 + Math.log10(2));
    expect(sumLog10([400, 1])).toBeCloseTo(400);
  });

  it("ranks everyone for the live leaderboard, and keeps the finished round during the summary", () => {
    const g = newGame();
    g.start(0);
    g.join("a", "A", 0);
    g.join("b", "B", 0);
    g.join("c", "C", 0);
    g.cast("a", 3, 10);
    g.cast("b", 6, 10);
    const rows = g.standings();
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows[2]!.userId).toBe("c"); // caught nothing: last
    expect(rows[2]!.points).toBe(0);
    expect(rows[0]!.points).toBeGreaterThanOrEqual(rows[1]!.points);
    expect(rows.find((r) => r.userId === "b")!.fish).toBe(6);
    g.end(100);
    expect(g.standings()).toEqual(rows);
    g.start(200);
    expect(g.standings()).toEqual([]);
  });

  it("gives gift casts their guaranteed rarity and points", () => {
    const g = newGame();
    g.start(0);
    g.join("a", "A", 0);
    for (const e of g.cast("a", 50, 10, 1, { minRarity: "epic", minPoints: 700 })) {
      expect(["epic", "legendary", "mythic"]).toContain(e.fish.rarity);
      expect(e.fish.price).toBeGreaterThanOrEqual(700);
    }
  });

  it("has no free casts by default: only likes and gifts cast", () => {
    const g = new RoundGame(createSeededRng(5));
    g.start(0);
    g.join("a", "A", 0);
    expect(g.tick(120_000).catches).toHaveLength(0);
  });

  it("steals a random fish from #1, or from #2 when the thief is #1", () => {
    const g = newGame();
    g.start(0);
    g.join("rich", "Rich", 0);
    g.join("thief", "Thief", 0);
    g.join("third", "Third", 0);
    expect(g.steal("thief")).toBeNull(); // nobody has anything yet
    g.cast("rich", 5, 1, 1, { minPoints: 1_000 });
    g.cast("third", 1, 1, 1, { minPoints: 10 });
    const before = g.standings();
    const steal = g.steal("thief")!;
    expect(steal.victim.userId).toBe("rich");
    expect(steal.thief.totalValue).toBe(steal.fish.price);
    expect(steal.victim.totalValue).toBe(before.find((r) => r.userId === "rich")!.points - steal.fish.price);
    const after = g.standings();
    expect(after.find((r) => r.userId === "rich")!.fish).toBe(4);
    expect(after.find((r) => r.userId === "thief")!.fish).toBe(1);
    // The richest player robs the runner-up instead of themselves.
    expect(g.steal("rich")!.victim.userId).not.toBe("rich");
  });
});
