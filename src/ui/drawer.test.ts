import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ticket, WorkerAgent, WorkerStatus } from "../api";
import type { NeedItem } from "../needs-column";
import { paletteOf } from "../scene/palette";
import { createDrawer, type DrawerAgentInfo } from "./drawer";

// textContent gom cả con như DOM thật để kiểm tra hậu tố hiển thị trong dòng.
// Có style để avatar rơi vào nhánh ô màu (DOM giả không có getContext) mà không ném lỗi.
class DrawerNode {
  children: DrawerNode[] = [];
  private text = "";
  className = "";
  id = "";
  title = "";
  href = "";
  target = "";
  rel = "";
  hidden = false;
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  classList = { add: (...names: string[]) => { this.className += ` ${names.join(" ")}`; } };
  constructor(readonly tagName = "div") {}
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(""); }
  set textContent(value: string) { this.text = value; this.children = []; }
  append(...children: DrawerNode[]) { this.children.push(...children); }
  replaceChildren(...children: DrawerNode[]) { this.text = ""; this.children = children; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  addEventListener() {}
  querySelectorAll() { return []; }
  classes() { return this.className.split(/\s+/).filter(Boolean); }
  all(cls: string): DrawerNode[] {
    return this.children.flatMap(child => [...(child.classes().includes(cls) ? [child] : []), ...child.all(cls)]);
  }
  one(cls: string): DrawerNode | undefined { return this.all(cls)[0]; }
  tags(tag: string): DrawerNode[] {
    return this.children.flatMap(child => [...(child.tagName === tag ? [child] : []), ...child.tags(tag)]);
  }
}

const now = Date.parse("2026-10-21T12:00:00Z");
const iso = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();
const worker = (patch: Partial<WorkerStatus> = {}): WorkerStatus => ({ name: "codex", state: "working", roles: ["coder"], ...patch });
function agentOf(patch: Record<string, unknown> = {}): WorkerAgent {
  return {
    id: "coder-1", role: "coder", ticket_id: "T-30755290", mode: "write", started_at: "2026-10-21T11:00:00Z",
    activity: { kind: "read", text: "Đọc dữ liệu", at: iso(12) },
    tasks: [{ id: "1", title: "Ghép số liệu", status: "in_progress" }],
    ...patch,
  } as unknown as WorkerAgent;
}
function need(id: string, title: string, artifacts: Ticket["artifacts"] = []): NeedItem {
  return { ticket: { id, title, status: "review", project: null, artifacts, updated_at: null }, kind: "merge", reason: null };
}
const mr = { kind: "merge_request", ref: "!1", url: "https://git.example/mr/1" };
const preview = { kind: "preview", ref: null, url: "https://preview.example/1" };
function info(agent = agentOf(), w = worker(), needItems: NeedItem[] = []): DrawerAgentInfo {
  return { key: "drawer-test", worker: w, agent, needItems };
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
  const show = (data: DrawerAgentInfo | null, at = now) => {
    drawer.render({ open: true, tab: "agent" }, data, at);
    expect(root.hidden).toBe(false);
    expect(root.children[2].children[0]).toBe(needs);
  };
  const section = (title: string) => panel.children.find(node => node.tagName === "section" && node.one("drawer-section-title")?.textContent === title)!;
  const text = (cls: string) => panel.one(cls)?.textContent;
  const stats = () => section("Số liệu").all("drawer-stat").map(node => `${node.children[0].textContent}: ${node.children[1].textContent}`);
  const suffixes = () => section("Số liệu").all("drawer-cache");
  return { drawer, root, panel, show, section, text, stats, suffixes };
}

