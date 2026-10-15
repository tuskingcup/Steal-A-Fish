import { describe, expect, it } from "vitest";
import { avatarFor, avatarKey, hashString, HATS, TOPS } from "./avatar";

describe("avatarFor", () => {
  it("gives a viewer the same look every time", () => {
    expect(avatarFor("7123456789")).toEqual(avatarFor("7123456789"));
    expect(hashString("abc")).toBe(hashString("abc"));
  });

  it("gives different viewers varied looks", () => {
    const avatars = Array.from({ length: 200 }, (_, i) => avatarFor(`user-${i}`));
    expect(new Set(avatars.map(avatarKey)).size).toBe(200);
    // Every hat and top style shows up across a crowd.
    expect(new Set(avatars.map((a) => a.hat)).size).toBe(HATS.length);
    expect(new Set(avatars.map((a) => a.top)).size).toBe(TOPS.length);
  });

  it("never uses the same colour for a top and its accent", () => {
    for (let i = 0; i < 500; i++) {
      const a = avatarFor(`v${i}`);
      expect(a.topAccent).not.toBe(a.topColor);
    }
  });
});
