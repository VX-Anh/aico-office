import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  realColumn: false,
  config: null as { baseUrl: string; token: string } | null,
  column: vi.fn(), source: vi.fn(), items: vi.fn(), refresh: vi.fn(async () => {}),
  reset: vi.fn(), update: vi.fn(), focus: vi.fn(), fetchTickets: vi.fn(), needAction: vi.fn(),
}));
vi.mock("./api", async (original) => ({
  ...await original<typeof import("./api")>(), loadConfig: () => h.config,
  demoWorkers: () => [], saveConfig: vi.fn(), fetchWorkers: async () => [], fetchTickets: h.fetchTickets, needAction: h.needAction,
}));
vi.mock("./needs-column", async (original) => {
  const actual = await original<typeof import("./needs-column")>();
  return { createNeedsColumn: (...args: Parameters<typeof actual.createNeedsColumn>) =>
    h.realColumn ? actual.createNeedsColumn(...args) : h.column(...args) };
});
vi.mock("./toasts", () => ({ createToasts: () => ({ reset: h.reset, update: h.update }) }));
vi.mock("./overlay", () => ({ createOverlay: () => ({ draw: vi.fn() }) }));
vi.mock("./agent-tooltip", () => ({ createAgentTooltip: () => ({ update: vi.fn() }) }));
vi.mock("./scene/index", () => ({
  ROLE_STYLES: {}, USAGE: {}, drawScene: vi.fn(), resetActors: vi.fn(),
  roleStyle: vi.fn(), sceneSize: () => ({ width: 100, height: 100 }),
}));

class Node {
  children: Node[] = [];
  classList = {
    add: (name: string) => { this.classes.add(name); },
    toggle: (name: string, enabled: boolean) => { if (enabled) this.classes.add(name); else this.classes.delete(name); },
    contains: (name: string) => this.classes.has(name),
  };
  classes = new Set<string>();
  setAttribute() {}
  textContent = "";
  hidden = false;
  disabled = false;
  title = "";
  className = "";
  style = {};
  listeners = new Map<string, (event: unknown) => void>();
  isContentEditable = false;
  matches() { return false; }
  elements = { namedItem: () => ({ value: "" }) };
  append(...children: Node[]) { this.children.push(...children); }
  replaceChildren() {}
  getContext() { return {}; }
  addEventListener(type: string, fn: (event: unknown) => void) { this.listeners.set(type, fn); }
  querySelector(selector: string) { return getNode(selector); }
}
let nodes: Map<string, Node>;
function getNode(selector: string): Node {
  if (!nodes.has(selector)) nodes.set(selector, new Node());
  return nodes.get(selector)!;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.realColumn = false;
  h.config = null;
  nodes = new Map();
  getNode("#tickets-error").hidden = true;
  h.column.mockImplementation((_root, source, items) => {
    h.source.mockImplementation(() => source);
    h.items.mockImplementation(items);
    return { refresh: h.refresh, setSource: h.source, tick: vi.fn(), focus: h.focus };
  });
  vi.stubGlobal("HTMLElement", Node);
  vi.stubGlobal("document", {
    querySelector: getNode, createElement: () => new Node(),
    createTextNode: () => new Node(), addEventListener: (type: string, fn: (event: unknown) => void) => getNode("document").addEventListener(type, fn), title: "",
  });
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  vi.stubGlobal("setInterval", vi.fn());
});

afterEach(() => { vi.unstubAllGlobals(); });

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
    expect(getNode("#agents-count").textContent).toBe("Đang làm: 0 agent");
  });

  it.each([false, true])("cập nhật bố cục, bộ đếm và toast (nguồn thật: %s)", async (real) => {
    if (real) h.config = { baseUrl: "http://aico", token: "test" };
    await import("./main");
    h.items([]);
    expect(getNode(".workspace").classList.contains("has-needs")).toBe(false);
    h.items([{ ticket: { id: "T-1" }, kind: "plan", reason: null }]);
    expect(getNode("#needs-count").textContent).toBe("Cần bạn: 1");
    expect(document.title).toBe("(1) AICO Office");
    expect(getNode(".workspace").classList.contains("has-needs")).toBe(true);
    expect(getNode("#needs-count").classList.contains("hot")).toBe(true);
    expect(h.update).toHaveBeenLastCalledWith([{ id: "T-1", kind: "plan", label: expect.any(String) }]);
    h.items([]);
    expect(document.title).toBe("AICO Office");
    expect(getNode(".workspace").classList.contains("has-needs")).toBe(false);
    expect(getNode("#needs-count").classList.contains("hot")).toBe(false);
    expect(getNode("#needs-count").disabled).toBe(true);
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

  it("phím P và bộ đếm lần lượt focus ticket; đổi nguồn xoá trạng thái cũ", async () => {
    await import("./main");
    h.focus.mockReturnValue(true);
    h.items([{ ticket: { id: "T-1" }, kind: "plan" }, { ticket: { id: "T-2" }, kind: "merge" }]);
    const preventDefault = vi.fn();
    getNode("document").listeners.get("keydown")!({ key: "P", target: null, ctrlKey: false, metaKey: false, altKey: false, preventDefault });
    expect(h.focus).toHaveBeenLastCalledWith("T-1");
    getNode("#needs-count").listeners.get("click")!({});
    expect(h.focus).toHaveBeenLastCalledWith("T-2");
    const oldSource = h.source();
    getNode("#demo").listeners.get("click")!({});
    expect(h.reset).toHaveBeenCalledOnce();
    expect(document.title).toBe("AICO Office");
    expect(getNode(".workspace").classList.contains("has-needs")).toBe(false);
    expect(getNode("#needs-count").classList.contains("hot")).toBe(false);
    expect(getNode("#needs-count").disabled).toBe(true);
    const nextSource = h.source.mock.calls.at(-1)![0];
    expect(nextSource).not.toBe(oldSource);
    expect((await nextSource.list()).length).toBe(4);
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
    expect(getNode(".workspace").classList.contains("has-needs")).toBe(false);
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
