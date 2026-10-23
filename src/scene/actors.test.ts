import { beforeEach, describe, expect, it } from "vitest";
import type { WorkerAgent, WorkerState, WorkerStatus } from "../api";
import { type Actor, actorPose, resetActors, syncActors } from "./actors";
import { WALL, YARD, computeLayout } from "./layout";
import { pathLength } from "./pathing";
import { roleStyle } from "./palette";

const agent: WorkerAgent = {
  id: "a", role: "coder", ticket_id: null, mode: "write", started_at: "2026-01-01T00:00:00Z",
};

// Thời gian do kịch bản điều khiển, không phụ thuộc timer hoặc tốc độ máy chạy test.
function scenario(slots = 1, initialFrontSlots = 1) {
  let t = 0;
  let present = false;
  let currentAgent = { ...agent };
  let others: WorkerAgent[] = [];
  let state: WorkerState = "working";
  let frontSlots = initialFrontSlots;
  const layoutNow = () => computeLayout([
    { name: "front", state: "idle", roles: [], slots: frontSlots },
    { name: "codex", state, roles: [], slots, agents: present ? [currentAgent, ...others] : others },
  ] satisfies WorkerStatus[]);
  let layout = layoutNow();
  let crew = syncActors(layout, t);
  const tick = (ms = 100) => {
    t += ms;
    layout = layoutNow();
    crew = syncActors(layout, t);
    for (const a of crew.rooms[1].seats) {
      if (a?.phase === "seated") {
        expect(a.path[a.path.length - 1]).toEqual(layout.rooms[1].desks[a.seat].seat);
      }
    }
    return crew;
  };
  const active = () => {
    const a = crew.rooms[1].seats.find((a) => a?.agent.id === agent.id);
    expect(a).toBeTruthy();
    return a!;
  };
  const seated = () => {
    for (let i = 0; i < 300 && active().phase !== "seated"; i++) tick();
    expect(active().phase).toBe("seated");
  };
  const exit = () => {
    const a = crew.walkers.find((a) => a.phase === "out");
    expect(a).toBeTruthy();
    const leaving = a as Actor;
    expect(leaving.path[leaving.path.length - 1]).toEqual(layout.lounge.exitSpot);
    // Tới đúng cuối đường, trước khi thời gian mờ dần loại actor khỏi crew.
    const endT = leaving.startT + pathLength(leaving.path) / 48 * 1000;
    tick(Math.max(0, endT - t));
    expect(crew.walkers).toContain(leaving);
    const pose = actorPose(leaving, t);
    expect(pose.x).toBeCloseTo(layout.lounge.exitSpot.x);
    expect(pose.y).toBeCloseTo(layout.lounge.exitSpot.y);
    expect(pose.alpha).toBeCloseTo(1);
    tick(401);
    expect(crew.walkers).not.toContain(leaving);
  };
  return {
    tick, active, seated, exit,
    role(value: WorkerAgent["role"], extraAgents = others) {
      currentAgent = { ...currentAgent, role: value };
      others = extraAgents;
      tick(0);
    },
    present(value: boolean) { present = value; tick(); },
    state(value: WorkerState) { state = value; tick(); },
    slots(value: number) { slots = value; tick(); },
    frontSlots(value: number) { frontSlots = value; tick(); },
    crew: () => crew,
    layout: () => layout,
  };
}

