import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentTooltip, hitFigure, recentLines } from "./agent-tooltip";

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


const now = Date.parse("2026-10-21T12:05:30Z");
const activity = (at: string, text = at) => ({ kind: "think", icon: "💭", text, at });
const ticketRecent = ["01.803", "03.511", "13.332", "26.114"].map(
  (second) => activity(`2026-10-21T12:05:${second}Z`),
);
const withRecent = (recent: unknown = ticketRecent) => ({
  ...figure("a"), agent: { ...figure("a").agent, recent },
});
// Math.floor: 3.886 / 16.668 / 26.489 / 28.197 giây tại đúng 12:05:30Z.
const expected = [3, 16, 26, 28].map((seconds, i) =>
  `💭 ${ticketRecent[3 - i].text} · ${seconds} giây trước`);

describe("recentLines", () => {
  it("tái hiện ticket: mới trước, giữ nguyên dữ liệu và giờ từng dòng", () => {
    const agent = withRecent().agent;
    expect(recentLines(agent, "a", now)).toEqual(expected);
    expect(agent.recent).toEqual(ticketRecent);
    expect(recentLines(agent, "a", NaN).every((line) => line.endsWith("chưa rõ"))).toBe(true);
  });

  it("rỗng và phần tử at hỏng không giữ chuỗi cũ", () => {
    for (const recent of [null, [], undefined]) {
      expect(recentLines({ recent }, "a", now)).toEqual(["chưa có"]);
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(recentLines({ recent: [...ticketRecent, activity("hỏng")] }, "a", now)).toEqual(expected);
    warn.mockRestore();
  });

  it("demo đã chạy hơn 9 giây có các chuỗi giờ khác nhau", async () => {
    const { demoWorkers } = await import("./api");
    const { withDemoActivity } = await import("./activity");
    const demoNow = Math.floor(now / 48000) * 48000 + 23000;
    const agent = withDemoActivity(demoWorkers(demoNow), demoNow)[0].agents![0];
    const lines = recentLines(agent, "demo", demoNow);
    expect(lines).toHaveLength(5);
    expect(new Set(lines.map((line) => line.split(" · ")[1])).size).toBe(5);
  });
});

class TooltipNode {
  children: TooltipNode[] = [];
  textContent = "";
  className = "";
  hidden = false;
  style = {};
  clientWidth = 100;
  clientHeight = 100;
  offsetWidth = 100;
  clientLeft = 0;
  clientTop = 0;
  listeners = new Map<string, (event: unknown) => void>();
  setAttribute() {}
  append(child: TooltipNode) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  addEventListener(type: string, fn: (event: unknown) => void) { this.listeners.set(type, fn); }
}

let canvas: TooltipNode;
let body: TooltipNode;
let config: string | null;
beforeEach(() => {
  canvas = new TooltipNode();
  body = new TooltipNode();
  config = null;
  vi.stubGlobal("document", { body, createElement: () => new TooltipNode(), addEventListener() {} });
  vi.stubGlobal("window", { innerWidth: 800, innerHeight: 600 });
  vi.stubGlobal("localStorage", { getItem: () => config });
});
afterEach(() => { vi.unstubAllGlobals(); });

function openTooltip(initial = withRecent(), at = now) {
  const tooltip = createAgentTooltip(canvas as unknown as HTMLCanvasElement);
  tooltip.update([initial], 100, at);
  canvas.listeners.get("pointermove")!({ pointerType: "mouse", clientX: 30, clientY: 40 });
  const node = body.children[0];
  const lines = () => node.children.slice(3, node.children.findIndex((child) => child.textContent === "Task"))
    .map((child) => child.textContent);
  return { tooltip, node, lines };
}

describe("tooltip đang mở", () => {
  it("tự tăng mỗi giây với workers cũ khi poll lỗi", () => {
    const initial = withRecent();
    const { tooltip, lines } = openTooltip(initial);
    expect(lines()).toEqual(expected);
    tooltip.update([initial], 100, now + 999);
    expect(lines()).toEqual(expected);
    for (const delta of [1000, 2000, 3000]) {
      tooltip.update([initial], 100, now + delta);
      expect(lines()[0]).toContain(`${3 + delta / 1000} giây trước`);
    }
  });

  it("poll thêm dòng, vượt 5 chỉ giữ mới nhất; mất rồi xuất hiện lại", () => {
    const { tooltip, lines } = openTooltip();
    const fresh = activity(new Date(now + 1000).toISOString(), "mới");
    tooltip.update([withRecent([...ticketRecent, fresh])], 100, now + 1000);
    expect(lines()).toHaveLength(5);
    expect(lines()[0]).toBe("💭 mới · 0 giây trước");
    expect(lines()[1]).toContain("4 giây trước");
    const newest = activity(new Date(now + 2000).toISOString(), "mới nhất");
    tooltip.update([withRecent([newest, ...ticketRecent, fresh])], 100, now + 2000);
    expect(lines()).toHaveLength(5);
    expect(lines()[0]).toBe("💭 mới nhất · 0 giây trước");
    expect(lines().join()).not.toContain(ticketRecent[0].text);
    tooltip.update([withRecent(null)], 100, now + 3000);
    expect(lines()).toEqual(["chưa có"]);
    tooltip.update([withRecent([fresh])], 100, now + 4000);
    expect(lines()).toEqual(["💭 mới · 3 giây trước"]);
  });

  it("tương lai 2 giây, vượt at và đồng hồ lùi đều render đúng", () => {
    const initial = withRecent([activity(new Date(now + 2000).toISOString(), "mới")]);
    const { tooltip, lines } = openTooltip(initial);
    expect(lines()).toEqual(["💭 mới · vừa xong"]);
    tooltip.update([initial], 100, now + 3000);
    expect(lines()).toEqual(["💭 mới · 1 giây trước"]);
    tooltip.update([initial], 100, now + 1000);
    expect(lines()).toEqual(["💭 mới · vừa xong"]);
  });

  it("now chưa hợp lệ rồi được cập nhật thì bỏ chữ chưa rõ", () => {
    const initial = withRecent();
    const { tooltip, lines } = openTooltip(initial, NaN);
    expect(lines().every((line) => line.endsWith("chưa rõ"))).toBe(true);
    tooltip.update([initial], 100, now);
    expect(lines()).toEqual(expected);
  });

  it.each(["rời bàn", "offline", "limited"])("đóng khi %s loại figures; quay lại cần mở lại", () => {
    const { tooltip, node } = openTooltip();
    // main/scene chỉ truyền figures đang làm việc của phòng online.
    tooltip.update([], 100, now + 1000);
    expect(node.hidden).toBe(true);
    tooltip.update([withRecent()], 100, now + 2000);
    expect(node.hidden).toBe(true);
  });

  it("đóng khi cùng id nhưng started_at đổi giữa hai poll", () => {
    const { tooltip, node } = openTooltip();
    const next = withRecent();
    next.agent.started_at = new Date(now).toISOString();
    tooltip.update([next], 100, now + 1000);
    expect(node.hidden).toBe(true);
  });

  it("đổi nguồn đóng ngay dù figures cũ còn nguyên", () => {
    const { tooltip, node } = openTooltip();
    config = JSON.stringify({ baseUrl: "https://aico", token: "test" });
    tooltip.update([withRecent()], 100, now + 1);
    expect(node.hidden).toBe(true);
  });
});
