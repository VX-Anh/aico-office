// Đồ đạc nhìn từ trên xuống góc 3/4, mọi đồ vật có viền tối 1px.
// Phòng làm việc: bàn gỗ, máy tính kiểu cũ, bàn phím, ghế đẩu, kệ sách, đồng hồ, cây leo, biển tên.
// Phòng nghỉ: tranh có khung, cây lớn, sofa đỏ đậm, bàn trà có cốc, quầy bếp.

import { shortCountdown } from "../usage";
import { glyph, text, textWidth } from "./font";
import type { Desk, LoungeBox, Sofa, SofaSet } from "./layout";
import { C, CODE_COLORS, SCREEN } from "./palette";
import { type Ctx, OUTLINE, type Rect, outlineRect, rect } from "./pixel";

export type Screen = "code" | "terminal" | "browser" | "search" | "read" | "cursor" | "off";

// Máy tính kiểu cũ: vỏ trắng ngà, mặt kính sáng theo trạng thái; code chạy màu theo mode của agent con.
function drawMonitor(ctx: Ctx, x: number, y: number, screen: Screen, mode: string, t: number): void {
  outlineRect(ctx, x, y, 14, 13, C.ivory);
  rect(ctx, x + 1, y + 10, 12, 2, C.ivoryShade);
  rect(ctx, x + 2, y + 2, 10, 7, OUTLINE);
  const sx = x + 3;
  const sy = y + 3;
  const bg = screen === "code" ? SCREEN.codeBg : screen === "cursor" ? SCREEN.cursorBg
    : screen === "terminal" ? SCREEN.terminalBg : screen === "browser" ? SCREEN.browserFrame
    : screen === "search" ? SCREEN.searchBg : screen === "read" ? SCREEN.paperBg : SCREEN.offBg;
  rect(ctx, sx, sy, 8, 5, bg);
  if (screen === "code") {
    const scroll = Math.floor(t / 180);
    const base = CODE_COLORS[mode] ?? SCREEN.codeLine;
    for (let i = 0; i < 3; i++) {
      const indent = (scroll + i) % 3;
      const len = 2 + ((scroll + i * 7) % 5);
      const color = (scroll + i) % 4 === 0 ? SCREEN.codeAccent : base;
      rect(ctx, x + 3 + indent, y + 3 + i * 2, Math.min(len, 8 - indent), 1, color);
    }
  } else if (screen === "terminal") {
    const scroll = Math.floor(t / 450);
    for (let row = 0; row < 5; row++) {
      const line = scroll + row;
      if (line % 2 === 0) rect(ctx, sx, sy + row, 2 + (line % 5), 1, SCREEN.terminalLine);
    }
    if (Math.floor(t / 600) % 2 === 0) rect(ctx, sx + 6, sy + 4, 2, 1, SCREEN.terminalLine);
  } else if (screen === "browser") {
    rect(ctx, sx + 1, sy + 1, 6, 3, SCREEN.browserPage);
    rect(ctx, sx, sy, 8, 1, SCREEN.browserBar);
    rect(ctx, sx + 1, sy + 2, 2, 2, SCREEN.browserContent);
    rect(ctx, sx + 4, sy + 2, 2, 1, SCREEN.browserContent);
    rect(ctx, sx + 7, sy + 1 + Math.floor(t / 700) % 3, 1, 1, SCREEN.browserBar);
  } else if (screen === "search") {
    rect(ctx, sx, sy + 1, 7, 1, SCREEN.searchLine);
    rect(ctx, sx + 1, sy + 3, 6, 1, SCREEN.searchLine);
    const lensX = sx + 1 + Math.round((Math.sin(t / 700) + 1) * 1.5);
    rect(ctx, lensX + 1, sy, 2, 1, SCREEN.searchGlass);
    rect(ctx, lensX, sy + 1, 1, 2, SCREEN.searchGlass);
    rect(ctx, lensX + 3, sy + 1, 1, 2, SCREEN.searchGlass);
    rect(ctx, lensX + 1, sy + 3, 2, 1, SCREEN.searchGlass);
    rect(ctx, lensX + 4, sy + 4, 1, 1, SCREEN.searchGlass);
  } else if (screen === "read") {
    const page = Math.floor(t / 1600) % 2;
    rect(ctx, sx + 1, sy, 6, 5, SCREEN.paper);
    rect(ctx, sx + 2, sy + 1, 4 - page, 1, SCREEN.paperLine);
    rect(ctx, sx + 2, sy + 3, 3 + page, 1, SCREEN.paperLine);
    rect(ctx, sx + 6, sy + page * 4, 1, 1, SCREEN.paperLine);
  } else if (screen === "cursor" && Math.floor(t / 600) % 2 === 0) {
    rect(ctx, x + 4, y + 4, 1, 2, SCREEN.codeLine); // con trỏ nhấp nháy
  }
  rect(ctx, x + 11, y + 11, 1, 1, screen === "off" ? SCREEN.powerOff : SCREEN.powerOn); // đèn nguồn
}

