// Văn phòng pixel vẽ bằng canvas: mỗi provider một phòng, trong phòng có `slots` chỗ ngồi cho agent con.
// Toạ độ tính theo pixel gốc (sceneSize), CSS phóng to với image-rendering: pixelated.

import { type WorkerAgent, type WorkerStatus, roomAgents } from "./api";

export const H = 132;
const FLOOR = 88; // y chân tường
const DESK = 92; // y mặt bàn
const SEAT_W = 64; // mỗi chỗ ngồi: màn hình bên trái, người ở x+40
const ROOM_PAD = 4; // lề trái trong phòng
const PLANT_W = 16; // góc phải phòng để cây cảnh
const GAP = 4; // vách giữa các phòng

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

export interface RoleStyle {
  label: string;
  shirt: string;
  shirtDark: string;
  accessory: string;
}

// Màu áo và phụ kiện theo vai trò của agent con; tóc giữ màu provider để nhận ra phòng.
export const ROLE_STYLES: Record<string, RoleStyle> = {
  tech_lead: { label: "Tech lead", shirt: "#4a7fd4", shirtDark: "#355fa8", accessory: "cà vạt" },
  coder: { label: "Coder", shirt: "#4fae60", shirtDark: "#3a8a49", accessory: "tai nghe" },
  reviewer: { label: "Reviewer", shirt: "#9b6bd6", shirtDark: "#7449b0", accessory: "kính" },
  designer: { label: "Designer", shirt: "#e57fb0", shirtDark: "#b85a8a", accessory: "mũ nồi" },
};

export function roleStyle(role: string | null | undefined): RoleStyle {
  return (role && ROLE_STYLES[role]) || { label: role || "?", shirt: FALLBACK.shirt, shirtDark: FALLBACK.shirtDark, accessory: "" };
}
const SKIN = "#f2c9a0";
const SKIN_SHADE = "#d9a77a";

type Ctx = CanvasRenderingContext2D;

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

