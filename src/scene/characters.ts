// Nhân vật chibi 16x22 vẽ bằng lưới ký tự, cache bitmap theo (tư thế, hướng, frame, kiểu tóc, màu tóc, áo, vai trò).
// Ký tự: O viền, H/h tóc, S/s da, E mắt, T/t áo, P quần, p giày, W cốc; "." trong suốt.

import type { WorkerAgent } from "../api";
import { glyph } from "./font";
import type { Sofa } from "./layout";
import type { Dir } from "./pathing";
import { HAIR_COLORS, type Palette, ROLE_STYLES, SKIN, SKIN_SHADE, roleStyle } from "./palette";
import { type Ctx, OUTLINE, cached, drawGrid, hashId, mirrorGrid, rect, shade } from "./pixel";

const W = 16;
const H = 22;
const HEAD_X = 2;
const HEAD_Y = 2;
const BODY_Y = 12;

export interface Look {
  hair: string;
  style: number; // 0 ngắn, 1 mái, 2 dài, 3 búi
  shirt: string;
  shirtDark: string;
  role: string | null; // chỉ vai trò đã biết mới có phụ kiện
}

export function agentLook(agent: WorkerAgent): Look {
  const h = hashId(agent.id);
  const style = roleStyle(agent.role);
  return {
    hair: HAIR_COLORS[h % HAIR_COLORS.length],
    style: (h >> 4) % 4,
    shirt: style.shirt,
    shirtDark: style.shirtDark,
    role: agent.role && ROLE_STYLES[agent.role] ? agent.role : null,
  };
}

// Nhân vật thường trực của phòng: tóc và áo màu provider.
export function residentLook(p: Palette, index: number): Look {
  return { hair: p.hair, style: index % 4, shirt: p.shirt, shirtDark: p.shirtDark, role: null };
}

type View = "front" | "back" | "side";
type Pose = "walk" | "sitBack" | "sitSide" | "lie";

// --- đầu (12x10, đặt tại HEAD_X, HEAD_Y) ---
const HEAD: Record<View | "sleep", string[]> = {
  front: [
    "..OOOOOOOO..",
    ".OSSSSSSSSO.",
    "OSSSSSSSSSSO",
    "OSSSSSSSSSSO",
    "OSSSSSSSSSSO",
    "OSSESSSSESSO",
    "OSSESSSSESSO",
    "OsSSSSSSSSsO",
    ".OssSSSSssO.",
    "..OOOOOOOO..",
  ],
  sleep: [
    "..OOOOOOOO..",
    ".OSSSSSSSSO.",
    "OSSSSSSSSSSO",
    "OSSSSSSSSSSO",
    "OSSSSSSSSSSO",
    "OSSSSSSSSSSO",
    "OSEESSSSEESO",
    "OsSSSSSSSSsO",
    ".OssSSSSssO.",
    "..OOOOOOOO..",
  ],
  back: [
    "..OOOOOOOO..",
    ".OHHHHHHHHO.",
    "OHHHHHHHHHHO",
    "OHHHHHHHHHHO",
    "OHHHHHHHHHHO",
    "OHHHHHHHHHHO",
    "OHHHHHHHHHHO",
    "OhHHHHHHHHhO",
    ".OhhhhhhhhO.",
    "..OOOOOOOO..",
  ],
  side: [
    "..OOOOOOOO..",
    ".OHHHHHHHHO.",
    "OHHHHHHHHSSO",
    "OHHHHHHSSSSO",
    "OHHHHHSSSSSO",
    "OHHHHSSSSESO",
    "OHHHHSSSSESO",
    "OhHHHSSSSSSO",
    ".OhhhsSSSsO.",
    "..OOOOOOOO..",
  ],
};

// --- kiểu tóc: lớp phủ lên đầu, dy tính từ đỉnh đầu ---
interface Layer {
  dy: number;
  rows: string[];
}
const BUN_FRONT = ["....OOOO....", "...OHHhHO..."];
const BUN_SIDE = ["...OOOO.....", "..OHHhHO...."];
const SHORT_FRONT = ["..OOOOOOOO..", ".OHHHHHHHHO.", "OHHHHHHHHHHO", "OHhHHHHHHhHO", "OH........HO"];

