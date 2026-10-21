// Avatar nhỏ cho thanh bên: cắt phần đầu + vai từ sprite nhân vật trong cảnh (drawWalker, agentLook),
// chỉ đọc từ src/scene. Bitmap cache theo id + vai trò; vẽ lỗi thì dùng ô màu vai trò.

import type { WorkerAgent } from "../api";
import { agentLook, drawWalker } from "../scene/characters";
import { roleStyle } from "../scene/palette";

// Sprite 16x22, lấy 16 hàng trên (đầu, tóc, áo) cho vừa ô vuông.
const SIZE = 16;
const bitmaps = new Map<string, HTMLCanvasElement | null>();

function avatarKey(agent: Pick<WorkerAgent, "id" | "role">): string {
  return JSON.stringify([agent.id, agent.role]);
}

function bitmapOf(agent: WorkerAgent): HTMLCanvasElement | null {
  const key = avatarKey(agent);
  if (bitmaps.has(key)) return bitmaps.get(key)!;
  let out: HTMLCanvasElement | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      // (x, y) là điểm giữa bàn chân: đặt sao cho đỉnh sprite trùng mép trên.
      drawWalker(ctx, agentLook(agent), SIZE / 2, 22, "down", 0);
      out = canvas;
    }
  } catch {
    out = null;
  }
  // Ghi cả kết quả lỗi để không thử vẽ lại mỗi giây.
  bitmaps.set(key, out);
  return out;
}

function fallback(agent: Pick<WorkerAgent, "role">): HTMLElement {
  const style = roleStyle(agent.role);
  const node = document.createElement("span");
  node.className = "avatar avatar-fallback";
  node.style.background = style.shirt;
  node.textContent = Array.from(style.label)[0]?.toUpperCase() ?? "?";
  return node;
}

// Mỗi dòng cần node riêng (một canvas không nằm được hai chỗ) nên chép từ bitmap đã cache.
export function createAvatar(agent: WorkerAgent): HTMLElement {
  const source = bitmapOf(agent);
  if (!source) return fallback(agent);
  try {
    const node = document.createElement("canvas");
    node.width = SIZE;
    node.height = SIZE;
    node.className = "avatar";
    node.setAttribute("aria-hidden", "true");
    const ctx = node.getContext("2d");
    if (!ctx) return fallback(agent);
    ctx.drawImage(source, 0, 0);
    return node;
  } catch {
    return fallback(agent);
  }
}

// Dòng agent giữ avatar cũ khi chỉ activity đổi; vai trò đổi thì vẽ lại.
export function avatarIdentity(agent: Pick<WorkerAgent, "id" | "role">): string {
  return avatarKey(agent);
}