describe("tab Agent: bố cục", () => {
  it("thứ tự hero → nhiệm vụ → trạng thái → Đang làm → Task → Gần đây → Số liệu", () => {
    const { show, panel } = openDrawer();
    show(info());
    expect(panel.children.map(node => node.classes()[0])).toEqual([
      "drawer-hero", "drawer-mission", "drawer-status", "drawer-now", "drawer-section", "drawer-section", "drawer-section",
    ]);
    expect(panel.all("drawer-section-title").map(node => node.textContent)).toEqual(["Task", "Gần đây", "Số liệu"]);
  });

  it("hero: avatar (ô màu khi không vẽ được), vai trò, id đủ, chip phòng, ticket", () => {
    const { show, panel, text } = openDrawer();
    show(info());
    const avatar = panel.one("drawer-hero-avatar")!.children[0];
    expect(avatar.classes()).toContain("avatar");
    expect(avatar.classes()).toContain("avatar-fallback");
    expect(avatar.style.background).toBeTruthy();
    expect(text("drawer-role")).toBe("Coder");
    const id = panel.one("drawer-agent-id")!;
    expect([id.textContent, id.title, id.classes().includes("mono")]).toEqual(["coder-1", "coder-1", true]);
    const chip = panel.one("drawer-room-chip")!;
    expect(chip.textContent).toBe("X");
    expect(chip.style.background).toBe(paletteOf(worker()).shirt);
    expect(text("drawer-room-name")).toBe("codex");
    expect(text("drawer-room-state")).toBe("đang làm");
    expect(text("drawer-ticket-label")).toBe("Ticket");
    expect(text("drawer-ticket-id")).toBe("T-30755290");
  });

  it("hero ẩn dòng ticket khi agent không có ticket", () => {
    const { show, panel } = openDrawer();
    show(info(agentOf({ ticket_id: null })));
    expect(panel.one("drawer-hero-ticket")).toBeUndefined();
  });
});

describe("hộp nhiệm vụ", () => {
  it("có ticket trong Cần bạn: tiêu đề và link mở tab mới", () => {
    const { show, panel, text } = openDrawer();
    show(info(agentOf(), worker(), [need("T-30755290", "Làm lại drawer", [mr, preview])]));
    expect(panel.one("drawer-mission")!.classes()).not.toContain("is-empty");
    expect(text("drawer-mission-title")).toBe("Làm lại drawer");
    expect(panel.all("drawer-link").map(a => [a.tagName, a.textContent, a.href, a.target, a.rel])).toEqual([
      ["a", "MR ↗", mr.url, "_blank", "noopener noreferrer"],
      ["a", "Xem trước ↗", preview.url, "_blank", "noopener noreferrer"],
    ]);
  });

  it("chỉ hiện link có url", () => {
    const { show, panel } = openDrawer();
    show(info(agentOf(), worker(), [need("T-30755290", "Làm lại drawer", [preview])]));
    expect(panel.all("drawer-link").map(a => a.textContent)).toEqual(["Xem trước ↗"]);
    show(info(agentOf(), worker(), [need("T-30755290", "Làm lại drawer")]));
    expect(panel.all("drawer-link")).toEqual([]);
    expect(panel.one("drawer-mission-links")).toBeUndefined();
  });

  it("có mã nhưng không có tiêu đề: hiện mã mờ, không link", () => {
    const { show, panel } = openDrawer();
    show(info(agentOf(), worker(), [need("T-khac", "Khác", [mr])]));
    const title = panel.one("drawer-mission-title")!;
    expect(title.textContent).toBe("T-30755290");
    expect(title.classes()).toContain("drawer-muted");
    expect(panel.all("drawer-link")).toEqual([]);
  });

  it("không có ticket: 'Chưa có ticket' và .is-empty", () => {
    const { show, panel, text } = openDrawer();
    show(info(agentOf({ ticket_id: null })));
    expect(panel.one("drawer-mission")!.classes()).toContain("is-empty");
    expect(text("drawer-mission-title")).toBe("Chưa có ticket");
  });
});

