// Văn phòng pixel nhìn từ trên xuống góc 3/4: mỗi provider một phòng làm việc có `slots` bàn,
// phía dưới là phòng nghỉ chung nối bằng ô cửa. Agent con ngồi bàn trong phòng provider của nó.
// Nền tĩnh (cỏ, cây, đường, tường, sàn, cửa) cache theo hình học; mỗi frame chỉ ghép ảnh,
// phần động, lightmap multiply. Biển tên nằm ở overlay.

import { readAgentActivity, screenFor } from "../activity";
import type { WorkerAgent, WorkerStatus } from "../api";
import { parseUsage } from "../usage";
import { type Actor, type Crew, actorPose, syncActors } from "./actors";
import { drawSeatedBack, drawSleeper, drawSofaSitter, drawWalker, drawZ, residentLook } from "./characters";
import {
  type Screen,
  countdownLabel,
  drawClock,
  drawCountdown,
  drawDesk,
  drawLoungeFurniture,
  drawPottedPlant,
  drawShelf,
  drawStool,
  drawVine,
} from "./furniture";
import { type Layout, type RoomBox, computeLayout } from "./layout";
import { type LightSource, type LightingInput, createLightmapCache, lightingInput, lightingKey, lightingMinutes, monitorLight } from "./lighting";
import { DEFAULT_OUTDOOR_SEED, type OutdoorLayout, drawOutdoorCar, outdoorLayout } from "./outdoor";
import { LIGHTING, paletteOf } from "./palette";
import { type Ctx, hashPhase } from "./pixel";
import { drawBackdrop, drawDarkness, drawDoors, drawLoungeShell, drawRoomShell, drawStorage } from "./tiles";
import { drawUsageBoard } from "./usage-board";

export { resetActors } from "./actors";
export { sceneSize } from "./layout";
export { ROLE_STYLES, USAGE, roleStyle } from "./palette";

export interface SceneFigure {
  key: string;
  agent: WorkerAgent;
  room: string;
  working: boolean;
  x: number;
  headY: number;
  footY: number;
  seated: boolean;
}

export interface SceneDrawOptions {
  /** Phút địa phương cho ánh sáng. Vắng thì lấy từ `now`, không đổi đồng hồ. */
  minutes?: number;
  reducedMotion?: boolean;
  seed?: number;
}

function deskPresentation(room: RoomBox, actor: Actor | null): { screen: Screen; mode: string } {
  if (room.worker.state === "limited" || room.worker.state === "offline") return { screen: "off", mode: "" };
  if (!actor || actor.phase !== "seated") return { screen: "cursor", mode: "" };
  const kind = screenFor(readAgentActivity(actor.agent, actor.key).activity?.kind);
  return { screen: kind === "idle" ? "code" : kind, mode: actor.agent.mode ?? "" };
}

// Khớp mặt kính trong drawDesk: mx = giữa bàn lệch 7, kính bắt đầu mx+3.
function monitorCenter(desk: { x: number; y: number; w: number }): { x: number; y: number } {
  const mx = desk.x + Math.floor(desk.w / 2) - 7;
  return { x: mx + 7, y: desk.y - 2 };
}

export function sceneLightSources(layout: Layout, crew: Crew, outdoor: OutdoorLayout): LightSource[] {
  const sources: LightSource[] = outdoor.lamps.map((lamp) => ({
    x: lamp.light.x, y: lamp.light.y, radius: 34, strength: 0.75, color: LIGHTING.lampGlow,
  }));
  layout.rooms.forEach((room, i) => {
    room.desks.forEach((desk, k) => {
      const { screen } = deskPresentation(room, crew.rooms[i]?.seats[k] ?? null);
      const at = monitorCenter(desk);
      const light = monitorLight({ x: at.x, y: at.y, state: room.worker.state, screen });
      if (light) sources.push(light);
    });
  });
  return sources;
}

export function backdropKey(layout: Layout, seed: number): string {
  const rooms = layout.rooms.map((room) => [
    room.x, room.y, room.w, room.h, room.floorY, room.door.x, room.door.w,
    room.sideDoor ? [room.sideDoor.x, room.sideDoor.y, room.sideDoor.w, room.sideDoor.h] : null,
    paletteOf(room.worker).shirt,
  ]);
  const lounge = layout.lounge;
  return JSON.stringify([
    seed, layout.width, layout.height, layout.building, layout.path, layout.road, rooms,
    [lounge.x, lounge.y, lounge.w, lounge.h, lounge.floorY], layout.storage,
  ]);
}

function paintStatic(ctx: Ctx, layout: Layout, outdoor: OutdoorLayout): void {
  drawBackdrop(ctx, layout, outdoor);
  if (layout.storage) drawStorage(ctx, layout.storage);
  for (const room of layout.rooms) drawRoomShell(ctx, room, paletteOf(room.worker).shirt);
  drawLoungeShell(ctx, layout.lounge);
  drawDoors(ctx, layout);
}

let backdropCanvas: HTMLCanvasElement | null = null;
let backdropHeld: string | null = null;
let backdropPaints = 0;
let lightPaints = 0;
let lightHeld: string | null = null;
const lightCache = createLightmapCache();

export function sceneCacheStats(): { backdrop: number; lightmap: number } {
  return { backdrop: backdropPaints, lightmap: lightPaints };
}

export function resetSceneCache(): void {
  backdropCanvas = null;
  backdropHeld = null;
  backdropPaints = 0;
  lightPaints = 0;
  lightHeld = null;
  lightCache.reset();
}

