import { describe, expect, it } from "vitest";
import { demoNeedTickets } from "../tickets";
import { DEMO_EVENT_MS, demoEventAssignments, demoEventTickets } from "./demo-events";
import { createRoomEvents } from "./room-events";

function input(now: number) {
  return {
    now,
    tickets: [...demoNeedTickets(now), ...demoEventTickets(now)],
    assignments: demoEventAssignments(now),
  };
}

describe("snapshot sự kiện demo", () => {
  it("cùng bộ phát hiện, lần đầu không phát, rồi lần lượt MR, done và escalated", () => {
    const events = createRoomEvents();
    expect(events.observe(input(0))).toEqual([]);
    const seen = new Set<string>();
    for (let second = 3; second <= 48; second += 3) {
      for (const banner of events.observe(input(second * 1000))) seen.add(banner.kind);
    }
    expect(seen).toEqual(new Set(["mr", "done", "escalated"]));
  });

  it("chu kỳ sau vẫn phát MR mới; reset giữa chừng không phát lại trạng thái hiện có", () => {
    const events = createRoomEvents();
    events.observe(input(0));
    expect(events.observe(input(12_000)).some((banner) => banner.kind === "mr" && banner.provider === "claude")).toBe(true);
    events.observe(input(DEMO_EVENT_MS));
    const next = events.observe(input(DEMO_EVENT_MS + 12_000));
    expect(next.some((banner) => banner.ticket === `T-ev-claude-1` && banner.kind === "mr")).toBe(true);

    events.reset();
    expect(events.observe(input(DEMO_EVENT_MS + 30_000))).toEqual([]);
    expect(events.observe(input(DEMO_EVENT_MS + 30_000))).toEqual([]);
  });

  it("đổi nguồn sau banner đang chạy thì baseline mới không dựng lại banner cũ", () => {
    const events = createRoomEvents();
    events.observe(input(0));
    expect(events.observe(input(12_000)).length).toBeGreaterThan(0);
    events.reset();
    const fresh = createRoomEvents();
    expect(fresh.observe(input(12_000))).toEqual([]);
    expect(events.tick(12_000)).toEqual([]);
  });
});