describe("dòng trạng thái", () => {
  it.each([
    ["working", worker(), agentOf(), [], "Đang làm"],
    ["need", worker(), agentOf(), [need("T-30755290", "x")], "Chờ"],
    ["error", worker(), agentOf({ activity: { kind: "error", text: "Build lỗi", at: iso(12) } }), [], "Lỗi"],
    ["idle", worker({ state: "idle" }), agentOf(), [], "Rảnh"],
    ["offline", worker({ state: "offline" }), agentOf(), [], "Mất kết nối"],
    ["limited", worker({ state: "limited" }), agentOf(), [], "Hết hạn mức"],
  ] as const)("tone %s", (tone, w, agent, needItems, label) => {
    const { show, panel, text } = openDrawer();
    show(info(agent, w, [...needItems]));
    expect(panel.one("drawer-status")!.classes()).toEqual(["drawer-status", `tone-${tone}`]);
    expect(panel.one("drawer-status-dot")).toBeDefined();
    expect(text("drawer-status-label")).toBe(label);
    expect(text("drawer-status-ago")).toBe("· 12 giây trước");
  });

  it("không có activity thì lấy started_at; không có cả hai thì ẩn thời gian", () => {
    const { show, text } = openDrawer();
    show(info(agentOf({ activity: null })));
    expect(text("drawer-status-ago")).toBe("· 1 giờ trước");
    show(info(agentOf({ activity: null, started_at: undefined })));
    expect(text("drawer-status-ago")).toBeUndefined();
  });
});

describe("thẻ Đang làm", () => {
  it("thường: icon, nội dung, detail", () => {
    const { show, panel, text } = openDrawer();
    show(info(agentOf({ activity: { kind: "edit", text: "Sửa drawer.ts", detail: "src/ui/drawer.ts", at: iso(5) } })));
    expect(panel.one("drawer-now")!.classes()).toEqual(["drawer-now"]);
    expect(text("drawer-now-title")).toBe("Đang làm");
    expect(text("drawer-now-icon")).toBeTruthy();
    expect(text("drawer-now-text")).toBe("Sửa drawer.ts");
    expect(text("drawer-now-detail")).toBe("src/ui/drawer.ts");
  });

  it("lỗi: .is-error", () => {
    const { show, panel } = openDrawer();
    show(info(agentOf({ activity: { kind: "error", text: "Build lỗi", at: iso(5) } })));
    expect(panel.one("drawer-now")!.classes()).toContain("is-error");
  });

  it("không có activity: 'Chưa có hoạt động'", () => {
    const { show, panel, text } = openDrawer();
    show(info(agentOf({ activity: undefined })));
    expect(text("drawer-now-text")).toBe("Chưa có hoạt động");
    expect(panel.one("drawer-now-icon")).toBeUndefined();
    expect(panel.one("drawer-now-detail")).toBeUndefined();
  });
});

const tasksOf = (n: number, done = 0) => Array.from({ length: n }, (_, i) => ({
  id: String(i), title: `Việc ${i}`, status: i < done ? "completed" : i === done ? "in_progress" : "pending",
}));

describe("Task", () => {
  it("checklist ○/◐/✓, số đếm và thanh tiến độ", () => {
    const { show, section } = openDrawer();
    show(info(agentOf({ tasks: tasksOf(3, 1) })));
    const block = section("Task");
    expect(block.one("drawer-section-count")!.textContent).toBe("1/3");
    const bar = block.one("drawer-progress")!;
    expect(bar.getAttribute("role")).toBe("progressbar");
    expect([bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemax")]).toEqual(["1", "3"]);
    expect(bar.one("drawer-progress-fill")!.style.width).toBe("33%");
    expect(block.all("drawer-check").map(li => [li.tagName, li.classes()[1], li.children[0].textContent, li.children[1].textContent])).toEqual([
      ["li", "completed", "✓", "Việc 0"],
      ["li", "in_progress", "◐", "Việc 1"],
      ["li", "pending", "○", "Việc 2"],
    ]);
  });

  it("tasks_done hợp lệ thì tin, hỏng thì tự đếm", () => {
    const { show, section } = openDrawer();
    show(info(agentOf({ tasks: tasksOf(3, 1), tasks_done: 2 })));
    expect(section("Task").one("drawer-section-count")!.textContent).toBe("2/3");
    show(info(agentOf({ tasks: tasksOf(3, 1), tasks_done: 9 })));
    expect(section("Task").one("drawer-section-count")!.textContent).toBe("1/3");
  });
});

const recentOf = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: "read", text: `Bước ${i} rất dài`, at: iso(100 - i) }));

