// Bảng hạn mức trên tường phòng: mỗi cửa sổ một hàng (nhãn 5H/WK, thanh tô theo mức, phần trăm);
// phòng không công bố hạn mức hiện `?` kèm gói.

import { type WorkerUsage, usageLevel, usagePercent, usageWindows } from "../usage";
import { glyphChars, text, textWidth } from "./font";
import { USAGE } from "./palette";
import { type Ctx, type Rect, outlineRect, rect } from "./pixel";

const ROW_H = 5; // cao chữ pixel và thanh
const ROW_GAP = 1;
const PAD = 2;

// Cắt chuỗi từ cuối cho vừa bề rộng, để gói dài không tràn khỏi bảng.
function fit(s: string, maxW: number): string {
  let chars = glyphChars(s);
  while (chars.length && textWidth(chars.join("")) > maxW) chars = chars.slice(0, -1);
  return chars.join("").trimEnd();
}

export function drawUsageBoard(ctx: Ctx, r: Rect, usage: WorkerUsage | null, t: number): void {
  if (!usage) return;
  const rows = usageWindows(usage);
  outlineRect(ctx, r.x, r.y, r.w, r.h, USAGE.board, USAGE.frame);
  const inner = r.w - PAD * 2;

  if (!rows.length) {
    const label = fit(usage.plan ? `? ${usage.plan}` : "?", inner);
    text(ctx, label, r.x + PAD, r.y + Math.floor((r.h - ROW_H) / 2), USAGE.unknown);
    return;
  }

  const labelW = Math.max(...rows.map((w) => textWidth(w.label)));
  const pctW = textWidth("100%");
  const barX = r.x + PAD + labelW + 2;
  const barW = r.x + r.w - PAD - pctW - 2 - barX;
  const blockH = rows.length * ROW_H + (rows.length - 1) * ROW_GAP;
  let y = r.y + Math.floor((r.h - blockH) / 2);
  for (const w of rows) {
    const pct = usagePercent(w.used_percent);
    const color = USAGE[usageLevel(w.used_percent)];
    text(ctx, w.label, r.x + PAD, y, USAGE.text);
    if (barW > 2) {
      outlineRect(ctx, barX, y, barW, ROW_H, USAGE.track, USAGE.frame);
      const fillW = Math.round(((barW - 2) * pct) / 100);
      // chạm 100% thì thanh nhấp nháy để thấy phòng sắp/đang bị khoá
      const blink = pct >= 100 && Math.floor(t / 500) % 2 === 1;
      if (fillW > 0 && !blink) rect(ctx, barX + 1, y + 1, fillW, ROW_H - 2, color);
    }
    const label = `${pct}%`;
    text(ctx, label, r.x + r.w - PAD - textWidth(label), y, color);
    y += ROW_H + ROW_GAP;
  }
}