describe("actors khi dữ liệu đổi giữa đường", () => {
  beforeEach(() => resetActors());

  for (const [from, to] of [[1, 4], [4, 1]]) {
    for (const phase of ["in", "seated", "out"] as const) {
      for (const state of ["working", "limited", "offline"] as const) {
        it(`phòng trước ${from} → ${to}, đổi slots và ${state} khi đang ${phase}`, () => {
          const s = scenario(1, from);
          s.present(true);
          if (phase !== "in") s.seated();
          if (phase === "out") s.present(false);
          const before = s.layout().rooms[1];
          s.frontSlots(to);
          const after = s.layout().rooms[1];
          expect(Math.sign(after.door.cx - before.door.cx)).toBe(Math.sign(to - from));
          expect(Math.sign(after.desks[0].seat.x - before.desks[0].seat.x)).toBe(Math.sign(to - from));
          s.slots(4);
          s.state(state);
          if (state === "offline") {
            expect(s.crew().walkers).toEqual([]);
            expect(s.crew().rooms[1].seats.every((a) => a === null)).toBe(true);
          } else if (state === "limited" || phase === "out") {
            s.exit();
          } else {
            s.seated();
          }
          s.frontSlots(1);
          s.slots(1);
          s.present(true);
          s.state("working");
          s.seated();
          s.present(false);
          s.exit();
        });
      }
    }

  }

  for (const phase of ["in", "out"] as const) {
    it(`mất rồi xuất hiện lại nhiều lần khi đang ${phase}`, () => {
      const s = scenario();
      s.present(true);
      if (phase === "out") {
        s.seated();
        s.present(false);
      }
      for (let i = 0; i < 3; i++) {
        s.present(true);
        expect(s.active().phase).toBe("in");
        s.tick(150);
        s.present(false);
        expect(s.crew().walkers.some((a) => a.phase === "out")).toBe(true);
      }
      s.present(true);
      s.seated();
      s.present(false);
      s.exit();
    });

    for (const [from, to] of [[1, 3], [3, 1]]) {
      it(`slots ${from} → ${to} khi đang ${phase}`, () => {
        const s = scenario(from);
        s.present(true);
        if (phase === "out") {
          s.seated();
          s.present(false);
        }
        s.tick(150);
        s.slots(to);
        if (phase === "out") {
          s.exit();
          s.present(true);
        }
        s.seated();
        s.present(false);
        s.exit();
      });
    }

    it(`số bàn phòng phía trước đổi khi đang ${phase}`, () => {
      const s = scenario();
      s.present(true);
      if (phase === "out") {
        s.seated();
        s.present(false);
      }
      s.tick(150);
      s.frontSlots(3);
      s.tick(150);
      s.frontSlots(1);
      if (phase === "out") {
        s.exit();
        s.present(true);
      }
      s.seated();
      s.present(false);
      s.exit();
    });

    it(`offline → online khi đang ${phase}`, () => {
      const s = scenario();
      s.present(true);
      if (phase === "out") {
        s.seated();
        s.present(false);
      }
      s.state("offline");
      expect(s.crew().walkers).toEqual([]);
      expect(s.crew().rooms[1].seats.every((a) => a === null)).toBe(true);
      s.present(true);
      s.state("working");
      expect(s.active().phase).toBe("seated");
      s.present(false);
      s.exit();
    });

    it(`limited khi đang ${phase}, hết hạn mức rồi đi vào lại`, () => {
      const s = scenario();
      s.present(true);
      if (phase === "out") {
        s.seated();
        s.present(false);
      }
      s.state("limited");
      expect(s.crew().rooms[1].seats.every((a) => a === null)).toBe(true);
      s.exit();
      s.present(true);
      s.state("working");
      s.seated();
      s.present(false);
      s.exit();
    });
  }

  it("ghế seated và lối ra nằm trong sân đã dịch, đi vào rồi đi ra vẫn đúng ghế hiện tại", () => {
    const s = scenario();
    s.present(true);
    s.seated();
    const room = s.layout().rooms[1];
    const sitting = s.active();
    const seat = room.desks[sitting.seat].seat;
    expect(room.y).toBe(YARD.top + WALL);
    expect(room.x).toBeGreaterThanOrEqual(YARD.left + WALL);
    expect(sitting.path[sitting.path.length - 1]).toEqual(seat);
    expect(seat.x).toBeGreaterThanOrEqual(room.x);
    expect(seat.x).toBeLessThanOrEqual(room.x + room.w);
    expect(s.layout().lounge.exitSpot.y).toBeGreaterThan(room.y + room.h);
    s.present(false);
    s.exit();
    s.frontSlots(4);
    s.present(true);
    s.seated();
    const again = s.active();
    expect(again.path[again.path.length - 1]).toEqual(s.layout().rooms[1].desks[again.seat].seat);
    s.frontSlots(1);
    s.present(false);
    s.exit();
  });
});