describe("Gần đây", () => {
  it("số đếm, mới nhất trước, ô time[datetime], text có title", () => {
    const { show, section } = openDrawer();
    show(info(agentOf({ recent: recentOf(3) })));
    const block = section("Gần đây");
    expect(block.one("drawer-section-count")!.textContent).toBe("3");
    const rows = block.all("drawer-tl-row");
    expect(rows.map(row => row.one("drawer-tl-text")!.textContent)).toEqual(["Bước 2 rất dài", "Bước 1 rất dài", "Bước 0 rất dài"]);
    const first = rows[0];
    expect(first.one("drawer-tl-text")!.title).toBe("Bước 2 rất dài");
    const time = first.one("drawer-tl-ago")!;
    expect([time.tagName, time.getAttribute("datetime"), time.textContent]).toEqual(["time", iso(98), "1 phút trước"]);
    expect(first.one("drawer-tl-icon")).toBeDefined();
  });
});

describe("Số liệu", () => {
  const base = { tool_calls: 12, tokens_in: 1_120_000, tokens_out: 25_000 };
  const showStats = (ctx: ReturnType<typeof openDrawer>, stats: unknown) => ctx.show(info(agentOf({ stats })));

  it("bảng dl/dt/dd, chỉ tô hậu tố cache", () => {
    const ctx = openDrawer();
    showStats(ctx, { ...base, tokens_cached: 1_033_000 });
    const table = ctx.section("Số liệu").tags("dl")[0];
    expect(table.classes()).toEqual(["drawer-stats"]);
    expect(table.children.map(row => [row.children[0].tagName, row.children[1].tagName])).toEqual(Array(4).fill(["dt", "dd"]));
    expect(ctx.stats()).toEqual(["Lần gọi tool: 12", "Token vào: 1,12 triệu (92% từ cache)", "Token mới: 87 nghìn", "Token ra: 25 nghìn"]);
    expect(ctx.section("Số liệu").all("drawer-stat-value").map(node => node.textContent)).toEqual(["12", "1,12 triệu", "87 nghìn", "25 nghìn"]);
    expect(ctx.suffixes().map(node => [node.tagName, node.textContent, node.className])).toEqual([
      ["span", " (92% từ cache)", "drawer-cache ok"],
    ]);
  });

  it("cache có → mất → có và stats thiếu không giữ dòng hoặc màu cũ", () => {
    const ctx = openDrawer();
    for (const cached of [1_033_000, undefined, 0, null, 800_000]) {
      showStats(ctx, { ...base, tokens_cached: cached });
      if (cached == null) {
        expect(ctx.stats()).toEqual(["Lần gọi tool: 12", "Token vào: 1.120.000", "Token ra: 25.000"]);
        expect(ctx.suffixes()).toEqual([]);
      } else {
        expect(ctx.stats()).toHaveLength(4);
        expect(ctx.suffixes()).toHaveLength(1);
      }
    }
    for (const stats of [undefined, null, "hỏng"]) {
      showStats(ctx, stats);
      expect(ctx.stats()).toEqual(["Lần gọi tool: chưa có", "Token vào: chưa có", "Token ra: chưa có"]);
      expect(ctx.suffixes()).toEqual([]);
    }
  });

  it.each(["900", true, {}, -1, NaN, Infinity])("cache hỏng %j → hồi phục", cached => {
    const ctx = openDrawer();
    for (const value of [900, cached, 900]) {
      showStats(ctx, { tool_calls: 3, tokens_in: 1000, tokens_out: 100, tokens_cached: value });
      if (Object.is(value, cached)) {
        expect(ctx.stats()).toEqual(["Lần gọi tool: 3", "Token vào: 1.000", "Token ra: 100"]);
        expect(ctx.suffixes()).toEqual([]);
      } else {
        expect(ctx.stats()).toEqual(["Lần gọi tool: 3", "Token vào: 1 nghìn (90% từ cache)", "Token mới: 100", "Token ra: 100"]);
        expect(ctx.suffixes().map(node => node.className)).toEqual(["drawer-cache ok"]);
      }
    }
  });

  it("token tăng/giảm/reset, cache vượt đầu vào và đổi ngưỡng không giữ số hoặc màu cũ", () => {
    const ctx = openDrawer();
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
      showStats(ctx, { tool_calls: input, tokens_in: input, tokens_cached: cached, tokens_out: input });
      expect(ctx.stats()).toEqual([
        `Lần gọi tool: ${input.toLocaleString("vi-VN")}`,
        `Token vào: ${count}${percent === null ? "" : ` (${percent}% từ cache)`}`,
        `Token mới: ${fresh}`, `Token ra: ${count}`,
      ]);
      expect(ctx.suffixes().map(node => node.className)).toEqual(level === null ? [] : [`drawer-cache ${level}`]);
    }
  });
});

