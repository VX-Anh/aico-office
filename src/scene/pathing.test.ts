import { describe, expect, it } from "vitest";
import type { WorkerStatus } from "../api";
import { computeLayout } from "./layout";
import { alongRoute, pathBetween, pathLength, positionAt, reverseFrom } from "./pathing";
import type { Pt } from "./pixel";

function worker(name: string, slots: number): WorkerStatus {
  return { name, state: "working", roles: [], slots, agents: [] };
}

// Đường đi chỉ gồm đoạn ngang/dọc, không có điểm trùng liền kề.
function expectManhattan(path: Pt[]): void {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    expect(a.x === b.x || a.y === b.y, `đoạn ${i} chéo`).toBe(true);
    expect(a.x === b.x && a.y === b.y, `điểm ${i} trùng`).toBe(false);
  }
}

const layout = computeLayout([worker("claude", 1), worker("codex", 3)]);
const seat = (room: number, s: number) => layout.rooms[room].desks[s].seat;
const exit = layout.lounge.exitSpot;

describe("pathBetween", () => {
  it("phòng nghỉ → ghế: bắt đầu ở exitSpot, kết thúc đúng ghế, qua cửa phòng", () => {
    const path = pathBetween(layout, "lounge", { room: 0, seat: 0 });
    expect(path[0]).toEqual(exit);
    expect(path[path.length - 1]).toEqual(seat(0, 0));
    expect(path).toContainEqual({ x: layout.rooms[0].door.cx, y: layout.lounge.walkY });
    expectManhattan(path);
  });

  it("ghế → phòng nghỉ là đảo ngược của chiều đi vào", () => {
    const inward = pathBetween(layout, "lounge", { room: 1, seat: 2 });
    const outward = pathBetween(layout, { room: 1, seat: 2 }, "lounge");
    expect(outward).toEqual([...inward].reverse());
  });

  it("ghế → ghế khác phòng: đi qua phòng nghỉ, kết thúc đúng ghế đích", () => {
    const path = pathBetween(layout, { room: 0, seat: 0 }, { room: 1, seat: 1 });
    expect(path[0]).toEqual(seat(0, 0));
    expect(path[path.length - 1]).toEqual(seat(1, 1));
    expect(path).toContainEqual(exit);
    expectManhattan(path);
  });

  it("phòng nghỉ → phòng nghỉ chỉ còn một điểm", () => {
    expect(pathBetween(layout, "lounge", "lounge")).toEqual([exit]);
  });
});

describe("positionAt", () => {
  const path = pathBetween(layout, "lounge", { room: 0, seat: 0 });
  const len = pathLength(path);

  it("đi hết quãng thì done và đứng ở điểm cuối", () => {
    const pose = positionAt(path, 0, (len / 10) * 1000 + 1, 10);
    expect(pose.done).toBe(true);
    expect({ x: pose.x, y: pose.y }).toEqual(seat(0, 0));
  });

  it("chưa bắt đầu thì đứng ở điểm đầu", () => {
    const pose = positionAt(path, 1000, 500, 10);
    expect({ x: pose.x, y: pose.y }).toEqual(path[0]);
    expect(pose.done).toBe(false);
  });
});

describe("alongRoute", () => {
  const route = pathBetween(layout, "lounge", { room: 0, seat: 0 });

  it("từ một điểm giữa tuyến: toEnd tới ghế, ngược lại về phòng nghỉ", () => {
    const mid = positionAt(route, 0, 4000, 10);
    const pos = { x: mid.x, y: mid.y };
    const fwd = alongRoute(route, pos, true);
    const back = alongRoute(route, pos, false);
    expect(fwd[0]).toEqual(pos);
    expect(fwd[fwd.length - 1]).toEqual(seat(0, 0));
    expect(back[0]).toEqual(pos);
    expect(back[back.length - 1]).toEqual(exit);
    expectManhattan(fwd);
    expectManhattan(back);
    expect(pathLength(fwd) + pathLength(back)).toBe(pathLength(route));
  });

  it("đổi hướng nhiều lần vẫn tới đúng đích của hướng cuối", () => {
    let pos: Pt = route[0];
    let toEnd = true;
    for (let k = 0; k < 5; k++) {
      const leg = alongRoute(route, pos, toEnd);
      const p = positionAt(leg, 0, 1500, 10);
      pos = { x: p.x, y: p.y };
      toEnd = !toEnd;
    }
    const last = alongRoute(route, pos, toEnd);
    expect(last[last.length - 1]).toEqual(toEnd ? seat(0, 0) : exit);
  });

  it("vị trí lệch khỏi tuyến được kéo về điểm gần nhất trên tuyến", () => {
    const s = seat(0, 0);
    const off = { x: s.x + 3, y: s.y };
    const path = alongRoute(route, off, true);
    expect(path[0]).toEqual(off);
    expect(path[path.length - 1]).toEqual(s);
    expectManhattan(path);
  });

  it("tuyến một điểm: đi thẳng tới điểm đó", () => {
    expect(alongRoute([exit], { x: exit.x, y: exit.y - 4 }, true)).toEqual([{ x: exit.x, y: exit.y - 4 }, exit]);
    expect(alongRoute([exit], exit, false)).toEqual([exit]);
  });
});

describe("reverseFrom", () => {
  const path = pathBetween(layout, "lounge", { room: 1, seat: 0 });

  it("quay đầu giữa đường: bắt đầu tại vị trí hiện tại, về đúng điểm xuất phát", () => {
    const back = reverseFrom(path, 0, 3000, 10);
    const pos = positionAt(path, 0, 3000, 10);
    expect(back[0]).toEqual({ x: pos.x, y: pos.y });
    expect(back[back.length - 1]).toEqual(path[0]);
    expectManhattan(back);
    expect(pathLength(back)).toBeCloseTo(pos.dist);
  });

  it("chưa đi được bước nào thì đứng yên ở điểm xuất phát", () => {
    expect(reverseFrom(path, 0, 0, 10)).toEqual([path[0]]);
  });

  it("đã tới đích rồi quay đầu thì đi lại toàn bộ đường", () => {
    const back = reverseFrom(path, 0, 1e9, 10);
    expect(back).toEqual([...path].reverse());
  });
});
