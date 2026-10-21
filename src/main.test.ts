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
  drawScene: vi.fn(() => [] as Record<string, unknown>[]),
  topbarUpdate: vi.fn(),
  sidebarUpdate: vi.fn(),
  sidebarToggle: vi.fn(),
  drawerRender: vi.fn(),
  feedRender: vi.fn(),
  feedSetCollapsed: vi.fn(),
  onSelect: null as ((key: string) => void) | null,
  onClose: null as (() => void) | null,
  onTab: null as ((tab: "agent" | "needs") => void) | null,
}));
vi.mock("./api", async (original) => ({
  ...await original<typeof import("./api")>(), loadConfig: () => h.config,
  demoWorkers: () => [], saveConfig: vi.fn(), fetchWorkers: h.fetchWorkers, fetchTickets: h.fetchTickets,
  fetchTicketSnapshot: h.fetchTickets, needAction: h.needAction,
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
  createDrawer: (root: Node, _needs: unknown, options: { onClose(): void; onTab(tab: "agent" | "needs"): void }) => {
    h.onClose = options.onClose;
    h.onTab = options.onTab;
    root.hidden = true;
    return {
      onLayout() {},
      render(view: { open: boolean; tab: string }, info: unknown, now: number) {
        h.drawerRender(view, info, now);
        root.hidden = !view.open;
        root.dataset.tab = view.tab;
      },
      destroy() {},
    };
  },
}));
vi.mock("./ui/feed", () => ({
  createFeed: () => ({
    setCollapsed(value: boolean) {
      h.feedSetCollapsed(value);
      getNode("#feed").classList.toggle("is-collapsed", value);
    },
    onLayout() {},
    render(lines: unknown[]) {
      h.feedRender(lines);
    },
    destroy() {},
  }),
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
  setAttribute() {}
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
    return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON() { return {}; } };
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
function press(key: string, target: unknown = null): void {
  getNode("document").listeners.get("keydown")!({
    key, target, ctrlKey: false, metaKey: false, altKey: false, repeat: false,
    preventDefault() {}, stopImmediatePropagation() {},
  });
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
    expect(h.feedRender).toHaveBeenLastCalledWith([]);
    expect(getNode("#needs-count").classList.contains("hot")).toBe(false);
    expect(getNode("#needs-count").disabled).toBe(true);
    const nextSource = h.source.mock.calls.at(-1)![0];
    expect(nextSource).not.toBe(oldSource);
    expect((await nextSource.list()).length).toBe(4);
    expect(preventDefault).toHaveBeenCalled();
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
    expect(label.length).toBeGreaterThan(0);
    h.config = { baseUrl: "http://aico", token: "test" };
    const base = room();
    h.fetchWorkers.mockResolvedValue([base]);
    await import("./main");
    await connected();
    h.onSelect!(agentKey("claude", agent));
    expect(drawerOf()).toEqual({ open: true, tab: "agent" });
    expect(h.feedRender.mock.calls.at(-1)?.[0]).toHaveLength(1);
    const calls = h.sidebarUpdate.mock.calls.length;
    h.fetchWorkers.mockResolvedValue([mutate(base)]);
    pollTick();
    await vi.waitFor(() => expect(h.sidebarUpdate.mock.calls.length).toBeGreaterThan(calls));
    expect(drawerOf().open).toBe(false);
    expect(h.feedRender.mock.calls.at(-1)?.[0]).toHaveLength(1);
    const again = h.sidebarUpdate.mock.calls.length;
    h.fetchWorkers.mockResolvedValue([base]);
    pollTick();
    await vi.waitFor(() => expect(h.sidebarUpdate.mock.calls.length).toBeGreaterThan(again));
    expect(drawerOf().open).toBe(false);
    expect(h.sidebarUpdate.mock.calls.at(-1)?.[2]).toBeNull();
    expect(h.feedRender.mock.calls.at(-1)?.[0]).toHaveLength(1);
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
    expect(h.feedRender).toHaveBeenLastCalledWith([]);
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

describe("ánh sáng, snapshot và banner demo", () => {
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
