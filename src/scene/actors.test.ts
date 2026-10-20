import { beforeEach, describe, expect, it } from "vitest";
import type { WorkerAgent, WorkerState, WorkerStatus } from "../api";
import { type Actor, actorPose, resetActors, syncActors } from "./actors";
import { computeLayout } from "./layout";
import { pathLength } from "./pathing";

const agent: WorkerAgent = {
  id: "a", role: "coder", ticket_id: null, mode: "write", started_at: "2026-01-01T00:00:00Z",
};

// Thời gian do kịch bản điều khiển, không phụ thuộc timer hoặc tốc độ máy chạy test.
function scenario(slots = 1, initialFrontSlots = 1) {
  let t = 0;
  let present = false;
  let state: WorkerState = "working";
  let frontSlots = initialFrontSlots;
  const layoutNow = () => computeLayout([
    { name: "front", state: "idle", roles: [], slots: frontSlots },
    { name: "codex", state, roles: [], slots, agents: present ? [agent] : [] },
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
});
