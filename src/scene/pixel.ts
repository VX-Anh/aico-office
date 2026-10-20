// Hàm vẽ pixel cơ bản: hình chữ nhật, viền tối 1px, lưới ký tự và cache bitmap.

export type Ctx = CanvasRenderingContext2D;

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const OUTLINE = "#21181f";

export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

// Khối có viền tối 1px quanh đồ vật.
export function outlineRect(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, outline = OUTLINE): void {
  rect(ctx, x, y, w, h, outline);
  if (w > 2 && h > 2) rect(ctx, x + 1, y + 1, w - 2, h - 2, fill);
}

// Lưới ký tự: mỗi ký tự là một pixel, màu tra trong palette; "." hoặc ký tự lạ là trong suốt.
export function drawGrid(ctx: Ctx, rows: readonly string[], palette: Record<string, string>, x: number, y: number): void {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const color = palette[row[dx]];
      if (color) rect(ctx, x + dx, y + dy, 1, 1, color);
    }
  });
}

export function mirrorGrid(rows: readonly string[]): string[] {
  return rows.map((row) => [...row].reverse().join(""));
}

// Bitmap vẽ một lần rồi dùng lại (sprite nhân vật), tránh vẽ lại từng pixel mỗi frame.
const bitmaps = new Map<string, HTMLCanvasElement>();

export function cached(key: string, w: number, h: number, paint: (ctx: Ctx) => void): HTMLCanvasElement {
  let canvas = bitmaps.get(key);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext("2d")!;
    c.imageSmoothingEnabled = false;
    paint(c);
    bitmaps.set(key, canvas);
  }
  return canvas;
}

// Làm tối/sáng màu hex theo hệ số (f < 1 tối hơn).
export function shade(hex: string, f: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((ch) => ch + ch).join("");
  const n = parseInt(h, 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export function hashId(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

// Lệch pha animation theo id để các nhân vật không cử động đồng loạt.
export function hashPhase(id: string): number {
  return (hashId(id) % 1000) / 100;
}