// Chữ pixel 3x5 (A-Z, 0-9 và vài ký tự hay gặp trong tên phòng), không cần font.
const GLYPHS: Record<string, string[]> = {
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "010"],
  K: ["101", "101", "110", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["110", "101", "101", "101", "101"],
  O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"],
  Q: ["010", "101", "101", "110", "011"],
  R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"],
  X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"],
  Z: ["111", "001", "010", "100", "111"],
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["110", "001", "010", "100", "111"],
  "3": ["110", "001", "010", "001", "110"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "110", "001", "110"],
  "6": ["011", "100", "110", "101", "010"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["010", "101", "010", "101", "010"],
  "9": ["010", "101", "011", "001", "110"],
  "-": ["000", "000", "111", "000", "000"],
  _: ["000", "000", "000", "000", "111"],
  ".": ["000", "000", "000", "000", "010"],
  " ": ["000", "000", "000", "000", "000"],
  "!": ["1", "1", "1", "0", "1"],
  "+": ["000", "010", "111", "010", "000"],
};

function glyph(ctx: Ctx, ch: string, x: number, y: number, color: string): void {
  const rows = GLYPHS[ch];
  if (!rows) return;
  rows.forEach((row, dy) =>
    [...row].forEach((bit, dx) => bit === "1" && rect(ctx, x + dx, y + dy, 1, 1, color)),
  );
}

// Chuẩn hoá chuỗi về các ký tự có trong GLYPHS (chữ hoa; ký tự lạ thành dấu cách).
function glyphChars(s: string): string[] {
  return [...s.toUpperCase()].map((ch) => (GLYPHS[ch] ? ch : " "));
}

function textWidth(s: string): number {
  const chars = glyphChars(s);
  return chars.reduce((sum, ch) => sum + GLYPHS[ch][0].length + 1, 0) - (chars.length ? 1 : 0);
}

function text(ctx: Ctx, s: string, x: number, y: number, color: string): void {
  for (const ch of glyphChars(s)) {
    glyph(ctx, ch, x, y, color);
    x += GLYPHS[ch][0].length + 1;
  }
}

function paletteOf(w: WorkerStatus): Palette {
  return PALETTES[w.kind ?? w.name] ?? PALETTES[w.name] ?? FALLBACK;
}

interface RoomBox {
  x: number;
  w: number;
  worker: WorkerStatus;
}

// Mỗi phòng rộng theo số chỗ (phòng 0 chỗ vẫn rộng bằng 1 chỗ để treo biển), xếp thành một hàng, giữa các phòng có vách GAP.
function layout(workers: WorkerStatus[]): { width: number; rooms: RoomBox[] } {
  const rooms: RoomBox[] = [];
  let x = GAP;
  for (const worker of workers) {
    const w = Math.max(1, roomAgents(worker).slots) * SEAT_W + ROOM_PAD + PLANT_W;
    rooms.push({ x, w, worker });
    x += w + GAP;
  }
  return { width: Math.max(x, 96), rooms };
}

export function sceneSize(workers: WorkerStatus[]): { width: number; height: number } {
  return { width: layout(workers).width, height: H };
}

// Giữ chỗ ổn định theo id agent: agent xong thì nhả chỗ, các agent khác không bị nhảy chỗ.
const seatMaps = new Map<string, Map<string, number>>();

function assignSeats(room: string, agents: WorkerAgent[], slots: number): { seats: (WorkerAgent | null)[]; overflow: number } {
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

function hashPhase(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return (Math.abs(h) % 1000) / 100;
}

function drawWalls(ctx: Ctx, x: number, w: number, accent: string, t: number): void {
  rect(ctx, x, 0, w, H, "#2a2f3a");
  rect(ctx, x, 0, w, FLOOR, "#3a4150"); // tường
  for (let sx = x + 8; sx < x + w; sx += 16) rect(ctx, sx, 0, 1, FLOOR, "#363c4a");
  rect(ctx, x, FLOOR - 6, w, 2, accent); // vạch tường màu provider
  rect(ctx, x, FLOOR, w, 2, "#1f232b"); // chân tường
  for (let y = FLOOR + 8; y < H; y += 9) rect(ctx, x, y, w, 1, "#262a33"); // sàn
  // cửa sổ: trời đổi màu chậm theo thời gian
  const sky = Math.sin(t / 20000) > 0 ? "#6fa8dc" : "#2b3a67";
  const wx = x + 8;
  const wy = 20;
  rect(ctx, wx, wy, 34, 22, "#1c2029");
  rect(ctx, wx + 2, wy + 2, 30, 18, sky);
  rect(ctx, wx + 16, wy + 2, 2, 18, "#1c2029");
  rect(ctx, wx + 2, wy + 10, 30, 2, "#1c2029");
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

type Screen = "code" | "cursor" | "off";
const CODE_COLORS: Record<string, string> = { read: "#a6e3a1", write: "#7fd1ff", review: "#d6a6ff" };

function drawMonitor(ctx: Ctx, x: number, y: number, screen: Screen, mode: string, t: number): void {
  rect(ctx, x, y, 24, 17, "#15181e");
  rect(ctx, x + 2, y + 2, 20, 13, screen === "code" ? "#123a5a" : screen === "cursor" ? "#1b2c3c" : "#0b0d11");
  if (screen === "code") {
    // dòng code chạy lên, màu theo mode của agent con
    const scroll = Math.floor(t / 180);
    const base = CODE_COLORS[mode] ?? "#7fd1ff";
    for (let i = 0; i < 4; i++) {
      const len = 4 + ((scroll + i * 7) % 11);
      const indent = ((scroll + i) % 3) * 2;
      const color = (scroll + i) % 4 === 0 ? "#f5c26b" : base;
      rect(ctx, x + 4 + indent, y + 4 + i * 3, Math.min(len, 16 - indent), 1, color);
    }
  } else if (screen === "cursor" && Math.floor(t / 600) % 2 === 0) {
    rect(ctx, x + 4, y + 5, 2, 3, "#7fd1ff"); // con trỏ nhấp nháy
  }
  rect(ctx, x + 10, y + 17, 4, 3, "#15181e");
  rect(ctx, x + 6, y + 20, 12, 2, "#15181e");
}

function drawAccessory(ctx: Ctx, cx: number, headY: number, bodyY: number, eyeY: number, role: string | null): void {
  switch (role) {
    case "tech_lead": // cà vạt
      rect(ctx, cx - 1, bodyY + 2, 2, 1, "#a8323a");
      rect(ctx, cx - 1, bodyY + 3, 2, 9, "#d6454f");
      break;
    case "coder": // tai nghe
      rect(ctx, cx - 7, headY - 4, 14, 2, "#2b2f38");
      rect(ctx, cx - 9, headY + 3, 3, 6, "#2b2f38");
      rect(ctx, cx + 6, headY + 3, 3, 6, "#2b2f38");
      rect(ctx, cx - 9, headY + 4, 1, 2, "#5c6370");
      rect(ctx, cx + 8, headY + 4, 1, 2, "#5c6370");
      break;
    case "reviewer": // kính
      for (const lx of [cx - 5, cx + 1]) {
        rect(ctx, lx, eyeY - 1, 4, 1, "#1c2029");
        rect(ctx, lx, eyeY + 2, 4, 1, "#1c2029");
        rect(ctx, lx, eyeY, 1, 2, "#1c2029");
        rect(ctx, lx + 3, eyeY, 1, 2, "#1c2029");
      }
      rect(ctx, cx - 1, eyeY, 2, 1, "#1c2029");
      break;
    case "designer": // mũ nồi
      rect(ctx, cx - 8, headY - 4, 15, 4, "#c0392b");
      rect(ctx, cx - 1, headY - 6, 2, 2, "#c0392b");
      break;
  }
}

function drawAgent(ctx: Ctx, cx: number, hair: string, role: string | null, sleeping: boolean, t: number, phase: number): void {
  const p = roleStyle(role);
  const headY = DESK - 30 + (sleeping ? 7 : 0);
  const bodyY = DESK - 16;

  // thân
  rect(ctx, cx - 9, bodyY, 18, 18, p.shirt);
  rect(ctx, cx - 9, bodyY + 14, 18, 4, p.shirtDark);
  rect(ctx, cx - 2, bodyY, 4, 3, SKIN_SHADE); // cổ
  // đầu
  rect(ctx, cx - 6, headY, 12, 12, SKIN);
  rect(ctx, cx - 6, headY + 10, 12, 2, SKIN_SHADE);
  rect(ctx, cx - 7, headY - 2, 14, 5, hair);
  rect(ctx, cx - 7, headY + 3, 2, 5, hair);
  rect(ctx, cx + 5, headY + 3, 2, 5, hair);
  // mắt
  const blink = !sleeping && Math.floor((t + phase * 1000) / 3200) % 5 === 0 && t % 3200 < 160;
  const look = sleeping ? 0 : 1; // nhìn màn hình
  if (sleeping || blink) {
    rect(ctx, cx - 4, headY + 6, 3, 1, "#3b2a20");
    rect(ctx, cx + 1, headY + 6, 3, 1, "#3b2a20");
  } else {
    rect(ctx, cx - 4, headY + 5 + look, 2, 2, "#2b1d14");
    rect(ctx, cx + 2, headY + 5 + look, 2, 2, "#2b1d14");
  }
  drawAccessory(ctx, cx, headY, bodyY, headY + 5 + look, role);
  // tay
  if (!sleeping) {
    const typing = Math.floor(t / 120 + phase) % 2;
    rect(ctx, cx - 13, bodyY + 4 + typing * 2, 4, 10, p.shirt);
    rect(ctx, cx + 9, bodyY + 6 - typing * 2, 4, 10, p.shirt);
    rect(ctx, cx - 13, bodyY + 14 + typing * 2, 4, 3, SKIN);
    rect(ctx, cx + 9, bodyY + 16 - typing * 2, 4, 3, SKIN);
  } else {
    rect(ctx, cx - 13, bodyY + 4, 4, 13, p.shirt);
    rect(ctx, cx + 9, bodyY + 4, 4, 13, p.shirt);
    // chữ Z bay lên
    for (let i = 0; i < 3; i++) {
      const k = ((t / 900 + i / 3 + phase) % 1 + 1) % 1;
      glyph(ctx, "Z", cx + 8 + i * 3 + k * 6, headY - 4 - k * 18, `rgba(220,230,255,${1 - k})`);
    }
  }
}

function drawSeat(ctx: Ctx, sx: number, agent: WorkerAgent | null, state: WorkerStatus["state"], hair: string, t: number): void {
  const cx = sx + 40; // người ngồi lệch phải, màn hình bên trái
  const dark = state === "limited";
  const sitter = state === "offline" ? null : agent;
  const phase = sitter ? hashPhase(sitter.id) : 0;
  // ghế
  rect(ctx, cx - 11, DESK - 22, 22, 24, dark ? "#2c3039" : sitter ? "#3b3f4a" : "#4a4f5a");
  if (sitter) drawAgent(ctx, cx, hair, sitter.role, dark, t, phase);
  // bàn (che phần dưới người)
  rect(ctx, sx + 2, DESK, 60, 5, "#9c6b45");
  rect(ctx, sx + 2, DESK + 5, 60, 2, "#7a5236");
  rect(ctx, sx + 5, DESK + 7, 4, H - DESK - 9, "#7a5236");
  rect(ctx, sx + 55, DESK + 7, 4, H - DESK - 9, "#7a5236");
  const screen: Screen = dark || state === "offline" ? "off" : sitter ? "code" : "cursor";
  drawMonitor(ctx, sx + 2, DESK - 22, screen, sitter?.mode ?? "", t);
  // cốc cà phê, hơi bốc lên khi đang làm
  rect(ctx, sx + 54, DESK - 6, 5, 6, "#e9e4da");
  rect(ctx, sx + 59, DESK - 5, 2, 3, "#e9e4da");
  if (screen === "code" && Math.floor(t / 400 + phase) % 2 === 0) rect(ctx, sx + 56, DESK - 10, 1, 3, "#c9ccd3");
}

// Biển tên phòng treo giữa tường phía trên; trả về vị trí để gắn đèn và dấu lỗi bên cạnh.
const NAME_MAX = 12;

function drawNameplate(ctx: Ctx, cx: number, y: number, label: string, frame: string, offline: boolean): { x: number; w: number } {
  const tw = textWidth(label);
  const bw = tw + 4; // viền 1px + đệm 1px mỗi bên
  const bx = Math.round(cx - bw / 2);
  rect(ctx, bx, y, bw, 9, offline ? "#62666d" : frame);
  rect(ctx, bx + 1, y + 1, bw - 2, 7, offline ? "#a9a59d" : "#e9e4da");
  text(ctx, label, bx + 2, y + 2, offline ? "#4a4f5a" : "#2a2f3a");
  return { x: bx, w: bw };
}

function roomLabel(name: string, overflow: number): string {
  let label = name.trim();
  if ([...label].length > NAME_MAX) label = [...label].slice(0, NAME_MAX - 1).join("") + ".";
  if (overflow > 0) label += `${label ? " " : ""}+${overflow}`;
  return label;
}

function drawRoom(ctx: Ctx, box: RoomBox, t: number): void {
  const { x, w, worker } = box;
  const { agents, slots } = roomAgents(worker);
  const { seats, overflow } = assignSeats(worker.name, agents, slots);
  const p = paletteOf(worker);
  const offline = worker.state === "offline";
  drawWalls(ctx, x, w, p.shirtDark, t);
  drawPlant(ctx, x + w - 13, t);
  seats.forEach((agent, k) => drawSeat(ctx, x + ROOM_PAD + k * SEAT_W, agent, worker.state, p.hair, t));
  // khung phòng màu provider
  rect(ctx, x, 0, w, 1, p.shirtDark);
  rect(ctx, x, H - 1, w, 1, p.shirtDark);
  rect(ctx, x, 0, 1, H, p.shirtDark);
  rect(ctx, x + w - 1, 0, 1, H, p.shirtDark);
  if (offline) {
    ctx.fillStyle = "rgba(0,0,0,0.55)"; // tắt đèn
    ctx.fillRect(x, 0, w, H);
  }
  const label = roomLabel(worker.name, overflow);
  if (!label) return;
  const plate = drawNameplate(ctx, x + w / 2, 3, label, p.shirtDark, offline);
  // đèn trạng thái cạnh biển tên
  const lamp = { idle: "#4fae60", working: "#f5c26b", limited: "#e06c75", offline: "#5c6370" }[worker.state];
  const pulse = worker.state === "working" ? Math.floor(t / 300) % 2 : 0;
  rect(ctx, plate.x - 5, 6 - pulse, 3, 3, lamp);
  if (worker.last_error && worker.state !== "limited" && !offline) {
    const bob = Math.floor(t / 300) % 2;
    rect(ctx, plate.x + plate.w + 2, 3 - bob, 5, 9, "#e06c75");
    glyph(ctx, "!", plate.x + plate.w + 4, 5 - bob, "#fff");
  }
}

export function drawScene(ctx: Ctx, workers: WorkerStatus[], t: number): void {
  ctx.imageSmoothingEnabled = false;
  const { width, rooms } = layout(workers);
  rect(ctx, 0, 0, width, H, "#1c2029"); // vách giữa các phòng
  rooms.forEach((room) => drawRoom(ctx, room, t));
}
