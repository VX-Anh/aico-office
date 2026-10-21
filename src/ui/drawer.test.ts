import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDrawer, type DrawerAgentInfo } from "./drawer";

// textContent gom cả con như DOM thật để kiểm tra hậu tố hiển thị trong dòng.
class DrawerNode {
  children: DrawerNode[] = [];
  private text = "";
  className = "";
  id = "";
  hidden = false;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  classList = { add: (...names: string[]) => { this.className += ` ${names.join(" ")}`; } };
  constructor(readonly tagName = "div") {}
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(""); }
  set textContent(value: string) { this.text = value; this.children = []; }
  append(...children: DrawerNode[]) { this.children.push(...children); }
  replaceChildren(...children: DrawerNode[]) { this.text = ""; this.children = children; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  addEventListener() {}
  querySelectorAll() { return []; }
}

const now = Date.parse("2026-10-21T12:00:00Z");
function info(stats: unknown): DrawerAgentInfo {
  const agent = {
    id: "coder-1", role: "coder", ticket_id: "T-30755290", mode: "write", started_at: "2026-10-21T11:00:00Z",
    activity: { kind: "read", text: "Đọc dữ liệu", at: new Date(now).toISOString() },
    tasks: [{ id: "1", title: "Ghép số liệu", status: "in_progress" }], stats,
  };
  return { key: "drawer-cache", worker: { name: "codex", state: "working", roles: ["coder"] }, agent };
}

beforeEach(() => {
  vi.stubGlobal("document", { createElement: (tag: string) => new DrawerNode(tag), addEventListener() {}, removeEventListener() {} });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function openDrawer() {
  const root = new DrawerNode();
  const needs = new DrawerNode();
  const drawer = createDrawer(root as unknown as HTMLElement, needs as unknown as HTMLElement, { onClose() {}, onTab() {} });
  const panel = root.children[1];
  const render = (stats: unknown) => {
    drawer.render({ open: true, tab: "agent" }, info(stats), now);
    expect(root.hidden).toBe(false);
    expect(root.children[2].children[0]).toBe(needs);
  };
  const section = () => panel.children.find(node => node.children[0]?.textContent === "Số liệu")!;
  const lines = () => section().children.slice(1).map(node => node.textContent);
  const suffixes = () => section().children.flatMap(node => node.children);
  return { drawer, root, panel, render, lines, suffixes };
}

const base = { tool_calls: 12, tokens_in: 1_120_000, tokens_out: 25_000 };

describe("số liệu drawer đang mở", () => {
  it("hiện nội dung thật, chỉ tô hậu tố cache và giữ các khối khác", () => {
    const { render, panel, lines, suffixes } = openDrawer();
    render({ ...base, tokens_cached: 1_033_000 });
    expect(lines()).toEqual(["Lần gọi tool: 12", "Token vào: 1,12 triệu (92% từ cache)", "Token mới: 87 nghìn", "Token ra: 25 nghìn"]);
    expect(suffixes().map(node => [node.tagName, node.textContent, node.className])).toEqual([
      ["span", " (92% từ cache)", "drawer-cache ok"],
    ]);
    expect(panel.children.filter(node => node.tagName === "section").map(node => node.children[0].textContent))
      .toEqual(["Đang làm", "Gần đây", "Task", "Số liệu"]);
    expect(panel.textContent).toContain("Đọc dữ liệu");
    expect(panel.textContent).toContain("Đang làm · Ghép số liệu");
  });

  it("cache có → mất → có và stats thiếu không giữ dòng hoặc màu cũ", () => {
    const { render, lines, suffixes } = openDrawer();
    for (const cached of [1_033_000, undefined, 0, null, 800_000]) {
      render({ ...base, tokens_cached: cached });
      if (cached == null) {
        expect(lines()).toEqual(["Lần gọi tool: 12", "Token vào: 1.120.000", "Token ra: 25.000"]);
        expect(suffixes()).toEqual([]);
      } else {
        expect(lines()).toHaveLength(4);
        expect(suffixes()).toHaveLength(1);
      }
    }
    for (const stats of [undefined, null, "hỏng"]) {
      render(stats);
      expect(lines()).toEqual(["Lần gọi tool: chưa có", "Token vào: chưa có", "Token ra: chưa có"]);
      expect(suffixes()).toEqual([]);
    }
  });

  it.each(["900", true, {}, -1, NaN, Infinity])("cache hỏng %j → hồi phục", cached => {
    const { render, lines, suffixes } = openDrawer();
    for (const value of [900, cached, 900]) {
      render({ tool_calls: 3, tokens_in: 1000, tokens_out: 100, tokens_cached: value });
      if (Object.is(value, cached)) {
        expect(lines()).toEqual(["Lần gọi tool: 3", "Token vào: 1.000", "Token ra: 100"]);
        expect(suffixes()).toEqual([]);
      } else {
        expect(lines()).toEqual(["Lần gọi tool: 3", "Token vào: 1 nghìn (90% từ cache)", "Token mới: 100", "Token ra: 100"]);
        expect(suffixes().map(node => node.className)).toEqual(["drawer-cache ok"]);
      }
    }
  });

  it("token tăng/giảm/reset, cache vượt đầu vào và đổi ngưỡng không giữ số hoặc màu cũ", () => {
    const { render, lines, suffixes } = openDrawer();
    const steps = [
      [1000, 700, "1 nghìn", "300", "70", "ok"],
      [2000, 800, "2 nghìn", "1,2 nghìn", "40", "warn"],
      [1000, 399, "1 nghìn", "601", "40", "crit"],
      [1000, 695, "1 nghìn", "305", "70", "warn"],
      [100, 800, "100", "0", "100", "ok"],
      [0, 0, "0", "0", null, null],
      [0, 800, "0", "0", null, null],
      [1000, 0, "1 nghìn", "1 nghìn", "0", "crit"],
      [1000, 700, "1 nghìn", "300", "70", "ok"],
    ] as const;
    for (const [input, cached, count, fresh, percent, level] of steps) {
      render({ tool_calls: input, tokens_in: input, tokens_cached: cached, tokens_out: input });
      expect(lines()).toEqual([
        `Lần gọi tool: ${input.toLocaleString("vi-VN")}`,
        `Token vào: ${count}${percent === null ? "" : ` (${percent}% từ cache)`}`,
        `Token mới: ${fresh}`, `Token ra: ${count}`,
      ]);
      expect(suffixes().map(node => node.className)).toEqual(level === null ? [] : [`drawer-cache ${level}`]);
    }
  });
});
