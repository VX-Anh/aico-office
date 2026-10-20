// Bố cục cảnh (hàm thuần, không vẽ): các phòng provider xếp một hàng ở trên, phòng nghỉ chung trải ngang ở dưới.
// Toạ độ tính theo pixel gốc; CSS phóng to với image-rendering: pixelated.

import { type WorkerAgent, type WorkerStatus, roomAgents } from "../api";
import type { Pt, Rect } from "./pixel";

export const WALL = 5; // độ dày viền ngoài và vách ngăn
export const ROOM_WALL_H = 28; // mặt trước tường trên của phòng
const ROOM_FLOOR_H = 60;
const ROOM_H = ROOM_WALL_H + ROOM_FLOOR_H;
const DESK_W = 40; // mỗi bàn chiếm 40px ngang
const ROOM_PAD = 8;
const ROOM_MIN_W = 92; // đủ treo biển tên 12 ký tự + "+N", đèn và dấu "!"
const DOOR_W = 14;
export const LOUNGE_WALL_H = 20;
const LOUNGE_FLOOR_H = 58;
const LOUNGE_H = LOUNGE_WALL_H + LOUNGE_FLOOR_H;
const LOUNGE_MIN_W = 224; // đủ cây cảnh, một bộ sofa và bếp
const KITCHEN_W = 56;
const PLANT_W = 26;
const SET_W = 62; // một bộ sofa: sofa trái, bàn trà, sofa phải

export interface Desk extends Rect {
  seat: Pt; // chỗ đứng trước ghế (chân nhân vật)
}

export interface Door {
  x: number;
  w: number;
  cx: number;
}

export interface RoomBox extends Rect {
  index: number;
  worker: WorkerStatus;
  agents: WorkerAgent[];
  slots: number;
  floorY: number;
  aisleY: number; // hàng lối đi phía dưới các bàn
  door: Door; // ô cửa xuống phòng nghỉ
  sideDoor: Rect | null; // ô cửa trên vách sang phòng bên phải
  desks: Desk[];
  shelf: Pt;
  clock: Pt;
  plateY: number;
}

export interface Sofa extends Rect {
  facing: "left" | "right";
}

export interface SofaSet {
  rug: Rect;
  table: Rect;
  sofas: [Sofa, Sofa];
}

export interface LoungeBox extends Rect {
  floorY: number;
  walkY: number; // hàng lối đi ngay dưới tường
  kitchen: Rect;
  counter: Rect;
  plant: Pt;
  paintings: Rect[];
  sets: SofaSet[];
  spots: Sofa[]; // mỗi sofa một người, theo thứ tự phòng
  standSpots: Pt[]; // người dư đứng cạnh quầy
  exitSpot: Pt; // chỗ agent con xuất hiện/mờ dần
}

export interface Layout {
  width: number;
  height: number;
  rooms: RoomBox[];
  lounge: LoungeBox;
  storage: Rect | null; // phần dư bên phải hàng phòng: khối tường kín
}

function roomBox(worker: WorkerStatus, index: number, x: number): RoomBox {
  const { agents, slots } = roomAgents(worker);
  // phòng 0 chỗ vẫn rộng bằng 1 chỗ; không hẹp hơn mức đủ treo biển tên
  const w = Math.max(ROOM_MIN_W, Math.max(1, slots) * DESK_W + ROOM_PAD * 2);
  const y = WALL;
  const floorY = y + ROOM_WALL_H;
  const deskX = x + Math.floor((w - slots * DESK_W) / 2);
  const desks = Array.from({ length: slots }, (_, k) => {
    const dx = deskX + k * DESK_W + 4;
    const dy = floorY + 6;
    return { x: dx, y: dy, w: 32, h: 18, seat: { x: dx + 16, y: dy + 31 } };
  });
  const cx = x + Math.floor(w / 2);
  return {
    index,
    worker,
    agents,
    slots,
    x,
    y,
    w,
    h: ROOM_H,
    floorY,
    aisleY: floorY + 50,
    door: { x: cx - DOOR_W / 2, w: DOOR_W, cx },
    sideDoor: null,
    desks,
    shelf: { x: x + 8, y: y + 13 },
    clock: { x: x + w - 16, y: y + 14 },
    plateY: y + 2,
  };
}