export function drawDesk(ctx: Ctx, d: Desk, screen: Screen, mode: string, t: number): void {
  const { x, y, w } = d;
  outlineRect(ctx, x, y, w, 18, C.wood);
  rect(ctx, x + 1, y + 1, w - 2, 1, C.woodLight);
  rect(ctx, x + 3, y + 5, 6, 1, C.woodDark); // vân gỗ
  rect(ctx, x + w - 10, y + 10, 5, 1, C.woodDark);
  rect(ctx, x + 1, y + 13, w - 2, 1, C.woodDark);
  rect(ctx, x + 1, y + 14, w - 2, 3, C.woodFace); // mặt trước bàn
  const mx = x + Math.floor(w / 2) - 7;
  drawMonitor(ctx, mx, y - 5, screen, mode, t);
  // bàn phím trước màn hình
  outlineRect(ctx, mx + 1, y + 9, 12, 4, C.key);
  for (let k = 0; k < 5; k++) rect(ctx, mx + 2 + k * 2, y + 10, 1, 1, C.ivoryShade);
  // giấy tờ góc phải bàn
  outlineRect(ctx, x + w - 8, y + 2, 6, 7, C.paper);
  rect(ctx, x + w - 7, y + 4, 4, 1, C.ivoryShade);
  rect(ctx, x + w - 7, y + 6, 3, 1, C.ivoryShade);
}

// Ghế đẩu tròn màu xanh trước bàn.
export function drawStool(ctx: Ctx, d: Desk): void {
  const cx = d.seat.x;
  const y = d.y + 24;
  rect(ctx, cx - 3, y, 6, 1, OUTLINE);
  rect(ctx, cx - 4, y + 1, 8, 1, OUTLINE);
  rect(ctx, cx - 5, y + 2, 10, 3, OUTLINE);
  rect(ctx, cx - 3, y + 1, 6, 1, C.stoolLight);
  rect(ctx, cx - 4, y + 2, 8, 2, C.stool);
  rect(ctx, cx - 4, y + 4, 8, 1, C.stoolDark);
  rect(ctx, cx - 4, y + 5, 8, 1, OUTLINE);
  rect(ctx, cx - 1, y + 6, 2, 2, C.stoolDark); // chân ghế
  rect(ctx, cx - 1, y + 8, 2, 1, OUTLINE);
}

export function drawShelf(ctx: Ctx, x: number, y: number): void {
  outlineRect(ctx, x, y, 22, 13, C.woodFace);
  rect(ctx, x + 1, y + 6, 20, 1, C.woodDark);
  rect(ctx, x + 1, y + 11, 20, 1, C.woodDark);
  for (const [row, by] of [[0, y + 1], [1, y + 7]] as const) {
    for (let bx = x + 2, i = 0; bx < x + 18; i++) {
      const bw = 2 + ((i + row) % 3 === 0 ? 1 : 0);
      const bh = 4 + ((i * 3 + row) % 2);
      if ((i + row * 2) % 7 === 5) {
        bx += 2; // khoảng trống trên kệ
        continue;
      }
      rect(ctx, bx, by + 5 - bh, bw, bh, C.books[(i + row * 3) % C.books.length]);
      bx += bw;
    }
  }
}

