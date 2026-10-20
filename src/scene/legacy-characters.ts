// Sprite nhân vật cũ vẽ bằng lưới ký tự viết tay, dùng khi công thức Pixelbolt thiếu tư thế.
// Ký tự: O viền, H/h tóc, S/s da, E mắt, T/t áo, P quần, p giày, W cốc; "." trong suốt.

import type { Look } from "./characters";
import { SKIN, SKIN_SHADE } from "./palette";
import { type Ctx, OUTLINE, cached, drawGrid, mirrorGrid, rect, shade } from "./pixel";

const W = 16;
const H = 22;
const HEAD_X = 2;
const HEAD_Y = 2;
const BODY_Y = 12;

export type View = "front" | "back" | "side";
export type Pose = "walk" | "sitBack" | "sitSide" | "lie";

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
export function legacySprite(look: Look, pose: Pose, view: View, frame: number, mirror: boolean): HTMLCanvasElement {
  const key = `legacy|${pose}|${view}|${frame}|${look.style}|${look.hair}|${look.shirt}|${look.role}|${mirror ? "m" : ""}`;
  return cached(key, W, H, (ctx) => {
    if (!mirror) return paint(ctx, look, pose, view, frame);
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(legacySprite(look, pose, view, frame, false), 0, 0);
  });
}
