import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerStatus } from "../api";
import { resetActors, syncActors } from "./actors";
import { CAR_DRIVE_MS } from "./outdoor";
import { outdoorLayout } from "./outdoor";
import { C, GROUND } from "./palette";
import { computeLayout } from "./layout";
import { lightingInput, lightingKey } from "./lighting";
import {
  backdropKey,
  drawScene,
  resetSceneCache,
  sceneCacheStats,
  sceneLightSources,
} from "./index";

const agent = { id: "a", role: "coder", ticket_id: "T-1", mode: "write", started_at: "2026-01-01T00:00:00Z" };

function room(name: string, state: WorkerStatus["state"], slots: number, agents: typeof agent[] = [], extra: Partial<WorkerStatus> = {}): WorkerStatus {
  return { name, state, roles: [], slots, agents, ...extra };
}

interface Fill { color: string; x: number; y: number; w: number; h: number }
interface FakeCanvas { width: number; height: number; fills: Fill[]; images: string[] }

function makeCtx(fills: Fill[], images: string[]) {
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    imageSmoothingEnabled: true,
    font: "",
    textBaseline: "alphabetic",
    textAlign: "left",
    lineWidth: 1,
    fillRect(x: number, y: number, w: number, h: number) { fills.push({ color: ctx.fillStyle, x, y, w, h }); },
    clearRect() {},
    drawImage() { images.push(ctx.globalCompositeOperation); },
    save() {},
    restore() {},
    translate() {},
    scale() {},
    setTransform() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fill() {},
    arc() {},
    createRadialGradient() { return { addColorStop() {} }; },
    measureText() { return { width: 0 }; },
    fillText() {},
  };
  return ctx;
}

function makeCanvas(made: FakeCanvas[]): FakeCanvas & { getContext: () => ReturnType<typeof makeCtx> } {
  const fills: Fill[] = [];
  const images: string[] = [];
  let ctx: ReturnType<typeof makeCtx> | null = null;
  const canvas = {
    width: 0,
    height: 0,
    fills,
    images,
    getContext() {
      ctx ??= makeCtx(fills, images);
      return ctx;
    },
  };
  made.push(canvas);
  return canvas;
}

const made: FakeCanvas[] = [];
const mainFills: Fill[] = [];
const mainImages: string[] = [];
const main = makeCtx(mainFills, mainImages);

beforeEach(() => {
  made.length = 0;
  mainFills.length = 0;
  mainImages.length = 0;
  resetActors();
  resetSceneCache();
  vi.stubGlobal("document", { createElement: () => makeCanvas(made) });
});

describe("khoá nền và nguồn sáng", () => {
  it("không đổi khi usage, token, lỗi hoặc số agent đổi; đổi khi slots hoặc seed đổi", () => {
    const base = [room("claude", "working", 2, [agent], { tokens_today: 1, usage: { windows: [] } })];
    const noisy = [room("claude", "working", 2, [{ ...agent, id: "b" }, { ...agent, id: "c" }], { tokens_today: 90, last_error: "x", usage: { note: "stale" } })];
    const offline = [room("claude", "offline", 2, [], { last_error: "mất" })];
    expect(backdropKey(computeLayout(base), 1)).toBe(backdropKey(computeLayout(noisy), 1));
    expect(backdropKey(computeLayout(base), 1)).toBe(backdropKey(computeLayout(offline), 1));
    expect(backdropKey(computeLayout(base), 1)).not.toBe(backdropKey(computeLayout([room("claude", "working", 4, [agent])]), 1));
    expect(backdropKey(computeLayout(base), 1)).not.toBe(backdropKey(computeLayout(base), 2));
    const present = computeLayout(base);
    const empty = computeLayout([room("claude", "working", 2, [])]);
    expect(lightingKey(lightingInput(present, 100, []))).not.toBe(lightingKey(lightingInput(empty, 100, [])));
  });

  it("offline và limited không có quầng màn hình; màn hình chờ vẫn bật; đèn đường còn", () => {
    const present = computeLayout([room("claude", "working", 1, [agent]), room("codex", "idle", 1, [])]);
    resetActors();
    const lights = sceneLightSources(present, syncActors(present, 0), outdoorLayout(present));
    expect(lights.some((light) => light.radius === 22)).toBe(true);
    expect(lights.some((light) => light.radius === 34)).toBe(true);

    for (const state of ["offline", "limited"] as const) {
      resetActors();
      const layout = computeLayout([room("claude", state, 1, state === "offline" ? [] : [agent])]);
      const next = sceneLightSources(layout, syncActors(layout, 0), outdoorLayout(layout));
      expect(next.some((light) => light.radius === 22)).toBe(false);
      expect(next.some((light) => light.radius === 34)).toBe(true);
    }
  });
});

