import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerStatus } from "./api";
import { agentKey } from "./ui/selection";

const h = vi.hoisted(() => ({
  realColumn: false,
  config: null as { baseUrl: string; token: string } | null,
  column: vi.fn(), source: vi.fn(), items: vi.fn(), refresh: vi.fn(async () => {}),
  reset: vi.fn(), update: vi.fn(), focus: vi.fn(), tick: vi.fn(),
  fetchTickets: vi.fn(), needAction: vi.fn(),
  overlayDraw: vi.fn(),
  fetchWorkers: vi.fn(async (): Promise<import("./api").WorkerStatus[]> => []),
  tooltipUpdate: vi.fn(),
  onSnapshot: undefined as ((tickets: unknown[]) => void) | undefined,
  drawScene: vi.fn((_ctx: unknown, _workers: WorkerStatus[]) => [] as Record<string, unknown>[]),
  topbarUpdate: vi.fn(),
  sidebarUpdate: vi.fn(),
  sidebarToggle: vi.fn(),
  drawerRender: vi.fn(),
  drawerTicket: null as ((id: string) => void) | null,
  feedRender: vi.fn(),
  feedSetCollapsed: vi.fn(),
  feedActions: {} as { onAgent?(room: string, agentId: string): void; onTicket?(id: string): void },
  // Listener phím riêng của feed thật: chỉ chạy khi main không chặn bằng stopImmediatePropagation.
  feedKey: null as ((event: { key: string; target: unknown }) => void) | null,
  // Bộ đếm "N mới" giả: cộng khi đang cuộn lên, render([]) đặt lại như feed thật.
  feedPending: 0,
  feedScrolledUp: false,
  drawerLayout: null as (() => void) | null,
  feedLayout: null as (() => void) | null,
  onSelect: null as ((key: string) => void) | null,
  onClose: null as (() => void) | null,
  onTab: null as ((tab: "agent" | "needs") => void) | null,
}));
vi.mock("./api", async (original) => ({
  ...await original<typeof import("./api")>(), loadConfig: () => h.config,
  demoWorkers: () => [], saveConfig: vi.fn(), fetchWorkers: h.fetchWorkers, fetchTickets: h.fetchTickets,
  fetchTicketSnapshot: h.fetchTickets, needAction: h.needAction,
  // Không gọi mạng thật cho ticket escalated: trên Windows tra tên "aico" chậm làm test hết giờ.
  fetchEscalationReason: async () => "lý do escalate (test)",
}));
vi.mock("./needs-column", async (original) => {
  const actual = await original<typeof import("./needs-column")>();
  return { createNeedsColumn: (...args: Parameters<typeof actual.createNeedsColumn>) =>
    h.realColumn ? actual.createNeedsColumn(...args) : h.column(...args) };
});
vi.mock("./toasts", () => ({ createToasts: () => ({ reset: h.reset, update: h.update }) }));
vi.mock("./overlay", () => ({ createOverlay: () => ({ draw: h.overlayDraw }) }));
vi.mock("./agent-tooltip", async (original) => {
  const actual = await original<typeof import("./agent-tooltip")>();
  return { ...actual, createAgentTooltip: () => ({ update: h.tooltipUpdate }) };
});
vi.mock("./scene/index", () => ({
  ROLE_STYLES: {}, USAGE: {}, drawScene: h.drawScene, resetActors: vi.fn(), resetSceneCache: vi.fn(),
  roleStyle: () => ({ shirt: "#000", label: "Coder", accessory: "" }), sceneSize: () => ({ width: 100, height: 100 }),
}));
vi.mock("./ui/topbar", () => ({
  createTopbar: () => ({
    update(workers: { state: string; agents?: unknown[] }[], needCount: number, now: number, ids?: ReadonlySet<string>) {
      h.topbarUpdate(workers, needCount, now, ids);
      paintTile("#agents-count", String(workers.reduce((sum, worker) => (
        worker.state === "offline" ? sum : sum + (Array.isArray(worker.agents) ? worker.agents.length : 0)), 0)));
      paintTile("#needs-count", String(needCount));
      const needs = getNode("#needs-count");
      needs.classList.toggle("hot", needCount > 0);
      needs.disabled = needCount === 0;
    },
    setSettingsOpen() {},
  }),
}));
vi.mock("./ui/sidebar", () => ({
  createSidebar: (_root: unknown, options: { onSelect: (key: string) => void }) => {
    h.onSelect = options.onSelect;
    return {
      update: (...args: unknown[]) => { h.sidebarUpdate(...args); },
      setCollapsed() {},
      toggle: () => { h.sidebarToggle(); },
      isCollapsed: () => false,
      onLayout() {},
    };
  },
}));
vi.mock("./ui/drawer", () => ({
  createDrawer: (root: Node, _needs: unknown, options: { onClose(): void; onTab(tab: "agent" | "needs"): void; onTicket(id: string): void }) => {
    h.drawerTicket = options.onTicket;
    h.onClose = options.onClose;
    h.onTab = options.onTab;
    root.hidden = true;
    return {
      onLayout(callback: () => void) { h.drawerLayout = callback; },
      render(view: { open: boolean; tab: string }, info: unknown, now: number) {
        h.drawerRender(view, info, now);
        const changed = root.hidden === view.open;
        root.hidden = !view.open;
        root.dataset.tab = view.tab;
        if (changed) h.drawerLayout?.();
      },
      destroy() {},
    };
  },
}));
vi.mock("./ui/feed", () => ({
  createFeed: (_root: unknown, actions: typeof h.feedActions = {}) => {
    h.feedActions = actions;
    const keys = new Set<string>();
    const setCollapsed = (value: boolean) => {
      h.feedSetCollapsed(value);
      getNode("#feed").classList.toggle("is-collapsed", value);
      h.feedLayout?.();
    };
    h.feedKey = (event) => {
      const target = event.target as { closest?: (selector: string) => unknown } | null;
      if (event.key === "]" && !target?.closest?.("input")) setCollapsed(!getNode("#feed").classList.contains("is-collapsed"));
    };
    return {
      setCollapsed,
      onLayout(callback: () => void) { h.feedLayout = callback; },
      render(lines: { key: string }[], workers?: unknown) {
        h.feedRender(lines, workers);
        const added = lines.filter((line) => !keys.has(line.key)).length;
        keys.clear();
        for (const line of lines) keys.add(line.key);
        if (!lines.length || !h.feedScrolledUp) h.feedPending = 0;
        else h.feedPending += added;
      },
      destroy() {},
    };
  },
}));