const CLOCK = ["..OOOOO..", ".OWWWWWO.", "OWWWWWWWO", "OWWWWWWWO", "OWWWWWWWO", "OWWWWWWWO", "OWWWWWWWO", ".OWWWWWO.", "..OOOOO.."];

// Đồng hồ tròn treo tường, kim theo giờ thực.
export function drawClock(ctx: Ctx, x: number, y: number, now: number): void {
  CLOCK.forEach((row, dy) =>
    [...row].forEach((ch, dx) => ch !== "." && rect(ctx, x + dx, y + dy, 1, 1, ch === "O" ? OUTLINE : C.ivory)),
  );
  const d = new Date(now);
  const hand = (turns: number, len: number, color: string) => {
    const a = turns * Math.PI * 2;
    for (let i = 1; i <= len; i++) rect(ctx, x + 4 + Math.round(Math.sin(a) * i), y + 4 - Math.round(Math.cos(a) * i), 1, 1, color);
  };
  hand(d.getMinutes() / 60, 3, "#5c6370");
  hand(((d.getHours() % 12) + d.getMinutes() / 60) / 12, 2, "#a8323a");
  rect(ctx, x + 4, y + 4, 1, 1, OUTLINE);
}

// Biển nhỏ đếm ngược giờ mở lại cho phòng hết hạn mức (ví dụ 47M, 1H05).
// Cùng định dạng với thẻ trạng thái (shortCountdown).
export function countdownLabel(resetsAt: string | null | undefined, now: number): string {
  return shortCountdown(resetsAt, now);
}

export function drawCountdown(ctx: Ctx, right: number, y: number, label: string, t: number): void {
  const w = textWidth(label) + 4;
  const x = right - w;
  rect(ctx, x + Math.floor(w / 2), y - 2, 1, 2, OUTLINE); // dây treo
  outlineRect(ctx, x, y, w, 9, C.paper, "#a8323a");
  text(ctx, label, x + 2, y + 2, Math.floor(t / 500) % 2 ? "#a8323a" : "#2a2f3a");
}

const VINE = [[1, 1], [3, 0], [6, 1], [9, 0], [12, 1], [0, 3], [2, 5], [0, 8], [2, 10], [1, 13], [3, 15], [0, 17], [2, 20]];

// Cây leo rủ xuống từ góc tường.
export function drawVine(ctx: Ctx, x: number, y: number, t: number): void {
  rect(ctx, x, y, 14, 1, C.stem);
  rect(ctx, x + 1, y, 1, 22, C.stem);
  VINE.forEach(([dx, dy], i) => {
    const sway = dy > 8 ? Math.round(Math.sin(t / 900 + i) * 0.6) : 0;
    rect(ctx, x + dx + sway, y + dy, 2, 2, i % 2 ? C.leafDark : C.leaf);
  });
}

export function drawPottedPlant(ctx: Ctx, x: number, y: number, t: number): void {
  const sway = Math.round(Math.sin(t / 800 + x) * 0.6);
  outlineRect(ctx, x + 1, y + 6, 8, 6, C.pot);
  rect(ctx, x + 2, y + 10, 6, 1, C.potDark);
  outlineRect(ctx, x + sway, y, 6, 6, C.leaf);
  outlineRect(ctx, x + 4 - sway, y - 2, 6, 6, C.leafDark);
  rect(ctx, x + 5 - sway, y - 1, 2, 1, C.leaf);
}

// Biển tên phòng treo trên tường; trả về vị trí để gắn đèn và dấu lỗi bên cạnh.
export const NAME_MAX = 12;