describe("actors đồng bộ trang phục khi role đổi", () => {
  beforeEach(() => resetActors());

  function expectLook(a: Actor, role: WorkerAgent["role"]) {
    expect(a.agent.role).toBe(role);
    expect(a.look.role).toBe(role === "tester" ? "tester" : null);
    expect(a.look.shirt).toBe(roleStyle(role).shirt);
    expect(a.look.shirtDark).toBe(roleStyle(role).shirtDark);
  }

  for (const phase of ["in", "seated"] as const) {
    it(`role lạ → tester → null khi ${phase}, giữ ghế và đường đi`, () => {
      const s = scenario();
      s.role("foo");
      s.present(true);
      if (phase === "seated") {
        s.seated();
        s.tick(0); // Lần sync kế tiếp rút path đã đi xong về đúng một điểm ghế.
      }
      const a = s.active();
      const before = structuredClone(a);
      expectLook(a, "foo");
      for (const role of ["tester", null]) {
        s.role(role);
        expect(s.active()).toBe(a);
        expectLook(a, role);
        expect(a.seat).toBe(before.seat);
        expect(a.phase).toBe(before.phase);
        expect(a.path).toEqual(before.path);
        expect(a.startT).toBe(before.startT);
        expect(a.route).toBe(before.route);
        expect(a.look.hair).toBe(before.look.hair);
        expect(a.look.style).toBe(before.look.style);
      }
      s.seated();
    });

    it(`đổi role cùng lúc tăng rồi giảm số agent khi ${phase}`, () => {
      const s = scenario(2);
      s.role("foo");
      s.present(true);
      if (phase === "seated") {
        s.seated();
        s.tick(0); // Lần sync kế tiếp rút path đã đi xong về đúng một điểm ghế.
      }
      const a = s.active();
      const before = structuredClone(a);
      const other = { ...agent, id: "b", role: "coder" };
      for (const [role, others] of [["tester", [other]], [null, []]] as const) {
        s.role(role, [...others]);
        expect(s.active()).toBe(a);
        expectLook(a, role);
        expect(a.seat).toBe(before.seat);
        expect(a.phase).toBe(before.phase);
        expect(a.path).toEqual(before.path);
        expect(a.startT).toBe(before.startT);
        expect(s.crew().rooms[1].seats.filter(Boolean)).toHaveLength(1 + others.length);
      }
      s.seated();
    });

    it(`mất rồi trở lại với role mới khi đi ra từ ${phase}`, () => {
      const s = scenario();
      s.role("foo");
      s.present(true);
      if (phase === "seated") {
        s.seated();
        s.tick(0); // Lần sync kế tiếp rút path đã đi xong về đúng một điểm ghế.
      }
      const a = s.active();
      const seat = a.seat;
      for (const role of ["tester", null, "tester"]) {
        s.present(false);
        expect(s.crew().walkers).toContain(a);
        expect(a.phase).toBe("out");
        s.role(role);
        s.present(true);
        expect(s.active()).toBe(a);
        expectLook(a, role);
        expect(a.phase).toBe("in");
        expect(a.seat).toBe(seat);
        expect(a.path[a.path.length - 1]).toEqual(s.layout().rooms[1].desks[seat].seat);
        s.tick(150);
      }
      s.seated();
    });

    for (const state of ["offline", "limited"] as const) {
      it(`${state} rồi online với role mới khi ${phase}`, () => {
        const s = scenario();
        s.role("foo");
        s.present(true);
        if (phase === "seated") s.seated();
        const seat = s.active().seat;
        for (const role of ["tester", null]) {
          s.state(state);
          expect(s.crew().rooms[1].seats.every((a) => a === null)).toBe(true);
          if (state === "offline") expect(s.crew().walkers).toEqual([]);
          s.role(role);
          s.state("working");
          expectLook(s.active(), role);
          expect(s.active().seat).toBe(seat);
          expect(s.active().phase).toBe(state === "offline" ? "seated" : "in");
          s.seated();
        }
      });
    }
  }
});