class Node {
  children: Node[] = [];
  classList = {
    add: (name: string) => { this.classes.add(name); },
    remove: (name: string) => { this.classes.delete(name); },
    toggle: (name: string, enabled: boolean) => { if (enabled) this.classes.add(name); else this.classes.delete(name); },
    contains: (name: string) => this.classes.has(name),
  };
  classes = new Set<string>();
  dataset: Record<string, string> = {};
  vars: Record<string, string> = {};
  left = 0;
  top = 0;
  setAttribute() {}
  insertBefore(child: Node, before: Node | null) {
    const old = this.children.indexOf(child);
    if (old >= 0) this.children.splice(old, 1);
    const index = before ? this.children.indexOf(before) : -1;
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
  }
  removeAttribute() {}
  scrollIntoView() {}
  focus() {}
  textContent = "";
  hidden = false;
  disabled = false;
  title = "";
  className = "";
  style = { setProperty: (name: string, value: string) => { this.vars[name] = value; } };
  clientWidth = 0;
  clientHeight = 0;
  clientLeft = 0;
  clientTop = 0;
  offsetWidth = 0;
  offsetHeight = 0;
  listeners = new Map<string, (event: unknown) => void>();
  isContentEditable = false;
  matches() { return false; }
  closest() { return null as unknown; }
  elements = { namedItem: () => ({ value: "" }) };
  append(...children: Node[]) { this.children.push(...children); }
  replaceChildren(...children: Node[]) { this.children = children; }
  getContext() { return { setTransform() {} }; }
  getBoundingClientRect() {
    const width = this.clientWidth || this.offsetWidth;
    const height = this.clientHeight || this.offsetHeight;
    const { left, top } = this;
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() { return {}; } };
  }
  addEventListener(type: string, fn: (event: unknown) => void) { this.listeners.set(type, fn); }
  querySelector(selector: string) { return getNode(selector); }
}
let nodes: Map<string, Node>;
function getNode(selector: string): Node {
  if (!nodes.has(selector)) nodes.set(selector, new Node());
  return nodes.get(selector)!;
}
function paintTile(id: string, value: string): void {
  const root = getNode(id);
  let tile = root.children.find((child) => child.className === "tile-value");
  if (!tile) {
    tile = new Node();
    tile.className = "tile-value";
    root.append(tile);
  }
  tile.textContent = value;
}
function tileValue(id: string): string {
  return getNode(id).children.find((child) => child.className === "tile-value")?.textContent ?? "";
}
function drawerOf(): { open: boolean; tab: string } {
  const drawer = getNode("#drawer");
  return { open: !drawer.hidden, tab: drawer.dataset.tab ?? "" };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.realColumn = false;
  h.config = null;
  h.onSelect = null;
  h.onClose = null;
  h.onTab = null;
  h.feedActions = {};
  h.feedKey = null;
  h.feedPending = 0;
  h.feedScrolledUp = false;
  h.drawerLayout = null;
  h.feedLayout = null;
  h.drawScene.mockReset();
  h.drawScene.mockImplementation(() => []);
  nodes = new Map();
  getNode("#tickets-error").hidden = true;
  h.fetchWorkers.mockReset();
  h.fetchWorkers.mockImplementation(async () => []);
  h.tooltipUpdate.mockClear();
  h.column.mockImplementation((_root, source, items, _onError, onSnapshot) => {
    h.onSnapshot = onSnapshot;
    h.source.mockImplementation(() => source);
    h.items.mockImplementation(items);
    return { refresh: h.refresh, setSource: h.source, tick: h.tick, focus: h.focus };
  });
  const root = getNode(":root");
  vi.stubGlobal("HTMLElement", Node);
  vi.stubGlobal("document", {
    querySelector: getNode, createElement: () => new Node(),
    createTextNode: () => new Node(), addEventListener: (type: string, fn: (event: unknown) => void) => getNode("document").addEventListener(type, fn), title: "",
    documentElement: root, body: getNode("body"),
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  vi.stubGlobal("setInterval", vi.fn());
});

afterEach(() => { vi.unstubAllGlobals(); });

const STARTED = "2026-01-01T00:00:00.000Z";
const agent = { id: "a", role: "coder", ticket_id: "T-9", mode: "write", started_at: STARTED, recent: [{ kind: "read", text: "Đọc file", at: STARTED }] };
function room(state: WorkerStatus["state"] = "working", agents: unknown[] = [agent]): WorkerStatus {
  return { name: "claude", state, roles: ["coder"], slots: 2, agents } as WorkerStatus;
}
// Phát như trình duyệt: listener của main đăng ký trước feed, chặn được listener phím của feed.
function press(key: string, target: unknown = null): void {
  let stopped = false;
  const event = {
    key, target, ctrlKey: false, metaKey: false, altKey: false, repeat: false,
    preventDefault() {}, stopImmediatePropagation() { stopped = true; },
  };
  getNode("document").listeners.get("keydown")!(event);
  if (!stopped) h.feedKey?.(event);
}
function pollTick(): void {
  (vi.mocked(setInterval).mock.calls[0][0] as () => void)();
}
async function connected(): Promise<void> {
  await vi.waitFor(() => expect(getNode("#conn").textContent).toContain("Đã nối"));
}

describe("ghép activity giữ nguyên cột Cần bạn", () => {
  it("khởi động demo với đủ ticket duyệt kế hoạch, merge và escalated", async () => {
    await import("./main");
    expect(h.column).toHaveBeenCalledOnce();
    const source = h.source();
    const items = await source.list();
    expect(new Set(items.map((i: { kind: string }) => i.kind))).toEqual(new Set(["plan", "merge", "escalated"]));
    for (const [kind, action] of [["plan", "approved"], ["merge", "approved"], ["escalated", "close"]]) {
      const item = items.find((i: { kind: string }) => i.kind === kind);
      await source.act(item, action, "");
      expect((await source.list()).some((i: { ticket: { id: string } }) => i.ticket.id === item.ticket.id)).toBe(false);
    }
    expect(tileValue("#agents-count")).toBe("0");
  });

  it.each([false, true])("cập nhật bố cục, bộ đếm và toast (nguồn thật: %s)", async (real) => {
    if (real) h.config = { baseUrl: "http://aico", token: "test" };
    await import("./main");
    h.items([]);
    expect(drawerOf()).toEqual({ open: false, tab: "needs" });
    h.items([{ ticket: { id: "T-1", title: "Kế hoạch" }, kind: "plan", reason: null }]);
    expect(tileValue("#needs-count")).toBe("1");
    expect(document.title).toBe("(1) AICO Office");
    expect(drawerOf()).toEqual({ open: true, tab: "needs" });
    expect(getNode("#needs-count").classList.contains("hot")).toBe(true);
    expect(h.update).toHaveBeenLastCalledWith([{ id: "T-1", kind: "plan", label: expect.any(String) }]);
    h.items([]);
    expect(document.title).toBe("AICO Office");
    expect(drawerOf()).toEqual({ open: false, tab: "needs" });
    expect(getNode("#needs-count").classList.contains("hot")).toBe(false);
    expect(getNode("#needs-count").disabled).toBe(true);
    expect(tileValue("#needs-count")).toBe("0");
  });

  it("nguồn thật giữ đủ loại ticket, báo lỗi tải và gửi đúng hành động", async () => {
    h.config = { baseUrl: "http://aico", token: "test" };
    h.fetchTickets.mockResolvedValue([{ id: "T-1", title: "Kế hoạch", status: "awaiting_plan_approval", updated_at: null, artifacts: [] }]);
    await import("./main");
    const source = h.source();
    const items = await source.list();
    expect(items[0].kind).toBe("plan");
    await source.act(items[0], "approved", "đồng ý");
    expect(h.needAction).toHaveBeenCalledWith(h.config, "plan", "T-1", "approved", "đồng ý");
    h.fetchTickets.mockRejectedValueOnce(new Error("mất mạng"));
    await expect(source.list()).rejects.toThrow("mất mạng");
    // Nguồn chỉ trả dữ liệu; dấu lỗi do cột cập nhật sau latest gate.
    expect(getNode("#tickets-error").hidden).toBe(true);
    await source.list();
  });

  it("phím P đi tiếp từ thẻ đang chọn, bộ đếm luôn tới ticket đầu; đổi nguồn xoá trạng thái cũ", async () => {
    await import("./main");
    h.focus.mockReturnValue(true);
    h.items([{ ticket: { id: "T-1", title: "Một" }, kind: "plan" }, { ticket: { id: "T-2", title: "Hai" }, kind: "merge" }, { ticket: { id: "T-3", title: "Ba" }, kind: "escalated" }]);
    const preventDefault = vi.fn();
    const pressP = () => getNode("document").listeners.get("keydown")!({ key: "P", target: null, ctrlKey: false, metaKey: false, altKey: false, preventDefault });
    pressP();
    expect(h.focus).toHaveBeenLastCalledWith("T-1");
    expect(h.drawerRender.mock.invocationCallOrder.at(-1)!).toBeLessThan(h.focus.mock.invocationCallOrder.at(-1)!);
    expect(drawerOf()).toEqual({ open: true, tab: "needs" });
    pressP();
    expect(h.focus).toHaveBeenLastCalledWith("T-2");
    // Người dùng tự bấm ô ghi chú của T-1 (focusin): P tiếp theo phải tới T-2, không phải T-3.
    const note = Object.assign(new Node(), { closest: () => ({ dataset: { ticketId: "T-1" } }) });
    getNode("#needs").listeners.get("focusin")!({ target: note });
    pressP();
    expect(h.focus).toHaveBeenLastCalledWith("T-2");
    // Bộ đếm luôn tới ticket đầu, dù đang ở thẻ nào.
    getNode("#needs-count").listeners.get("click")!({});
    expect(h.focus).toHaveBeenLastCalledWith("T-1");
    getNode("#needs-count").listeners.get("click")!({});
    expect(h.focus).toHaveBeenLastCalledWith("T-1");
    const oldSource = h.source();
    getNode("#demo").listeners.get("click")!({});
    expect(h.reset).toHaveBeenCalledOnce();
    expect(document.title).toBe("AICO Office");
    expect(drawerOf().open).toBe(false);
    expect(h.feedRender).toHaveBeenLastCalledWith([], expect.any(Array));
    expect(getNode("#needs-count").classList.contains("hot")).toBe(false);
    expect(getNode("#needs-count").disabled).toBe(true);
    const nextSource = h.source.mock.calls.at(-1)![0];
    expect(nextSource).not.toBe(oldSource);
    expect((await nextSource.list()).length).toBe(4);
    expect(preventDefault).toHaveBeenCalled();
  });


  it("bấm Demo không xoá kết nối đã lưu; bấm lần nữa là quay về aico thật", async () => {
    h.config = { baseUrl: "http://aico", token: "test" };
    h.fetchWorkers.mockResolvedValue([room()]);
    const api = await import("./api");
    await import("./main");
    await connected();
    const demo = getNode("#demo");
    expect(demo.textContent).toBe("Demo");
    demo.listeners.get("click")!({});
    expect(getNode("#conn").textContent).toContain("demo");
    expect(demo.textContent).toBe("Thoát demo");
    expect(api.saveConfig).not.toHaveBeenCalled();
    h.fetchWorkers.mockClear();
    demo.listeners.get("click")!({});
    await connected();
    expect(h.fetchWorkers).toHaveBeenCalledWith(h.config);
    expect(getNode("#conn").textContent).toBe("Đã nối http://aico");
    expect(demo.textContent).toBe("Demo");
  });

  it("lỗi nguồn thật trả về muộn sau khi đổi sang demo không bật dấu lỗi", async () => {
    h.config = { baseUrl: "http://aico", token: "test" };
    let reject!: (error: Error) => void;
    h.fetchTickets.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    await import("./main");
    const pending = h.source().list();
    getNode("#demo").listeners.get("click")!({});
    reject(new Error("nguồn cũ mất mạng"));
    await expect(pending).rejects.toThrow("nguồn cũ mất mạng");
    expect(getNode("#tickets-error").hidden).toBe(true);
    expect(document.title).toBe("AICO Office");
    expect(drawerOf().open).toBe(false);
    expect(getNode("#needs-count").classList.contains("hot")).toBe(false);
  });

  it.each([false, true])("request cũ không ghi đè trạng thái lỗi mới (lỗi mới: %s)", async (newError) => {
    h.realColumn = true;
    h.config = { baseUrl: "http://aico", token: "test" };
    let resolveOld!: (value: unknown[]) => void;
    let rejectOld!: (error: Error) => void;
    h.fetchTickets.mockReturnValueOnce(new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }));
    await import("./main");
    // Poll khởi động còn chờ A; interval bắt đầu B cùng nguồn.
    if (newError) h.fetchTickets.mockRejectedValueOnce(new Error("lỗi mới"));
    else h.fetchTickets.mockResolvedValueOnce([]);
    const poll = vi.mocked(setInterval).mock.calls[0][0] as () => void;
    poll();
    await vi.waitFor(() => {
      expect(getNode("#tickets-error").hidden).toBe(!newError);
      if (newError) expect(getNode("#tickets-error").title).toContain("lỗi mới");
    });
    if (newError) resolveOld([]);
    else rejectOld(new Error("lỗi cũ"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getNode("#tickets-error").hidden).toBe(!newError);
    expect(getNode("#tickets-error").title).toBe(newError ? "Lỗi tải ticket: lỗi mới" : "");
    expect(getNode("#needs").children[1].textContent).toBe(getNode("#tickets-error").title);
    h.fetchTickets.mockResolvedValueOnce([]);
    poll();
    await vi.waitFor(() => {
      expect(getNode("#tickets-error").hidden).toBe(true);
      expect(getNode("#tickets-error").title).toBe("");
    });
  });

});

