// Văn phòng pixel nhìn từ trên xuống góc 3/4: mỗi provider một phòng làm việc có `slots` bàn,
// phía dưới là phòng nghỉ chung nối bằng ô cửa. Agent con ngồi bàn trong phòng provider của nó.

import type { WorkerStatus } from "../api";
import { type Crew, actorPose, syncActors } from "./actors";
import { drawSeatedBack, drawSleeper, drawSofaSitter, drawWalker, drawZ, residentLook } from "./characters";
import {
  type Screen,
  countdownLabel,
  drawClock,
  drawCountdown,
  drawDesk,
  drawErrorMark,
  drawLamp,
  drawLoungeFurniture,
  drawNameplate,
  drawPottedPlant,
  drawShelf,
  drawStool,
  drawVine,
  roomLabel,
} from "./furniture";
import { type Layout, type RoomBox, computeLayout } from "./layout";
import { LAMP, paletteOf } from "./palette";
import { type Ctx, hashPhase } from "./pixel";
import { drawBackdrop, drawDarkness, drawDoors, drawLoungeShell, drawRoomShell, drawStorage } from "./tiles";

export { resetActors } from "./actors";
export { sceneSize } from "./layout";
export { ROLE_STYLES, roleStyle } from "./palette";

function drawRoomFurniture(ctx: Ctx, room: RoomBox, crew: Crew["rooms"][number], t: number, now: number): void {
  const { worker } = room;
  drawShelf(ctx, room.shelf.x, room.shelf.y);
  drawClock(ctx, room.clock.x, room.clock.y, now);
  if (worker.state === "limited") drawCountdown(ctx, room.clock.x - 3, room.clock.y + 2, countdownLabel(worker.limit?.resets_at, now), t);
  drawVine(ctx, room.x, room.y + 1, t);
  drawPottedPlant(ctx, room.x + 3, room.floorY + 44, t);
  const off = worker.state === "limited" || worker.state === "offline";
  room.desks.forEach((desk, k) => {
    const actor = crew.seats[k];
    const seated = actor?.phase === "seated" ? actor : null;
    const screen: Screen = off ? "off" : seated ? "code" : "cursor";
    drawDesk(ctx, desk, screen, seated?.agent.mode ?? "", t);
    drawStool(ctx, desk);
    if (seated) drawSeatedBack(ctx, seated.look, desk.seat.x, desk.y + 29, t, hashPhase(seated.agent.id));
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

function drawSigns(ctx: Ctx, room: RoomBox, overflow: number, t: number): void {
  const { worker } = room;
  const offline = worker.state === "offline";
  const label = roomLabel(worker.name, overflow);
  if (!label) return;
  const plate = drawNameplate(ctx, room.x + room.w / 2, room.plateY, label, paletteOf(worker).shirtDark, offline);
  const pulse = worker.state === "working" ? Math.floor(t / 300) % 2 : 0;
  drawLamp(ctx, plate.x - 5, room.plateY + 3 - pulse, LAMP[worker.state]);
  if (worker.last_error && worker.state !== "limited" && !offline) drawErrorMark(ctx, plate.x + plate.w + 2, room.plateY - (Math.floor(t / 300) % 2));
}

// t: thời gian animation (requestAnimationFrame), now: giờ thực (đồng hồ, đếm ngược).
export function drawScene(ctx: Ctx, workers: WorkerStatus[], t: number, now: number): void {
  ctx.imageSmoothingEnabled = false;
  const layout = computeLayout(workers);
  const crew = syncActors(layout, t);

  drawBackdrop(ctx, layout);
  if (layout.storage) drawStorage(ctx, layout.storage);
  layout.rooms.forEach((room) => drawRoomShell(ctx, room, paletteOf(room.worker).shirt));
  drawLoungeShell(ctx, layout.lounge);
  drawDoors(ctx, layout);

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
    .forEach(({ a, pose }) => drawWalker(ctx, a.look, pose.x, pose.y, pose.dir, pose.frame, pose.alpha));

  layout.rooms.forEach((room) => room.worker.state === "offline" && drawDarkness(ctx, room));
  layout.rooms.forEach((room, i) => drawSigns(ctx, room, crew.rooms[i].overflow, t));
}
