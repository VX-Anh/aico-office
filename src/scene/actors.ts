// Tầng trạng thái giữa dữ liệu và hình vẽ: so agents[] của từng phòng với các nhân vật đang có,
// agent mới đi từ phòng nghỉ tới bàn, agent xong đi về phòng nghỉ rồi mờ dần.

import type { WorkerAgent } from "../api";
import { type Look, agentLook } from "./characters";
import { type Layout, assignSeats, resetSeats } from "./layout";
import { alongRoute, pathBetween, pathLength, positionAt, reverseFrom } from "./pathing";
import type { Pt } from "./pixel";

const SPEED = 48; // px/giây
const FADE_MS = 400;

export interface Actor {
  key: string;
  room: string;
  agent: WorkerAgent;
  seat: number;
  look: Look;
  phase: "seated" | "in" | "out";
  path: Pt[];
  startT: number;
}

export interface RoomCrew {
  seats: (Actor | null)[]; // actor đã ngồi hoặc đang đi tới từng ghế
  overflow: number;
}

export interface Crew {
  rooms: RoomCrew[]; // cùng thứ tự với layout.rooms
  walkers: Actor[];
}

const active = new Map<string, Actor>(); // key: phòng|id agent
let leaving: Actor[] = [];
const seenRooms = new Set<string>();

// Đổi nguồn dữ liệu (demo ↔ thật): lần vẽ sau đặt thẳng agent vào ghế, không đi bộ.
export function resetActors(): void {
  active.clear();
  leaving = [];
  seenRooms.clear();
  resetSeats();
}

// Đổi hướng giữa đường: đi tiếp trên tuyến phòng nghỉ ↔ ghế từ vị trí hiện tại.
function turn(a: Actor, layout: Layout, room: number, t: number, toSeat: boolean): Pt[] {
  const p = positionAt(a.path, a.startT, t, SPEED);
  if (!layout.rooms[room]?.desks[a.seat]) return reverseFrom(a.path, a.startT, t, SPEED);
  return alongRoute(pathBetween(layout, "lounge", { room, seat: a.seat }), p, toSeat);
}

function sendOut(a: Actor, layout: Layout, t: number): void {
  const room = layout.rooms.findIndex((r) => r.worker.name === a.room);
  if (room < 0) return;
  if (a.phase === "in") a.path = turn(a, layout, room, t, false);
  else if (layout.rooms[room].desks[a.seat]) a.path = pathBetween(layout, { room, seat: a.seat }, "lounge");
  else return; // ghế không còn (slots giảm): biến mất luôn
  a.phase = "out";
  a.startT = t;
  leaving.push(a);
}

export function syncActors(layout: Layout, t: number): Crew {
  const present = new Set<string>();
  const rooms = layout.rooms.map((room): RoomCrew => {
    const name = room.worker.name;
    const state = room.worker.state;
    const { seats, overflow } = assignSeats(name, room.agents, room.slots);
    const crew: RoomCrew = { seats: seats.map(() => null), overflow };
    if (state === "offline") {
      // tắt đèn: không ai đi bộ, lần online sau đặt thẳng vào ghế
      leaving = leaving.filter((a) => a.room !== name);
      seenRooms.delete(name);
      return crew;
    }
    const first = !seenRooms.has(name);
    seenRooms.add(name);
    if (state === "limited") return crew; // hết hạn mức: không ai ngồi bàn
    seats.forEach((agent, k) => {
      if (!agent) return;
      const key = `${name}|${agent.id}`;
      present.add(key);
      let a = active.get(key);
      if (a && a.seat !== k) {
        active.delete(key);
        sendOut(a, layout, t);
        a = undefined;
      }
      if (!a) {
        const back = leaving.find((l) => l.key === key && l.seat === k);
        if (back) {
          // quay lại khi đang đi ra: đổi hướng về ghế
          leaving = leaving.filter((l) => l !== back);
          back.path = turn(back, layout, room.index, t, true);
          back.phase = "in";
          back.startT = t;
          a = back;
        } else {
          a = {
            key,
            room: name,
            agent,
            seat: k,
            look: agentLook(agent),
            phase: first ? "seated" : "in",
            path: first ? [] : pathBetween(layout, "lounge", { room: room.index, seat: k }),
            startT: t,
          };
        }
        active.set(key, a);
      }
      a.agent = agent;
      if (a.phase === "in" && positionAt(a.path, a.startT, t, SPEED).done) a.phase = "seated";
      crew.seats[k] = a;
    });
    return crew;
  });

  for (const [key, a] of active) {
    if (present.has(key)) continue;
    active.delete(key);
    const room = layout.rooms.find((r) => r.worker.name === a.room);
    if (room && room.worker.state !== "offline") sendOut(a, layout, t);
  }
  leaving = leaving.filter((a) => t - (a.startT + (pathLength(a.path) / SPEED) * 1000) < FADE_MS);

  const walkers = [...[...active.values()].filter((a) => a.phase === "in"), ...leaving];
  return { rooms, walkers };
}

export function actorPose(a: Actor, t: number): { x: number; y: number; dir: "down" | "up" | "left" | "right"; frame: number; alpha: number } {
  const p = positionAt(a.path, a.startT, t, SPEED);
  const end = a.startT + (pathLength(a.path) / SPEED) * 1000;
  const alpha = a.phase === "out" && p.done ? Math.max(0, 1 - (t - end) / FADE_MS) : 1;
  return { x: p.x, y: p.y, dir: p.done && a.phase === "out" ? "down" : p.dir, frame: p.done ? 0 : Math.floor(p.dist / 5) % 4, alpha };
}