function loungeBox(x: number, y: number, w: number, rooms: RoomBox[]): LoungeBox {
  const floorY = y + LOUNGE_WALL_H;
  const walkY = floorY + 7;
  const kitchen = { x: x + w - KITCHEN_W, y: floorY, w: KITCHEN_W, h: LOUNGE_FLOOR_H };
  const counter = { x: x + w - 15, y: floorY, w: 15, h: 40 };
  const regionX = x + PLANT_W;
  const regionW = kitchen.x - 4 - regionX;
  const nSets = Math.max(0, Math.floor(regionW / SET_W));
  const startX = regionX + Math.floor((regionW - nSets * SET_W) / 2);
  const sets: SofaSet[] = Array.from({ length: nSets }, (_, i) => {
    const sx = startX + i * SET_W;
    return {
      rug: { x: sx + 6, y: floorY + 15, w: 50, h: 36 },
      table: { x: sx + 21, y: floorY + 26, w: 20, h: 13 },
      sofas: [
        { x: sx + 2, y: floorY + 18, w: 12, h: 28, facing: "right" },
        { x: sx + 48, y: floorY + 18, w: 12, h: 28, facing: "left" },
      ],
    };
  });
  const spots = sets.flatMap((s) => s.sofas);
  const standX = counter.x - 8;
  const standSpots = Array.from({ length: Math.max(0, rooms.length - spots.length) }, (_, k) => ({
    x: standX,
    y: Math.min(floorY + 24 + k * 10, y + LOUNGE_H - 3),
  }));
  // tranh treo trên tường phía trên mỗi bộ sofa, tránh ô cửa
  const paintings = sets
    .map((s) => ({ x: s.table.x - 1, y: y + 4, w: 22, h: 12 }))
    .filter((p) => rooms.every((r) => p.x + p.w + 3 < r.door.x || p.x > r.door.x + r.door.w + 3));
  return {
    x,
    y,
    w,
    h: LOUNGE_H,
    floorY,
    walkY,
    kitchen,
    counter,
    plant: { x: x + 5, y: floorY + 34 },
    paintings,
    sets,
    spots,
    standSpots,
    exitSpot: { x: standX, y: walkY },
  };
}

export function computeLayout(workers: WorkerStatus[]): Layout {
  const rooms: RoomBox[] = [];
  let x = WALL;
  workers.forEach((worker, index) => {
    const room = roomBox(worker, index, x);
    rooms.push(room);
    x += room.w + WALL;
  });
  rooms.forEach((room, i) => {
    if (i < rooms.length - 1) room.sideDoor = { x: room.x + room.w, y: room.aisleY - 13, w: WALL, h: 15 };
  });
  const rowRight = x;
  const width = Math.max(rowRight, LOUNGE_MIN_W + WALL * 2);
  const loungeY = WALL + ROOM_H + WALL;
  const lounge = loungeBox(WALL, loungeY, width - WALL * 2, rooms);
  const storageW = width - WALL - rowRight;
  const storage = storageW > 0 ? { x: rowRight, y: WALL, w: storageW, h: ROOM_H } : null;
  return { width, height: loungeY + LOUNGE_H + WALL, rooms, lounge, storage };
}

export function sceneSize(workers: WorkerStatus[]): { width: number; height: number } {
  const { width, height } = computeLayout(workers);
  return { width, height };
}

// Giữ chỗ ổn định theo id agent: agent xong thì nhả chỗ, các agent khác không bị nhảy chỗ.
const seatMaps = new Map<string, Map<string, number>>();

export function resetSeats(): void {
  seatMaps.clear();
}

export function assignSeats(room: string, agents: WorkerAgent[], slots: number): { seats: (WorkerAgent | null)[]; overflow: number } {
  let seatOf = seatMaps.get(room);
  if (!seatOf) seatMaps.set(room, (seatOf = new Map()));
  const ids = new Set(agents.map((a) => a.id));
  for (const [id, idx] of seatOf) if (!ids.has(id) || idx >= slots) seatOf.delete(id);
  const seats: (WorkerAgent | null)[] = Array.from({ length: slots }, () => null);
  const waiting: WorkerAgent[] = [];
  for (const a of agents) {
    const idx = seatOf.get(a.id);
    if (idx !== undefined && !seats[idx]) seats[idx] = a;
    else waiting.push(a);
  }
  let overflow = 0;
  for (const a of waiting) {
    const idx = seats.indexOf(null);
    if (idx < 0) {
      overflow++;
      continue;
    }
    seats[idx] = a;
    seatOf.set(a.id, idx);
  }
  return { seats, overflow };
}
