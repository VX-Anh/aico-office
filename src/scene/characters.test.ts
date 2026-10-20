// Giữ lỗi T-cff2d329 ở bước gộp ops của characters.ts, và kiểm mọi file art/ thay cho pixel_validate.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RawFrame, type RawRecipe, has, normalize } from "./characters";
import { type Recipe, animFrames, resolveFrame } from "./pixelbolt";

const W = 16;
const H = 22;
const ANIMS = ["walk_down", "walk_up", "walk_left", "walk_right", "sit_back", "sit_side", "lie"] as const;
const BLANK = Array.from({ length: H }, () => ".".repeat(W));

let seq = 0;
function raw(frames: RawFrame[]): RawRecipe {
  return { name: `chartest${seq++}`, width: W, height: H, frames, animations: { walk_down: ["a"] } };
}

describe("gộp ops của frame", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("đặt lưới nhỏ tại x, y trong khung 16×22", () => {
    const r = normalize(raw([{ name: "a", ops: [{ op: "grid", x: 2, y: 3, rows: ["ab", "cd"] }] }]));
    const out = resolveFrame(r, "a")!;
    expect(out).toHaveLength(H);
    expect(out.every((row) => row.length === W)).toBe(true);
    expect(out[3].slice(2, 4)).toBe("ab");
    expect(out[4].slice(2, 4)).toBe("cd");
    expect(animFrames(r, "walk_down")).toEqual(["a"]);
  });

  it("ops rỗng kèm from thì kế thừa frame gốc", () => {
    const base = BLANK.map((row, y) => (y === 5 ? "t" + row.slice(1) : row));
    const r = normalize(raw([{ name: "base", rows: base }, { name: "a", from: "base", ops: [] }]));
    expect(resolveFrame(r, "a")).toEqual(base);
  });

  it.each<[string, RawFrame]>([
    ["ops: []", { name: "a", ops: [] }],
    ["rows: [42] trong op", { name: "a", ops: [{ op: "grid", rows: [42] as unknown as string[] }] }],
    ["rows: [42] trực tiếp", { name: "a", rows: [42] as unknown as string[] }],
    ["op rows rỗng", { name: "a", ops: [{ op: "grid", rows: [] }] }],
    ["ops không phải mảng", { name: "a", ops: {} as unknown as RawFrame["ops"] }],
    ["op không phải object", { name: "a", ops: [null as unknown as { op?: string }] }],
    ["op lạ", { name: "a", ops: [{ op: "tilemap", rows: ["ab"] }] }],
    ["x/y không nguyên", { name: "a", ops: [{ op: "grid", x: 1.5, rows: ["ab"] }] }],
    ["x âm", { name: "a", ops: [{ op: "grid", x: -1, rows: ["ab"] }] }],
    ["hàng dài không đều", { name: "a", ops: [{ op: "grid", rows: ["ab", "c"] }] }],
    ["lưới rộng hơn 16", { name: "a", ops: [{ op: "grid", rows: BLANK.map((r) => r + ".") }] }],
    ["lưới cao hơn 22", { name: "a", ops: [{ op: "grid", rows: [...BLANK, BLANK[0]] }] }],
    ["lưới lọt khung nhưng đặt lệch ra ngoài", { name: "a", ops: [{ op: "grid", x: 15, y: 21, rows: ["ab"] }] }],
    ["một op tốt, một op hỏng", { name: "a", ops: [{ op: "grid", rows: ["ab"] }, { op: "grid", rows: [42] as unknown as string[] }] }],
  ])("từ chối %s", (_, frame) => {
    const r = normalize(raw([frame]));
    expect(resolveFrame(r, "a")).toBeNull();
    expect(animFrames(r, "walk_down")).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("từ chối vòng lặp from qua ops", () => {
    const r = normalize(
      raw([
        { name: "a", from: "b", ops: [] },
        { name: "b", from: "a", ops: [{ op: "grid", rows: ["ab"] }] },
      ]),
    );
    expect(animFrames(r, "walk_down")).toBeNull();
  });
});

// Đọc thô, không qua bộ chuẩn hoá, để kiểm đúng nội dung file.
const FILES = import.meta.glob<RawRecipe>("../../art/characters/**/*.pixel.json", { eager: true, import: "default" });

describe("mọi file art/characters", () => {
  it("có file để kiểm", () => {
    expect(Object.keys(FILES).length).toBeGreaterThan(0);
    expect(Object.keys(FILES).some((p) => p.endsWith("/body.pixel.json"))).toBe(true);
  });

  describe.each(Object.entries(FILES))("%s", (_, file) => {
    it("khai báo khung 16×22", () => {
      expect(file.width).toBe(W);
      expect(file.height).toBe(H);
    });

    it("mọi frame đọc được và đúng 16×22", () => {
      const r: Recipe = normalize(file);
      const names = Array.isArray(file.frames) ? file.frames.map((f) => f.name!) : Object.keys(file.frames);
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        const out = resolveFrame(r, name);
        expect(out, name).not.toBeNull();
        expect(out!.length, name).toBe(H);
        expect(out!.every((row) => row.length === W), name).toBe(true);
      }
    });

    it("mọi animation khai báo đều đọc được", () => {
      const r = normalize(file);
      for (const anim of Object.keys(file.animations ?? {})) expect(animFrames(r, anim), anim).not.toBeNull();
    });
  });

  it.each(ANIMS)("body có animation %s", (anim) => {
    expect(has("body", anim)).toBe(true);
  });
});
