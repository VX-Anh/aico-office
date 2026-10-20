// Văn phòng pixel vẽ bằng canvas: mỗi agent một bàn, animation theo trạng thái.
// Toạ độ tính theo pixel gốc (W x H), CSS phóng to với image-rendering: pixelated.

import type { WorkerStatus } from "./api";

export const W = 288;
export const H = 120;
const DESK_W = 96;
const FLOOR = 76; // y chân tường
const DESK = 80; // y mặt bàn

interface Palette {
  hair: string;
  shirt: string;
  shirtDark: string;
}

const PALETTES: Record<string, Palette> = {
  claude: { hair: "#7a3e22", shirt: "#d97757", shirtDark: "#a8553a" },
  codex: { hair: "#22262b", shirt: "#10a37f", shirtDark: "#0b7a5f" },
  cursor: { hair: "#d9d4c7", shirt: "#7c6cf0", shirtDark: "#5747c4" },
};
const FALLBACK: Palette = { hair: "#444", shirt: "#8a8f98", shirtDark: "#62666d" };
const SKIN = "#f2c9a0";
const SKIN_SHADE = "#d9a77a";

type Ctx = CanvasRenderingContext2D;

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

// Chữ pixel 3x5 cho "Z" và "!" (đủ dùng, không cần font).
const GLYPHS: Record<string, string[]> = {
  Z: ["111", "001", "010", "100", "111"],
  "!": ["1", "1", "1", "0", "1"],
};

function glyph(ctx: Ctx, ch: string, x: number, y: number, color: string): void {
  const rows = GLYPHS[ch];
  if (!rows) return;
  rows.forEach((row, dy) =>
    [...row].forEach((bit, dx) => bit === "1" && rect(ctx, x + dx, y + dy, 1, 1, color)),
  );
}

function drawRoom(ctx: Ctx, t: number): void {
  rect(ctx, 0, 0, W, H, "#2a2f3a");
  rect(ctx, 0, 0, W, FLOOR, "#3a4150"); // tường
  for (let x = 0; x < W; x += 16) rect(ctx, x, 0, 1, FLOOR, "#363c4a");
  rect(ctx, 0, FLOOR, W, 2, "#1f232b"); // chân tường
  for (let y = FLOOR + 8; y < H; y += 9) rect(ctx, 0, y, W, 1, "#262a33"); // sàn
  // cửa sổ: trời đổi màu chậm theo thời gian
  const sky = Math.sin(t / 20000) > 0 ? "#6fa8dc" : "#2b3a67";
  for (const wx of [8, 104, 200]) {
    rect(ctx, wx, 8, 34, 22, "#1c2029");
    rect(ctx, wx + 2, 10, 30, 18, sky);
    rect(ctx, wx + 16, 10, 2, 18, "#1c2029");
    rect(ctx, wx + 2, 18, 30, 2, "#1c2029");
  }
}

function drawPlant(ctx: Ctx, x: number, t: number): void {
  const sway = Math.round(Math.sin(t / 700 + x) * 1);
  const y = FLOOR + 14;
  rect(ctx, x, y, 10, 10, "#8b5a3c");
  rect(ctx, x + 1, y - 1, 8, 2, "#6e4630");
  rect(ctx, x + 3 + sway, y - 12, 4, 11, "#3f8f4f");
  rect(ctx, x + sway, y - 10, 4, 4, "#4fae60");
  rect(ctx, x + 6 + sway, y - 14, 4, 5, "#4fae60");
}

function drawMonitor(ctx: Ctx, x: number, y: number, w: WorkerStatus, t: number): void {
  rect(ctx, x, y, 24, 17, "#15181e");
  const on = w.state === "working" || w.state === "idle";
  rect(ctx, x + 2, y + 2, 20, 13, on ? (w.state === "working" ? "#123a5a" : "#1b2c3c") : "#0b0d11");
  if (w.state === "working") {
    // dòng code chạy lên
    const scroll = Math.floor(t / 180);
    for (let i = 0; i < 4; i++) {
      const len = 4 + ((scroll + i * 7) % 11);
      const indent = ((scroll + i) % 3) * 2;
      const color = (scroll + i) % 4 === 0 ? "#f5c26b" : "#7fd1ff";
      rect(ctx, x + 4 + indent, y + 4 + i * 3, Math.min(len, 16 - indent), 1, color);
    }
  } else if (w.state === "idle" && Math.floor(t / 600) % 2 === 0) {
    rect(ctx, x + 4, y + 5, 2, 3, "#7fd1ff"); // con trỏ nhấp nháy
  }
  rect(ctx, x + 10, y + 17, 4, 3, "#15181e");
  rect(ctx, x + 6, y + 20, 12, 2, "#15181e");
}

