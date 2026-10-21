// Bảng màu: màu provider, màu vai trò của agent con và bảng màu ấm dùng chung cho cảnh.

import type { WorkerStatus } from "../api";

export interface Palette {
  hair: string;
  shirt: string;
  shirtDark: string;
}

const PALETTES: Record<string, Palette> = {
  claude: { hair: "#7a3e22", shirt: "#d97757", shirtDark: "#a8553a" },
  codex: { hair: "#22262b", shirt: "#10a37f", shirtDark: "#0b7a5f" },
  cursor: { hair: "#d9d4c7", shirt: "#7c6cf0", shirtDark: "#5747c4" },
};
const FALLBACK: Palette = { hair: "#444444", shirt: "#8a8f98", shirtDark: "#62666d" };

export function paletteOf(w: WorkerStatus): Palette {
  return PALETTES[w.kind ?? w.name] ?? PALETTES[w.name] ?? FALLBACK;
}

export interface RoleStyle {
  label: string;
  shirt: string;
  shirtDark: string;
  accessory: string;
  accent: string; // màu chính của phụ kiện (khoá "a" trong công thức Pixelbolt)
}

// Màu áo và phụ kiện theo vai trò của agent con.
export const ROLE_STYLES: Record<string, RoleStyle> = {
  tech_lead: { label: "Tech lead", shirt: "#4a7fd4", shirtDark: "#355fa8", accessory: "cà vạt", accent: "#d6454f" },
  coder: { label: "Coder", shirt: "#4fae60", shirtDark: "#3a8a49", accessory: "tai nghe", accent: "#2b2f38" },
  reviewer: { label: "Reviewer", shirt: "#9b6bd6", shirtDark: "#7449b0", accessory: "kính", accent: "#21181f" },
  designer: { label: "Designer", shirt: "#e57fb0", shirtDark: "#b85a8a", accessory: "mũ nồi", accent: "#c0392b" },
};

export function roleStyle(role: string | null | undefined): RoleStyle {
  return (role && ROLE_STYLES[role]) || { label: role || "?", shirt: FALLBACK.shirt, shirtDark: FALLBACK.shirtDark, accessory: "", accent: "" };
}

// Màu tóc của agent con chọn theo id (nhân vật thường trực dùng màu tóc provider).
export const HAIR_COLORS = ["#3b2a20", "#7a3e22", "#c98a3c", "#22262b", "#a8323a", "#d9d4c7", "#5a3a7a", "#e0b84f"];

export const SKIN = "#f2c9a0";
export const SKIN_SHADE = "#d9a77a";
export const CODE_COLORS: Record<string, string> = { read: "#a6e3a1", write: "#7fd1ff", review: "#d6a6ff" };

// Mặt kính máy tính: giữ màu cũ cho code, con trỏ và màn hình tắt.
export const SCREEN = {
  codeBg: "#123a5a",
  cursorBg: "#1b2c3c",
  offBg: "#0b0d11",
  codeLine: "#7fd1ff",
  codeAccent: "#f5c26b",
  powerOff: "#5c6370",
  powerOn: "#4fae60",
  terminalBg: "#101e1b",
  terminalLine: "#82d99a",
  browserFrame: "#6787a5",
  browserBar: "#c0d7e8",
  browserPage: "#edf2ed",
  browserContent: "#739ac1",
  searchBg: "#203c50",
  searchLine: "#52758b",
  searchGlass: "#f5d18a",
  paperBg: "#344654",
  paper: "#f4efe4",
  paperLine: "#89939c",
};

// Lớp chữ hoạt động và thanh tiến độ dùng chung tông với cảnh.
export const BUBBLE = {
  bg: "#f4efe4",
  border: "#6787a5",
  error: "#d6454f",
  text: "#2a2f3a",
  staleAlpha: 0.5,
  bar: "#4fae60",
  barTrack: "#2b2f38",
  barText: "#f4efe4",
};

// Màu đèn trạng thái cạnh biển tên.
export const LAMP: Record<WorkerStatus["state"], string> = {
  idle: "#4fae60",
  working: "#f5c26b",
  limited: "#e06c75",
  offline: "#5c6370",
};

// Bảng hạn mức trên tường: màu thanh theo mức dùng lại tông đèn trạng thái (xanh, vàng, đỏ).
export const USAGE = {
  ok: LAMP.idle,
  warn: LAMP.working,
  high: LAMP.limited,
  track: "#151a24", // rãnh thanh chưa dùng
  frame: "#21181f",
  board: "#2b2f38",
  text: "#efe6cf",
  unknown: "#8a8f98", // dấu ? và gói của phòng không công bố hạn mức
};

// Bảng màu ấm, ít màu cho tường, sàn và đồ đạc.
export const C = {
  wall: "#2a2030", // viền ngoài và vách ngăn
  wallLight: "#3a2e42",
  roomWall: "#2e4d6e", // mặt trước tường phòng làm việc
  roomWallLine: "#284463",
  roomWallShade: "#1f3550",
  plank: "#b07a46",
  plankAlt: "#a36e3e",
  plankLine: "#875730",
  plankSeam: "#6e4426",
  loungeWall: "#d4b98e",
  loungeWallLow: "#a9825a",
  loungeWallLine: "#c2a67a",
  loungeFloor: "#5583bd",
  loungeFloorLine: "#4a76ad",
  loungeFloorDot: "#6a96cc",
  doorway: "#3f6a9e",
  checkLight: "#ece4d2",
  checkDark: "#34303c",
  wood: "#dba46a",
  woodLight: "#ebbd84",
  woodDark: "#a8703f",
  woodFace: "#8a5a32",
  ivory: "#efe6cf",
  ivoryShade: "#cdbf9f",
  key: "#d6ccb4",
  stool: "#3f7fc4",
  stoolDark: "#2d5f9a",
  stoolLight: "#69a3dc",
  sofa: "#9a3030",
  sofaDark: "#6e2026",
  sofaLight: "#b8473f",
  rug: "#c97a4f",
  rugEdge: "#e3a46b",
  leaf: "#5fae4f",
  leafDark: "#3f8a3f",
  stem: "#2f6a35",
  pot: "#b5653a",
  potDark: "#8a4a2a",
  paper: "#f4efe4",
  coffee: "#6b3f22",
  steam: "#d8dce4",
  stone: "#d8d0c0",
  stoneDark: "#b3a992",
  frame: "#c9a14f",
  dark: "rgba(6,6,14,0.62)",
  shadow: "rgba(20,10,20,0.25)",
  books: ["#c94f4f", "#e0b84f", "#4f8fc9", "#5fae6a", "#a86fc9", "#e08a4f"],
};
