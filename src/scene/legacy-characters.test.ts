import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Look } from "./characters";
import { type Pose, type View, legacySprite } from "./legacy-characters";
import { C, ROLE_STYLES } from "./palette";

// Canvas giả: mỗi canvas giữ danh sách fillRect của chính nó, nên bitmap lấy từ cache vẫn so được.
interface Fill { color: string; x: number; y: number; w: number; h: number }
interface FakeCanvas { width: number; height: number; fills: Fill[]; getContext: () => unknown }

function makeCanvas(): FakeCanvas {
  const fills: Fill[] = [];
  const ctx = {
    fillStyle: "",
    imageSmoothingEnabled: true,
    fillRect(x: number, y: number, w: number, h: number) { fills.push({ color: ctx.fillStyle, x, y, w, h }); },
    translate() {},
    scale() {},
    drawImage() {},
  };
  return { width: 0, height: 0, fills, getContext: () => ctx };
}

beforeAll(() => {
  vi.stubGlobal("document", { createElement: () => makeCanvas() });
});

const base: Look = { hair: "#22262b", style: 0, shirt: "#8a8f98", shirtDark: "#62666d", role: null };

// Ảnh cuối cùng theo từng pixel, để so được dù thứ tự vẽ khác nhau.
function pixels(role: string | null, pose: Pose, view: View, frame = 0): Map<string, string> {
  const canvas = legacySprite({ ...base, role }, pose, view, frame, false) as unknown as FakeCanvas;
  const out = new Map<string, string>();
  for (const f of canvas.fills) {
    for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) out.set(`${x},${y}`, f.color);
  }
  return out;
}

function diff(a: Map<string, string>, b: Map<string, string>): string[] {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].filter((k) => a.get(k) !== b.get(k));
}

const NEW_ROLES = ["ba", "tester", "researcher"] as const;

describe("phụ kiện vai trò mới ở sprite dự phòng", () => {
  for (const role of NEW_ROLES) {
    it(`${role}: có phụ kiện màu accent ở front và side, không vẽ ở back và lie`, () => {
      for (const view of ["front", "side"] as const) {
        for (const frame of [0, 1, 2, 3]) {
          const changed = diff(pixels(role, "walk", view, frame), pixels(null, "walk", view, frame));
          expect(changed.length).toBeGreaterThan(0);
          expect([...pixels(role, "walk", view, frame).values()]).toContain(ROLE_STYLES[role].accent);
        }
      }
      expect(diff(pixels(role, "sitSide", "side", 0), pixels(null, "sitSide", "side", 0)).length).toBeGreaterThan(0);
      for (const frame of [0, 1, 2, 3]) expect(diff(pixels(role, "walk", "back", frame), pixels(null, "walk", "back", frame))).toEqual([]);
      expect(diff(pixels(role, "sitBack", "back", 0), pixels(null, "sitBack", "back", 0))).toEqual([]);
      expect(diff(pixels(role, "lie", "front", 0), pixels(null, "lie", "front", 0))).toEqual([]);
    });
  }

  it("phụ kiện không đè lên đầu (y 2–11) ở front và side", () => {
    for (const role of NEW_ROLES) {
      for (const view of ["front", "side"] as const) {
        const changed = diff(pixels(role, "walk", view), pixels(null, "walk", view));
        expect(changed.every((k) => Number(k.split(",")[1]) >= 12)).toBe(true);
      }
    }
  });

  it("ngồi sofa không che cốc ở frame nâng cốc", () => {
    for (const role of NEW_ROLES) {
      const sip = pixels(null, "sitSide", "side", 1);
      const cup = [...sip].filter(([, c]) => c === C.paper).map(([k]) => k);
      expect(cup.length).toBeGreaterThan(0);
      const changed = new Set(diff(pixels(role, "sitSide", "side", 1), sip));
      expect(cup.filter((k) => changed.has(k))).toEqual([]);
    }
  });

  it("coder vẫn có tai nghe ở back", () => {
    expect(diff(pixels("coder", "walk", "back"), pixels(null, "walk", "back")).length).toBeGreaterThan(0);
  });

  it("vai trò lạ không có phụ kiện", () => {
    for (const view of ["front", "side", "back"] as const) {
      expect(diff(pixels("foo", "walk", view), pixels(null, "walk", view))).toEqual([]);
    }
  });
});