describe("thời gian tương đối", () => {
  it("frame truyền Date.now() cho tooltip, không truyền t của requestAnimationFrame", async () => {
    const epoch = 1_761_048_730_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(epoch);
    vi.stubGlobal("devicePixelRatio", 1);
    await import("./main");
    const frame = vi.mocked(requestAnimationFrame).mock.calls[0][0] as (t: number) => void;
    // t của rAF là ms từ lúc tải trang; tooltip phải nhận giờ epoch giả lập.
    frame(250);
    expect(h.tooltipUpdate).toHaveBeenLastCalledWith([], 100, epoch);
    now.mockReturnValue(epoch + 1500);
    frame(16);
    expect(h.tooltipUpdate).toHaveBeenLastCalledWith([], 100, epoch + 1500);
    now.mockRestore();
  });

  it("tick một giây làm mới panel bằng Date.now(); chuỗi Lần cuối nằm ở format.ts", async () => {
    const epoch = 1_761_048_730_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(epoch);
    h.config = { baseUrl: "http://aico", token: "test" };
    const iso = (delta: number) => new Date(epoch + delta).toISOString();
    h.fetchWorkers.mockResolvedValue([
      { name: "sắp", state: "idle", roles: [], last_run_at: iso(2_000) },
      {
        name: "xong", state: "working", roles: ["coder"], last_run_at: iso(-90_000),
        agents: [
          { id: "a", role: "coder", ticket_id: "T-1", mode: "write", started_at: iso(-90_000) },
          { id: "b", role: "coder", ticket_id: "T-2", mode: "read", started_at: iso(2_000) },
        ],
      },
      { name: "lâu", state: "idle", roles: [], last_run_at: iso(-90 * 60_000) },
      { name: "ngày", state: "idle", roles: [], last_run_at: iso(-2 * 86_400_000) },
      { name: "mới", state: "idle", roles: [], last_run_at: null },
    ]);
    await import("./main");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const render = vi.mocked(setInterval).mock.calls[1][0] as () => void;
    render();
    expect(h.tick).toHaveBeenLastCalledWith(epoch);
    expect(h.topbarUpdate.mock.calls.at(-1)?.[2]).toBe(epoch);
    expect(tileValue("#agents-count")).toBe("2");
    expect(getNode("#cards").children).toEqual([]);
    now.mockRestore();
  });
});

