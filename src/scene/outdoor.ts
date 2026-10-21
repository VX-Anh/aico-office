// Ngoại cảnh thuần: cỏ, cây, bụi, lối lát, đèn, đường và xe.
// Hợp đồng OutdoorLayout cho W2 (đèn → nguồn sáng) và W5 (biển nằm ở RoomSign, không đè footprint này).
// drawBackdrop gọi drawOutdoorStatic. W6 cache lần gọi đó; drawOutdoorCar chạy mỗi frame cùng phần động.
// Cùng hệ toạ độ với Layout: gốc (0,0) là góc cảnh, không dịch canvas riêng.

import type { Layout } from "./layout";
import { GROUND } from "./palette";
import { type Ctx, type Pt, type Rect, outlineRect, rect } from "./pixel";

export const DEFAULT_OUTDOOR_SEED = 0xa1c0;
export const CAR_CYCLE_MS = 14_000;
export const CAR_DRIVE_MS = 4_000;

const TREE = { w: 16, h: 18 };
const BUSH = { w: 10, h: 8 };
const LAMP = { w: 5, h: 16 };
const CAR = { w: 22, h: 10 };
const PAD = 3;

export interface OutdoorProp extends Rect {
  variant: number;
}

export interface OutdoorLamp extends OutdoorProp {
  /** Tâm bóng đèn, nằm trong footprint. W2 dùng làm nguồn sáng. */
  light: Pt;
}

export interface OutdoorLayout {
  seed: number;
  width: number;
  height: number;
  building: Rect;
  path: Rect;
  road: Rect;
  trees: OutdoorProp[];
  bushes: OutdoorProp[];
  lamps: OutdoorLamp[];
}

export interface CarPose extends Rect {
  visible: boolean;
  dir: "left" | "right";
  variant: number;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return DEFAULT_OUTDOOR_SEED;
  return seed >>> 0;
}

function mix(seed: number, salt: number): number {
  return (normalizeSeed(seed) ^ salt) >>> 0;
}