describe("dữ liệu đổi giữa chừng trên cùng drawer", () => {
  it("ticket có → mất → có lại, link theo", () => {
    const { show, panel, text } = openDrawer();
    const withLinks = [need("T-30755290", "Làm lại drawer", [mr])];
    show(info(agentOf(), worker(), withLinks));
    expect(panel.all("drawer-link").map(a => a.href)).toEqual([mr.url]);
    show(info(agentOf(), worker(), []));
    expect(panel.all("drawer-link")).toEqual([]);
    expect(text("drawer-mission-title")).toBe("T-30755290");
    show(info(agentOf(), worker(), [need("T-30755290", "Tiêu đề mới", [preview])]));
    expect(text("drawer-mission-title")).toBe("Tiêu đề mới");
    expect(panel.all("drawer-link").map(a => a.href)).toEqual([preview.url]);
  });

  it("ticket_id đổi rồi thành null", () => {
    const { show, panel, text } = openDrawer();
    const items = [need("T-1", "Một", [mr]), need("T-2", "Hai")];
    show(info(agentOf({ ticket_id: "T-1" }), worker(), items));
    expect([text("drawer-ticket-id"), text("drawer-mission-title")]).toEqual(["T-1", "Một"]);
    show(info(agentOf({ ticket_id: "T-2" }), worker(), items));
    expect([text("drawer-ticket-id"), text("drawer-mission-title")]).toEqual(["T-2", "Hai"]);
    expect(panel.all("drawer-link")).toEqual([]);
    show(info(agentOf({ ticket_id: null }), worker(), items));
    expect(panel.one("drawer-hero-ticket")).toBeUndefined();
    expect(text("drawer-mission-title")).toBe("Chưa có ticket");
    expect(panel.one("drawer-mission")!.classes()).toContain("is-empty");
    show(info(agentOf({ ticket_id: "T-1" }), worker(), items));
    expect(panel.one("drawer-mission")!.classes()).not.toContain("is-empty");
  });

  it("activity null → thường → lỗi → thường", () => {
    const { show, panel, text } = openDrawer();
    const steps = [
      [null, "Chưa có hoạt động", false, undefined, "working"],
      [{ kind: "edit", text: "Sửa", detail: "a.ts", at: iso(3) }, "Sửa", false, "a.ts", "working"],
      [{ kind: "error", text: "Build lỗi", at: iso(2) }, "Build lỗi", true, undefined, "error"],
      [{ kind: "test", text: "Chạy test", at: iso(1) }, "Chạy test", false, undefined, "working"],
    ] as const;
    for (const [activity, label, error, detail, tone] of steps) {
      show(info(agentOf({ activity })));
      expect(text("drawer-now-text")).toBe(label);
      expect(panel.one("drawer-now")!.classes().includes("is-error")).toBe(error);
      expect(text("drawer-now-detail")).toBe(detail);
      expect(panel.one("drawer-status")!.classes()).toEqual(["drawer-status", `tone-${tone}`]);
    }
  });

  it("working → need → idle → working", () => {
    const { show, panel, text } = openDrawer();
    const steps = [
      [worker(), [], "working", "Đang làm"],
      [worker(), [need("T-30755290", "x")], "need", "Chờ"],
      [worker({ state: "idle" }), [], "idle", "Rảnh"],
      [worker(), [], "working", "Đang làm"],
    ] as const;
    for (const [w, items, tone, label] of steps) {
      show(info(agentOf(), w, [...items]));
      expect(panel.one("drawer-status")!.classes()).toEqual(["drawer-status", `tone-${tone}`]);
      expect(text("drawer-status-label")).toBe(label);
      expect(panel.all("drawer-status")).toHaveLength(1);
    }
  });

  it("task 3 → 7 → 0 → mất", () => {
    const { show, section } = openDrawer();
    for (const [tasks, count, rows, width] of [[tasksOf(3, 2), "2/3", 3, "67%"], [tasksOf(7, 0), "0/7", 7, "0%"]] as const) {
      show(info(agentOf({ tasks })));
      const block = section("Task");
      expect(block.one("drawer-section-count")!.textContent).toBe(count);
      expect(block.all("drawer-check")).toHaveLength(rows);
      expect(block.all("drawer-progress")).toHaveLength(1);
      expect(block.one("drawer-progress-fill")!.style.width).toBe(width);
    }
    for (const tasks of [[], undefined]) {
      show(info(agentOf({ tasks })));
      const block = section("Task");
      expect(block.one("drawer-section-count")).toBeUndefined();
      expect(block.one("drawer-progress")).toBeUndefined();
      expect(block.all("drawer-check")).toEqual([]);
      expect(block.textContent).toContain("Chưa có task");
    }
  });

  it("recent 12 → 3 → rỗng → 5", () => {
    const { show, section } = openDrawer();
    for (const n of [12, 3, 0, 5]) {
      show(info(agentOf({ recent: recentOf(n) })));
      const block = section("Gần đây");
      expect(block.one("drawer-section-count")!.textContent).toBe(String(n));
      expect(block.all("drawer-tl-row")).toHaveLength(n);
      expect(block.textContent.includes("Chưa có hoạt động")).toBe(n === 0);
    }
  });

  it("đổi agent A → B không sót nút của A", () => {
    const { show, panel, text } = openDrawer();
    show(info(agentOf({ recent: recentOf(4) }), worker(), [need("T-30755290", "Của A", [mr])]));
    const b = agentOf({ id: "lead-9", role: "tech_lead", ticket_id: "T-B", activity: null, tasks: undefined });
    show(info(b, worker({ name: "claude" })));
    expect(panel.all("drawer-hero")).toHaveLength(1);
    expect([text("drawer-agent-id"), text("drawer-room-name"), text("drawer-room-chip"), text("drawer-ticket-id")])
      .toEqual(["lead-9", "claude", "C", "T-B"]);
    expect(text("drawer-role")).toBe("Tech lead");
    expect(panel.one("drawer-room-chip")!.style.background).toBe(paletteOf(worker({ name: "claude" })).shirt);
    expect(panel.all("drawer-link")).toEqual([]);
    expect(panel.all("drawer-tl-row")).toEqual([]);
    expect(panel.all("avatar")).toHaveLength(1);
    expect(panel.textContent).not.toContain("coder-1");
    expect(panel.textContent).not.toContain("Của A");
  });

  it("worker offline/limited đổi nhãn phòng", () => {
    const { show, text } = openDrawer();
    for (const [state, label] of [["working", "đang làm"], ["offline", "mất kết nối"], ["limited", "hết hạn mức"], ["idle", "rảnh"], ["lạ", "?"]] as const) {
      show(info(agentOf(), worker({ state: state as WorkerStatus["state"] })));
      expect(text("drawer-room-state")).toBe(label);
    }
  });

  it("render(view, null) không sót hero", () => {
    const { show, panel } = openDrawer();
    show(info(agentOf(), worker(), [need("T-30755290", "x", [mr])]));
    show(null);
    expect(panel.children.map(node => [node.className, node.textContent])).toEqual([["drawer-muted", "Chọn một agent để xem chi tiết."]]);
  });

  it("now +61 giây thì thời gian tương đối cập nhật", () => {
    const { show, text } = openDrawer();
    const data = info(agentOf({ recent: [{ kind: "read", text: "Đọc", at: iso(12) }] }));
    show(data);
    expect(text("drawer-status-ago")).toBe("· 12 giây trước");
    expect(text("drawer-tl-ago")).toBe("12 giây trước");
    show(data, now + 61_000);
    expect(text("drawer-status-ago")).toBe("· 1 phút trước");
    expect(text("drawer-tl-ago")).toBe("1 phút trước");
  });
});
