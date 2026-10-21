// Ánh sáng nhận giờ từ nơi gọi; cache chỉ giữ lightmap gần nhất để không tăng bộ nhớ theo thời gian.
import type { WorkerStatus } from "../api";
import type { Screen } from "./furniture";
import type { Layout } from "./layout";
import { C, SCREEN } from "./palette";
import type { Pt, Rect } from "./pixel";

export function parseHour(hour: string | null | undefined): number | null {
  if (typeof hour !== "string" || !/^\d{2}:\d{2}$/.test(hour)) return null;
  const [h, m] = hour.split(":").map(Number);
  return h < 24 && m < 60 ? h * 60 + m : null;
}

// `hour` hợp lệ thì ghi đè; sai hoặc vắng thì lấy giờ địa phương của `now`. Không đụng đồng hồ cảnh.
export function lightingMinutes(now: number, hour: string | null | undefined): number {
  const parsed = parseHour(hour ?? null);
  if (parsed !== null) return parsed;
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return 0;
  return date.getHours() * 60 + date.getMinutes();
}

export function normalizeMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) throw new RangeError("Phút địa phương phải hữu hạn");
  return ((minutes % 1440) + 1440) % 1440;
}

// Bình minh 05:00–07:00, hoàng hôn 17:00–19:00; vòng qua nửa đêm liên tục.
export function brightnessAt(minutes: number): number {
  const m = normalizeMinutes(minutes);
  if (m < 300 || m >= 1140) return 0;
  if (m < 420) return (m - 300) / 120;
  if (m < 1020) return 1;
  return (1140 - m) / 120;
}

export interface LightSource extends Pt {
  radius: number;
  strength: number;
  color: string;
}

export interface LightingRoom extends Rect {
  state: WorkerStatus["state"];
  agents: number;
}

export interface LightingInput {
  width: number;
  height: number;
  minutes: number;
  rooms: readonly LightingRoom[];
  sources: readonly LightSource[];
}

export interface MonitorLight extends Pt {
  state: WorkerStatus["state"];
  screen: Screen;
}

// Truyền chính screen đã vẽ, kể cả màn hình chờ đang bật; màn hình tắt không có quầng.
export function monitorLight(monitor: MonitorLight): LightSource | null {
  if (monitor.screen === "off" || monitor.state === "offline" || monitor.state === "limited") return null;
  return { x: monitor.x, y: monitor.y, radius: 22, strength: 0.65, color: SCREEN.codeLine };
}

// Renderer có thể truyền nguồn màn hình thực tế và đèn đường từ OutdoorLayout, không phụ thuộc module ngoại cảnh.
export function lightingInput(layout: Layout, minutes: number, sources: readonly LightSource[]): LightingInput {
  return {
    width: layout.width, height: layout.height, minutes, sources,
    rooms: layout.rooms.map((room) => ({
      x: room.x, y: room.y, w: room.w, h: room.h,
      state: room.worker.state, agents: room.agents.length,
    })),
  };
}

export function lightingKey(input: LightingInput): string {
  const rooms = input.rooms.map((r) => [r.x, r.y, r.w, r.h, r.state, r.agents]);
  // Thứ tự nguồn không làm thay đổi ánh sáng (lighter có tính giao hoán).
  const sources = input.sources.map((s) => JSON.stringify([s.x, s.y, s.radius, s.strength, s.color])).sort();
  return JSON.stringify([input.width, input.height, Math.floor(normalizeMinutes(input.minutes) / 5), rooms, sources]);
}

export interface LightmapCanvas {
  width: number;
  height: number;
  getContext(contextId: "2d"): CanvasRenderingContext2D | null;
}

export function paintLightmap(ctx: CanvasRenderingContext2D, input: LightingInput): void {
  const day = brightnessAt(Math.floor(normalizeMinutes(input.minutes) / 5) * 5);
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, input.width, input.height);
  // Trắng giữ nguyên màu khi multiply; sắc xanh lấy từ bảng màu chung.
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, input.width, input.height);
  ctx.globalAlpha = (1 - day) * 0.8;
  ctx.fillStyle = C.roomWallShade;
  ctx.fillRect(0, 0, input.width, input.height);
  ctx.globalAlpha = 1;
  for (const room of input.rooms) {
    const active = room.state !== "offline" && room.state !== "limited" && room.agents > 0;
    ctx.fillStyle = "white";
    ctx.fillRect(room.x, room.y, room.w, room.h);
    ctx.globalAlpha = active ? (1 - day) * 0.08 : 0.25 + (1 - day) * 0.4;
    ctx.fillStyle = C.roomWallShade;
    ctx.fillRect(room.x, room.y, room.w, room.h);
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = "lighter";
  for (const source of input.sources) {
    if (source.radius <= 0 || source.strength <= 0 || day === 1) continue;
    const gradient = ctx.createRadialGradient(source.x, source.y, 0, source.x, source.y, source.radius);
    gradient.addColorStop(0, source.color);
    gradient.addColorStop(1, "transparent");
    ctx.globalAlpha = Math.min(1, source.strength) * (1 - day);
    ctx.fillStyle = gradient;
    ctx.fillRect(source.x - source.radius, source.y - source.radius, source.radius * 2, source.radius * 2);
  }
  ctx.restore();
}

export function createLightmapCache(createCanvas: () => LightmapCanvas = () => document.createElement("canvas")) {
  let canvas: LightmapCanvas | null = null;
  let key: string | null = null;
  return {
    get(input: LightingInput): LightmapCanvas | null {
      const next = lightingKey(input);
      if (canvas && key === next) return canvas;
      canvas ??= createCanvas();
      canvas.width = input.width;
      canvas.height = input.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      paintLightmap(ctx, input);
      key = next;
      return canvas;
    },
    draw(ctx: CanvasRenderingContext2D, input: LightingInput): void {
      const map = this.get(input);
      if (!map) return;
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(map as CanvasImageSource, 0, 0);
      ctx.restore();
    },
    reset(): void {
      canvas = null;
      key = null;
    },
  };
}
