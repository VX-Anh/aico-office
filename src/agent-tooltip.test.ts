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
  private text = "";
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value: string) { this.text = value; this.children = []; }
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
let documentListeners: Map<string, (event: unknown) => void>;
beforeEach(() => {
  canvas = new TooltipNode();
  body = new TooltipNode();
  config = null;
  documentListeners = new Map();
  vi.stubGlobal("document", { body, createElement: () => new TooltipNode(), addEventListener: (type: string, fn: (event: unknown) => void) => documentListeners.set(type, fn) });
  vi.stubGlobal("window", { innerWidth: 800, innerHeight: 600 });
  vi.stubGlobal("localStorage", { getItem: () => config });
});
afterEach(() => { vi.unstubAllGlobals(); });

function openTooltip(initial: Parameters<ReturnType<typeof createAgentTooltip>["update"]>[0][number] = withRecent(), at = now) {
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

const withStats = (stats: unknown, key = "a", x = 30) => ({
  ...figure(key, x), agent: { ...figure(key).agent, stats },
});
const stats = (tokens_in = 1_120_000, tokens_cached: unknown = 1_033_000) => ({
  tool_calls: 12, tokens_in, tokens_cached, tokens_out: 2500,
});
function statRows(node: TooltipNode) {
  const start = node.children.findIndex((child) => child.textContent === "Thống kê");
  return node.children.slice(start + 1);
}
function assertStats(node: TooltipNode, expected: string[], level: string | null) {
  const rows = statRows(node);
  expect(rows.map((row) => row.textContent)).toEqual(expected);
  const suffixes = rows.flatMap((row) => row.children);
  expect(suffixes.map((suffix) => suffix.className)).toEqual(level ? [`agent-tooltip-cache ${level}`] : []);
}
const cachedRows = ["Lần gọi tool: 12", "Token vào: 1,12 triệu (92% từ cache)", "Token mới: 87 nghìn", "Token ra: 2,5 nghìn"];
const legacyRows = ["Lần gọi tool: 12", "Token vào: 1.120.000", "Token ra: 2.500"];

describe("số liệu cache trong tooltip", () => {
  it("hiện nội dung thật và chỉ tô hậu tố cache", () => {
    const { node } = openTooltip(withStats(stats()));
    assertStats(node, cachedRows, "ok");
    expect(statRows(node)[1].children[0].textContent).toBe(" (92% từ cache)");
  });

  it("có → mất → có và hỏng → hồi phục không giữ dòng hoặc màu cũ", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { tooltip, node } = openTooltip(withStats(stats()));
      let tick = 0;
      for (const cached of [undefined, 1_033_000, "hỏng", 1_033_000, null, 1_033_000, -1, 1_033_000, Infinity, 1_033_000]) {
        tooltip.update([withStats({ ...stats(), tokens_cached: cached })], 100, now + ++tick * 1000);
        const valid = cached === 1_033_000;
        assertStats(node, valid ? cachedRows : legacyRows, valid ? "ok" : null);
      }
    } finally { warn.mockRestore(); }
  });

  it("token tăng/giảm/reset, vượt đầu vào và qua ngưỡng màu mỗi giây", () => {
    const { tooltip, node } = openTooltip(withStats(stats()));
    const cases: [number, number, string, string, string | null][] = [
      [2000, 1400, "2 nghìn (70% từ cache)", "600", "ok"],
      [1000, 695, "1 nghìn (70% từ cache)", "305", "warn"],
      [1000, 400, "1 nghìn (40% từ cache)", "600", "warn"],
      [1000, 399, "1 nghìn (40% từ cache)", "601", "crit"],
      [1000, 0, "1 nghìn (0% từ cache)", "1 nghìn", "crit"],
      [1000, 1200, "1 nghìn (100% từ cache)", "0", "ok"],
      [0, 0, "0", "0", null],
      [1_120_000, 1_033_000, "1,12 triệu (92% từ cache)", "87 nghìn", "ok"],
    ];
    cases.forEach(([input, cached, label, fresh, level], index) => {
      tooltip.update([withStats(stats(input, cached))], 100, now + index * 1000 + 999);
      if (index === 0) assertStats(node, cachedRows, "ok");
      tooltip.update([withStats(stats(input, cached))], 100, now + (index + 1) * 1000);
      assertStats(node, ["Lần gọi tool: 12", `Token vào: ${label}`, `Token mới: ${fresh}`, "Token ra: 2,5 nghìn"], level);
    });
  });

  it("đổi agent tức thì, số agent 1 → 2 → 1 không lẫn số liệu", () => {
    const first = withStats(stats());
    const second = withStats(stats(100, 20), "b", 70);
    const { tooltip, node } = openTooltip(first);
    tooltip.update([first, second], 100, now + 1);
    canvas.listeners.get("pointermove")!({ pointerType: "mouse", clientX: 70, clientY: 40 });
    assertStats(node, ["Lần gọi tool: 12", "Token vào: 100 (20% từ cache)", "Token mới: 80", "Token ra: 2,5 nghìn"], "crit");
    tooltip.update([first], 100, now + 2);
    expect(node.hidden).toBe(true);
    tooltip.update([first, second], 100, now + 1000);
    expect(node.hidden).toBe(true);
    canvas.listeners.get("pointermove")!({ pointerType: "mouse", clientX: 30, clientY: 40 });
    assertStats(node, cachedRows, "ok");
    config = JSON.stringify({ baseUrl: "https://new", token: "new" });
    tooltip.update([first], 100, now + 1001);
    expect(node.hidden).toBe(true);
    tooltip.update([withStats(stats(0, 0))], 100, now + 2000);
    expect(node.hidden).toBe(true);
    canvas.listeners.get("pointermove")!({ pointerType: "mouse", clientX: 30, clientY: 40 });
    assertStats(node, ["Lần gọi tool: 12", "Token vào: 0", "Token mới: 0", "Token ra: 2,5 nghìn"], null);
  });

  it("giữ hover, chạm và định vị trong màn hình hẹp", () => {
    vi.stubGlobal("window", { innerWidth: 120, innerHeight: 120 });
    const { tooltip, node } = openTooltip(withStats(stats()));
    expect(node.style).toEqual({ left: "8px", top: "8px" });
    canvas.listeners.get("pointerleave")!({});
    expect(node.hidden).toBe(true);
    documentListeners.get("pointerdown")!({ pointerType: "touch", target: canvas, clientX: 30, clientY: 40 });
    expect(node.hidden).toBe(false);
    canvas.listeners.get("pointerleave")!({});
    expect(node.hidden).toBe(false);
    tooltip.update([withStats(stats(100, 70))], 100, now + 1000);
    expect(statRows(node)[1].textContent).toBe("Token vào: 100 (70% từ cache)");
    documentListeners.get("pointerdown")!({ pointerType: "touch", target: body });
    expect(node.hidden).toBe(true);
  });
});
