import { describe, expect, it } from "vitest";
import type { WorkerAgent, WorkerStatus } from "../api";
import { computeLayout, roomSigns } from "./layout";
import {
  CAR_CYCLE_MS,
  CAR_DRIVE_MS,
  DEFAULT_OUTDOOR_SEED,
  type CarPose,
  type OutdoorLayout,
  carPose,
  drawOutdoorCar,
  drawOutdoorStatic,
  outdoorLayout,
  rectsOverlap,
} from "./outdoor";
import { C, GROUND } from "./palette";
import type { Ctx, Rect } from "./pixel";
import { drawBackdrop } from "./tiles";

function worker(name: string, slots: number, agents = 0, state: WorkerStatus["state"] = "idle"): WorkerStatus {
  const crew: WorkerAgent[] = Array.from({ length: agents }, (_, i) => ({
    id: `${name}-${i}`, role: "coder", ticket_id: null, mode: "write", started_at: "2026-01-01T00:00:00Z",
  }));
  return { name, state, roles: [], slots, agents: crew };
}

function layouts(): { name: string; layout: ReturnType<typeof computeLayout> }[] {
  return [
    { name: "slots 0", layout: computeLayout([worker("a", 0), worker("b", 1)]) },
    { name: "một phòng", layout: computeLayout([worker("codex", 2, 2, "working")]) },
    { name: "slots tăng", layout: computeLayout([worker("front", 4), worker("codex", 1), worker("cursor", 3)]) },
    { name: "slots giảm", layout: computeLayout([worker("front", 1), worker("codex", 1)]) },
    { name: "nhiều phòng", layout: computeLayout(Array.from({ length: 6 }, (_, i) => worker(`p${i}`, i % 3))) },
    { name: "không phòng", layout: computeLayout([]) },
  ];
}

function props(outdoor: OutdoorLayout): Rect[] {
  return [...outdoor.trees, ...outdoor.bushes, ...outdoor.lamps];
}

function expectClear(outdoor: OutdoorLayout): void {
  const forbidden = [outdoor.building, outdoor.path];
  const all = props(outdoor);
  expect(outdoor.trees.length).toBeGreaterThan(0);
  expect(outdoor.bushes.length).toBeGreaterThan(0);
  expect(outdoor.lamps.length).toBeGreaterThanOrEqual(2);
  for (const prop of all) {
    expect(prop.x).toBeGreaterThanOrEqual(0);
    expect(prop.y).toBeGreaterThanOrEqual(0);
    expect(prop.x + prop.w).toBeLessThanOrEqual(outdoor.width);
    expect(prop.y + prop.h).toBeLessThanOrEqual(outdoor.height);
    for (const area of forbidden) expect(rectsOverlap(prop, area)).toBe(false);
    expect(rectsOverlap(prop, outdoor.road)).toBe(false);
  }
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) expect(rectsOverlap(all[i], all[j])).toBe(false);
  }
  for (const lamp of outdoor.lamps) {
    expect(lamp.light.x).toBeGreaterThanOrEqual(lamp.x);
    expect(lamp.light.x).toBeLessThan(lamp.x + lamp.w);
    expect(lamp.light.y).toBeGreaterThanOrEqual(lamp.y);
    expect(lamp.light.y).toBeLessThan(lamp.y + lamp.h);
    expect(lamp.y + lamp.h).toBeLessThanOrEqual(outdoor.path.y);
    expect(lamp.y).toBeGreaterThanOrEqual(outdoor.building.y + outdoor.building.h);
  }
}

function recorder(): { ctx: Ctx; ops: { color: string; x: number; y: number; w: number; h: number }[] } {
  const ops: { color: string; x: number; y: number; w: number; h: number }[] = [];
  const ctx = {
    fillStyle: "",
    fillRect(x: number, y: number, w: number, h: number) {
      ops.push({ color: String(this.fillStyle), x, y, w, h });
    },
  };
  return { ctx: ctx as unknown as Ctx, ops };
}

