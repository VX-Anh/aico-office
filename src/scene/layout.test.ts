import { beforeEach, describe, expect, it } from "vitest";
import type { WorkerAgent, WorkerStatus } from "../api";
import { assignSeats, computeLayout, resetSeats } from "./layout";

function agent(id: string): WorkerAgent {
  return { id, role: "coder", ticket_id: null, mode: "write", started_at: "2026-01-01T00:00:00Z" };
}

const ids = (seats: (WorkerAgent | null)[]) => seats.map((a) => a?.id ?? null);

describe("assignSeats", () => {
  beforeEach(() => resetSeats());

  it("xếp lần lượt từ ghế đầu", () => {
    const { seats, overflow } = assignSeats("claude", [agent("a"), agent("b")], 3);
    expect(ids(seats)).toEqual(["a", "b", null]);
    expect(overflow).toBe(0);
  });

  it("giữ ghế theo id khi thứ tự đổi hoặc agent khác rời đi", () => {
    assignSeats("claude", [agent("a"), agent("b"), agent("c")], 3);
    expect(ids(assignSeats("claude", [agent("c"), agent("a")], 3).seats)).toEqual(["a", null, "c"]);
    // agent mới lấp chỗ trống, không đẩy ai khỏi ghế
    expect(ids(assignSeats("claude", [agent("d"), agent("c"), agent("a")], 3).seats)).toEqual(["a", "d", "c"]);
  });

  it("agent rời rồi quay lại thì được xếp như agent mới", () => {
    assignSeats("claude", [agent("a"), agent("b")], 2);
    assignSeats("claude", [agent("b")], 2);
    expect(ids(assignSeats("claude", [agent("c"), agent("a"), agent("b")], 2).seats)).toEqual(["c", "b"]);
  });

  it("vượt slots thì đếm overflow, agent đang ngồi giữ ghế", () => {
    assignSeats("codex", [agent("a")], 2);
    const { seats, overflow } = assignSeats("codex", [agent("x"), agent("y"), agent("a"), agent("z")], 2);
    expect(ids(seats)).toEqual(["a", "x"]);
    expect(overflow).toBe(2);
  });

  it("slots giảm thì agent ở ghế bị bỏ được xếp lại, dư thì overflow", () => {
    assignSeats("claude", [agent("a"), agent("b"), agent("c")], 3);
    const { seats, overflow } = assignSeats("claude", [agent("a"), agent("b"), agent("c")], 1);
    expect(ids(seats)).toEqual(["a"]);
    expect(overflow).toBe(2);
    // slots tăng lại: a giữ ghế 0, b và c lấp chỗ trống
    expect(ids(assignSeats("claude", [agent("c"), agent("b"), agent("a")], 3).seats)).toEqual(["a", "c", "b"]);
  });

  it("slots = 0: mọi agent đều overflow", () => {
    const { seats, overflow } = assignSeats("cursor", [agent("a")], 0);
    expect(seats).toEqual([]);
    expect(overflow).toBe(1);
  });

  it("mỗi phòng giữ chỗ riêng", () => {
    assignSeats("claude", [agent("a"), agent("b")], 2);
    expect(ids(assignSeats("codex", [agent("b")], 2).seats)).toEqual(["b", null]);
  });
});

describe("computeLayout", () => {
  const w = (name: string, extra: Partial<WorkerStatus>): WorkerStatus => ({ name, state: "idle", roles: [], ...extra });

  it("mỗi phòng có đúng slots bàn, ghế nằm trong phòng và trên lối đi", () => {
    const layout = computeLayout([w("claude", { slots: 3 }), w("codex", { slots: 1 }), w("cursor", { slots: 0 })]);
    expect(layout.rooms.map((r) => r.desks.length)).toEqual([3, 1, 0]);
    for (const r of layout.rooms) {
      expect(r.door.cx).toBeGreaterThan(r.x);
      expect(r.door.cx).toBeLessThan(r.x + r.w);
      for (const d of r.desks) {
        expect(d.seat.x).toBeGreaterThan(r.x);
        expect(d.seat.x).toBeLessThan(r.x + r.w);
        expect(d.seat.y).toBeLessThan(r.aisleY);
      }
    }
  });

  it("phòng xếp liền nhau không chồng lấn, sideDoor chỉ có giữa hai phòng", () => {
    const layout = computeLayout([w("a", { slots: 2 }), w("b", { slots: 4 }), w("c", { slots: 1 })]);
    const [r0, r1, r2] = layout.rooms;
    expect(r1.x).toBeGreaterThanOrEqual(r0.x + r0.w);
    expect(r2.x).toBeGreaterThanOrEqual(r1.x + r1.w);
    expect(r0.sideDoor).not.toBeNull();
    expect(r2.sideDoor).toBeNull();
    expect(layout.width).toBeGreaterThanOrEqual(r2.x + r2.w);
  });

  it("thiếu slots (aico bản cũ) thì số bàn theo số agent, tối thiểu 1", () => {
    const layout = computeLayout([w("old", {}), w("two", { agents: [agent("a"), agent("b")] })]);
    expect(layout.rooms.map((r) => r.slots)).toEqual([1, 2]);
  });

  it("đổi số bàn phòng phía trước làm dịch ghế của phòng sau", () => {
    const before = computeLayout([w("claude", { slots: 1 }), w("codex", { slots: 1 })]);
    const after = computeLayout([w("claude", { slots: 4 }), w("codex", { slots: 1 })]);
    expect(after.rooms[1].desks[0].seat.x).toBeGreaterThan(before.rooms[1].desks[0].seat.x);
  });

  it("phòng nghỉ đủ chỗ: sofa + chỗ đứng bằng ít nhất số phòng", () => {
    const many = computeLayout(Array.from({ length: 6 }, (_, i) => w(`p${i}`, { slots: 1 })));
    expect(many.lounge.spots.length + many.lounge.standSpots.length).toBeGreaterThanOrEqual(6);
  });
});
