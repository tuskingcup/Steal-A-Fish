import { describe, expect, it } from "vitest";
import { Leaderboard } from "./leaderboard";

describe("Leaderboard", () => {
  it("has no champion until someone scores", () => {
    expect(new Leaderboard().champion()).toBeNull();
  });

  it("crowns the top scorer and reports changes", () => {
    const lb = new Leaderboard();
    expect(lb.add("a", 1)).toBe(true);
    expect(lb.champion()).toBe("a");
    expect(lb.add("b", 1)).toBe(false); // tie: champion keeps the crown
    expect(lb.champion()).toBe("a");
    expect(lb.add("b", 1)).toBe(true);
    expect(lb.champion()).toBe("b");
    expect(lb.add("a", 0)).toBe(false);
  });

  it("passes the crown on when the champion's score drops", () => {
    const lb = new Leaderboard();
    lb.add("a", 5);
    lb.add("b", 3);
    expect(lb.set("a", 1)).toBe(true);
    expect(lb.champion()).toBe("b");
  });
});
