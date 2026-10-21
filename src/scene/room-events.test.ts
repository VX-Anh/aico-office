import { describe, expect, it } from "vitest";
import type { Ticket, TicketArtifact } from "../api";
import { BANNER_MS, MAX_QUEUE, bannerText, createRoomEvents, type TicketAssignment } from "./room-events";

function ticket(id: string, status: string, artifacts: TicketArtifact[] = []): Ticket {
  return { id, title: id, status, project: null, updated_at: null, artifacts };
}

const mr = (ref: string, url: string | null = `https://example.com/${ref}`): TicketArtifact => ({
  kind: "merge_request", ref, url,
});

function run(now: number, tickets: Ticket[], assignments: TicketAssignment[] = [{ ticketId: "T-1", provider: "claude" }]) {
  return { tickets, assignments, now };
}

describe("banner từ hai lần poll", () => {
  it("chữ tiếng Việt và TTL khoảng 10 giây", () => {
    expect(bannerText("mr", "T-1")).toBe("MR mở: T-1");
    expect(bannerText("done", "T-9")).toBe("Đã merge T-9");
    expect(bannerText("escalated", "T-3")).toBe("Leo thang: T-3");
    expect(BANNER_MS).toBe(10_000);
  });

  it("baseline không phát lịch sử MR, done hay escalated; poll giống hệt không lặp", () => {
    const events = createRoomEvents();
    const initial = [
      ticket("T-1", "done", [mr("!1")]),
      ticket("T-2", "escalated", [mr("!2")]),
      ticket("T-3", "in_progress", [mr("!3")]),
    ];
    const rooms = [
      { ticketId: "T-1", provider: "claude" },
      { ticketId: "T-2", provider: "codex" },
      { ticketId: "T-3", provider: "cursor" },
    ];
    expect(events.observe(run(0, initial, rooms))).toEqual([]);
    expect(events.observe(run(1000, initial, rooms))).toEqual([]);
  });

  it("MR đầu, MR bổ sung, đảo thứ tự, đổi url cùng ref, và MR mất rồi trở lại", () => {
    const events = createRoomEvents();
    const room = [{ ticketId: "T-1", provider: "claude" }];
    expect(events.observe(run(0, [ticket("T-1", "in_progress")], room))).toEqual([]);

    const first = events.observe(run(1000, [ticket("T-1", "in_progress", [mr("!1", "https://a")])], room));
    expect(first.map((banner) => banner.kind)).toEqual(["mr"]);
    expect(first[0].key).toContain("!1");
    expect(first[0].expiresAt - first[0].startedAt).toBe(BANNER_MS);

    const branch: TicketArtifact = { kind: "branch", ref: "aico/T-1", url: null };
    const second = mr("!2", "https://b");
    const reordered = events.observe(run(1500, [ticket("T-1", "in_progress", [second, branch, mr("!1", "https://a")])], room));
    expect(reordered.map((banner) => banner.key)).toEqual(first.map((banner) => banner.key));
    const extra = events.tick(1000 + BANNER_MS);
    expect(extra.some((banner) => banner.key.includes("!2"))).toBe(true);

    events.tick(30_000);
    expect(events.observe(run(30_000, [ticket("T-1", "in_progress", [mr("!1", "https://changed"), second])], room))).toEqual([]);
    expect(events.observe(run(31_000, [ticket("T-1", "in_progress", [branch])], room))).toEqual([]);
    expect(events.observe(run(32_000, [ticket("T-1", "in_progress", [mr("!1"), second])], room))).toEqual([]);
  });

  it("MR chỉ có url vẫn ổn định khi đảo artifact", () => {
    const events = createRoomEvents();
    const room = [{ ticketId: "T-1", provider: "claude" }];
    const urlOnly: TicketArtifact = { kind: "merge_request", ref: null, url: "https://example.com/mr/9" };
    const other: TicketArtifact = { kind: "preview", ref: null, url: "https://example.com/p" };
    events.observe(run(0, [ticket("T-1", "in_progress")], room));
    expect(events.observe(run(1000, [ticket("T-1", "in_progress", [other, urlOnly])], room))).toHaveLength(1);
    events.tick(20_000);
    expect(events.observe(run(20_000, [ticket("T-1", "in_progress", [urlOnly, other])], room))).toEqual([]);
  });

  it("done và escalated chỉ khi chuyển trạng thái; biến mất không phải done; poll tiếp không lặp", () => {
    const events = createRoomEvents();
    const room = [{ ticketId: "T-1", provider: "claude" }];
    events.observe(run(0, [ticket("T-1", "in_progress")], room));
    expect(events.observe(run(1000, [], room))).toEqual([]);
    expect(events.observe(run(2000, [ticket("T-1", "in_progress")], room))).toEqual([]);

    const done = events.observe(run(3000, [ticket("T-1", "done")], room));
    expect(done.map((banner) => banner.kind)).toEqual(["done"]);
    expect(events.observe(run(3500, [ticket("T-1", "done")], room))).toEqual(done);
    expect(events.tick(3000 + BANNER_MS - 1)).toHaveLength(1);
    expect(events.tick(3000 + BANNER_MS)).toEqual([]);

    events.observe(run(20_000, [ticket("T-1", "in_progress")], room));
    const escalated = events.observe(run(21_000, [ticket("T-1", "escalated")], room));
    expect(escalated.map((banner) => banner.kind)).toEqual(["escalated"]);
    expect(events.observe(run(22_000, [ticket("T-1", "escalated")], room))[0].startedAt).toBe(escalated[0].startedAt);
  });

  it("ticket mất rồi hiện lại đúng done chỉ một lần; gán muộn không tạo banner", () => {
    const events = createRoomEvents();
    events.observe(run(0, [ticket("T-1", "in_progress")], []));
    expect(events.observe(run(500, [ticket("T-1", "done")], [{ ticketId: "T-1", provider: "claude" }])))
      .toMatchObject([{ provider: "claude", kind: "done" }]);

    events.reset();
    events.observe(run(0, [ticket("T-1", "in_progress")], []));
    expect(events.observe(run(1000, [ticket("T-1", "done")], []))).toEqual([]);
    expect(events.observe(run(1500, [ticket("T-1", "done")], [{ ticketId: "T-1", provider: "claude" }]))).toEqual([]);

    events.reset();
    events.observe(run(0, [ticket("T-1", "in_progress")], [{ ticketId: "T-1", provider: "claude" }]));
    expect(events.observe(run(1000, [], []))).toEqual([]);
    const back = events.observe(run(2000, [ticket("T-1", "done")], []));
    expect(back).toMatchObject([{ provider: "claude", ticket: "T-1", kind: "done" }]);
    expect(events.observe(run(2500, [], []))).toEqual(back);
    expect(events.observe(run(2600, [ticket("T-1", "done")], []))).toEqual(back);
  });

  it("nhiều ticket một phòng, một ticket nhiều phòng, ticket không ánh xạ không gán nhầm", () => {
    const events = createRoomEvents();
    const tickets = [ticket("T-a", "in_progress"), ticket("T-b", "in_progress"), ticket("T-c", "in_progress")];
    const rooms = [
      { ticketId: "T-a", provider: "claude" },
      { ticketId: "T-b", provider: "claude" },
      { ticketId: "T-c", provider: "claude" },
      { ticketId: "T-c", provider: "codex" },
    ];
    events.observe(run(0, tickets, rooms));
    const banners = events.observe(run(1000, [
      ticket("T-a", "done"),
      ticket("T-b", "escalated"),
      ticket("T-c", "done"),
      ticket("T-z", "done"),
    ], rooms));
    expect(banners.filter((banner) => banner.provider === "claude").map((banner) => banner.kind)).toEqual(["escalated"]);
    expect(banners.filter((banner) => banner.ticket === "T-z")).toEqual([]);
    const seen = [...banners];
    let now = 1000;
    for (let i = 0; i < 4; i++) {
      now += BANNER_MS;
      seen.push(...events.tick(now));
    }
    expect(seen.filter((banner) => banner.ticket === "T-c").map((banner) => banner.provider).sort()).toEqual(["claude", "codex"]);
    expect(seen.filter((banner) => banner.provider === "claude").some((banner) => banner.kind === "done")).toBe(true);
  });

  it("agent rời trước poll done vẫn còn phòng; reset xoá ánh xạ", () => {
    const events = createRoomEvents();
    events.observe(run(0, [ticket("T-1", "in_progress", [mr("!1")])], [{ ticketId: "T-1", provider: "codex" }]));
    const opened = events.observe(run(1000, [ticket("T-1", "in_progress", [mr("!1"), mr("!2")])], []));
    expect(opened).toMatchObject([{ provider: "codex", kind: "mr" }]);
    events.tick(20_000);
    const merged = events.observe(run(20_000, [ticket("T-1", "done", [mr("!1"), mr("!2")])], []));
    expect(merged).toMatchObject([{ provider: "codex", ticket: "T-1", kind: "done" }]);

    events.reset();
    expect(events.observe(run(30_000, [ticket("T-1", "done", [mr("!1")])], []))).toEqual([]);
    expect(events.observe(run(31_000, [ticket("T-1", "escalated")], []))).toEqual([]);
  });

  it("hàng đợi có giới hạn và không bỏ escalated để giữ MR", () => {
    const events = createRoomEvents();
    const ids = Array.from({ length: MAX_QUEUE + 2 }, (_, i) => `T-${i}`);
    const rooms = [
      ...ids.map((id) => ({ ticketId: id, provider: "claude" })),
      { ticketId: "T-hot", provider: "claude" },
    ];
    events.observe(run(0, [...ids.map((id) => ticket(id, "in_progress")), ticket("T-hot", "in_progress")], rooms));
    const first = events.observe(run(1000, [
      ...ids.map((id) => ticket(id, "in_progress", [mr(`!${id}`)])),
      ticket("T-hot", "escalated"),
    ], rooms));
    expect(first.map((banner) => banner.kind)).toEqual(["escalated"]);
    const seen = new Set(first.map((banner) => banner.ticket));
    for (let i = 1; i <= MAX_QUEUE + 2; i++) {
      for (const banner of events.tick(1000 + i * BANNER_MS)) seen.add(banner.ticket);
    }
    expect(seen.has("T-hot")).toBe(true);
    expect(seen.size).toBeLessThanOrEqual(1 + MAX_QUEUE);
    expect(seen.has(`T-${MAX_QUEUE + 1}`)).toBe(false);
  });

  it("artifact hỏng hoặc danh sách không phải mảng thì bỏ qua, không ném", () => {
    const events = createRoomEvents();
    const broken = { id: "T-1", title: "x", status: "in_progress", project: null, updated_at: null, artifacts: null } as unknown as Ticket;
    expect(events.observe({ tickets: [broken], assignments: [{ ticketId: "T-1", provider: "claude" }], now: 0 })).toEqual([]);
    expect(events.observe({ tickets: null as unknown as Ticket[], assignments: null as unknown as TicketAssignment[], now: 1 })).toEqual([]);
    expect(events.observe(run(Number.NaN, [ticket("T-1", "done")]))).toEqual([]);
  });
});
