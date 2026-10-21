// Nền: viền ngoài và vách ngăn tối, sàn gỗ dạng ván, sàn xanh và caro của phòng nghỉ, mặt trước tường, ô cửa.

import type { Layout, LoungeBox, RoomBox } from "./layout";
import { drawOutdoorStatic, outdoorLayout } from "./outdoor";
import { C } from "./palette";
import { type Ctx, type Rect, rect } from "./pixel";

const PLANK_H = 6;
const PLANK_LEN = 24;

// Sàn gỗ: các dải ngang 2 tông nâu, đường ghép so le theo hàng.
function plankFloor(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  for (let row = 0; row * PLANK_H < h; row++) {
    const py = y + row * PLANK_H;
    const ph = Math.min(PLANK_H, h - row * PLANK_H);
    rect(ctx, x, py, w, ph, row % 2 ? C.plankAlt : C.plank);
    rect(ctx, x, py + ph - 1, w, 1, C.plankLine);
    const offset = (row * 11) % PLANK_LEN;
    for (let sx = x + offset; sx < x + w; sx += PLANK_LEN) rect(ctx, sx, py, 1, ph - 1, C.plankSeam);
  }
}

function loungeFloor(ctx: Ctx, l: LoungeBox): void {
  const h = l.y + l.h - l.floorY;
  rect(ctx, l.x, l.floorY, l.w, h, C.loungeFloor);
  for (let y = l.floorY + 7; y < l.floorY + h; y += 8) rect(ctx, l.x, y, l.w, 1, C.loungeFloorLine);
  for (let x = l.x + 7; x < l.x + l.w; x += 8) rect(ctx, x, l.floorY, 1, h, C.loungeFloorLine);
  for (let y = l.floorY + 3; y < l.floorY + h; y += 8) for (let x = l.x + 3; x < l.x + l.w; x += 16) rect(ctx, x + ((y >> 3) % 2) * 8, y, 1, 1, C.loungeFloorDot);
  // góc bếp: caro đen trắng
  const k = l.kitchen;
  for (let y = 0; y < k.h; y += 6)
    for (let x = 0; x < k.w; x += 6)
      rect(ctx, k.x + x, k.y + y, Math.min(6, k.w - x), Math.min(6, k.h - y), ((x + y) / 6) % 2 ? C.checkDark : C.checkLight);
}

// Mặt trước tường phòng làm việc: xanh đậm, ô panel, vạch nhấn màu provider, chân tường.
function roomWall(ctx: Ctx, r: RoomBox, accent: string, wallH: number): void {
  rect(ctx, r.x, r.y, r.w, wallH, C.roomWall);
  for (let x = r.x + 11; x < r.x + r.w; x += 12) rect(ctx, x, r.y, 1, wallH - 4, C.roomWallLine);
  rect(ctx, r.x, r.y, r.w, 1, C.roomWallShade);
  rect(ctx, r.x, r.y + wallH - 4, r.w, 2, accent);
  rect(ctx, r.x, r.y + wallH - 2, r.w, 2, C.roomWallShade);
}

function loungeWall(ctx: Ctx, l: LoungeBox): void {
  const wallH = l.floorY - l.y;
  rect(ctx, l.x, l.y, l.w, wallH, C.loungeWall);
  for (let x = l.x + 5; x < l.x + l.w; x += 10) rect(ctx, x, l.y + 1, 1, wallH - 9, C.loungeWallLine);
  rect(ctx, l.x, l.y + wallH - 8, l.w, 6, C.loungeWallLow); // ốp gỗ chân tường
  rect(ctx, l.x, l.y + wallH - 8, l.w, 1, C.woodFace);
  rect(ctx, l.x, l.y + wallH - 2, l.w, 2, C.woodFace);
}

export function drawBackdrop(ctx: Ctx, layout: Layout, outdoor = outdoorLayout(layout)): void {
  // Sân trước, tường sau: tô tường cả scene sẽ che cỏ. Xe không nằm ở đây vì nó chạy theo thời gian.
  // `outdoor` để cache dùng đúng seed; mặc định vẫn sinh từ layout.
  drawOutdoorStatic(ctx, outdoor);
  const b = layout.building;
  rect(ctx, b.x, b.y, b.w, b.h, C.wall);
  rect(ctx, b.x, b.y, b.w, 1, C.wallLight);
}

export function drawRoomShell(ctx: Ctx, r: RoomBox, accent: string): void {
  const wallH = r.floorY - r.y;
  roomWall(ctx, r, accent, wallH);
  plankFloor(ctx, r.x, r.floorY, r.w, r.h - wallH);
  rect(ctx, r.x, r.floorY, r.w, 1, C.plankSeam); // bóng chân tường
}

export function drawLoungeShell(ctx: Ctx, l: LoungeBox): void {
  loungeWall(ctx, l);
  loungeFloor(ctx, l);
  rect(ctx, l.x, l.floorY, l.w, 1, C.loungeFloorLine);
}

// Khối tường kín (kho) lấp phần dư bên phải hàng phòng.
export function drawStorage(ctx: Ctx, s: Rect): void {
  rect(ctx, s.x, s.y, s.w, s.h, C.wallLight);
  for (let y = s.y + 3; y < s.y + s.h; y += 6)
    for (let x = s.x + ((y - s.y) % 12 === 3 ? 0 : 6); x < s.x + s.w; x += 12) rect(ctx, x, y, Math.min(10, s.x + s.w - x), 1, C.wall);
}

// Ô cửa: khoét vách ngăn giữa các phòng và vách/tường xuống phòng nghỉ, có ngưỡng cửa sẫm.
export function drawDoors(ctx: Ctx, layout: Layout): void {
  const l = layout.lounge;
  const wallH = l.floorY - l.y;
  for (const r of layout.rooms) {
    if (r.sideDoor) {
      const d = r.sideDoor;
      rect(ctx, d.x, d.y, d.w, d.h, C.plank);
      rect(ctx, d.x, d.y + d.h - 1, d.w, 1, C.plankSeam);
      rect(ctx, d.x, d.y, d.w, 1, C.plankSeam);
    }
    const { x, w } = r.door;
    rect(ctx, x, r.y + r.h, w, l.y - r.y - r.h, C.plankAlt); // khe vách
    rect(ctx, x, l.y, w, wallH, C.doorway); // lỗ cửa trên tường phòng nghỉ
    rect(ctx, x, l.y, w, 2, C.plankSeam);
    rect(ctx, x - 2, l.y, 2, wallH, C.woodFace); // khung cửa
    rect(ctx, x + w, l.y, 2, wallH, C.woodFace);
    rect(ctx, x, l.floorY - 1, w, 1, C.loungeFloorLine);
  }
}

// Tắt đèn phòng offline.
export function drawDarkness(ctx: Ctx, r: RoomBox): void {
  ctx.fillStyle = C.dark;
  ctx.fillRect(r.x, r.y, r.w, r.h);
}