const HAIR: Record<View, Layer[][]> = {
  front: [
    [{ dy: 0, rows: SHORT_FRONT }],
    [{ dy: 0, rows: ["..OOOOOOOO..", ".OHHHHHHHHO.", "OHHHHHHHHHHO", "OHHHHHHHHHHO", "OHhHhHHhHhHO", "OH........HO", "Oh........hO"] }],
    [
      {
        dy: 0,
        rows: [
          "..OOOOOOOO..",
          ".OHHHHHHHHO.",
          "OHHHHHHHHHHO",
          "OHHHHhhHHHHO",
          "OHH......HHO",
          "OHH......HHO",
          "OHH......HHO",
          "OHh......hHO",
          "OHO......OHO",
          "OhO......OhO",
          "OhO......OhO",
          ".O........O.",
        ],
      },
    ],
    [{ dy: -2, rows: BUN_FRONT }, { dy: 0, rows: SHORT_FRONT }],
  ],
  back: [
    [],
    [],
    [{ dy: 7, rows: ["OHHHHHHHHHHO", "OHHHHHHHHHHO", "OhHHHHHHHHhO", "OhhhhhhhhhhO", ".OOOOOOOOOO."] }],
    [{ dy: -2, rows: BUN_FRONT }],
  ],
  side: [
    [],
    [{ dy: 2, rows: ["OHHHHHHHHHHO", "OHHHHHHHHhSO"] }],
    [{ dy: 7, rows: ["OHHHH.......", "OHHHH.......", "OhHHO.......", "OhhO........", ".OO........."] }],
    [{ dy: -2, rows: BUN_SIDE }],
  ],
};

// --- thân (16 rộng, đặt tại BODY_Y) ---
const FRONT_STAND = [
  "....OTTTTTTO....",
  "...OTTTTTTTTO...",
  "..OTOTTTTTTOTO..",
  "..OTOTTTTTTOTO..",
  "..OSOttttttOSO..",
  "...OOPPPPPPOO...",
  "....OPPOOPPO....",
  "....OPPOOPPO....",
  "....OppOOppO....",
  "....OOO..OOO....",
];
const FRONT_STEP = [
  "....OTTTTTTO....",
  "...OTTTTTTTTO...",
  "..OTOTTTTTTOTO..",
  "..OSOTTTTTTOTO..",
  "...OOttttttOSO..",
  "...OOPPPPPPOO...",
  "....OPPOOPPO....",
  "....OppOOPPO....",
  "....OOO.OppO....",
  ".........OOO....",
];
const SIDE_STAND = [
  ".....OTTTTO.....",
  "....OTTTTTTO....",
  "....OTTTTTTO....",
  "....OTtTTTTO....",
  "....OTStTTTO....",
  ".....OPPPPO.....",
  ".....OPPPPO.....",
  ".....OPPPPO.....",
  ".....OpppppO....",
  ".....OOOOOOO....",
];
const SIDE_STRIDE = [
  ".....OTTTTO.....",
  "....OTTTTTTO....",
  "....OTTTTTTO....",
  "...OTtTTTTTO....",
  "...OSOtTTTTO....",
  ".....OPPPPO.....",
  "....OPPOOPPO....",
  "...OPPO..OPPO...",
  "..OppO....OppO..",
  "..OOO......OOO..",
];
const SIDE_PASS = [
  ".....OTTTTO.....",
  "....OTTTTTTO....",
  "....OTTTTTTO....",
  "....OTTTTtTO....",
  "....OTTTTtSO....",
  ".....OPPPPO.....",
  ".....OPPPPO.....",
  "....OPPOPPO.....",
  "....OppOppO.....",
  "....OOOOOOO.....",
];
// frame bước chân: đứng, bước trái, đứng, bước phải
const WALK: Record<View, string[][]> = {
  front: [FRONT_STAND, FRONT_STEP, FRONT_STAND, mirrorGrid(FRONT_STEP)],
  back: [FRONT_STAND, mirrorGrid(FRONT_STEP), FRONT_STAND, FRONT_STEP],
  side: [SIDE_STAND, SIDE_STRIDE, SIDE_STAND, SIDE_PASS],
};

// Ngồi bàn nhìn từ sau lưng: thấy tóc, vai; hai tay gõ phím so le.
const SIT_BACK = ["OTTOTTTTTTTTOTTO", "OTTTTTTTTTTTTTTO", "OTtTTTTTTTTTTtTO", ".OttttttttttttO.", "..OOOOOOOOOOOO.."];
const TYPING = [
  ["OSO.............", "OSO..........OSO", "OTO..........OSO", "OTO..........OTO"],
  [".............OSO", "OSO..........OSO", "OSO..........OTO", "OTO..........OTO"],
];