describe("outdoorLayout", () => {
  it("cùng seed và cùng hình cho cùng kết quả", () => {
    const layout = computeLayout([worker("claude", 3), worker("codex", 1)]);
    expect(outdoorLayout(layout, 7)).toEqual(outdoorLayout(layout, 7));
    expect(outdoorLayout(layout)).toEqual(outdoorLayout(layout, DEFAULT_OUTDOOR_SEED));
    expect(outdoorLayout(layout, Number.NaN)).toEqual(outdoorLayout(layout, DEFAULT_OUTDOOR_SEED));
  });

  it("đổi seed thì hàng đèn đổi chỗ", () => {
    const layout = computeLayout([worker("claude", 2), worker("codex", 2)]);
    const a = outdoorLayout(layout, 1);
    const b = outdoorLayout(layout, 2);
    expect(a.seed).not.toBe(b.seed);
    expect(a.lamps.map((lamp) => lamp.x)).not.toEqual(b.lamps.map((lamp) => lamp.x));
    expect(a.trees.length).toBe(b.trees.length);
  });

  for (const { name, layout } of layouts()) {
    it(`footprint không đè toà nhà, lối đi hay đường khi ${name}`, () => {
      const outdoor = outdoorLayout(layout, 3);
      expect(outdoor.width).toBe(layout.width);
      expect(outdoor.height).toBe(layout.height);
      expect(outdoor.building).toEqual(layout.building);
      expect(outdoor.path).toEqual(layout.path);
      expect(outdoor.road).toEqual(layout.road);
      expectClear(outdoor);
      for (const room of layout.rooms) {
        for (const prop of props(outdoor)) expect(rectsOverlap(room.signBand, prop)).toBe(false);
      }
    });
  }

  it("agent mất, offline hoặc limited không đổi cây và đèn nếu slots giữ nguyên", () => {
    const present = outdoorLayout(computeLayout([worker("codex", 2, 2, "working")]), 9);
    const gone = outdoorLayout(computeLayout([worker("codex", 2, 0, "working")]), 9);
    const offline = outdoorLayout(computeLayout([worker("codex", 2, 0, "offline")]), 9);
    const limited = outdoorLayout(computeLayout([worker("codex", 2, 1, "limited")]), 9);
    expect(gone).toEqual(present);
    expect(offline).toEqual(present);
    expect(limited).toEqual(present);
    expect(roomSigns(computeLayout([worker("codex", 2, 0, "offline")]))[0].agents).toBe(0);
  });

  it("slots tăng rồi giảm vẫn chừa lối đi", () => {
    const grow = [1, 4, 2, 0];
    for (const slots of grow) {
      const layout = computeLayout([worker("front", slots), worker("codex", slots === 0 ? 1 : slots)]);
      expectClear(outdoorLayout(layout, DEFAULT_OUTDOOR_SEED));
    }
  });
});

describe("xe", () => {
  const outdoor = outdoorLayout(computeLayout([worker("claude", 1), worker("codex", 3)]), 4);

  function onRoad(pose: CarPose): void {
    expect(pose.y).toBeGreaterThanOrEqual(outdoor.road.y);
    expect(pose.y + pose.h).toBeLessThanOrEqual(outdoor.road.y + outdoor.road.h);
    expect(rectsOverlap(pose, outdoor.building)).toBe(false);
    expect(rectsOverlap(pose, outdoor.path)).toBe(false);
  }

  it("chạy thưa theo hai hướng rồi nghỉ", () => {
    const early = carPose(outdoor, 200, false);
    const later = carPose(outdoor, 800, false);
    expect(early.visible).toBe(true);
    expect(later.visible).toBe(true);
    expect(early.dir).toBe("right");
    expect(later.x).toBeGreaterThan(early.x);
    onRoad(early);
    onRoad(later);
    expect(rectsOverlap(later, outdoor.road)).toBe(true);

    const backEarly = carPose(outdoor, CAR_CYCLE_MS + 200, false);
    const backLater = carPose(outdoor, CAR_CYCLE_MS + 800, false);
    expect(backEarly.dir).toBe("left");
    expect(backLater.x).toBeLessThan(backEarly.x);
    onRoad(backEarly);

    expect(carPose(outdoor, CAR_DRIVE_MS, false).visible).toBe(false);
    expect(carPose(outdoor, CAR_CYCLE_MS - 1, false).visible).toBe(false);
    expect(carPose(outdoor, CAR_DRIVE_MS - 1, false).visible).toBe(true);
  });

  it("reduced motion đỗ một chỗ, không phụ thuộc thời gian", () => {
    const parked = carPose(outdoor, 0, true);
    expect(parked).toEqual(carPose(outdoor, CAR_CYCLE_MS + 12345, true));
    expect(parked.visible).toBe(true);
    expect(parked.x).toBeGreaterThanOrEqual(outdoor.road.x);
    expect(parked.x + parked.w).toBeLessThanOrEqual(outdoor.road.x + outdoor.road.w);
    onRoad(parked);
  });
});