export function roomLabel(name: string, overflow: number): string {
  let label = name.trim();
  if ([...label].length > NAME_MAX) label = [...label].slice(0, NAME_MAX - 1).join("") + ".";
  if (overflow > 0) label += `${label ? " " : ""}+${overflow}`;
  return label;
}

export function drawNameplate(ctx: Ctx, cx: number, y: number, label: string, frame: string, offline: boolean): { x: number; w: number } {
  const tw = textWidth(label);
  const bw = tw + 4; // viền 1px + đệm 1px mỗi bên
  const bx = Math.round(cx - bw / 2);
  rect(ctx, bx, y, bw, 9, offline ? "#62666d" : frame);
  rect(ctx, bx + 1, y + 1, bw - 2, 7, offline ? "#a9a59d" : "#e9e4da");
  text(ctx, label, bx + 2, y + 2, offline ? "#4a4f5a" : "#2a2f3a");
  return { x: bx, w: bw };
}

export function drawLamp(ctx: Ctx, x: number, y: number, color: string): void {
  outlineRect(ctx, x - 1, y - 1, 5, 5, color);
}

export function drawErrorMark(ctx: Ctx, x: number, y: number): void {
  rect(ctx, x, y, 5, 9, "#e06c75");
  glyph(ctx, "!", x + 2, y + 2, "#fff");
}

// --- phòng nghỉ ---

function drawPainting(ctx: Ctx, p: Rect, i: number): void {
  outlineRect(ctx, p.x, p.y, p.w, p.h, C.frame);
  const ix = p.x + 2;
  const iy = p.y + 2;
  const iw = p.w - 4;
  const ih = p.h - 4;
  const skies = ["#8ec5e8", "#f2b880", "#b9a6e0"];
  rect(ctx, ix, iy, iw, ih, skies[i % skies.length]);
  rect(ctx, ix + iw - 5, iy + 1, 2, 2, i % 2 ? "#fff6d0" : "#f5c26b"); // mặt trời
  rect(ctx, ix, iy + ih - 3, iw, 3, "#5fae6a"); // đồi
  rect(ctx, ix + 2, iy + ih - 5, 6, 2, "#4f9a5a");
  rect(ctx, ix + 4, iy + ih - 6, 3, 1, "#4f9a5a");
}

function drawBigPlant(ctx: Ctx, x: number, y: number, t: number): void {
  const sway = Math.round(Math.sin(t / 1100) * 0.8);
  outlineRect(ctx, x + 6 + sway, y - 22, 6, 10, C.leafDark);
  outlineRect(ctx, x + sway, y - 17, 8, 8, C.leaf);
  outlineRect(ctx, x + 10 - sway, y - 16, 8, 8, C.leaf);
  outlineRect(ctx, x + 3, y - 10, 12, 8, C.leafDark);
  rect(ctx, x + 2 + sway, y - 15, 3, 1, "#7fca6a");
  rect(ctx, x + 12 - sway, y - 14, 3, 1, "#7fca6a");
  rect(ctx, x + 8, y - 4, 2, 4, C.stem);
  outlineRect(ctx, x + 2, y, 14, 11, C.pot);
  rect(ctx, x + 3, y + 1, 12, 2, C.potDark);
  rect(ctx, x + 3, y + 8, 12, 2, C.potDark);
}

// Sofa dọc: lưng tựa ở phía ngoài, tay vịn trên/dưới, người ngồi nhìn vào bàn trà.
function drawSofa(ctx: Ctx, s: Sofa): void {
  outlineRect(ctx, s.x, s.y, s.w, s.h, C.sofa);
  const backX = s.facing === "right" ? s.x + 1 : s.x + s.w - 5;
  rect(ctx, backX, s.y + 1, 4, s.h - 2, C.sofaDark); // lưng tựa
  rect(ctx, s.x + 1, s.y + 1, s.w - 2, 4, C.sofaLight); // tay vịn trên
  rect(ctx, s.x + 1, s.y + 5, s.w - 2, 1, OUTLINE);
  rect(ctx, s.x + 1, s.y + s.h - 6, s.w - 2, 1, OUTLINE);
  rect(ctx, s.x + 1, s.y + s.h - 5, s.w - 2, 2, C.sofaLight); // tay vịn dưới
  rect(ctx, s.x + 1, s.y + s.h - 3, s.w - 2, 2, C.sofaDark); // mặt trước
  const seatX = s.facing === "right" ? s.x + 5 : s.x + 1;
  rect(ctx, seatX, s.y + Math.floor(s.h / 2), s.w - 6, 1, C.sofaDark); // đường nối nệm
}