// mulberry32: cùng seed thì cùng chuỗi, không dùng Math.random nên không nhảy giữa các frame.
function rng(seed: number): () => number {
  let a = normalizeSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function copyRect(r: Rect): Rect {
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

function insideScene(layout: Layout, box: Rect): boolean {
  return box.x >= 0 && box.y >= 0 && box.x + box.w <= layout.width && box.y + box.h <= layout.height;
}

function onGrass(layout: Layout, box: Rect): boolean {
  return insideScene(layout, box)
    && !rectsOverlap(box, layout.building)
    && !rectsOverlap(box, layout.path)
    && !rectsOverlap(box, layout.road);
}

function cells(region: Rect, w: number, h: number, stepX: number, stepY: number): Rect[] {
  const out: Rect[] = [];
  if (region.w < w || region.h < h) return out;
  for (let y = region.y; y + h <= region.y + region.h; y += stepY) {
    for (let x = region.x; x + w <= region.x + region.w; x += stepX) out.push({ x, y, w, h });
  }
  return out;
}

function sideYards(layout: Layout): Rect[] {
  const b = layout.building;
  const regions: Rect[] = [];
  if (b.x > PAD) regions.push({ x: PAD, y: b.y, w: b.x - PAD, h: b.h });
  const right = b.x + b.w;
  if (right + PAD < layout.width) regions.push({ x: right, y: b.y, w: layout.width - right - PAD, h: b.h });
  return regions;
}

function placeLamps(layout: Layout, seed: number): OutdoorLamp[] {
  const y = layout.building.y + layout.building.h;
  const h = layout.path.y - y;
  if (h < 8 || layout.width < LAMP.w + PAD * 2) return [];
  const lampH = Math.min(LAMP.h, h);
  const rand = rng(mix(seed, 0x1a47));
  const margin = PAD;
  const usable = layout.width - margin * 2 - LAMP.w;
  const count = Math.max(2, Math.min(12, Math.floor(layout.width / 52)));
  const step = Math.floor(usable / (count - 1));
  // Trượt cả hàng theo seed, đủ nhỏ để không bị kẹp mép làm trùng vị trí.
  const shift = (normalizeSeed(seed) % 7) - 3;
  const lamps: OutdoorLamp[] = [];
  for (let i = 0; i < count; i++) {
    let x = margin + i * step + shift;
    const maxX = layout.width - margin - LAMP.w;
    if (x < margin) x = margin;
    if (x > maxX) x = maxX;
    const prev = lamps[lamps.length - 1];
    if (prev && x < prev.x + prev.w + 2) x = prev.x + prev.w + 2;
    if (x + LAMP.w > layout.width - margin) break;
    const box = { x, y, w: LAMP.w, h: lampH };
    if (!onGrass(layout, box)) continue;
    lamps.push({ ...box, variant: Math.floor(rand() * 2), light: { x: x + 2, y: y + 2 } });
  }
  return lamps;
}

function placeTrees(layout: Layout, seed: number): OutdoorProp[] {
  const b = layout.building;
  const top: Rect[] = [];
  const topW = layout.width - PAD * 2;
  if (b.y >= PAD + TREE.h && topW >= TREE.w) {
    // Một hàng sát mép trên, không lấp dải biển phía trên mái.
    for (let x = PAD; x + TREE.w <= PAD + topW; x += TREE.w + 4) top.push({ x, y: PAD, w: TREE.w, h: TREE.h });
  }
  const side = sideYards(layout).flatMap((region) => cells(region, TREE.w, TREE.h, TREE.w + 4, TREE.h + 6));
  const rand = rng(mix(seed, 0x71ee));
  const picked = shuffle(side.filter((box) => onGrass(layout, box)), rand);
  const perSide = 4;
  const sideKept = picked.filter((box) => top.every((tree) => !rectsOverlap(box, tree))).slice(0, perSide * 2);
  const trees = [...top.filter((box) => onGrass(layout, box)), ...sideKept];
  return trees
    .map((box) => ({ ...box, variant: Math.floor(rand() * 3) }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function placeBushes(layout: Layout, seed: number, blocked: Rect[]): OutdoorProp[] {
  const free = (box: Rect) => onGrass(layout, box) && blocked.every((other) => !rectsOverlap(box, other));
  const groundY = layout.road.y + layout.road.h;
  const groundH = layout.height - groundY;
  const hedge = groundH >= BUSH.h
    ? cells({ x: PAD, y: groundY, w: layout.width - PAD * 2, h: groundH }, BUSH.w, BUSH.h, BUSH.w + 2, BUSH.h + 4).filter(free)
    : [];
  const rand = rng(mix(seed, 0xb511));
  const side = shuffle(sideYards(layout).flatMap((region) => cells(region, BUSH.w, BUSH.h, BUSH.w + 2, BUSH.h + 4)).filter(free), rand)
    .slice(0, 6);
  return [...hedge, ...side]
    .map((box) => ({ ...box, variant: Math.floor(rand() * 2) }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function outdoorLayout(layout: Layout, seed = DEFAULT_OUTDOOR_SEED): OutdoorLayout {
  const stable = normalizeSeed(seed);
  const trees = placeTrees(layout, stable);
  const lamps = placeLamps(layout, stable);
  const bushes = placeBushes(layout, stable, [...trees, ...lamps]);
  return {
    seed: stable,
    width: layout.width,
    height: layout.height,
    building: copyRect(layout.building),
    path: copyRect(layout.path),
    road: copyRect(layout.road),
    trees,
    bushes,
    lamps,
  };
}

export function carPose(outdoor: OutdoorLayout, t: number, reducedMotion: boolean): CarPose {
  const road = outdoor.road;
  const y = road.y + Math.floor((road.h - CAR.h) / 2);
  const base = { y, w: CAR.w, h: CAR.h };
  if (reducedMotion) {
    // Đỗ sát lề, không đọc t: tắt chuyển động chứ không xoá xe.
    return { ...base, x: road.x + 6, visible: true, dir: "right", variant: 0 };
  }
  const time = Number.isFinite(t) ? Math.max(0, t) : 0;
  const cycle = Math.floor(time / CAR_CYCLE_MS);
  const phase = time % CAR_CYCLE_MS;
  const dir: CarPose["dir"] = cycle % 2 === 0 ? "right" : "left";
  if (phase >= CAR_DRIVE_MS) {
    return { ...base, x: road.x - CAR.w, visible: false, dir, variant: cycle % 2 };
  }
  const travel = road.w + CAR.w;
  const k = phase / CAR_DRIVE_MS;
  const x = Math.round(dir === "right" ? road.x - CAR.w + k * travel : road.x + road.w - k * travel);
  return { ...base, x, visible: true, dir, variant: cycle % 2 };
}

function drawTree(ctx: Ctx, tree: OutdoorProp): void {
  const { x, y, w, h, variant } = tree;
  const trunkW = 4;
  const trunkH = 5;
  rect(ctx, x + Math.floor((w - trunkW) / 2), y + h - trunkH, trunkW, trunkH, GROUND.trunk);
  if (variant % 3 === 1) {
    rect(ctx, x + 2, y + 8, w - 4, 5, GROUND.canopy);
    rect(ctx, x + 4, y + 4, w - 8, 5, GROUND.canopyLight);
    rect(ctx, x + 6, y, w - 12, 5, GROUND.canopy);
  } else if (variant % 3 === 2) {
    rect(ctx, x, y + 4, w, h - trunkH - 2, GROUND.canopy);
    rect(ctx, x + 2, y + 1, w - 4, 4, GROUND.canopyLight);
  } else {
    rect(ctx, x + 1, y + 3, w - 2, h - trunkH - 1, GROUND.canopy);
    rect(ctx, x + 3, y + 1, w - 6, 4, GROUND.canopyLight);
  }
}

function drawBush(ctx: Ctx, bush: OutdoorProp): void {
  const { x, y, w, h, variant } = bush;
  rect(ctx, x, y + 2, w - 2, h - 2, GROUND.bush);
  rect(ctx, x + 2, y, w - 3, h - 3, variant % 2 ? GROUND.bushLight : GROUND.bush);
}

function drawLamp(ctx: Ctx, lamp: OutdoorLamp): void {
  const { x, y, w, h, variant } = lamp;
  rect(ctx, x + 2, y + 4, 1, h - 4, GROUND.pole);
  outlineRect(ctx, x, y, w, 5, variant ? GROUND.lampShade : GROUND.lamp);
  rect(ctx, x + 1, y + 1, w - 2, 2, GROUND.lamp);
}

function drawPath(ctx: Ctx, path: Rect): void {
  rect(ctx, path.x, path.y, path.w, path.h, GROUND.pathMortar);
  const bw = 8;
  const bh = 4;
  for (let row = 0; row * (bh + 1) < path.h; row++) {
    const y = path.y + 1 + row * (bh + 1);
    if (y >= path.y + path.h) break;
    const h = Math.min(bh, path.y + path.h - y);
    const offset = row % 2 ? 4 : 0;
    for (let x = path.x + offset; x < path.x + path.w; x += bw + 1) {
      const w = Math.min(bw, path.x + path.w - x);
      rect(ctx, x, y, w, h, row % 2 ? GROUND.pathAlt : GROUND.path);
    }
  }
}

function drawRoad(ctx: Ctx, road: Rect): void {
  rect(ctx, road.x, road.y, road.w, road.h, GROUND.road);
  rect(ctx, road.x, road.y, road.w, 1, GROUND.roadDark);
  rect(ctx, road.x, road.y + road.h - 1, road.w, 1, GROUND.roadDark);
  rect(ctx, road.x, road.y + 3, road.w, 1, GROUND.laneEdge);
  rect(ctx, road.x, road.y + road.h - 4, road.w, 1, GROUND.laneEdge);
  const mid = road.y + Math.floor(road.h / 2);
  for (let x = road.x + 4; x < road.x + road.w - 4; x += 12) rect(ctx, x, mid, 6, 1, GROUND.lane);
}

function drawTufts(ctx: Ctx, outdoor: OutdoorLayout): void {
  const rand = rng(mix(outdoor.seed, 0x747566));
  const blocked = [outdoor.building, outdoor.path, outdoor.road];
  let placed = 0;
  for (let i = 0; i < 48 && placed < 24; i++) {
    const box = {
      x: Math.floor(rand() * Math.max(1, outdoor.width - 3)),
      y: Math.floor(rand() * Math.max(1, outdoor.height - 3)),
      w: 2,
      h: 2,
    };
    if (box.x + box.w > outdoor.width || box.y + box.h > outdoor.height) continue;
    if (blocked.some((area) => rectsOverlap(box, area))) continue;
    rect(ctx, box.x, box.y, box.w, box.h, i % 2 ? GROUND.tuft : GROUND.grassDark);
    placed++;
  }
}

export function drawOutdoorStatic(ctx: Ctx, outdoor: OutdoorLayout): void {
  rect(ctx, 0, 0, outdoor.width, outdoor.height, GROUND.grass);
  rect(ctx, 0, 0, outdoor.width, 2, GROUND.grassEdge);
  rect(ctx, 0, outdoor.height - 2, outdoor.width, 2, GROUND.grassEdge);
  rect(ctx, 0, 0, 2, outdoor.height, GROUND.grassEdge);
  rect(ctx, outdoor.width - 2, 0, 2, outdoor.height, GROUND.grassEdge);
  drawTufts(ctx, outdoor);
  const b = outdoor.building;
  rect(ctx, b.x, b.y + b.h, b.w, 2, GROUND.grassDark);
  drawPath(ctx, outdoor.path);
  drawRoad(ctx, outdoor.road);
  outdoor.bushes.forEach((bush) => drawBush(ctx, bush));
  outdoor.trees.forEach((tree) => drawTree(ctx, tree));
  outdoor.lamps.forEach((lamp) => drawLamp(ctx, lamp));
}

function drawCar(ctx: Ctx, pose: CarPose): void {
  const x = Math.round(pose.x);
  const y = Math.round(pose.y);
  const body = pose.variant % 2 ? GROUND.carAlt : GROUND.car;
  outlineRect(ctx, x, y + 3, pose.w, pose.h - 4, body);
  const winX = pose.dir === "right" ? x + pose.w - 10 : x + 3;
  rect(ctx, winX, y + 4, 6, 3, GROUND.carWindow);
  rect(ctx, x + 2, y + pose.h - 3, 4, 3, GROUND.carWheel);
  rect(ctx, x + pose.w - 6, y + pose.h - 3, 4, 3, GROUND.carWheel);
}

export function drawOutdoorCar(ctx: Ctx, outdoor: OutdoorLayout, t: number, reducedMotion: boolean): void {
  const pose = carPose(outdoor, t, reducedMotion);
  if (!pose.visible) return;
  drawCar(ctx, pose);
}
