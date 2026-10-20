// Giữ lỗi T-cff2d329: công thức hỏng phải bị từ chối (null) để tư thế đó rơi về sprite cũ, không thành lưới rỗng "hợp lệ".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Recipe, type RecipeFrame, animFrames, resolveFrame } from "./pixelbolt";

const W = 16;
const H = 22;
const BLANK = Array.from({ length: H }, () => ".".repeat(W));
const BODY = BLANK.map((r, y) => (y === 10 ? "......tttt......" : r));

let seq = 0;
// Mỗi công thức một tên riêng vì warn chỉ in một lần theo nội dung.
function recipe(frames: RecipeFrame[], animations: Recipe["animations"] = { walk_down: ["a"] }): Recipe {
  return { name: `test${seq++}`, width: W, height: H, frames, animations };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe("frame hợp lệ", () => {
  it("đọc lưới 16×22 và animation", () => {
    const r = recipe([{ name: "a", rows: BODY }]);
    expect(resolveFrame(r, "a")).toEqual(BODY);
    expect(animFrames(r, "walk_down")).toEqual(["a"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("from kế thừa rồi đè ô không trong suốt", () => {
    const top = BLANK.map((r, y) => (y === 0 ? "h" + r.slice(1) : r));
    const r = recipe([
      { name: "base", rows: BODY },
      { name: "a", from: "base", rows: top },
    ]);
    const out = resolveFrame(r, "a")!;
    expect(out[0][0]).toBe("h");
    expect(out[10]).toBe(BODY[10]);
  });

  it("from không có rows thì chép nguyên frame gốc", () => {
    const r = recipe([
      { name: "base", rows: BODY },
      { name: "a", from: "base" },
    ]);
    expect(resolveFrame(r, "a")).toEqual(BODY);
  });

  it("animation dạng object { frames }", () => {
    const r = recipe([{ name: "a", rows: BODY }], { walk_down: { frames: ["a", "a"], fps: 4 } });
    expect(animFrames(r, "walk_down")).toEqual(["a", "a"]);
  });
});

describe("từ chối công thức hỏng", () => {
  it.each<[string, RecipeFrame]>([
    ["rows: [42]", { name: "a", rows: [42] as unknown as string[] }],
    ["rows có phần tử không phải chuỗi", { name: "a", rows: [...BLANK.slice(1), null] as unknown as string[] }],
    ["rows không phải mảng", { name: "a", rows: "................" as unknown as string[] }],
    ["rows rỗng", { name: "a", rows: [] }],
    ["thiếu rows và from", { name: "a" }],
    ["op lạ", { name: "a", op: "tilemap", rows: BODY }],
    ["hàng dài không đều", { name: "a", rows: BLANK.map((r, y) => (y === 3 ? r + "." : r)) }],
    ["lưới rộng hơn 16", { name: "a", rows: BLANK.map((r) => r + ".") }],
    ["lưới cao hơn 22", { name: "a", rows: [...BLANK, BLANK[0]] }],
    ["lưới nhỏ hơn khung", { name: "a", rows: BLANK.slice(1) }],
  ])("%s", (_, frame) => {
    const r = recipe([frame]);
    expect(resolveFrame(r, "a")).toBeNull();
    expect(animFrames(r, "walk_down")).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("from trỏ tới frame không tồn tại", () => {
    const r = recipe([{ name: "a", from: "missing" }]);
    expect(animFrames(r, "walk_down")).toBeNull();
  });

  it("from trỏ tới frame hỏng (op lạ) thì frame con cũng hỏng", () => {
    const r = recipe([
      { name: "base", op: "compile", rows: BODY },
      { name: "a", from: "base", rows: BLANK },
    ]);
    expect(animFrames(r, "walk_down")).toBeNull();
  });

  it("frame con kế thừa lưới gốc vượt khung", () => {
    const wide = BLANK.map((r) => r + "..");
    const r = recipe([
      { name: "base", rows: wide },
      { name: "a", from: "base" },
    ]);
    expect(resolveFrame(r, "a")).toBeNull();
  });

  it("frame con khác kích thước frame gốc", () => {
    const r = recipe([
      { name: "base", rows: BODY },
      { name: "a", from: "base", rows: BLANK.slice(2) },
    ]);
    expect(resolveFrame(r, "a")).toBeNull();
  });

  it.each([
    ["tự trỏ vào mình", [{ name: "a", from: "a" }]],
    [
      "vòng hai frame",
      [
        { name: "a", from: "b" },
        { name: "b", from: "a" },
      ],
    ],
    [
      "vòng ba frame, có rows",
      [
        { name: "a", from: "b", rows: BODY },
        { name: "b", from: "c", rows: BODY },
        { name: "c", from: "a", rows: BODY },
      ],
    ],
  ])("vòng lặp from: %s", (_, frames) => {
    const r = recipe(frames as RecipeFrame[], { walk_down: ["a"], walk_up: ["b"] });
    expect(resolveFrame(r, "a")).toBeNull();
    expect(animFrames(r, "walk_down")).toBeNull();
    // Gọi lại vẫn null: kết quả giữa chừng của vòng lặp không được ghi nhớ thành hợp lệ.
    expect(animFrames(r, "walk_down")).toBeNull();
    if (frames.length > 1) expect(animFrames(r, "walk_up")).toBeNull();
  });

  it("một frame hỏng làm cả animation bị từ chối", () => {
    const r = recipe(
      [
        { name: "a", rows: BODY },
        { name: "b", rows: [42] as unknown as string[] },
      ],
      { walk_down: ["a", "b"] },
    );
    expect(animFrames(r, "walk_down")).toBeNull();
  });

  it.each([
    ["không có animation", {}],
    ["frames rỗng", { walk_down: [] }],
    ["frames không phải chuỗi", { walk_down: [1] as unknown as string[] }],
    ["frame không tồn tại", { walk_down: ["nope"] }],
  ])("animation hỏng: %s", (_, animations) => {
    const r = recipe([{ name: "a", rows: BODY }], animations);
    expect(animFrames(r, "walk_down")).toBeNull();
  });
});
