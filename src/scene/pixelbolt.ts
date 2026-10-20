// Bộ đọc công thức Pixelbolt (.pixel.json) tối giản: palette, frames (op grid, from), animations.
// Chỉ hỗ trợ op "grid"; "." hoặc dấu cách là trong suốt. Công thức hỏng thì warn một lần và bỏ qua frame, không throw.

import { type Ctx, cached, drawGrid } from "./pixel";

export type Colors = Record<string, string>;

export interface RecipeFrame {
  name?: string;
  op?: string;
  rows?: string[];
  from?: string;
  palette?: Colors;
}

export interface RecipeAnimation {
  frames: string[];
  fps?: number;
  loop?: boolean;
}

export interface Recipe {
  name?: string;
  width?: number;
  height?: number;
  palette?: Colors;
  // Pixelbolt cho phép frames dạng object (tên → frame) hoặc mảng frame có trường name.
  frames: Record<string, RecipeFrame> | RecipeFrame[];
  animations?: Record<string, RecipeAnimation | string[]>;
}

interface Resolved {
  rows: string[];
  palette: Colors;
}

const TRANSPARENT = new Set([".", " "]);
const warned = new Set<string>();

function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[pixelbolt] ${msg}`);
}

function label(recipe: Recipe): string {
  return recipe.name ?? "recipe";
}

function frameSpec(recipe: Recipe, name: string): RecipeFrame | undefined {
  const frames = recipe.frames;
  if (Array.isArray(frames)) return frames.find((f) => f && f.name === name);
  if (frames && Object.prototype.hasOwnProperty.call(frames, name)) return frames[name];
  return undefined;
}

function frameNames(recipe: Recipe): string[] {
  const frames = recipe.frames;
  if (Array.isArray(frames)) return frames.flatMap((f) => (f && typeof f.name === "string" ? [f.name] : []));
  return frames ? Object.keys(frames) : [];
}

// Kích thước chuẩn của công thức: width/height khai báo, nếu không có thì lấy frame đầu tiên đọc được.
function recipeSize(recipe: Recipe): { w: number; h: number } | null {
  if (recipe.width && recipe.height) return { w: recipe.width, h: recipe.height };
  for (const name of frameNames(recipe)) {
    const r = resolve(recipe, name, [], false);
    if (r) return { w: r.rows[0]?.length ?? 0, h: r.rows.length };
  }
  return null;
}

// Đè ô không trong suốt của rows lên base (cùng kích thước).
function overlay(base: readonly string[], rows: readonly string[]): string[] {
  return base.map((row, y) => {
    const top = rows[y];
    let out = "";
    for (let x = 0; x < row.length; x++) {
      const ch = top[x];
      out += TRANSPARENT.has(ch) ? row[x] : ch;
    }
    return out;
  });
}

const resolvedCache = new WeakMap<Recipe, Map<string, Resolved | null>>();

function resolve(recipe: Recipe, name: string, stack: string[], checkSize: boolean): Resolved | null {
  let memo = resolvedCache.get(recipe);
  if (!memo) {
    memo = new Map();
    resolvedCache.set(recipe, memo);
  }
  const memoKey = `${checkSize ? 1 : 0}:${name}`;
  if (memo.has(memoKey)) return memo.get(memoKey)!;

  const result = resolveUncached(recipe, name, stack, checkSize);
  // Không ghi nhớ kết quả giữa chừng của vòng lặp: frame trong vòng lặp đều hỏng, nhưng chỉ chắc khi gọi từ gốc.
  if (stack.length === 0) memo.set(memoKey, result);
  return result;
}

function resolveUncached(recipe: Recipe, name: string, stack: string[], checkSize: boolean): Resolved | null {
  const id = `${label(recipe)}/${name}`;
  if (stack.includes(name)) {
    warnOnce(`${id}: vòng lặp from (${[...stack, name].join(" → ")})`);
    return null;
  }
  const spec = frameSpec(recipe, name);
  if (!spec || typeof spec !== "object") {
    warnOnce(`${id}: không có frame`);
    return null;
  }
  const op = spec.op ?? "grid";
  if (op !== "grid") {
    warnOnce(`${id}: op lạ "${op}"`);
    return null;
  }
  const rows = spec.rows;
  if (rows !== undefined && (!Array.isArray(rows) || rows.some((r) => typeof r !== "string"))) {
    warnOnce(`${id}: rows phải là mảng chuỗi`);
    return null;
  }

  let base: Resolved | null = null;
  if (spec.from !== undefined) {
    base = resolve(recipe, spec.from, [...stack, name], false);
    if (!base) {
      warnOnce(`${id}: from "${spec.from}" không đọc được`);
      return null;
    }
  }
  if (!base && !rows) {
    warnOnce(`${id}: thiếu rows`);
    return null;
  }

  let out: string[];
  if (rows && rows.length > 0) {
    const w = rows[0].length;
    if (rows.some((r) => r.length !== w)) {
      warnOnce(`${id}: các hàng dài không đều`);
      return null;
    }
    if (base && (base.rows.length !== rows.length || (base.rows[0]?.length ?? 0) !== w)) {
      warnOnce(`${id}: kích thước khác frame gốc "${spec.from}"`);
      return null;
    }
    out = base ? overlay(base.rows, rows) : [...rows];
  } else if (base) {
    out = [...base.rows];
  } else {
    warnOnce(`${id}: rows rỗng`);
    return null;
  }

  if (checkSize) {
    const size = recipeSize(recipe);
    if (size && (out.length !== size.h || (out[0]?.length ?? 0) !== size.w)) {
      warnOnce(`${id}: kích thước ${out[0]?.length ?? 0}x${out.length}, cần ${size.w}x${size.h}`);
      return null;
    }
  }

  return { rows: out, palette: { ...(base?.palette ?? {}), ...(spec.palette ?? {}) } };
}

// Lưới đã gộp from của một frame; null nếu frame hỏng (đã warn).
export function resolveFrame(recipe: Recipe, name: string): string[] | null {
  return resolve(recipe, name, [], true)?.rows ?? null;
}

// Danh sách tên frame của animation; null nếu không có hoặc có frame hỏng.
export function animFrames(recipe: Recipe, anim: string): string[] | null {
  const a = recipe.animations?.[anim];
  if (!a) return null;
  const frames = Array.isArray(a) ? a : a.frames;
  if (!Array.isArray(frames) || frames.length === 0 || frames.some((f) => typeof f !== "string")) {
    warnOnce(`${label(recipe)}: animation "${anim}" không có frame`);
    return null;
  }
  for (const f of frames) if (!resolveFrame(recipe, f)) return null;
  return frames;
}

// Vẽ frame thứ `frame` (lấy theo vòng) của animation. colors đè lên palette công thức (khoá h/H, s/S, t/T, a, o).
// Trả false nếu không vẽ được.
export function drawRecipeFrame(ctx: Ctx, recipe: Recipe, anim: string, frame: number, colors: Colors, x = 0, y = 0): boolean {
  const frames = animFrames(recipe, anim);
  if (!frames) return false;
  const n = frames.length;
  const name = frames[((Math.floor(frame) % n) + n) % n];
  const r = resolve(recipe, name, [], true);
  if (!r) return false;
  drawGrid(ctx, r.rows, { ...(recipe.palette ?? {}), ...r.palette, ...colors }, x, y);
  return true;
}

function colorsKey(colors: Colors): string {
  return Object.keys(colors)
    .sort()
    .map((k) => `${k}=${colors[k]}`)
    .join(",");
}

// Bitmap của một frame, cache theo (id công thức, animation, frame, bộ màu). null nếu công thức thiếu/hỏng.
export function bitmap(id: string, recipe: Recipe, anim: string, frame: number, colors: Colors): HTMLCanvasElement | null {
  const frames = animFrames(recipe, anim);
  if (!frames) return null;
  const n = frames.length;
  const index = ((Math.floor(frame) % n) + n) % n;
  const rows = resolveFrame(recipe, frames[index])!;
  const w = rows[0]?.length ?? 0;
  const h = rows.length;
  const key = `pb:${id}:${anim}:${index}:${colorsKey(colors)}`;
  return cached(key, w, h, (ctx) => {
    drawRecipeFrame(ctx, recipe, anim, index, colors);
  });
}
