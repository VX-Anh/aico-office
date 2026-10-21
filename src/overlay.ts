// Chữ dùng pixel màn hình để giữ dấu tiếng Việt sắc nét khi cảnh được phóng to.
import { type Bubble, bubbleFor, resolveBubbles, taskProgress, truncate } from "./activity";
import type { WorkerAgent } from "./api";
import { BUBBLE } from "./scene/palette";

// Nhận phần hình học của SceneFigure, không phụ thuộc vòng vẽ cảnh.
interface OverlayFigure {
  key: string;
  agent: WorkerAgent;
  working: boolean;
  x: number;
  headY: number;
  footY: number;
}

interface PlacedBubble {
  key: string;
  bubble: Bubble;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  at: number;
  headX: number;
  headY: number;
}

const FONT = '12px "Segoe UI", system-ui, sans-serif';
const HEIGHT = 26;
const PAD = 8;
const TAIL = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

function labelFor(ctx: CanvasRenderingContext2D, bubble: Bubble, compact: boolean, width: number): string {
  const text = compact ? "" : truncate(bubble.text);
  const points = Array.from(text);
  let label = text ? `${bubble.icon} ${text}` : bubble.icon;
  // Cảnh rất hẹp vẫn phải giữ toàn bộ chữ bên trong bong bóng.
  while (points.length && ctx.measureText(label).width > width - PAD * 2) {
    points.pop();
    label = points.length ? `${bubble.icon} ${points.join("")}…` : bubble.icon;
  }
  return label;
}

export function createOverlay(canvas: HTMLCanvasElement): {
  draw(figures: OverlayFigure[], sceneW: number, now: number): void;
} {
  const overlay = document.createElement("canvas");
  overlay.className = "activity-overlay";
  overlay.setAttribute("aria-hidden", "true");
  Object.assign(overlay.style, {
    position: "absolute",
    pointerEvents: "none",
    imageRendering: "auto",
  });
  canvas.insertAdjacentElement("afterend", overlay);
  const ctx = overlay.getContext("2d");

  return {
    draw(figures, sceneW, now): void {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      Object.assign(overlay.style, {
        left: `${canvas.offsetLeft + canvas.clientLeft}px`,
        top: `${canvas.offsetTop + canvas.clientTop}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
      const pixelsW = Math.round(width * dpr);
      const pixelsH = Math.round(height * dpr);
      if (overlay.width !== pixelsW) overlay.width = pixelsW;
      if (overlay.height !== pixelsH) overlay.height = pixelsH;
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      if (width <= 0 || height <= 0 || !Number.isFinite(sceneW) || sceneW <= 0) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = FONT;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.lineWidth = 1;
      const scale = width / sceneW;
      const active = figures.filter((figure) => figure.working);
      const placed: PlacedBubble[] = [];
      const maxWidth = Math.max(1, width - 2);
      for (const figure of active) {
        const bubble = bubbleFor(figure.agent, now);
        if (!bubble) continue;
        const label = labelFor(ctx, bubble, bubble.stale, maxWidth);
        const w = Math.min(maxWidth, ctx.measureText(label).width + PAD * 2);
        const h = Math.min(HEIGHT, Math.max(1, height - 2));
        const headX = clamp(figure.x * scale, 0, width);
        const headY = clamp(figure.headY * scale, 0, height);
        placed.push({
          key: figure.key, bubble, label, w, h, at: bubble.at, headX, headY,
          x: clamp(headX - w / 2, 1, width - w - 1),
          y: clamp(headY - h - TAIL, 1, height - h - 1),
        });
      }
      const compact = resolveBubbles(placed);
      // Bong bóng mới được vẽ sau để còn đọc được khi các icon vẫn sát nhau.
      placed.sort((a, b) => a.at - b.at || b.key.localeCompare(a.key));
      for (const item of placed) {
        const { bubble, h, headX, headY } = item;
        const label = compact.has(item.key) ? labelFor(ctx, bubble, true, maxWidth) : item.label;
        const w = Math.min(maxWidth, ctx.measureText(label).width + PAD * 2);
        const x = clamp(headX - w / 2, 1, width - w - 1);
        const y = item.y;
        ctx.save();
        ctx.globalAlpha = bubble.stale ? BUBBLE.staleAlpha : 1;
        ctx.fillStyle = BUBBLE.bg;
        ctx.strokeStyle = bubble.error ? BUBBLE.error : BUBBLE.border;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, Math.min(6, w / 2, h / 2));
        ctx.fill();
        ctx.stroke();
        if (headY > y + h) {
          const base = clamp(headX, x + Math.min(7, w / 2), x + w - Math.min(7, w / 2));
          ctx.beginPath();
          ctx.moveTo(base - Math.min(4, w / 4), y + h - 0.5);
          ctx.lineTo(headX, headY);
          ctx.lineTo(base + Math.min(4, w / 4), y + h - 0.5);
          ctx.fill();
          ctx.stroke();
        }
        ctx.fillStyle = BUBBLE.text;
        ctx.fillText(label, x + PAD, y + h / 2, Math.max(1, w - PAD * 2));
        ctx.restore();
      }
      for (const figure of active) {
        const progress = taskProgress(figure.agent);
        if (!progress) continue;
        const w = Math.min(44, maxWidth);
        const h = 17;
        const x = clamp(figure.x * scale - w / 2, 1, width - w - 1);
        const y = clamp(figure.footY * scale + 4, 1, height - h - 1);
        ctx.fillStyle = BUBBLE.barTrack;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = BUBBLE.bar;
        ctx.fillRect(x, y + h - 3, w * progress.done / progress.total, 3);
        ctx.fillStyle = BUBBLE.barText;
        ctx.textAlign = "center";
        ctx.fillText(`${progress.done}/${progress.total}`, x + w / 2, y + 7, Math.max(1, w - 4));
      }
    },
  };
}
