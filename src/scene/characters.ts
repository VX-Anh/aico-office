// Nhân vật chibi 16x22 vẽ từ công thức Pixelbolt trong art/characters/ (thân, tóc theo kiểu, phụ kiện theo vai trò),
// thay khoá màu theo Look và cache bitmap. Tư thế thiếu trong công thức thì dùng sprite lưới cũ (legacy-characters.ts).

import type { WorkerAgent } from "../api";
import { glyph } from "./font";
import type { Sofa } from "./layout";
import type { Dir } from "./pathing";
import { type Pose, type View, legacySprite } from "./legacy-characters";
import { HAIR_COLORS, type Palette, ROLE_STYLES, SKIN, SKIN_SHADE, roleStyle } from "./palette";
import { type Ctx, OUTLINE, cached, hashId, rect, shade } from "./pixel";
import { type Colors, type Recipe, type RecipeFrame, animFrames, bitmap } from "./pixelbolt";

const W = 16;
const H = 22;

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

type Anim = "walk_down" | "walk_up" | "walk_left" | "walk_right" | "sit_back" | "sit_side" | "lie";

// Frame Pixelbolt gốc: lưới nằm trong ops (op grid đặt tại x, y), có thể nhỏ hơn khung.
interface RawFrame {
  name?: string;
  from?: string;
  palette?: Colors;
  rows?: string[];
  ops?: { op?: string; x?: number; y?: number; rows?: string[] }[];
}
interface RawRecipe extends Omit<Recipe, "frames"> {
  frames: RawFrame[] | Record<string, RawFrame>;
}

// Gộp các op grid của frame thành một lưới đủ khung để bộ đọc chỉ cần xử lý rows/from.
// Op khác grid được giữ tên để bộ đọc warn và bỏ frame.
function flattenFrame(f: RawFrame, w: number, h: number): RecipeFrame {
  if (!f.ops) return f;
  const out: RecipeFrame = { name: f.name, from: f.from, palette: f.palette };
  const bad = f.ops.find((o) => (o.op ?? "grid") !== "grid");
  if (bad) return { ...out, op: bad.op };
  const grid = Array.from({ length: h }, () => Array<string>(w).fill("."));
  for (const o of f.ops) {
    (o.rows ?? []).forEach((row, dy) => {
      const y = (o.y ?? 0) + dy;
      for (let dx = 0; dx < row.length; dx++) {
        const x = (o.x ?? 0) + dx;
        if (y >= 0 && y < h && x >= 0 && x < w && row[dx] !== "." && row[dx] !== " ") grid[y][x] = row[dx];
      }
    });
  }
  return { ...out, rows: grid.map((r) => r.join("")) };
}

function normalize(raw: RawRecipe): Recipe {
  const w = raw.width ?? W;
  const h = raw.height ?? H;
  const frames = Array.isArray(raw.frames)
    ? raw.frames.map((f) => flattenFrame(f, w, h))
    : Object.fromEntries(Object.entries(raw.frames).map(([k, f]) => [k, flattenFrame(f, w, h)]));
  return { ...raw, frames };
}

