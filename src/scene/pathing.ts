// Đường đi (hàm thuần): chỉ gồm đoạn ngang và dọc, từ ghế xuống lối đi, ngang tới cửa, dọc qua cửa, ngang tới chỗ trong phòng nghỉ.

import type { Layout } from "./layout";
import type { Pt } from "./pixel";

export type Dir = "down" | "up" | "left" | "right";
export type Place = "lounge" | { room: number; seat: number };

export interface Pose {
  x: number;
  y: number;
  dir: Dir;
  done: boolean;
  dist: number; // quãng đã đi, dùng chọn frame bước chân
}

function compact(points: Pt[]): Pt[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
}

function seatRoute(layout: Layout, room: number, seat: number): Pt[] {
  const r = layout.rooms[room];
  const s = r.desks[seat].seat;
  const { walkY, exitSpot } = layout.lounge;
  return compact([
    { x: s.x, y: s.y },
    { x: s.x, y: r.aisleY },
    { x: r.door.cx, y: r.aisleY },
    { x: r.door.cx, y: walkY },
    { x: exitSpot.x, y: exitSpot.y },
  ]);
}

export function pathBetween(layout: Layout, from: Place, to: Place): Pt[] {
  const toLounge = (p: Place) => (p === "lounge" ? [{ ...layout.lounge.exitSpot }] : seatRoute(layout, p.room, p.seat));
  return compact([...toLounge(from), ...toLounge(to).reverse()]);
}

function segDir(a: Pt, b: Pt): Dir {
  if (b.x > a.x) return "right";
  if (b.x < a.x) return "left";
  return b.y < a.y ? "up" : "down";
}

export function pathLength(path: Pt[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
  return len;
}

// Vị trí theo thời gian thực (không cộng dồn theo frame): tab ẩn lâu rồi mở lại thì nhân vật đã tới đích.
export function positionAt(path: Pt[], startT: number, t: number, speed: number): Pose & { segment: number } {
  const dist = Math.max(0, ((t - startT) / 1000) * speed);
  let left = dist;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (left < len) {
      const k = left / len;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dir: segDir(a, b), done: false, dist, segment: i };
    }
    left -= len;
  }
  const last = path[path.length - 1] ?? { x: 0, y: 0 };
  const dir = path.length > 1 ? segDir(path[path.length - 2], last) : "down";
  return { x: last.x, y: last.y, dir, done: true, dist, segment: path.length };
}

// Đổi hướng giữa đường trên một tuyến cố định (ví dụ phòng nghỉ → ghế): chiếu vị trí hiện tại lên tuyến,
// rồi đi tiếp về cuối tuyến (toEnd) hoặc về đầu tuyến. Đổi hướng bao nhiêu lần cũng vẫn tới đúng đích.
export function alongRoute(route: Pt[], pos: Pt, toEnd: boolean): Pt[] {
  if (route.length < 2) return compact([{ x: pos.x, y: pos.y }, ...route]);
  let best = { seg: 1, p: route[0], d: Infinity };
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const p = {
      x: Math.min(Math.max(pos.x, Math.min(a.x, b.x)), Math.max(a.x, b.x)),
      y: Math.min(Math.max(pos.y, Math.min(a.y, b.y)), Math.max(a.y, b.y)),
    };
    const d = Math.abs(p.x - pos.x) + Math.abs(p.y - pos.y);
    if (d < best.d) best = { seg: i, p, d };
  }
  const rest = toEnd ? route.slice(best.seg) : route.slice(0, best.seg).reverse();
  return compact([{ x: pos.x, y: pos.y }, best.p, ...rest]);
}

// Quay đầu giữa đường: đi ngược từ vị trí hiện tại về điểm xuất phát.
export function reverseFrom(path: Pt[], startT: number, t: number, speed: number): Pt[] {
  const pos = positionAt(path, startT, t, speed);
  return compact([{ x: pos.x, y: pos.y }, ...path.slice(0, Math.min(pos.segment, path.length)).reverse()]);
}