function drawCachedBackdrop(ctx: Ctx, layout: Layout, outdoor: OutdoorLayout, seed: number): void {
  const key = backdropKey(layout, seed);
  if (backdropCanvas && backdropHeld === key) {
    ctx.drawImage(backdropCanvas, 0, 0);
    return;
  }
  const canvas = backdropCanvas ?? document.createElement("canvas");
  canvas.width = Math.max(1, layout.width);
  canvas.height = Math.max(1, layout.height);
  const cached = canvas.getContext("2d");
  if (!cached) {
    paintStatic(ctx, layout, outdoor);
    return;
  }
  cached.imageSmoothingEnabled = false;
  paintStatic(cached, layout, outdoor);
  backdropCanvas = canvas;
  backdropHeld = key;
  backdropPaints += 1;
  ctx.drawImage(canvas, 0, 0);
}

function drawLights(ctx: Ctx, input: LightingInput): void {
  const key = lightingKey(input);
  if (key !== lightHeld) {
    lightHeld = key;
    lightPaints += 1;
  }
  lightCache.draw(ctx, input);
}

function drawRoomFurniture(ctx: Ctx, room: RoomBox, crew: Crew["rooms"][number], t: number, now: number): void {
  const { worker } = room;
  drawShelf(ctx, room.shelf.x, room.shelf.y);
  drawClock(ctx, room.clock.x, room.clock.y, now);
  // phòng mất kết nối thì số liệu không còn đáng tin: không treo bảng
  if (worker.state !== "offline") drawUsageBoard(ctx, room.usageBoard, parseUsage(worker.usage, worker.name), t);
  if (worker.state === "limited") drawCountdown(ctx, room.clock.x - 3, room.clock.y + 2, countdownLabel(worker.limit?.resets_at, now), t);
  drawVine(ctx, room.x, room.y + 1, t);
  drawPottedPlant(ctx, room.x + 3, room.floorY + 44, t);
  room.desks.forEach((desk, k) => {
    const actor = crew.seats[k];
    const { screen, mode } = deskPresentation(room, actor);
    drawDesk(ctx, desk, screen, mode, t);
    drawStool(ctx, desk);
    if (actor?.phase === "seated") drawSeatedBack(ctx, actor.look, desk.seat.x, desk.y + 29, t, hashPhase(actor.agent.id));
  });
}

// Nhân vật thường trực: mỗi phòng một người ở phòng nghỉ (ngồi sofa uống cà phê, hoặc ngủ khi hết hạn mức).
function drawResidents(ctx: Ctx, layout: Layout, t: number): void {
  const { lounge } = layout;
  layout.rooms.forEach((room, i) => {
    if (room.worker.state === "offline") return;
    const look = residentLook(paletteOf(room.worker), i);
    const sleeping = room.worker.state === "limited";
    const phase = hashPhase(room.worker.name);
    const sofa = lounge.spots[i];
    if (sofa) {
      if (sleeping) drawSleeper(ctx, look, sofa, t, phase);
      else drawSofaSitter(ctx, look, sofa, t, phase);
      return;
    }
    // hết sofa: đứng cạnh quầy
    const p = lounge.standSpots[i - lounge.spots.length];
    if (!p) return;
    drawWalker(ctx, look, p.x, p.y, "right", 0);
    if (sleeping) drawZ(ctx, p.x + 4, p.y - 22, t, phase);
  });
}

// t: thời gian animation (requestAnimationFrame), now: giờ thực (đồng hồ, đếm ngược).
export function drawScene(ctx: Ctx, workers: WorkerStatus[], t: number, now: number, options: SceneDrawOptions = {}): SceneFigure[] {
  ctx.imageSmoothingEnabled = false;
  const layout = computeLayout(workers);
  const seed = options.seed ?? DEFAULT_OUTDOOR_SEED;
  const outdoor = outdoorLayout(layout, seed);
  const crew = syncActors(layout, t);

  const figures: SceneFigure[] = [];
  layout.rooms.forEach((room, i) => {
    crew.rooms[i].seats.forEach((actor, k) => {
      if (actor?.phase !== "seated") return;
      const desk = room.desks[k];
      figures.push({
        key: actor.key, agent: actor.agent, room: actor.room,
        working: room.worker.state === "working",
        x: desk.seat.x, headY: desk.y + 12, footY: desk.y + 34, seated: true,
      });
    });
  });

  drawCachedBackdrop(ctx, layout, outdoor, seed);
  layout.rooms.forEach((room, i) => drawRoomFurniture(ctx, room, crew.rooms[i], t, now));
  // bàn trà bốc hơi khi có người ngồi uống
  const drinking = new Set<number>();
  layout.rooms.forEach((room, i) => {
    if (i < layout.lounge.spots.length && (room.worker.state === "idle" || room.worker.state === "working")) drinking.add(Math.floor(i / 2));
  });
  drawLoungeFurniture(ctx, layout.lounge, drinking, t);
  drawResidents(ctx, layout, t);

  // nhân vật đi bộ, sắp theo y chân để người gần hơn che người xa hơn
  crew.walkers
    .map((a) => ({ a, pose: actorPose(a, t) }))
    .sort((p, q) => p.pose.y - q.pose.y)
    .forEach(({ a, pose }) => {
      drawWalker(ctx, a.look, pose.x, pose.y, pose.dir, pose.frame, pose.alpha);
      figures.push({
        key: a.key, agent: a.agent, room: a.room,
        working: a.phase === "in" && layout.rooms.some((room) => room.worker.name === a.room && room.worker.state === "working"),
        x: pose.x, headY: pose.y - 22, footY: pose.y, seated: false,
      });
    });

  layout.rooms.forEach((room) => room.worker.state === "offline" && drawDarkness(ctx, room));
  drawOutdoorCar(ctx, outdoor, t, options.reducedMotion === true);
  const minutes = options.minutes ?? lightingMinutes(now, null);
  drawLights(ctx, lightingInput(layout, minutes, sceneLightSources(layout, crew, outdoor)));
  return figures;
}