function drawAgent(ctx: Ctx, cx: number, w: WorkerStatus, t: number, phase: number): void {
  const p = PALETTES[w.kind ?? w.name] ?? PALETTES[w.name] ?? FALLBACK;
  const sleeping = w.state === "limited";
  const breathe = Math.round(Math.sin(t / 500 + phase));
  const headY = DESK - 30 + (sleeping ? 7 : 0) + (w.state === "idle" ? breathe * 0.5 : 0);
  const bodyY = DESK - 16;

  // thân
  rect(ctx, cx - 9, bodyY, 18, 18, p.shirt);
  rect(ctx, cx - 9, bodyY + 14, 18, 4, p.shirtDark);
  rect(ctx, cx - 2, bodyY, 4, 3, SKIN_SHADE); // cổ
  // đầu
  rect(ctx, cx - 6, headY, 12, 12, SKIN);
  rect(ctx, cx - 6, headY + 10, 12, 2, SKIN_SHADE);
  rect(ctx, cx - 7, headY - 2, 14, 5, p.hair);
  rect(ctx, cx - 7, headY + 3, 2, 5, p.hair);
  rect(ctx, cx + 5, headY + 3, 2, 5, p.hair);
  // mắt
  const blink = !sleeping && Math.floor((t + phase * 1000) / 3200) % 5 === 0 && t % 3200 < 160;
  if (sleeping || blink) {
    rect(ctx, cx - 4, headY + 6, 3, 1, "#3b2a20");
    rect(ctx, cx + 1, headY + 6, 3, 1, "#3b2a20");
  } else {
    const look = w.state === "working" ? 1 : 0; // nhìn màn hình
    rect(ctx, cx - 4, headY + 5 + look, 2, 2, "#2b1d14");
    rect(ctx, cx + 2, headY + 5 + look, 2, 2, "#2b1d14");
  }
  // tay
  if (w.state === "working") {
    const typing = Math.floor(t / 120 + phase) % 2;
    rect(ctx, cx - 13, bodyY + 4 + typing * 2, 4, 10, p.shirt);
    rect(ctx, cx + 9, bodyY + 6 - typing * 2, 4, 10, p.shirt);
    rect(ctx, cx - 13, bodyY + 14 + typing * 2, 4, 3, SKIN);
    rect(ctx, cx + 9, bodyY + 16 - typing * 2, 4, 3, SKIN);
  } else {
    rect(ctx, cx - 13, bodyY + 4, 4, 13, p.shirt);
    rect(ctx, cx + 9, bodyY + 4, 4, 13, p.shirt);
  }
  if (sleeping) {
    // chữ Z bay lên
    for (let i = 0; i < 3; i++) {
      const k = ((t / 900 + i / 3 + phase) % 1 + 1) % 1;
      glyph(ctx, "Z", cx + 8 + i * 3 + k * 6, headY - 4 - k * 18, `rgba(220,230,255,${1 - k})`);
    }
  }
}

function drawStation(ctx: Ctx, index: number, w: WorkerStatus, t: number): void {
  const x0 = index * DESK_W;
  const cx = x0 + 56; // người ngồi lệch phải, màn hình bên trái
  // ghế
  rect(ctx, cx - 11, DESK - 22, 22, 24, w.state === "offline" ? "#4a4f5a" : "#3b3f4a");
  if (w.state !== "offline") drawAgent(ctx, cx, w, t, index * 1.7);
  // bàn (che phần dưới người)
  rect(ctx, x0 + 8, DESK, 80, 5, "#9c6b45");
  rect(ctx, x0 + 8, DESK + 5, 80, 2, "#7a5236");
  rect(ctx, x0 + 11, DESK + 7, 4, H - DESK - 9, "#7a5236");
  rect(ctx, x0 + 81, DESK + 7, 4, H - DESK - 9, "#7a5236");
  drawMonitor(ctx, x0 + 12, DESK - 22, w, t);
  // cốc cà phê, hơi bốc lên khi đang làm
  rect(ctx, x0 + 74, DESK - 6, 5, 6, "#e9e4da");
  rect(ctx, x0 + 79, DESK - 5, 2, 3, "#e9e4da");
  if (w.state === "working" && Math.floor(t / 400) % 2 === 0) rect(ctx, x0 + 76, DESK - 10, 1, 3, "#c9ccd3");
  // đèn trạng thái trên bàn
  const lamp = { idle: "#4fae60", working: "#f5c26b", limited: "#e06c75", offline: "#5c6370" }[w.state];
  const pulse = w.state === "working" ? Math.floor(t / 300) % 2 : 0;
  rect(ctx, x0 + 40, DESK - 3 - pulse, 3, 3, lamp);
  if (w.last_error && w.state !== "limited" && w.state !== "offline") {
    const bob = Math.floor(t / 300) % 2;
    rect(ctx, cx + 10, DESK - 44 - bob, 5, 9, "#e06c75");
    glyph(ctx, "!", cx + 12, DESK - 42 - bob, "#fff");
  }
}

export function drawScene(ctx: Ctx, workers: WorkerStatus[], t: number): void {
  ctx.imageSmoothingEnabled = false;
  drawRoom(ctx, t);
  drawPlant(ctx, DESK_W - 5, t);
  drawPlant(ctx, 2 * DESK_W - 5, t);
  workers.slice(0, 3).forEach((w, i) => drawStation(ctx, i, w, t));
}