// Ngồi sofa nhìn nghiêng (quay phải), frame 1 nâng cốc lên miệng.
const SIT_SIDE = [
  [
    ".....OTTTTO.....",
    "....OTTTTTTO....",
    "....OTTTTtSO....",
    "....OTTTOOWWO...",
    "....OPPPPPPPO...",
    "....OPPPPPPPO...",
    "....OOOOOOpPO...",
    "..........OpO...",
    "..........OOO...",
  ],
  [
    ".....OTTTTO.....",
    "....OTTTTTTO....",
    "....OTTTTtTO....",
    "....OTTTTTTO....",
    "....OPPPPPPPO...",
    "....OPPPPPPPO...",
    "....OOOOOOpPO...",
    "..........OpO...",
    "..........OOO...",
  ],
];
const SIP = ["...........OWWO.", "...........OWWO.", "..........OSOO..", "..........OTO..."];

// Nằm ngủ trên sofa: đầu trên gối, chăn màu áo.
const LIE = [
  "...OTTTTTTTTO...",
  "..OWWWWWWWWWWO..",
  "..OTtTTTTTTtTO..",
  "..OTTTTTTTTTTO..",
  "..OTTTTTTTTTTO..",
  "..OtTTTTTTTTtO..",
  "..OttttttttttO..",
  "...OOOOOOOOOO...",
];

function drawAccessory(ctx: Ctx, role: string | null, view: View, pose: Pose): void {
  const dark = "#2b2f38";
  switch (role) {
    case "tech_lead": // cà vạt
      if (view === "front" && pose !== "lie") {
        rect(ctx, 7, BODY_Y, 2, 1, "#a8323a");
        rect(ctx, 7, BODY_Y + 1, 2, 3, "#d6454f");
      } else if (view === "side") rect(ctx, 10, BODY_Y + 1, 1, 2, "#d6454f");
      break;
    case "coder": // tai nghe
      if (view === "side") {
        rect(ctx, 5, 2, 6, 1, dark);
        rect(ctx, 7, 3, 1, 4, dark);
        rect(ctx, 6, 7, 3, 4, dark);
        rect(ctx, 7, 8, 1, 2, "#5c6370");
      } else {
        rect(ctx, 4, 2, 8, 1, dark);
        rect(ctx, 2, 3, 1, 4, dark);
        rect(ctx, 13, 3, 1, 4, dark);
        rect(ctx, 1, 7, 2, 4, dark);
        rect(ctx, 13, 7, 2, 4, dark);
        rect(ctx, 1, 8, 1, 2, "#5c6370");
        rect(ctx, 14, 8, 1, 2, "#5c6370");
      }
      break;
    case "reviewer": // kính, chỉ thấy khi nhìn trước hoặc nghiêng
      if (view === "front") {
        for (const lx of [4, 9]) {
          rect(ctx, lx, 6, 3, 1, OUTLINE);
          rect(ctx, lx, 9, 3, 1, OUTLINE);
          rect(ctx, lx, 7, 1, 2, OUTLINE);
          rect(ctx, lx + 2, 7, 1, 2, OUTLINE);
        }
        rect(ctx, 7, 7, 2, 1, OUTLINE);
      } else if (view === "side") {
        rect(ctx, 10, 6, 3, 1, OUTLINE);
        rect(ctx, 10, 9, 3, 1, OUTLINE);
        rect(ctx, 10, 7, 1, 2, OUTLINE);
        rect(ctx, 12, 7, 1, 2, OUTLINE);
        rect(ctx, 7, 7, 3, 1, OUTLINE);
      }
      break;
    case "designer": {
      // mũ nồi
      const x = view === "side" ? 4 : 3;
      rect(ctx, x + 1, 0, 8, 1, OUTLINE);
      rect(ctx, x, 1, 10, 2, "#c0392b");
      rect(ctx, x, 3, 10, 1, "#8e2a20");
      rect(ctx, x + 4, 0, 2, 1, "#c0392b");
      break;
    }
  }
}