describe("vẽ ngoại cảnh", () => {
  const outdoor = outdoorLayout(computeLayout([worker("a", 1), worker("b", 2)]), 6);

  it("nền tĩnh có cỏ, bụi, lối, đường, vạch và đèn, không có xe", () => {
    const first = recorder();
    drawOutdoorStatic(first.ctx, outdoor);
    const second = recorder();
    drawOutdoorStatic(second.ctx, outdoor);
    expect(second.ops).toEqual(first.ops);
    const colors = new Set(first.ops.map((op) => op.color));
    expect(colors.has(GROUND.grass)).toBe(true);
    expect(colors.has(GROUND.bush) || colors.has(GROUND.bushLight)).toBe(true);
    expect(colors.has(GROUND.path) || colors.has(GROUND.pathAlt)).toBe(true);
    expect(colors.has(GROUND.road)).toBe(true);
    expect(colors.has(GROUND.lane)).toBe(true);
    expect(colors.has(GROUND.lamp)).toBe(true);
    expect(colors.has(GROUND.canopy) || colors.has(GROUND.canopyLight)).toBe(true);
    expect(colors.has(GROUND.car)).toBe(false);
    expect(colors.has(GROUND.carAlt)).toBe(false);
  });

  it("xe đổi chỗ khi chạy và đứng yên khi reduced motion", () => {
    const stillA = recorder();
    const stillB = recorder();
    drawOutdoorCar(stillA.ctx, outdoor, 0, true);
    drawOutdoorCar(stillB.ctx, outdoor, 50_000, true);
    expect(stillB.ops).toEqual(stillA.ops);
    expect(stillA.ops.some((op) => op.color === GROUND.car || op.color === GROUND.carAlt)).toBe(true);

    const moveA = recorder();
    const moveB = recorder();
    drawOutdoorCar(moveA.ctx, outdoor, 100, false);
    drawOutdoorCar(moveB.ctx, outdoor, 900, false);
    expect(moveB.ops).not.toEqual(moveA.ops);

    const hidden = recorder();
    drawOutdoorCar(hidden.ctx, outdoor, CAR_DRIVE_MS + 10, false);
    expect(hidden.ops).toEqual([]);
  });

  it("nền cảnh vẽ sân rồi tường, xe để lớp động", () => {
    const { ctx, ops } = recorder();
    drawBackdrop(ctx, computeLayout([worker("a", 1), worker("b", 1)]));
    const colors = new Set(ops.map((op) => op.color));
    expect(colors.has(GROUND.grass)).toBe(true);
    expect(colors.has(GROUND.road)).toBe(true);
    expect(colors.has(C.wall)).toBe(true);
    expect(colors.has(GROUND.car)).toBe(false);
    const wall = ops.find((op) => op.color === C.wall);
    const grass = ops.find((op) => op.color === GROUND.grass);
    expect(wall).toBeTruthy();
    expect(grass).toBeTruthy();
    expect(ops.indexOf(wall!)).toBeGreaterThan(ops.indexOf(grass!));
  });
});