// Công thức nạp lúc build, khoá theo đường dẫn trong art/characters: "body", "hair/style0", "acc/coder".
const RECIPES: Record<string, Recipe> = Object.fromEntries(
  Object.entries(import.meta.glob<RawRecipe>("../../art/characters/**/*.pixel.json", { eager: true, import: "default" })).map(
    ([path, raw]) => [path.replace(/^.*\/art\/characters\//, "").replace(/\.pixel\.json$/, ""), normalize(raw)],
  ),
);

// Tư thế tương ứng của sprite cũ khi công thức thân thiếu animation.
const LEGACY: Record<Anim, { pose: Pose; view: View }> = {
  walk_down: { pose: "walk", view: "front" },
  walk_up: { pose: "walk", view: "back" },
  walk_left: { pose: "walk", view: "side" },
  walk_right: { pose: "walk", view: "side" },
  sit_back: { pose: "sitBack", view: "back" },
  sit_side: { pose: "sitSide", view: "side" },
  lie: { pose: "lie", view: "front" },
};

function has(id: string, anim: Anim): boolean {
  const r = RECIPES[id];
  return !!r && !!animFrames(r, anim);
}

// Khoá màu thay theo agent: h/H tóc, s/S da, t/T áo, o viền, a phụ kiện theo vai trò.
function colorsOf(look: Look): Colors {
  const colors: Colors = {
    h: look.hair,
    H: shade(look.hair, 0.72),
    s: SKIN,
    S: SKIN_SHADE,
    t: look.shirt,
    T: look.shirtDark,
    o: OUTLINE,
  };
  const role = look.role ? ROLE_STYLES[look.role] : undefined;
  if (role) colors.a = role.accent;
  return colors;
}

// Chồng lớp thân → tóc theo kiểu → phụ kiện theo vai trò. Sprite quay phải; mirror thì lật ngang.
function sprite(look: Look, anim: Anim, frame: number, mirror: boolean): HTMLCanvasElement {
  if (!has("body", anim)) {
    if (anim === "walk_left" && has("body", "walk_right")) return sprite(look, "walk_right", frame, !mirror);
    const { pose, view } = LEGACY[anim];
    return legacySprite(look, pose, view, frame, mirror !== (anim === "walk_left"));
  }
  const n = animFrames(RECIPES.body, anim)!.length;
  const f = ((frame % n) + n) % n;
  const key = `pb|${anim}|${f}|${look.style}|${look.hair}|${look.shirt}|${look.role}|${mirror ? "m" : ""}`;
  return cached(key, W, H, (ctx) => {
    if (mirror) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(sprite(look, anim, f, false), 0, 0);
      return;
    }
    const colors = colorsOf(look);
    const layers = ["body", `hair/style${look.style % 4}`];
    if (look.role) layers.push(`acc/${look.role}`);
    for (const id of layers) {
      if (!has(id, anim)) continue;
      const bmp = bitmap(id, RECIPES[id], anim, f, colors);
      if (bmp) ctx.drawImage(bmp, 0, 0);
    }
  });
}

const WALK_ANIM: Record<Dir, Anim> = { down: "walk_down", up: "walk_up", left: "walk_left", right: "walk_right" };

// Nhân vật đi bộ, (x, y) là điểm giữa bàn chân.
export function drawWalker(ctx: Ctx, look: Look, x: number, y: number, dir: Dir, frame: number, alpha = 1): void {
  const px = Math.round(x);
  const py = Math.round(y);
  ctx.globalAlpha = alpha;
  rect(ctx, px - 5, py - 2, 10, 2, "rgba(20,10,20,0.25)"); // bóng
  ctx.drawImage(sprite(look, WALK_ANIM[dir], frame, false), px - W / 2, py - H);
  ctx.globalAlpha = 1;
}

// Ngồi bàn quay lưng, (cx, bottom) là giữa vai dưới cùng.
export function drawSeatedBack(ctx: Ctx, look: Look, cx: number, bottom: number, t: number, phase: number): void {
  const frame = Math.floor(t / 120 + phase) % 2;
  ctx.drawImage(sprite(look, "sit_back", frame, false), cx - W / 2, bottom - 17);
}

// Ngồi sofa nhìn nghiêng về phía bàn trà, thỉnh thoảng nâng cốc.
export function drawSofaSitter(ctx: Ctx, look: Look, s: Sofa, t: number, phase: number): void {
  const sip = Math.floor(t / 1400 + phase) % 3 === 0 ? 1 : 0;
  const right = s.facing === "right";
  const x = right ? s.x - 2 : s.x + s.w - W + 2; // lưng sát lưng tựa sofa
  ctx.drawImage(sprite(look, "sit_side", sip, !right), x, s.y + 3);
}

// Nằm ngủ trên sofa, có gối và chữ Z bay lên.
export function drawSleeper(ctx: Ctx, look: Look, s: Sofa, t: number, phase: number): void {
  const x = s.x + Math.floor(s.w / 2) - W / 2;
  rect(ctx, s.x + 2, s.y + 2, s.w - 4, 5, OUTLINE);
  rect(ctx, s.x + 3, s.y + 3, s.w - 6, 3, "#ece6d8"); // gối
  ctx.drawImage(sprite(look, "lie", 0, false), x, s.y + 1);
  drawZ(ctx, s.x + s.w - 2, s.y + 2, t, phase);
}

export function drawZ(ctx: Ctx, x: number, y: number, t: number, phase: number): void {
  for (let i = 0; i < 3; i++) {
    const k = (((t / 900 + i / 3 + phase) % 1) + 1) % 1;
    glyph(ctx, "Z", Math.round(x + i * 2 + k * 6), Math.round(y - k * 16), `rgba(235,240,255,${1 - k})`);
  }
}