function drawCup(ctx: Ctx, x: number, y: number): void {
  outlineRect(ctx, x, y, 4, 4, C.paper);
  rect(ctx, x + 1, y + 1, 2, 1, C.coffee);
}

function drawTable(ctx: Ctx, tb: Rect, steam: boolean, t: number): void {
  outlineRect(ctx, tb.x, tb.y, tb.w, tb.h, C.wood);
  rect(ctx, tb.x + 1, tb.y + 1, tb.w - 2, 1, C.woodLight);
  rect(ctx, tb.x + 1, tb.y + tb.h - 4, tb.w - 2, 3, C.woodFace);
  drawCup(ctx, tb.x + 3, tb.y + 3);
  drawCup(ctx, tb.x + tb.w - 7, tb.y + 4);
  rect(ctx, tb.x + 9, tb.y + 3, 3, 3, "#e0b84f"); // đĩa bánh
  if (!steam) return;
  for (const [cx, k] of [[tb.x + 4, 0], [tb.x + tb.w - 6, 1]] as const) {
    const s = Math.floor(t / 350 + k) % 3;
    rect(ctx, cx + (s === 1 ? 1 : 0), tb.y + 1 - s, 1, 2, C.steam);
  }
}

function drawRug(ctx: Ctx, r: Rect): void {
  outlineRect(ctx, r.x, r.y, r.w, r.h, C.rugEdge);
  rect(ctx, r.x + 2, r.y + 2, r.w - 4, r.h - 4, C.rug);
  for (let x = r.x + 4; x < r.x + r.w - 4; x += 6) rect(ctx, x, r.y + 3, 2, 1, C.rugEdge);
}

// Quầy bếp dọc tường phải: mặt đá, máy pha cà phê, cốc.
function drawCounter(ctx: Ctx, c: Rect, t: number): void {
  outlineRect(ctx, c.x, c.y, c.w, c.h, C.stone);
  rect(ctx, c.x + 1, c.y + c.h - 5, c.w - 2, 4, C.woodFace);
  rect(ctx, c.x + 1, c.y + c.h - 6, c.w - 2, 1, C.stoneDark);
  outlineRect(ctx, c.x + 3, c.y + 3, 9, 10, "#3a3f4a"); // máy pha cà phê
  rect(ctx, c.x + 5, c.y + 5, 5, 2, "#5c6370");
  rect(ctx, c.x + 9, c.y + 9, 1, 1, Math.floor(t / 700) % 2 ? "#e06c75" : "#7a2f35");
  drawCup(ctx, c.x + 5, c.y + 16);
  drawCup(ctx, c.x + 5, c.y + 22);
  outlineRect(ctx, c.x + 3, c.y + 28, 9, 5, "#e8e2d4"); // khay
}

export function drawLoungeFurniture(ctx: Ctx, l: LoungeBox, drinkingSets: Set<number>, t: number): void {
  l.paintings.forEach((p, i) => drawPainting(ctx, p, i));
  drawCounter(ctx, l.counter, t);
  l.sets.forEach((set: SofaSet, i) => {
    drawRug(ctx, set.rug);
    set.sofas.forEach((s) => drawSofa(ctx, s));
    drawTable(ctx, set.table, drinkingSets.has(i), t);
  });
  drawBigPlant(ctx, l.plant.x, l.plant.y, t);
}