describe("chọn agent, feed và lỗi poll", () => {
  const cases: [string, (base: WorkerStatus) => WorkerStatus][] = [
    ["biến mất", (base) => ({ ...base, agents: [] })],
    ["started_at mới", (base) => ({ ...base, agents: [{ ...base.agents![0], started_at: "2026-02-01T00:00:00.000Z" }] })],
    ["phòng offline", (base) => ({ ...base, state: "offline" })],
    ["phòng limited", (base) => ({ ...base, state: "limited" })],
  ];
  it.each(cases)("agent đang chọn %s thì đóng, xuất hiện lại không tự mở và không lặp feed", async (label, mutate) => {
    h.config = { baseUrl: "http://aico", token: "test" };
    const selected = { ...agent, stats: { tokens_in: 100, tokens_cached: 80, tokens_out: 10 } };
    const base = room("working", [selected]);
    h.fetchWorkers.mockResolvedValue([base]);
    await import("./main");
    await connected();
    h.onSelect!(agentKey("claude", agent));
    expect(drawerOf()).toEqual({ open: true, tab: "agent" });
    expect(h.feedRender.mock.calls.at(-1)?.[0]).toHaveLength(1);
    expect(h.drawerRender.mock.calls.at(-1)?.[1].agent.stats).toEqual(selected.stats);
    const calls = h.sidebarUpdate.mock.calls.length;
    h.fetchWorkers.mockResolvedValue([mutate(base)]);
    pollTick();
    await vi.waitFor(() => expect(h.sidebarUpdate.mock.calls.length).toBeGreaterThan(calls));
    expect(drawerOf().open).toBe(false);
    // Chuyển sang limited thêm đúng một dòng hết hạn mức; ngoài ra không lặp dòng cũ.
    const lines = label === "phòng limited" ? 2 : 1;
    expect(h.feedRender.mock.calls.at(-1)?.[0]).toHaveLength(lines);
    const again = h.sidebarUpdate.mock.calls.length;
    h.fetchWorkers.mockResolvedValue([base]);
    pollTick();
    await vi.waitFor(() => expect(h.sidebarUpdate.mock.calls.length).toBeGreaterThan(again));
    expect(drawerOf().open).toBe(false);
    expect(h.sidebarUpdate.mock.calls.at(-1)?.[2]).toBeNull();
    expect(h.drawerRender.mock.calls.at(-1)?.[1]).toBeNull();
    expect(h.sidebarUpdate.mock.calls.at(-1)?.[0][0].agents[0].stats).toEqual(selected.stats);
    expect(h.feedRender.mock.calls.at(-1)?.[0]).toHaveLength(lines);
  });

  it("poll đổi stats và số agent 1→2→1 không trộn dữ liệu tới drawer và tooltip", async () => {
    h.config = { baseUrl: "http://aico", token: "test" };
    const snapshots = [
      [{ ...agent, stats: { tokens_in: 1_120_000, tokens_cached: 1_033_000, tokens_out: 100 } }],
      [{ ...agent, stats: { tokens_in: 200, tokens_cached: 80, tokens_out: 20 } },
        { ...agent, id: "b", stats: { tokens_in: 900, tokens_cached: 800, tokens_out: 90 } }],
      [{ ...agent, stats: { tokens_in: 0, tokens_out: 0 } }],
      [{ ...agent, stats: { tokens_in: 100, tokens_cached: 95, tokens_out: 10 } }],
    ];
    h.fetchWorkers.mockResolvedValue([room("working", snapshots[0])]);
    await import("./main");
    await connected();
    h.onSelect!(agentKey("claude", agent));
    // Cảnh giả chỉ tạo hình từ snapshot main truyền vào, không tự giữ stats.
    h.drawScene.mockImplementation((_ctx, workers: WorkerStatus[]) => workers.flatMap((worker) =>
      (worker.agents ?? []).map((current) => ({
        key: agentKey(worker.name, current), agent: current, room: worker.name,
        working: true, seated: true, x: 30, headY: 10, footY: 40,
      }))));
    const frame = vi.mocked(requestAnimationFrame).mock.calls[0][0] as (t: number) => void;
    for (const agents of snapshots) {
      const calls = h.sidebarUpdate.mock.calls.length;
      h.fetchWorkers.mockResolvedValue([room("working", agents)]);
      pollTick();
      await vi.waitFor(() => expect(h.sidebarUpdate.mock.calls.length).toBeGreaterThan(calls));
      expect(drawerOf()).toEqual({ open: true, tab: "agent" });
      expect(h.drawerRender.mock.calls.at(-1)?.[1]).toMatchObject({ agent: agents[0] });
      expect(h.drawerRender.mock.calls.at(-1)?.[1].agent.stats).toEqual(agents[0].stats);
      expect(tileValue("#agents-count")).toBe(String(agents.length));
      frame(0);
      const figures = h.tooltipUpdate.mock.calls.at(-1)?.[0];
      expect(figures.map((figure: { agent: unknown }) => figure.agent)).toEqual(agents);
    }
  });

  it("poll lỗi giữ stats cuối, hồi phục nhận stats mới; nguồn cũ trả muộn không khôi phục lựa chọn", async () => {
    h.config = { baseUrl: "http://aico", token: "test" };
    const first = { ...agent, stats: { tokens_in: 100, tokens_cached: 90, tokens_out: 10 } };
    const next = { ...agent, stats: { tokens_in: 200, tokens_cached: 20, tokens_out: 30 } };
    h.fetchWorkers.mockResolvedValue([room("working", [first])]);
    await import("./main");
    await connected();
    h.onSelect!(agentKey("claude", agent));
    h.fetchWorkers.mockRejectedValueOnce(new Error("mất mạng"));
    pollTick();
    await vi.waitFor(() => expect(getNode("#conn").textContent).toContain("Lỗi: mất mạng"));
    expect(h.drawerRender.mock.calls.at(-1)?.[1].agent.stats).toEqual(first.stats);
    expect(drawerOf()).toEqual({ open: true, tab: "agent" });
    h.fetchWorkers.mockResolvedValue([room("working", [next])]);
    pollTick();
    await connected();
    await vi.waitFor(() => expect(h.drawerRender.mock.calls.at(-1)?.[1].agent.stats).toEqual(next.stats));
    let resolveOld!: (workers: WorkerStatus[]) => void;
    h.fetchWorkers.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    pollTick();
    getNode("#demo").listeners.get("click")!({});
    resolveOld([room("working", [first])]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(drawerOf().open).toBe(false);
    expect(h.drawerRender.mock.calls.at(-1)?.[1]).toBeNull();
    expect(h.sidebarUpdate.mock.calls.at(-1)?.[0]).toEqual([]);
    expect(h.sidebarUpdate.mock.calls.at(-1)?.[2]).toBeNull();
    expect(getNode("#conn").textContent).toContain("demo");
  });

  it("needs 1→0 đóng ngăn; đang chọn agent thì về tab agent; 0→1 sau Esc thì mở lại", async () => {
    h.config = { baseUrl: "http://aico", token: "test" };
    h.fetchWorkers.mockResolvedValue([room()]);
    await import("./main");
    await connected();
    const item = { ticket: { id: "T-1", title: "Kế hoạch" }, kind: "plan" as const, reason: null };
    h.items([item]);
    expect(drawerOf()).toEqual({ open: true, tab: "needs" });
    h.items([]);
    expect(drawerOf().open).toBe(false);
    h.onSelect!(agentKey("claude", agent));
    h.items([item]);
    h.onTab!("needs");
    expect(drawerOf()).toEqual({ open: true, tab: "needs" });
    h.items([]);
    expect(drawerOf()).toEqual({ open: true, tab: "agent" });
    h.items([item]);
    press("Escape");
    expect(drawerOf().open).toBe(false);
    h.items([]);
    h.items([item]);
    expect(drawerOf()).toEqual({ open: true, tab: "needs" });
  });

  it("đổi nguồn xoá feed, lựa chọn và cờ đóng ngăn", async () => {
    h.config = { baseUrl: "http://aico", token: "test" };
    h.fetchWorkers.mockResolvedValue([room()]);
    await import("./main");
    await connected();
    h.onSelect!(agentKey("claude", agent));
    h.items([{ ticket: { id: "T-1", title: "Kế hoạch" }, kind: "plan", reason: null }]);
    press("Escape");
    expect(drawerOf().open).toBe(false);
    expect(h.feedRender.mock.calls.at(-1)?.[0]).not.toEqual([]);
    getNode("#demo").listeners.get("click")!({});
    expect(h.reset).toHaveBeenCalledOnce();
    expect(h.feedRender).toHaveBeenLastCalledWith([], expect.any(Array));
    expect(drawerOf().open).toBe(false);
    expect(h.sidebarUpdate.mock.calls.at(-1)?.[2]).toBeNull();
    h.items([{ ticket: { id: "T-2", title: "Mới" }, kind: "merge", reason: null }]);
    expect(drawerOf()).toEqual({ open: true, tab: "needs" });
  });

  it.each(["agent", "needs"] as const)("lỗi poll giữ ngăn %s và không thêm feed", async (mode) => {
    h.config = { baseUrl: "http://aico", token: "test" };
    h.fetchWorkers.mockResolvedValue([room()]);
    await import("./main");
    await connected();
    if (mode === "agent") h.onSelect!(agentKey("claude", agent));
    else h.items([{ ticket: { id: "T-1", title: "Kế hoạch" }, kind: "plan", reason: null }]);
    expect(drawerOf()).toEqual({ open: true, tab: mode });
    const feedCalls = h.feedRender.mock.calls.length;
    const lines = h.feedRender.mock.calls.at(-1)?.[0];
    h.fetchWorkers.mockRejectedValueOnce(new Error("mất mạng"));
    pollTick();
    await vi.waitFor(() => expect(getNode("#conn").textContent).toContain("Lỗi: mất mạng"));
    expect(getNode("#conn").className).toBe("conn bad");
    expect(h.feedRender.mock.calls.length).toBe(feedCalls);
    expect(h.feedRender.mock.calls.at(-1)?.[0]).toBe(lines);
    expect(drawerOf()).toEqual({ open: true, tab: mode });
    expect(h.sidebarUpdate.mock.calls.at(-1)?.[0]).toEqual([room()]);
  });

  it("bấm nhân vật thì mở ngăn; bấm trượt thì không; phím [ ] Esc bỏ qua khi đang nhập", async () => {
    h.config = { baseUrl: "http://aico", token: "test" };
    h.fetchWorkers.mockResolvedValue([room()]);
    await import("./main");
    await connected();
    h.drawScene.mockReturnValue([{
      key: "claude|a", agent, room: "claude", working: true, seated: true,
      x: 30, headY: 10, footY: 40,
    }]);
    const canvas = getNode("#office");
    canvas.clientWidth = 100;
    canvas.clientHeight = 100;
    const frame = vi.mocked(requestAnimationFrame).mock.calls[0][0] as (t: number) => void;
    frame(0);
    canvas.listeners.get("pointerdown")!({ clientX: 30, clientY: 0, button: 0 });
    expect(drawerOf().open).toBe(false);
    canvas.listeners.get("pointerdown")!({ clientX: 30, clientY: 30, button: 0 });
    expect(drawerOf()).toEqual({ open: true, tab: "agent" });
    const field = Object.assign(new Node(), { closest: () => field });
    press("[", field);
    press("]", field);
    press("Escape", field);
    expect(h.sidebarToggle).not.toHaveBeenCalled();
    expect(h.feedSetCollapsed).not.toHaveBeenCalled();
    expect(drawerOf().open).toBe(true);
    press("[");
    press("]");
    expect(h.sidebarToggle).toHaveBeenCalledOnce();
    expect(h.feedSetCollapsed).toHaveBeenLastCalledWith(true);
    expect(getNode(":root").vars["--free-left"]).toBe("0px");
    press("]");
    expect(h.feedSetCollapsed).toHaveBeenLastCalledWith(false);
    press("Escape");
    expect(drawerOf().open).toBe(false);
  });
});

describe("feed: bấm dòng, vị trí khung và đổi nguồn", () => {
  async function realWith(workers: WorkerStatus[]): Promise<void> {
    h.config = { baseUrl: "http://aico", token: "test" };
    h.fetchWorkers.mockResolvedValue(workers);
    await import("./main");
    await connected();
  }
  async function pollWith(workers: WorkerStatus[]): Promise<void> {
    const calls = h.sidebarUpdate.mock.calls.length;
    h.fetchWorkers.mockResolvedValue(workers);
    pollTick();
    await vi.waitFor(() => expect(h.sidebarUpdate.mock.calls.length).toBeGreaterThan(calls));
  }

  it("feed nhận lines kèm workers mới nhất", async () => {
    await realWith([room()]);
    expect(h.feedRender.mock.calls.at(-1)?.[1]).toEqual([room()]);
    await pollWith([room("idle", [])]);
    expect(h.feedRender.mock.calls.at(-1)?.[1]).toEqual([room("idle", [])]);
  });

  it("bấm dòng agent mở tab Agent đúng key; agent đổi started_at thì chọn bản đang có", async () => {
    await realWith([room()]);
    h.feedActions.onAgent!("claude", "a");
    expect(drawerOf()).toEqual({ open: true, tab: "agent" });
    expect(h.sidebarUpdate.mock.calls.at(-1)?.[2]).toBe(agentKey("claude", agent));
    expect(h.drawerRender.mock.calls.at(-1)?.[1].agent).toEqual(agent);
    press("Escape");
    const next = { ...agent, started_at: "2026-02-01T00:00:00.000Z" };
    await pollWith([room("working", [next])]);
    h.feedActions.onAgent!("claude", "a");
    expect(drawerOf()).toEqual({ open: true, tab: "agent" });
    expect(h.sidebarUpdate.mock.calls.at(-1)?.[2]).toBe(agentKey("claude", next));
  });

  const gone: [string, WorkerStatus[]][] = [
    ["agent đã đi", [room("working", [])]],
    ["phòng chuyển limited", [room("limited")]],
    ["phòng chuyển offline", [room("offline")]],
    ["phòng biến mất", []],
    ["agents sai kiểu", [{ ...room(), agents: "x" as unknown as [] }]],
  ];
  it.each(gone)("%s giữa chừng thì bấm dòng agent không mở ngăn", async (_label, after) => {
    await realWith([room()]);
    await pollWith(after);
    const renders = h.drawerRender.mock.calls.length;
    expect(() => h.feedActions.onAgent!("claude", "a")).not.toThrow();
    expect(drawerOf().open).toBe(false);
    expect(h.drawerRender.mock.calls.length).toBe(renders);
    expect(h.sidebarUpdate.mock.calls.at(-1)?.[2]).toBeNull();
    // Quay lại phòng thì bấm lại được.
    await pollWith([room()]);
    h.feedActions.onAgent!("claude", "a");
    expect(drawerOf()).toEqual({ open: true, tab: "agent" });
  });

  it("bấm dòng agent khác phòng cùng id chỉ chọn đúng phòng", async () => {
    const other = { ...room(), name: "codex" } as WorkerStatus;
    await realWith([room("limited"), other]);
    h.feedActions.onAgent!("claude", "a");
    expect(drawerOf().open).toBe(false);
    h.feedActions.onAgent!("codex", "a");
    expect(h.sidebarUpdate.mock.calls.at(-1)?.[2]).toBe(agentKey("codex", agent));
  });

  it("bấm dòng ticket mở Cần bạn và focus thẻ; ticket đã xử lý không lỗi, không đổi focusedTicket", async () => {
    await realWith([room()]);
    h.items([
      { ticket: { id: "T-1", title: "Một" }, kind: "plan", reason: null },
      { ticket: { id: "T-2", title: "Hai" }, kind: "merge", reason: null },
      { ticket: { id: "T-3", title: "Ba" }, kind: "escalated", reason: null },
    ]);
    press("Escape");
    h.onSelect!(agentKey("claude", agent));
    expect(drawerOf()).toEqual({ open: true, tab: "agent" });
    h.focus.mockReturnValue(true);
    h.feedActions.onTicket!("T-1");
    expect(drawerOf()).toEqual({ open: true, tab: "needs" });
    expect(h.focus).toHaveBeenLastCalledWith("T-1");
    expect(h.drawerRender.mock.invocationCallOrder.at(-1)!).toBeLessThan(h.focus.mock.invocationCallOrder.at(-1)!);
    // Thẻ đã xử lý: cột không tìm thấy nên focus trả false.
    h.focus.mockReturnValue(false);
    expect(() => h.feedActions.onTicket!("T-old")).not.toThrow();
    expect(drawerOf()).toEqual({ open: true, tab: "needs" });
    h.focus.mockReturnValue(true);
    press("P");
    expect(h.focus).toHaveBeenLastCalledWith("T-2");
  });

  it("bấm nhãn need mở tab Cần bạn rồi focus ticket", async () => {
    await realWith([room()]);
    h.items([{ ticket: { id: "T-1", title: "Một" }, kind: "plan", reason: null }]);
    h.onSelect!(agentKey("claude", agent));
    expect(drawerOf()).toEqual({ open: true, tab: "agent" });
    h.focus.mockReturnValue(true);
    h.drawerTicket!("T-1");
    expect(drawerOf()).toEqual({ open: true, tab: "needs" });
    expect(h.focus).toHaveBeenLastCalledWith("T-1");
    expect(h.drawerRender.mock.invocationCallOrder.at(-1)!).toBeLessThan(h.focus.mock.invocationCallOrder.at(-1)!);
  });

  it("bấm dòng ticket khi không còn thẻ nào thì không mở ngăn trống", async () => {
    await realWith([room()]);
    h.focus.mockReturnValue(false);
    expect(() => h.feedActions.onTicket!("T-old")).not.toThrow();
    expect(drawerOf().open).toBe(false);
  });

  it("relayout ghi --feed-left/--feed-room theo sidebar và drawer, trước khi đo #feed", async () => {
    const root = getNode(":root");
    root.clientWidth = 1440;
    root.clientHeight = 900;
    const sidebar = getNode("#sidebar");
    Object.assign(sidebar, { left: 10, top: 60, clientWidth: 300, clientHeight: 600 });
    const drawer = getNode("#drawer");
    Object.assign(drawer, { left: 1050, top: 60, clientWidth: 380, clientHeight: 600 });
    const feedNode = getNode("#feed");
    Object.assign(feedNode, { left: 320, top: 740, clientWidth: 700, clientHeight: 150 });
    const seen: string[] = [];
    const measure = feedNode.getBoundingClientRect.bind(feedNode);
    feedNode.getBoundingClientRect = () => {
      seen.push(root.vars["--feed-left"]);
      return measure();
    };
    h.sidebarToggle.mockImplementation(() => {
      sidebar.clientWidth = sidebar.clientWidth === 300 ? 44 : 300;
    });
    await realWith([room()]);
    const vars = () => [root.vars["--feed-left"], root.vars["--feed-room"]];
    expect(vars()).toEqual(["320px", "1110px"]);
    // computeInsets vẫn chừa đáy theo #feed.
    expect(root.vars["--free-bottom"]).toBe("170px");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
    h.onSelect!(agentKey("claude", agent));
    expect(vars()).toEqual(["320px", "720px"]);
    press("[");
    expect(vars()).toEqual(["64px", "976px"]);
    press("Escape");
    expect(drawerOf().open).toBe(false);
    expect(vars()).toEqual(["64px", "1366px"]);
    press("[");
    expect(vars()).toEqual(["320px", "1110px"]);
    h.onSelect!(agentKey("claude", agent));
    expect(vars()).toEqual(["320px", "720px"]);
    expect(root.vars["--free-bottom"]).toBe("170px");
  });

  it("màn hẹp: feed rộng hết màn trừ lề, không theo sidebar/drawer", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: String(query).includes("max-width"), addEventListener() {}, removeEventListener() {},
    }));
    const root = getNode(":root");
    root.clientWidth = 390;
    root.clientHeight = 844;
    Object.assign(getNode("#sidebar"), { left: 10, top: 60, clientWidth: 300, clientHeight: 600 });
    await realWith([room()]);
    expect([root.vars["--feed-left"], root.vars["--feed-room"]]).toEqual(["10px", "370px"]);
  });

  it("màn hẹp: --feed-reserve theo chiều cao feed thật để drawer đứng trên feed, cả hai tab", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: String(query).includes("max-width"), addEventListener() {}, removeEventListener() {},
    }));
    const root = getNode(":root");
    root.clientWidth = 390;
    root.clientHeight = 844;
    const feedNode = getNode("#feed");
    // Feed mở cao 45vh (380px) hay thu gọn còn 38px; mock đổi kích thước theo lớp is-collapsed.
    const open = { left: 10, top: 454, clientWidth: 370, clientHeight: 380 };
    const shut = { left: 10, top: 796, clientWidth: 370, clientHeight: 38 };
    Object.assign(feedNode, open);
    feedNode.classList.toggle = (name: string, force?: boolean) => {
      const on = force ?? !feedNode.classList.contains(name);
      if (on) feedNode.classList.add(name); else feedNode.classList.remove(name);
      if (name === "is-collapsed") Object.assign(feedNode, on ? shut : open);
      return on;
    };
    await realWith([room()]);
    const reserve = () => root.vars["--feed-reserve"];
    expect(reserve()).toBe("390px");
    // Mở ngăn Agent khi feed đang mở: drawer vẫn chừa đủ chỗ cho feed.
    h.onSelect!(agentKey("claude", agent));
    expect(drawerOf()).toEqual({ open: true, tab: "agent" });
    expect(reserve()).toBe("390px");
    press("]");
    expect(reserve()).toBe("48px");
    // Mở lại feed lúc drawer đang hiện: drawer lùi lên theo.
    press("]");
    expect(reserve()).toBe("390px");
    h.items([{ ticket: { id: "T-1", title: "Kế hoạch" }, kind: "plan" as const, reason: null }]);
    h.onTab!("needs");
    expect(drawerOf()).toEqual({ open: true, tab: "needs" });
    expect(reserve()).toBe("390px");
    press("]");
    expect(reserve()).toBe("48px");
    press("Escape");
    press("]");
    expect(reserve()).toBe("390px");
  });

  it("feed ẩn hoặc chưa đo được thì xoá --feed-reserve để CSS dùng giá trị mặc định", async () => {
    getNode("#feed").hidden = true;
    await realWith([room()]);
    expect(getNode(":root").vars["--feed-reserve"]).toBe("");
  });

  it.each([["open", false], ["collapsed", true], ["x", null]] as const)("?feed=%s đặt trạng thái khung lúc mở trang", async (value, collapsed) => {
    vi.stubGlobal("location", { search: `?feed=${value}` });
    await import("./main");
    if (collapsed === null) expect(h.feedSetCollapsed).not.toHaveBeenCalled();
    else expect(h.feedSetCollapsed).toHaveBeenCalledExactlyOnceWith(collapsed);
  });

  it("phím ] thu/mở đúng một lần mỗi lần bấm", async () => {
    await realWith([room()]);
    expect(h.feedKey).not.toBeNull();
    press("]");
    expect(h.feedSetCollapsed).toHaveBeenCalledOnce();
    expect(getNode("#feed").classList.contains("is-collapsed")).toBe(true);
    press("]");
    expect(h.feedSetCollapsed).toHaveBeenCalledTimes(2);
    expect(getNode("#feed").classList.contains("is-collapsed")).toBe(false);
  });

  it.each([true, false])("đổi nguồn làm feed rỗng và ẩn viên N mới (từ nguồn thật: %s)", async (fromReal) => {
    if (fromReal) await realWith([room()]);
    else await import("./main");
    h.feedScrolledUp = true;
    h.items([{ ticket: { id: "T-1", title: "Kế hoạch" }, kind: "plan", reason: null }]);
    h.items([{ ticket: { id: "T-2", title: "Hai" }, kind: "merge", reason: null }]);
    expect(h.feedPending).toBeGreaterThan(0);
    if (fromReal) getNode("#demo").listeners.get("click")!({});
    else {
      h.fetchWorkers.mockResolvedValue([room()]);
      vi.stubGlobal("FormData", class { get(name: string) { return name === "baseUrl" ? "http://aico" : "tok"; } });
      getNode("#settings").listeners.get("submit")!({ preventDefault() {} });
    }
    expect(h.feedRender.mock.calls.at(-1)?.[0]).toEqual([]);
    expect(h.feedPending).toBe(0);
    // Demo → thật đi qua form cài đặt có token.
    if (fromReal) expect(getNode("#conn").textContent).toContain("demo");
    else await connected();
  });

  it("poll lỗi giữ nguyên feed và viên N mới", async () => {
    await realWith([room()]);
    h.feedScrolledUp = true;
    h.items([{ ticket: { id: "T-1", title: "Kế hoạch" }, kind: "plan", reason: null }]);
    const pending = h.feedPending;
    const calls = h.feedRender.mock.calls.length;
    const lines = h.feedRender.mock.calls.at(-1)?.[0];
    h.fetchWorkers.mockRejectedValueOnce(new Error("mất mạng"));
    pollTick();
    await vi.waitFor(() => expect(getNode("#conn").textContent).toContain("Lỗi: mất mạng"));
    expect(h.feedRender.mock.calls.length).toBe(calls);
    expect(h.feedRender.mock.calls.at(-1)?.[0]).toBe(lines);
    expect(h.feedPending).toBe(pending);
  });
});

