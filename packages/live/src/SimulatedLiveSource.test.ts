import { describe, expect, it } from "vitest";
import type { LiveEvent } from "@saf/core";
import { SimulatedLiveSource } from "./SimulatedLiveSource";

describe("SimulatedLiveSource", () => {
  it("emits normalized events with unique ids", async () => {
    const source = new SimulatedLiveSource();
    const events: LiveEvent[] = [];
    source.onEvent((e) => events.push(e));
    await source.connect();

    source.sendGift({ giftId: 5655, giftName: "Rose", diamonds: 1, repeatCount: 3 });
    source.sendLikes(50);
    source.sendComment("!สมุด");

    expect(events.map((e) => e.type)).toEqual(["gift", "like", "comment"]);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(3);
    const g = events[0];
    expect(g?.type === "gift" && g.repeatCount).toBe(3);
  });

  it("reports connection state", async () => {
    const source = new SimulatedLiveSource();
    const states: string[] = [];
    source.onState((s) => states.push(s.status));
    await source.connect();
    await source.disconnect();
    expect(states).toEqual(["disconnected", "connected", "disconnected"]);
  });
});
