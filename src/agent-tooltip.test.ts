import { describe, expect, it } from "vitest";
import { hitFigure } from "./agent-tooltip";

const figure = (key: string, x = 30, footY = 50) => ({
  key, x, headY: footY - 22, footY, room: "codex",
  agent: { id: key, role: "coder", ticket_id: null, mode: "write", started_at: "2026-10-21T00:00:00Z" },
});

describe("hitFigure", () => {
  it("trúng thân và các cạnh vùng 16×22", () => {
    const agent = figure("a");
    for (const [x, y] of [[30, 40], [22, 28], [38, 50]]) {
      expect(hitFigure([agent], x, y)).toBe(agent);
    }
  });

  it("trượt ở bốn phía, danh sách rỗng và toạ độ không hợp lệ", () => {
    const agent = figure("a");
    for (const [x, y] of [[21, 40], [39, 40], [30, 27], [30, 51], [NaN, 40], [30, NaN]]) {
      expect(hitFigure([agent], x, y)).toBeNull();
    }
    expect(hitFigure([], 30, 40)).toBeNull();
  });

  it("ưu tiên y chân lớn hơn bất kể thứ tự danh sách", () => {
    const back = figure("back");
    const front = figure("front", 32, 55);
    expect(hitFigure([front, back], 30, 40)).toBe(front);
    expect(hitFigure([back, front], 30, 40)).toBe(front);
    expect(hitFigure([back, front], 23, 30)).toBe(back);
  });

  it("không giữ nhân vật đã biến mất và dùng vị trí hiện tại", () => {
    const old = figure("a");
    const moved = figure("a", 80, 100);
    expect(hitFigure([old], 30, 40)).toBe(old);
    expect(hitFigure([moved], 30, 40)).toBeNull();
    expect(hitFigure([moved], 80, 90)).toBe(moved);
    expect(hitFigure([], 80, 90)).toBeNull();
  });
});