describe("ánh sáng, snapshot và banner demo", () => {
  it.each(["done", "mr", "escalated"].flatMap((kind) => [false, true].map((slow) => ({ kind, slow }))))(
    "nhớ phòng từ worker khi ticket lỗi hoặc chậm: $kind / $slow", async ({ kind, slow }) => {
      h.config = { baseUrl: "http://aico", token: "test" };
      h.realColumn = true;
      const initial = { id: "T-1", title: "Một", status: "in_progress", project: null, updated_at: null, artifacts: [] };
      h.fetchTickets.mockResolvedValue([initial]);
      h.fetchWorkers.mockResolvedValue([]);
      await import("./main");
      await connected();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const frame = vi.mocked(requestAnimationFrame).mock.calls[0][0] as (t: number) => void;
      let release!: (tickets: unknown[]) => void;
      if (slow) h.fetchTickets.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
      else h.fetchTickets.mockRejectedValueOnce(new Error("mất mạng"));
      h.fetchWorkers.mockResolvedValue([room("working", [{ ...agent, ticket_id: "T-1" }])]);
      const calls = h.fetchWorkers.mock.calls.length;
      pollTick();
      await vi.waitFor(() => expect(h.fetchWorkers.mock.calls.length).toBeGreaterThan(calls));
      await new Promise((resolve) => setTimeout(resolve, 0));
      h.fetchWorkers.mockResolvedValue([]);
      h.fetchTickets.mockResolvedValue([{
        ...initial, status: kind === "mr" ? "in_progress" : kind,
        artifacts: kind === "mr" ? [{ kind: "merge_request", ref: "!1", url: null }] : [],
      }]);
      const updates = h.sidebarUpdate.mock.calls.length;
      pollTick();
      await vi.waitFor(() => expect(h.sidebarUpdate.mock.calls.length).toBeGreaterThan(updates));
      if (slow) {
        release([initial]);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getNode("#tickets-error").title).toBe("");
      frame(0);
      expect(h.overlayDraw.mock.calls.at(-1)?.[3].banners)
        .toMatchObject([{ provider: "claude", ticket: "T-1", kind }]);
    },
  );

  it("worker cũ trả muộn không được thêm ánh xạ ticket", async () => {
    h.config = { baseUrl: "http://aico", token: "test" };
    h.realColumn = true;
    const initial = { id: "T-1", title: "Một", status: "in_progress", project: null, updated_at: null, artifacts: [] };
    h.fetchTickets.mockResolvedValue([initial]);
    await import("./main");
    await connected();
    await new Promise((resolve) => setTimeout(resolve, 0));
    let release!: (workers: WorkerStatus[]) => void;
    h.fetchWorkers.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    pollTick();
    h.fetchWorkers.mockResolvedValue([]);
    pollTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    release([room("working", [{ ...agent, ticket_id: "T-1" }])]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.fetchTickets.mockResolvedValue([{ ...initial, status: "done" }]);
    const calls = h.sidebarUpdate.mock.calls.length;
    pollTick();
    await vi.waitFor(() => expect(h.sidebarUpdate.mock.calls.length).toBeGreaterThan(calls));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = vi.mocked(requestAnimationFrame).mock.calls[0][0] as (t: number) => void;
    frame(0);
    expect(h.overlayDraw.mock.calls.at(-1)?.[3].banners).toEqual([]);
  });

  it("snapshot nguồn thật giữ done, panel chỉ lấy ticket cần người", async () => {
    h.config = { baseUrl: "http://aico", token: "test" };
    const done = { id: "T-done", title: "Xong", status: "done", project: null, updated_at: null, artifacts: [] };
    const plan = { id: "T-1", title: "Kế hoạch", status: "awaiting_plan_approval", project: null, updated_at: null, artifacts: [] };
    h.fetchTickets.mockResolvedValue([done, plan]);
    await import("./main");
    const listed = await h.source().list();
    expect(listed.map((item: { ticket: { id: string } }) => item.ticket.id)).toEqual(["T-1"]);
    expect(listed.tickets.map((ticket: { status: string }) => ticket.status)).toEqual(["done", "awaiting_plan_approval"]);
  });

  it("demo giữ 4 thẻ và đưa ticket sự kiện vào snapshot", async () => {
    await import("./main");
    const listed = await h.source().list();
    expect(listed).toHaveLength(4);
    expect(listed.some((item: { ticket: { id: string } }) => item.ticket.id.startsWith("T-ev-"))).toBe(false);
    expect(listed.tickets.some((ticket: { id: string }) => String(ticket.id).startsWith("T-ev-"))).toBe(true);
  });

  it("?hour chỉ điều khiển phút ánh sáng; reduced motion đổi theo từng frame", async () => {
    vi.stubGlobal("location", { search: "?hour=21:30" });
    const epoch = 1_761_048_730_000;
    vi.spyOn(Date, "now").mockReturnValue(epoch);
    vi.stubGlobal("devicePixelRatio", 1);
    let reduce = false;
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: String(query).includes("reduced-motion") ? reduce : false,
      addEventListener() {},
      removeEventListener() {},
    }));
    await import("./main");
    const frame = vi.mocked(requestAnimationFrame).mock.calls[0][0] as (t: number) => void;
    frame(10);
    const call = h.drawScene.mock.calls.at(-1) as unknown as unknown[];
    expect(call[3]).toBe(epoch);
    expect(call[4]).toMatchObject({ minutes: 21 * 60 + 30, reducedMotion: false });
    expect(h.overlayDraw.mock.calls.at(-1)?.[2]).toBe(epoch);
    expect(h.overlayDraw.mock.calls.at(-1)?.[3].banners).toEqual([]);
    expect(Array.isArray(h.overlayDraw.mock.calls.at(-1)?.[3].signs)).toBe(true);
    reduce = true;
    frame(20);
    const next = h.drawScene.mock.calls.at(-1) as unknown as unknown[];
    expect(next[4]).toMatchObject({ minutes: 21 * 60 + 30, reducedMotion: true });
    expect(next[3]).toBe(epoch);
  });

  it("demo phát MR sau baseline và xoá banner khi đổi nguồn", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(0);
    await import("./main");
    let polls = 0;
    h.refresh.mockImplementation(async () => {
      const listed = await h.source().list();
      if (Array.isArray(listed.tickets)) h.onSnapshot?.(listed.tickets);
      polls += 1;
    });
    const frame = vi.mocked(requestAnimationFrame).mock.calls[0][0] as (t: number) => void;
    const poll = vi.mocked(setInterval).mock.calls[0][0] as () => void;
    try {
      poll();
      await vi.waitFor(() => expect(polls).toBe(1));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getNode("#tickets-error").title).toBe("");
      frame(0);
      expect(h.overlayDraw.mock.calls.at(-1)?.[3].banners).toEqual([]);
      now.mockReturnValue(12_000);
      poll();
      await vi.waitFor(() => expect(polls).toBe(2));
      await new Promise((resolve) => setTimeout(resolve, 0));
      frame(16);
      const banners = h.overlayDraw.mock.calls.at(-1)?.[3].banners as { kind: string; provider: string }[];
      expect(banners.some((banner) => banner.kind === "mr" && banner.provider === "claude")).toBe(true);
      getNode("#demo").listeners.get("click")!({});
      await vi.waitFor(() => expect(polls).toBeGreaterThanOrEqual(3));
      await new Promise((resolve) => setTimeout(resolve, 0));
      frame(32);
      expect(h.overlayDraw.mock.calls.at(-1)?.[3].banners).toEqual([]);
    } finally {
      h.refresh.mockReset();
      h.refresh.mockImplementation(async () => {});
      now.mockRestore();
    }
  });
});