function paint(ctx: Ctx, look: Look, pose: Pose, view: View, frame: number): void {
  const pal: Record<string, string> = {
    O: OUTLINE,
    H: look.hair,
    h: shade(look.hair, 0.72),
    S: SKIN,
    s: SKIN_SHADE,
    E: "#2b1d14",
    T: look.shirt,
    t: look.shirtDark,
    P: "#3d4a6b",
    p: "#2a2230",
    W: "#f4efe4",
  };
  const head = pose === "lie" ? HEAD.sleep : HEAD[view];
  const hairView: View = pose === "lie" ? "front" : view;
  if (pose === "walk") drawGrid(ctx, WALK[view][frame % 4], pal, 0, BODY_Y);
  if (pose === "sitBack") {
    drawGrid(ctx, TYPING[frame % 2], pal, 0, 8);
    drawGrid(ctx, SIT_BACK, pal, 0, BODY_Y);
  }
  if (pose === "sitSide") drawGrid(ctx, SIT_SIDE[frame % 2], pal, 0, BODY_Y);
  if (pose === "lie") drawGrid(ctx, LIE, pal, 0, BODY_Y);
  drawGrid(ctx, head, pal, HEAD_X, HEAD_Y);
  for (const layer of HAIR[hairView][look.style % 4]) drawGrid(ctx, layer.rows, pal, HEAD_X, HEAD_Y + layer.dy);
  if (pose === "sitSide" && frame % 2 === 1) drawGrid(ctx, SIP, pal, 0, 8);
  drawAccessory(ctx, look.role, hairView, pose);
}

// Sprite quay phải; quay trái thì lật ngang.
function sprite(look: Look, pose: Pose, view: View, frame: number, mirror: boolean): HTMLCanvasElement {
  const key = `${pose}|${view}|${frame}|${look.style}|${look.hair}|${look.shirt}|${look.role}|${mirror ? "m" : ""}`;
  return cached(key, W, H, (ctx) => {
    if (!mirror) return paint(ctx, look, pose, view, frame);
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite(look, pose, view, frame, false), 0, 0);
  });
}

const VIEW_OF: Record<Dir, View> = { down: "front", up: "back", left: "side", right: "side" };

// Nhân vật đi bộ, (x, y) là điểm giữa bàn chân.
export function drawWalker(ctx: Ctx, look: Look, x: number, y: number, dir: Dir, frame: number, alpha = 1): void {
  const px = Math.round(x);
  const py = Math.round(y);
  ctx.globalAlpha = alpha;
  rect(ctx, px - 5, py - 2, 10, 2, "rgba(20,10,20,0.25)"); // bóng
  ctx.drawImage(sprite(look, "walk", VIEW_OF[dir], frame, dir === "left"), px - W / 2, py - H);
  ctx.globalAlpha = 1;
}

// Ngồi bàn quay lưng, (cx, bottom) là giữa vai dưới cùng.
export function drawSeatedBack(ctx: Ctx, look: Look, cx: number, bottom: number, t: number, phase: number): void {
  const frame = Math.floor(t / 120 + phase) % 2;
  ctx.drawImage(sprite(look, "sitBack", "back", frame, false), cx - W / 2, bottom - 17);
}

// Ngồi sofa nhìn nghiêng về phía bàn trà, thỉnh thoảng nâng cốc.
export function drawSofaSitter(ctx: Ctx, look: Look, s: Sofa, t: number, phase: number): void {
  const sip = Math.floor(t / 1400 + phase) % 3 === 0 ? 1 : 0;
  const right = s.facing === "right";
  const x = right ? s.x - 2 : s.x + s.w - W + 2; // lưng sát lưng tựa sofa
  ctx.drawImage(sprite(look, "sitSide", "side", sip, !right), x, s.y + 3);
}

// Nằm ngủ trên sofa, có gối và chữ Z bay lên.
export function drawSleeper(ctx: Ctx, look: Look, s: Sofa, t: number, phase: number): void {
  const x = s.x + Math.floor(s.w / 2) - W / 2;
  rect(ctx, s.x + 2, s.y + 2, s.w - 4, 5, OUTLINE);
  rect(ctx, s.x + 3, s.y + 3, s.w - 6, 3, "#ece6d8"); // gối
  ctx.drawImage(sprite(look, "lie", "front", 0, false), x, s.y + 1);
  drawZ(ctx, s.x + s.w - 2, s.y + 2, t, phase);
}

export function drawZ(ctx: Ctx, x: number, y: number, t: number, phase: number): void {
  for (let i = 0; i < 3; i++) {
    const k = (((t / 900 + i / 3 + phase) % 1) + 1) % 1;
    glyph(ctx, "Z", Math.round(x + i * 2 + k * 6), Math.round(y - k * 16), `rgba(235,240,255,${1 - k})`);
  }
}