describe("ghép cảnh", () => {
  const workers = [room("claude", "working", 1, [agent]), room("codex", "idle", 1, [])];
  const roadY = () => computeLayout(workers).road.y;
  const carFills = () => mainFills.filter((fill) => (
    (fill.color === GROUND.car || fill.color === GROUND.carAlt) && fill.y >= roadY()
  ));

  it("cache nền một lần, xe chạy hoặc đỗ, lightmap multiply, phòng offline tối ngoài cache", () => {
    const now = Date.parse("2026-10-21T12:00:00");
    drawScene(main as unknown as CanvasRenderingContext2D, workers, 200, now, { minutes: 12 * 60 });
    expect(sceneCacheStats()).toEqual({ backdrop: 1, lightmap: 1 });
    expect(mainImages).toContain("multiply");
    expect(carFills().length).toBeGreaterThan(0);
    const backdrop = made.find((canvas) => canvas.fills.some((fill) => fill.color === GROUND.grass));
    expect(backdrop?.fills.some((fill) => fill.color === GROUND.car || fill.color === GROUND.carAlt)).toBe(false);
    expect(backdrop?.fills.some((fill) => fill.color === C.wall)).toBe(true);
    expect(mainFills.some((fill) => fill.color === GROUND.grass)).toBe(false);

    drawScene(main as unknown as CanvasRenderingContext2D, [
      room("claude", "working", 1, [agent], { tokens_today: 40, last_error: "x" }),
      room("codex", "idle", 1, [], { tokens_today: 9 }),
    ], 900, now, { minutes: 12 * 60 + 4 });
    expect(sceneCacheStats()).toEqual({ backdrop: 1, lightmap: 1 });

    drawScene(main as unknown as CanvasRenderingContext2D, workers, 900, now, { minutes: 12 * 60 + 5 });
    expect(sceneCacheStats().lightmap).toBe(2);
    expect(sceneCacheStats().backdrop).toBe(1);

    const beforeDark = mainFills.length;
    drawScene(main as unknown as CanvasRenderingContext2D, [room("claude", "offline", 1, []), room("codex", "idle", 1, [])], 200, now, { minutes: 21 * 60 + 30 });
    expect(mainFills.slice(beforeDark).some((fill) => fill.color === C.dark)).toBe(true);
    expect(sceneCacheStats().backdrop).toBe(1);
    const afterDark = mainFills.length;
    drawScene(main as unknown as CanvasRenderingContext2D, [room("claude", "idle", 1, []), room("codex", "idle", 1, [])], 200, now, { minutes: 0 });
    expect(mainFills.slice(afterDark).some((fill) => fill.color === C.dark)).toBe(false);
    expect(sceneCacheStats().backdrop).toBe(1);

    drawScene(main as unknown as CanvasRenderingContext2D, [room("claude", "idle", 4, []), room("codex", "idle", 1, [])], 200, now, { minutes: 0 });
    expect(sceneCacheStats().backdrop).toBe(2);

    mainFills.length = 0;
    drawScene(main as unknown as CanvasRenderingContext2D, workers, 100, now, { reducedMotion: true, minutes: 720 });
    const parked = carFills().map((fill) => fill.x);
    expect(parked.length).toBeGreaterThan(0);
    mainFills.length = 0;
    drawScene(main as unknown as CanvasRenderingContext2D, workers, 50_000, now, { reducedMotion: true, minutes: 720 });
    expect(carFills().map((fill) => fill.x)).toEqual(parked);

    mainFills.length = 0;
    drawScene(main as unknown as CanvasRenderingContext2D, workers, 100, now, { reducedMotion: false, minutes: 720 });
    const moving = carFills().map((fill) => fill.x);
    mainFills.length = 0;
    drawScene(main as unknown as CanvasRenderingContext2D, workers, 900, now, { reducedMotion: false, minutes: 720 });
    expect(carFills().map((fill) => fill.x)).not.toEqual(moving);

    mainFills.length = 0;
    drawScene(main as unknown as CanvasRenderingContext2D, workers, CAR_DRIVE_MS, now, { reducedMotion: false, minutes: 720 });
    expect(carFills()).toEqual([]);
  });
});
