import { beforeEach, describe, expect, it } from "vitest";
import type { WorkerAgent, WorkerStatus } from "../api";
import type { Rect } from "./pixel";
import { textWidth } from "./font";
import { ROOM_WALL_H, SIGN_BAND_H, WALL, YARD, assignSeats, computeLayout, resetSeats, roomSigns, sceneSize } from "./layout";

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

  for (const slots of [0, 1, 2, 3, 4]) {
    it(`bảng hạn mức nằm riêng trên tường khi slots = ${slots}`, () => {
      const { rooms } = computeLayout([w("front", { slots: 2 }), w("codex", { slots })]);
      const r = rooms[1];
      const board = r.usageBoard;
      expect(board).toBeDefined();
      expect(board.w).toBeGreaterThanOrEqual(60);
      expect(board.h).toBe(15);
      expect(board.x).toBe(r.shelf.x + 22 + 3);
      expect(board.y).toBeGreaterThanOrEqual(r.y + 13);
      expect(board.x + board.w).toBeLessThanOrEqual(r.x + r.w);
      expect(board.y + board.h).toBeLessThanOrEqual(r.y + ROOM_WALL_H);
      const countdownW = textWidth("71H05") + 4;
      const obstacles: Rect[] = [
        { ...r.shelf, w: 22, h: 13 },
        { ...r.clock, w: 9, h: 9 },
        // Kể cả dây treo phía trên biển đếm ngược.
        { x: r.clock.x - 3 - countdownW, y: r.clock.y, w: countdownW, h: 11 },
        { x: r.x, y: r.plateY, w: r.w, h: 9 },
        { x: r.door.x, y: r.y + r.h, w: r.door.w, h: WALL },
        ...r.desks,
        ...r.desks.map((d) => ({ x: d.x + d.w / 2 - 7, y: d.y - 5, w: 14, h: 13 })),
        ...(r.sideDoor ? [r.sideDoor] : []),
      ];
      for (const o of obstacles) {
        expect(board.x < o.x + o.w && board.x + board.w > o.x &&
          board.y < o.y + o.h && board.y + board.h > o.y).toBe(false);
      }
      expect(board.x + board.w + 3).toBeLessThanOrEqual(r.clock.x - 3 - countdownW);
    });
  }

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

  it("sceneSize trùng layout, toà nhà và sân cùng một hệ toạ độ", () => {
    const workers = [w("claude", { slots: 3 }), w("codex", { slots: 1 }), w("cursor", { slots: 0 })];
    const layout = computeLayout(workers);
    expect(sceneSize(workers)).toEqual({ width: layout.width, height: layout.height });
    expect(layout.building).toMatchObject({ x: YARD.left, y: YARD.top });
    expect(layout.width - (layout.building.x + layout.building.w)).toBe(YARD.right);
    expect(layout.path).toMatchObject({ x: 0, w: layout.width, h: YARD.path });
    expect(layout.path.y).toBe(layout.building.y + layout.building.h + YARD.apron);
    expect(layout.road).toMatchObject({ x: 0, w: layout.width, h: YARD.road });
    expect(layout.road.y).toBe(layout.path.y + layout.path.h);
    expect(layout.height).toBe(layout.road.y + layout.road.h + YARD.bottom);
    for (const room of layout.rooms) {
      expect(room.x).toBeGreaterThanOrEqual(layout.building.x + WALL);
      expect(room.y).toBe(layout.building.y + WALL);
      expect(room.x + room.w).toBeLessThanOrEqual(layout.building.x + layout.building.w - WALL);
      expect(room.signAnchor).toEqual({ x: room.x + Math.floor(room.w / 2), y: room.signBand.y });
      expect(room.signBand.h).toBe(SIGN_BAND_H);
      expect(room.signBand.y + room.signBand.h).toBe(layout.building.y);
      expect(room.signBand.y).toBeGreaterThanOrEqual(0);
    }
    const lounge = layout.lounge;
    expect(lounge.x).toBeGreaterThanOrEqual(layout.building.x);
    expect(lounge.y + lounge.h).toBeLessThanOrEqual(layout.building.y + layout.building.h);
    if (layout.storage) {
      expect(layout.storage.x + layout.storage.w).toBeLessThanOrEqual(layout.building.x + layout.building.w);
    }
  });

  it("neo biển đứng yên khi agent mất hoặc offline, dịch khi slots phòng trước đổi", () => {
    const codex = (slots: number, agents: number, state: WorkerStatus["state"] = "working", front = 1) => computeLayout([
      w("front", { slots: front }),
      w("codex", { state, slots, agents: Array.from({ length: agents }, (_, i) => agent(`a${i}`)) }),
    ]);
    const seated = roomSigns(codex(2, 2));
    const gone = roomSigns(codex(2, 0));
    const back = roomSigns(codex(2, 2));
    expect(gone[1].anchor).toEqual(seated[1].anchor);
    expect(gone[1].band).toEqual(seated[1].band);
    expect(gone[1].agents).toBe(0);
    expect(back[1]).toEqual(seated[1]);
    expect(roomSigns(codex(2, 2, "offline"))[1]).toMatchObject({ state: "offline", anchor: seated[1].anchor, agents: 2 });
    expect(roomSigns(codex(2, 0, "limited"))[1]).toMatchObject({ state: "limited", agents: 0, slots: 2, overflow: 0, error: false });
    expect(roomSigns(codex(1, 4))[1]).toMatchObject({ agents: 4, slots: 1, overflow: 3, error: false });
    const erred = computeLayout([
      w("front", { slots: 1 }),
      w("codex", { state: "working", slots: 2, agents: [agent("a")], last_error: "CLI lỗi" }),
    ]);
    expect(roomSigns(erred)[1].error).toBe(true);
    expect(roomSigns(computeLayout([
      w("front", { slots: 1 }),
      w("codex", { state: "offline", slots: 2, agents: [agent("a")], last_error: "CLI lỗi" }),
    ]))[1].error).toBe(false);
    expect(roomSigns(computeLayout([
      w("front", { slots: 1 }),
      w("codex", { state: "limited", slots: 2, agents: [], last_error: "hết hạn" }),
    ]))[1].error).toBe(false);
    // slots 1 và 2 đều chạm ROOM_MIN_W nên tâm phòng không nhảy; slots 4 mới nới rộng.
    const wideRoom = roomSigns(codex(4, 4));
    expect(wideRoom[1].anchor.x).toBeGreaterThan(seated[1].anchor.x);
    expect(wideRoom[1].slots).toBe(4);
    expect(roomSigns(codex(1, 1))[1].anchor).toEqual(seated[1].anchor);
    expect(roomSigns(codex(1, 1))[1].anchor.x).toBeLessThan(wideRoom[1].anchor.x);
    const widerFront = roomSigns(codex(2, 2, "working", 4));
    expect(widerFront[1].anchor.x).toBeGreaterThan(seated[1].anchor.x);
    expect(sceneSize([w("front", { slots: 4 }), w("codex", { slots: 2 })]).width)
      .toBeGreaterThan(sceneSize([w("front", { slots: 1 }), w("codex", { slots: 2 })]).width);
  });
});
