import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerAgent, WorkerStatus } from "../api";
import { agentKey } from "./selection";
import { createSidebar } from "./sidebar";
import { HIDDEN_ROOMS_KEY } from "./sidebar-model";

// Đếm lần vẽ lại avatar: sidebar gọi createAvatar khi id hoặc vai trò đổi.
const avatarMock = vi.hoisted(() => ({ calls: 0 }));

vi.mock("./avatar", () => ({
  avatarIdentity: (agent: { id: string; role: string | null }) => `${agent.id}/${agent.role}`,
  createAvatar: () => {
    avatarMock.calls += 1;
    return document.createElement("canvas");
  },
}));

interface FakeEvent {
  type: string;
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  target: unknown;
  defaultPrevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}
type Listener = (event: FakeEvent) => void;

let doc: { activeElement: Node | null; listeners: Listener[] };

// DOM giả đủ cho sidebar: cây con, thuộc tính, sự kiện nổi bọt lên document, focus mất khi node bị tháo.
class Node {
  children: Node[] = [];
  parentElement: Node | null = null;
  private text = "";
  className = "";
  hidden = false;
  inert = false;
  title = "";
  type = "";
  value = "";
  placeholder = "";
  autocomplete = "";
  spellcheck = true;
  isContentEditable = false;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, Listener[]>();
  style = {
    background: "", color: "", width: "",
    props: new Map<string, string>(),
    setProperty(name: string, value: string) { this.props.set(name, value); },
    getPropertyValue(name: string) { return this.props.get(name) ?? ""; },
  };
  constructor(readonly tagName = "div") {}
  get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value: string) { this.replaceChildren(); this.text = value; }
  get lastElementChild(): Node | null { return this.children.at(-1) ?? null; }
  classList = {
    add: (...names: string[]) => { this.className = [this.className, ...names].filter(Boolean).join(" "); },
    contains: (name: string) => this.className.split(" ").includes(name),
    toggle: (name: string, value: boolean) => {
      const names = this.className.split(" ").filter((item) => item && item !== name);
      if (value) names.push(name);
      this.className = names.join(" ");
    },
  };
  append(...nodes: Node[]) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node: Node, before: Node | null) {
    node.remove();
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, node);
    node.parentElement = this;
  }
  contains(node: Node | null): boolean {
    for (let at = node; at; at = at.parentElement) if (at === this) return true;
    return false;
  }
  remove() {
    // Trình duyệt bỏ focus khi node đang focus (hoặc tổ tiên của nó) bị tháo khỏi cây.
    if (this.contains(doc.activeElement)) doc.activeElement = null;
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this);
    this.parentElement = null;
  }
  replaceChildren(...nodes: Node[]) {
    for (const node of [...this.children]) node.remove();
    this.text = "";
    this.append(...nodes);
  }
  replaceWith(node: Node) { this.parentElement?.insertBefore(node, this); this.remove(); }
  after(node: Node) {
    const parent = this.parentElement;
    if (parent) parent.insertBefore(node, parent.children[parent.children.indexOf(this) + 1] ?? null);
  }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  closest(selector: string): Node | null {
    const tags = selector.split(",").map((s) => s.trim());
    for (let at: Node | null = this; at; at = at.parentElement) if (tags.includes(at.tagName)) return at;
    return null;
  }
  focus() { doc.activeElement = this; }
  blur() { if (doc.activeElement === this) doc.activeElement = null; }
  addEventListener(name: string, cb: Listener) { this.listeners.set(name, [...this.listeners.get(name) ?? [], cb]); }
  fire(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const event: FakeEvent = {
      type, target: this, defaultPrevented: false, stopped: false, ...init,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
    };
    for (let at: Node | null = this; at && !event.stopped; at = at.parentElement) at.listeners.get(type)?.forEach((cb) => cb(event));
    if (!event.stopped && type === "keydown") doc.listeners.forEach((cb) => cb(event));
    return event;
  }
  all(cls: string): Node[] {
    const out: Node[] = [];
    for (const child of this.children) {
      if (child.classList.contains(cls)) out.push(child);
      out.push(...child.all(cls));
    }
    return out;
  }
  find(cls: string): Node {
    const node = this.all(cls)[0];
    if (!node) throw new Error(`không có .${cls}`);
    return node;
  }
}

let mediaChange: ((event: { matches: boolean }) => void) | null;
function stubMedia(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({ matches, addEventListener: (_: string, cb: typeof mediaChange) => { mediaChange = cb; } }));
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}

beforeEach(() => {
  avatarMock.calls = 0;
  doc = { activeElement: null, listeners: [] };
  mediaChange = null;
  vi.stubGlobal("HTMLElement", Node);
  vi.stubGlobal("localStorage", memoryStorage());
  stubMedia(false);
  vi.stubGlobal("document", {
    createElement: (tag: string) => new Node(tag),
    createTextNode: (text: string) => { const node = new Node("#text"); node.textContent = text; return node; },
    addEventListener: (_name: string, cb: Listener) => { doc.listeners.push(cb); },
    get activeElement() { return doc.activeElement; },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const NOW = Date.parse("2026-10-22T10:00:00Z");
const iso = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

function agent(id: string, role: string | null, ticket: string, text: string, started = iso(183)): WorkerAgent {
  return { id, role, ticket_id: ticket, mode: "write", started_at: started, activity: { kind: "edit", text, at: iso(5) } } as WorkerAgent;
}
const a1 = agent("a1", "coder", "T-11", "Sửa giao diện");
const a2 = agent("a2", "reviewer", "T-22", "Đọc diff");
const b1 = agent("b1", "tech_lead", "T-33", "Thiết kế kế hoạch");
const claude = (over: Partial<WorkerStatus> = {}): WorkerStatus => ({ name: "claude", state: "working", roles: [], slots: 3, agents: [a1, a2], ...over });
const codex = (over: Partial<WorkerStatus> = {}): WorkerStatus => ({ name: "codex", state: "working", roles: [], slots: 2, agents: [b1], ...over });
const NONE = new Set<string>();

function setup(workers: WorkerStatus[] = [claude(), codex()], options: { shortcut?: boolean } = {}) {
  const parent = new Node();
  const root = new Node("aside");
  parent.append(root);
  const onSelect = vi.fn();
  const sidebar = createSidebar(root as unknown as HTMLElement, { onSelect, ...options });
  const [head, tools, scroll, legend] = root.children;
  const input = tools.find("sidebar-input");
  const view = {
    sidebar, root, parent, head, tools, scroll, legend, input, onSelect,
    update: (w = workers, needs: ReadonlySet<string> = NONE, sel: string | null = null, now = NOW) => sidebar.update(w, needs, sel, now),
    type(value: string) { input.value = value; input.fire("input"); },
    rooms: () => scroll.find("sidebar-rooms").children,
    roomNames: () => scroll.find("sidebar-rooms").children.map((r) => r.find("room-name").textContent),
    rowsOf: (name: string) => {
      const block = view.rooms().find((r) => r.find("room-name").textContent === name);
      return block ? block.find("room-agents").children : [];
    },
    rows: () => scroll.all("agent-row"),
    room: (name: string) => view.rooms().find((r) => r.find("room-name").textContent === name)!,
    none: () => scroll.find("sidebar-empty"),
    chips: () => tools.find("sidebar-chips").children,
    chip: (name: string) => view.chips().find((c) => c.find("room-chip-name").textContent === name)!,
    filtering: () => head.find("sidebar-filtering"),
    key: (key: string, init: Partial<FakeEvent> = {}, target: Node = root) => target.fire("keydown", { key, ...init }),
  };
  view.update();
  return view;
}
const roles = (rows: Node[]) => rows.map((r) => r.find("agent-role").textContent);

describe("bố cục đầu phòng và chữ cái chip", () => {
  it.each(["working", "offline", "limited"] as const)("các ô dòng đầu nằm trực tiếp trong grid đầu phòng: %s", (state) => {
    const v = setup([claude({ state, last_error: "Lỗi thử" }), codex({ state })]);
    for (const room of v.rooms()) {
      const head = room.find("room-head");
      expect(head.children.map((node) => node.className)).toEqual([
        "room-letter title-pixel", "room-name", "room-count",
        "room-alert", "room-state", "room-slots",
      ]);
    }
  });

  it("mọi chip dùng kiểu room-letter ở cả trạng thái bật, tắt rồi bật lại", () => {
    const v = setup();
    for (const chip of v.chips()) {
      const letter = chip.find("room-chip-letter");
      for (const pressed of ["true", "false", "true"]) {
        expect(chip.getAttribute("aria-pressed")).toBe(pressed);
        expect(letter.classList.contains("room-letter")).toBe(true);
        chip.fire("click");
      }
    }
  });
});

describe("giữ hành vi cũ", () => {
  it("thứ tự phòng, nút « », chú thích vai trò, bấm dòng gọi onSelect", () => {
    const v = setup([codex(), claude()]);
    expect(v.roomNames()).toEqual(["codex", "claude"]);
    const toggle = v.head.find("sidebar-toggle");
    expect(toggle.textContent).toBe("«");
    toggle.fire("click");
    expect(v.sidebar.isCollapsed()).toBe(true);
    expect(toggle.textContent).toBe("»");
    expect(v.tools.inert).toBe(true);
    toggle.fire("click");
    expect(v.legend.textContent).toContain("Coder (tai nghe)");
    v.rows()[0].fire("click");
    expect(v.onSelect).toHaveBeenCalledWith(agentKey("codex", b1));
  });

  it("màn hẹp: » mở ngăn kéo, Esc trong thanh đóng ngăn kéo", () => {
    stubMedia(true);
    const v = setup();
    expect(v.sidebar.isCollapsed()).toBe(true);
    v.head.find("sidebar-toggle").fire("click");
    expect(v.sidebar.isCollapsed()).toBe(false);
    v.key("Escape", {}, v.rows()[0]);
    expect(v.sidebar.isCollapsed()).toBe(true);
  });
});

describe("tìm kiếm", () => {
  it.each([
    ["vai trò", "reviewer", ["claude", ["Reviewer"]]],
    ["ticket", "t-33", ["codex", ["Tech lead"]]],
    ["hoạt động không dấu", "sua giao", ["claude", ["Coder"]]],
    ["chữ hoa có dấu", "THIẾT KẾ", ["codex", ["Tech lead"]]],
    ["không dấu", "thiet ke", ["codex", ["Tech lead"]]],
    ["id agent", "a2", ["claude", ["Reviewer"]]],
  ] as const)("khớp theo %s", (_name, q, [room, expected]) => {
    const v = setup();
    v.type(q);
    expect(roles(v.rowsOf(room))).toEqual(expected);
    expect(v.filtering().hidden).toBe(false);
  });

  it("khớp theo tên phòng: mọi agent của phòng; phòng khác chỉ còn đầu kèm 'Không có agent khớp'", () => {
    const v = setup();
    v.type("CLAUDE");
    expect(roles(v.rowsOf("claude"))).toEqual(["Coder", "Reviewer"]);
    expect(v.roomNames()).toEqual(["claude", "codex"]);
    expect(v.rowsOf("codex")).toEqual([]);
    const empty = v.room("codex").find("room-empty");
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe("Không có agent khớp");
    expect(empty.classList.contains("is-nomatch")).toBe(true);
    expect(v.none().hidden).toBe(true);
  });

  it("không khớp gì cả: chỉ còn dòng 'Không tìm thấy “q”'; xoá từ khoá thì đúng node cũ quay lại", () => {
    const v = setup();
    const before = v.rows();
    const blocks = v.rooms();
    v.type("  zzz ");
    expect(v.rooms()).toEqual([]);
    expect(v.none().hidden).toBe(false);
    expect(v.none().textContent).toBe("Không tìm thấy “zzz”");
    v.update();
    expect(v.rooms()).toEqual([]);
    v.type("");
    expect(v.rooms()).toEqual(blocks);
    expect(v.rows()).toEqual(before);
    expect(v.rows().every((row, i) => row === before[i])).toBe(true);
    expect(v.none().hidden).toBe(true);
    expect(v.filtering().hidden).toBe(true);
    expect(v.room("codex").find("room-empty").hidden).toBe(true);
  });
});

describe("phím / và Esc", () => {
  it.each([false, true])("/ focus ô và mở thanh đang thu gọn (màn hẹp: %s)", (narrow) => {
    stubMedia(narrow);
    const v = setup();
    v.sidebar.setCollapsed(true);
    const event = v.key("/");
    expect(event.defaultPrevented).toBe(true);
    expect(v.sidebar.isCollapsed()).toBe(false);
    expect(v.tools.inert).toBe(false);
    expect(doc.activeElement).toBe(v.input);
  });

  it("vẫn chạy khi shortcut:false; bỏ qua khi đang gõ hoặc có Ctrl/Meta/Alt/repeat", () => {
    const v = setup(undefined, { shortcut: false });
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }]) {
      expect(v.key("/", init).defaultPrevented).toBe(false);
      expect(doc.activeElement).toBeNull();
    }
    const other = new Node("input");
    v.parent.append(other);
    other.focus();
    expect(v.key("/", {}, other).defaultPrevented).toBe(false);
    expect(doc.activeElement).toBe(other);
    const textarea = new Node("textarea");
    expect(v.key("/", {}, textarea).defaultPrevented).toBe(false);
    v.key("/");
    expect(doc.activeElement).toBe(v.input);
    // Đang ở trong ô tìm thì / là ký tự gõ, không bị chặn.
    expect(v.key("/", {}, v.input).defaultPrevented).toBe(false);
    // shortcut:false: phím [ không bật/tắt.
    v.key("[");
    expect(v.sidebar.isCollapsed()).toBe(false);
  });

  it("Esc trong ô xoá chữ, bỏ focus, không lan ra và không đóng ngăn kéo màn hẹp", () => {
    stubMedia(true);
    const v = setup();
    const docEsc = vi.fn();
    doc.listeners.push((event) => { if (event.key === "Escape") docEsc(); });
    v.key("/");
    expect(v.sidebar.isCollapsed()).toBe(false);
    v.type("coder");
    expect(v.rows()).toHaveLength(1);
    const event = v.key("Escape", {}, v.input);
    expect(event.stopped).toBe(true);
    expect(v.input.value).toBe("");
    expect(doc.activeElement).toBeNull();
    expect(v.rows()).toHaveLength(3);
    expect(v.sidebar.isCollapsed()).toBe(false);
    expect(docEsc).not.toHaveBeenCalled();
    // Esc lần nữa (ô rỗng, không focus ô) mới đóng ngăn kéo.
    v.key("Escape", {}, v.rows()[0]);
    expect(v.sidebar.isCollapsed()).toBe(true);
  });

  it("focus ở ô tìm không mất khi update() chạy mỗi giây, kể cả khi dữ liệu đổi", () => {
    const v = setup();
    v.key("/");
    v.type("a");
    for (let i = 1; i <= 5; i++) {
      v.update(i % 2 ? [claude(), codex({ state: "offline" })] : [codex(), claude()], NONE, null, NOW + i * 1000);
      expect(doc.activeElement).toBe(v.input);
    }
    expect(v.input.value).toBe("a");
  });
});

describe("chip lọc phòng", () => {
  it("ẩn và hiện phòng, aria-pressed đổi, nhãn 'đang lọc', lưu localStorage", () => {
    const v = setup();
    expect(v.chips().map((c) => c.find("room-chip-name").textContent)).toEqual(["claude", "codex"]);
    expect(v.chip("claude").find("room-chip-letter").textContent).toBe("C");
    expect(v.chip("codex").getAttribute("aria-pressed")).toBe("true");
    expect(v.filtering().hidden).toBe(true);
    v.chip("codex").fire("click");
    expect(v.roomNames()).toEqual(["claude"]);
    expect(v.chip("codex").getAttribute("aria-pressed")).toBe("false");
    expect(v.filtering().hidden).toBe(false);
    expect(localStorage.getItem(HIDDEN_ROOMS_KEY)).toBe(JSON.stringify(["codex"]));
    v.chip("claude").fire("click");
    expect(v.roomNames()).toEqual([]);
    expect(v.none().textContent).toBe("Đã ẩn mọi phòng");
    v.chip("codex").fire("click");
    v.chip("claude").fire("click");
    expect(v.roomNames()).toEqual(["claude", "codex"]);
    expect(v.filtering().hidden).toBe(true);
    expect(localStorage.getItem(HIDDEN_ROOMS_KEY)).toBe("[]");
  });

  it("nhớ qua localStorage khi tạo lại sidebar", () => {
    setup().chip("claude").fire("click");
    const v = setup();
    expect(v.roomNames()).toEqual(["codex"]);
    expect(v.chip("claude").getAttribute("aria-pressed")).toBe("false");
    expect(v.filtering().hidden).toBe(false);
  });

  it.each([
    ["getItem/setItem ném lỗi", { getItem: () => { throw new Error("chặn"); }, setItem: () => { throw new Error("đầy"); } }],
    ["truy cập localStorage ném lỗi", null],
  ])("%s: vẫn lọc được trong phiên", (_name, storage) => {
    if (storage) vi.stubGlobal("localStorage", storage);
    else Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
    try {
      const v = setup();
      v.chip("claude").fire("click");
      expect(v.roomNames()).toEqual(["codex"]);
      v.update();
      expect(v.roomNames()).toEqual(["codex"]);
      v.chip("claude").fire("click");
      expect(v.roomNames()).toEqual(["claude", "codex"]);
    } finally {
      if (!storage) delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it("phòng đang ẩn biến khỏi dữ liệu rồi trở lại: vẫn ẩn", () => {
    const v = setup();
    v.chip("codex").fire("click");
    v.update([claude()]);
    expect(v.chips()).toHaveLength(1);
    v.update([claude(), codex()]);
    expect(v.roomNames()).toEqual(["claude"]);
    expect(v.chip("codex").getAttribute("aria-pressed")).toBe("false");
  });

  it("phòng offline/limited rồi online lại khi đang ẩn bằng chip hoặc đang lọc", () => {
    const v = setup();
    v.chip("codex").fire("click");
    for (const state of ["offline", "limited", "working"] as const) {
      v.update([claude(), codex({ state })]);
      expect(v.roomNames()).toEqual(["claude"]);
    }
    v.chip("codex").fire("click");
    v.type("tech");
    // Mất kết nối: agent còn trong dữ liệu vẫn khớp, dòng mờ.
    v.update([claude(), codex({ state: "offline" })]);
    expect(roles(v.rowsOf("codex"))).toEqual(["Tech lead"]);
    expect(v.rowsOf("codex")[0].classList.contains("offline")).toBe(true);
    // Hết hạn mức: không liệt kê agent nên không còn gì khớp, chỉ còn dòng báo.
    v.update([claude(), codex({ state: "limited" })]);
    expect(v.rooms()).toEqual([]);
    expect(v.none().textContent).toBe("Không tìm thấy “tech”");
    v.type("a");
    expect(v.room("codex").dataset.state).toBe("limited");
    expect(v.room("codex").find("room-empty").textContent).toBe("Không có agent khớp");
    expect(v.room("codex").find("room-count").textContent).toBe("0");
    v.type("tech");
    v.update([claude(), codex()]);
    expect(roles(v.rowsOf("codex"))).toEqual(["Tech lead"]);
    expect(v.room("codex").dataset.state).toBe("working");
  });
});

describe("thời gian chạy", () => {
  const elapsed = (row: Node) => row.find("agent-elapsed");
  it("' · 3:03', '1:00:00'; hỏng hoặc tương lai thì không có hậu tố", () => {
    const agents = [agent("x1", "coder", "T-1", "a"), agent("x2", "coder", "T-2", "b", iso(3600)), agent("x3", "coder", "T-3", "c", "hỏng"), agent("x4", "coder", "T-4", "d", iso(-60))];
    const v = setup([claude({ agents, slots: 4 })]);
    const rows = v.rows();
    expect(rows[0].find("agent-text").textContent).toBe(`${rows[0].find("agent-activity").textContent} · 3:03`);
    expect(rows[0].find("agent-activity").textContent).toMatch(/ a$/);
    expect(elapsed(rows[0]).textContent).toBe(" · 3:03");
    expect(elapsed(rows[1]).textContent).toBe(" · 1:00:00");
    for (const row of rows.slice(2)) {
      expect(elapsed(row).hidden).toBe(true);
      expect(elapsed(row).textContent).toBe("");
      expect(row.find("agent-text").textContent).not.toContain("·");
    }
    expect(rows[0].find("agent-text").getAttribute("title")).toBe("a");
  });

  it("cập nhật theo now giữa hai lần update, giữ node", () => {
    const v = setup();
    const row = v.rows()[0];
    v.update(undefined, NONE, null, NOW + 57_000);
    expect(v.rows()[0]).toBe(row);
    expect(elapsed(row).textContent).toBe(" · 4:00");
    v.update(undefined, NONE, null, NOW - 200_000);
    expect(elapsed(row).hidden).toBe(true);
  });
});

describe("class dòng và thanh chỗ", () => {
  it("selected, need, need+selected, offline và đổi need giữa chừng", () => {
    const v = setup();
    const row = v.rows()[0];
    const is = (cls: string) => row.classList.contains(cls);
    v.update(undefined, NONE, agentKey("claude", a1));
    expect([is("selected"), is("need")]).toEqual([true, false]);
    expect(row.getAttribute("aria-current")).toBe("true");
    v.update(undefined, new Set(["T-11"]), agentKey("claude", a1));
    expect([is("selected"), is("need")]).toEqual([true, true]);
    v.update(undefined, new Set(["T-11"]), null);
    expect([is("selected"), is("need")]).toEqual([false, true]);
    expect(row.hasAttribute("aria-current")).toBe(false);
    v.update(undefined, NONE, null);
    expect(is("need")).toBe(false);
    expect(row.find("status-dot").dataset.state).toBe("working");
    v.update([claude({ state: "idle" })]);
    expect(is("offline")).toBe(false);
  });

  it("offline: dòng mờ khi phòng mất kết nối mà dữ liệu còn agent; online lại thì bỏ", () => {
    const v = setup();
    const row = v.rows()[0];
    v.update([claude({ state: "offline" }), codex()]);
    expect(v.rows()[0]).toBe(row);
    expect(row.classList.contains("offline")).toBe(true);
    expect(row.find("status-dot").dataset.state).toBe("offline");
    expect(v.room("claude").find("room-alert").hidden).toBe(false);
    v.update([claude({ state: "offline", agents: [] }), codex()]);
    expect(v.room("claude").find("room-empty").textContent).toBe("Phòng tắt");
    v.update([claude({ state: "limited" }), codex()]);
    expect(v.rowsOf("claude")).toEqual([]);
    expect(v.room("claude").find("room-empty").textContent).toBe("Chờ mở lại hạn mức");
    v.update([claude(), codex()]);
    expect(v.rowsOf("claude")[0]).not.toBe(undefined);
    expect(v.rowsOf("claude")[0].classList.contains("offline")).toBe(false);
  });

  it("agent đang chọn bị lọc mất rồi khớp lại: vẫn selected, cùng node", () => {
    const v = setup();
    const key = agentKey("claude", a1);
    v.update(undefined, NONE, key);
    const row = v.rows()[0];
    v.type("reviewer");
    v.update(undefined, NONE, key);
    expect(v.rows().includes(row)).toBe(false);
    v.type("coder");
    expect(v.rows()[0]).toBe(row);
    expect(row.classList.contains("selected")).toBe(true);
  });

  it("thanh chỗ: ratio, nhãn '1/3 chỗ', over khi vượt slots", () => {
    const v = setup([claude({ agents: [a1] })]);
    const room = v.room("claude");
    expect(room.find("room-slots-text").textContent).toBe("1/3 chỗ");
    expect(room.find("room-slots-bar").children[0].style.width).toBe("33.3%");
    expect(room.find("room-slots").classList.contains("over")).toBe(false);
    expect(room.find("room-count").textContent).toBe("1");
    expect(room.find("room-head").style.getPropertyValue("--room-color")).not.toBe("");
    v.update([claude({ agents: [a1, a2, b1, agent("c4", "designer", "T-4", "x")] })]);
    expect(room.find("room-slots-text").textContent).toBe("4/3 chỗ");
    expect(room.find("room-slots-bar").children[0].style.width).toBe("100%");
    expect(room.find("room-slots").classList.contains("over")).toBe(true);
  });

  it("số agent đổi 0→2→1, vượt slots rồi hạ xuống khi đang lọc", () => {
    const v = setup([claude({ agents: [], slots: 2 })]);
    v.type("coder");
    const room = () => v.room("claude");
    const states: [WorkerAgent[], string, string, boolean, string[]][] = [
      [[], "0", "0/2 chỗ", false, []],
      [[a1, a2], "2", "2/2 chỗ", false, ["Coder"]],
      [[a2], "1", "1/2 chỗ", false, []],
      [[a1, a2, b1], "3", "3/2 chỗ", true, ["Coder"]],
      [[a1], "1", "1/2 chỗ", false, ["Coder"]],
    ];
    for (const [agents, count, label, over, shown] of states) {
      v.update([claude({ agents, slots: 2 }), codex()]);
      if (shown.length === 0) {
        // Phòng claude không còn agent khớp; codex cũng không: chỉ còn dòng báo.
        expect(v.rooms()).toEqual([]);
        v.type("a");
        v.type("coder");
        continue;
      }
      expect(room().find("room-count").textContent).toBe(count);
      expect(room().find("room-slots-text").textContent).toBe(label);
      expect(room().find("room-slots").classList.contains("over")).toBe(over);
      expect(roles(v.rowsOf("claude"))).toEqual(shown);
    }
    // Lọc theo tên phòng để thấy cả trường hợp phòng có agent nhưng không khớp.
    v.type("t-22");
    v.update([claude({ agents: [a1, a2, b1], slots: 2 }), codex()]);
    expect(v.room("claude").find("room-slots").classList.contains("over")).toBe(true);
    expect(v.room("claude").find("room-count").textContent).toBe("3");
    v.update([claude({ agents: [a1], slots: 2 }), codex()]);
    expect(v.rooms()).toEqual([]);
    v.update([claude({ agents: [a1, a2], slots: 2 }), codex()]);
    expect(v.room("claude").find("room-slots").classList.contains("over")).toBe(false);
    expect(v.room("claude").find("room-slots-text").textContent).toBe("2/2 chỗ");
    expect(v.room("codex").find("room-empty").textContent).toBe("Không có agent khớp");
  });

  it("agent khớp từ khoá mất rồi xuất hiện lại khi đang lọc", () => {
    const v = setup();
    v.type("t-22");
    const row = v.rows()[0];
    v.update([claude({ agents: [a1] }), codex()]);
    expect(v.rooms()).toEqual([]);
    expect(v.none().textContent).toBe("Không tìm thấy “t-22”");
    v.update([claude(), codex()]);
    expect(roles(v.rows())).toEqual(["Reviewer"]);
    // Agent rời phòng thì node bị bỏ; quay lại là dòng mới nhưng đúng nội dung.
    expect(v.rows()[0]).not.toBe(row);
    expect(v.none().hidden).toBe(true);
    expect(v.room("codex").find("room-empty").textContent).toBe("Không có agent khớp");
  });
});

const NEW_ROLES = {
  ba: { label: "BA", shirt: "#d9a43a" },
  tester: { label: "Tester", shirt: "#3bb5c8" },
  researcher: { label: "Researcher", shirt: "#8c8f3a" },
} as const;
const FALLBACK_SHIRT = "#8a8f98";

describe("vai trò BA, Tester, Researcher", () => {
  const ba = agent("ana-1", "ba", "T-41", "Phân tích yêu cầu");
  const tester = agent("qa-1", "tester", "T-42", "Chụp ảnh nghiệm thu");
  const researcher = agent("rs-1", "researcher", "T-43", "Đọc tài liệu");

  it("chú thích có đúng 7 mục theo thứ tự, không có ngoặc rỗng", () => {
    const v = setup();
    const items = v.legend.all("legend-item");
    expect(items.map((item) => item.textContent)).toEqual([
      "Tech lead (cà vạt)",
      "Coder (tai nghe)",
      "Reviewer (kính)",
      "Designer (mũ nồi)",
      "BA (bảng kẹp hồ sơ)",
      "Tester (kính lúp)",
      "Researcher (sổ tay)",
    ]);
    expect(items.map((item) => item.find("swatch").style.background)).toEqual([
      "#4a7fd4", "#4fae60", "#9b6bd6", "#e57fb0",
      NEW_ROLES.ba.shirt, NEW_ROLES.tester.shirt, NEW_ROLES.researcher.shirt,
    ]);
    expect(v.legend.textContent).not.toContain("()");
  });

  it("dòng agent ba, tester, researcher ghi nhãn mới bằng màu áo mới", () => {
    const v = setup([claude({ agents: [ba, tester, researcher], slots: 3 })]);
    const rows = v.rows();
    expect(rows.map((row) => row.find("agent-role").textContent)).toEqual(["BA", "Tester", "Researcher"]);
    expect(rows.map((row) => row.find("agent-role").style.color)).toEqual([
      NEW_ROLES.ba.shirt, NEW_ROLES.tester.shirt, NEW_ROLES.researcher.shirt,
    ]);
  });

  it.each([
    ["ba", "BA"],
    ["TESTER", "Tester"],
    ["Research", "Researcher"],
  ] as const)("tìm %s khớp đúng agent", (query, label) => {
    const v = setup([claude({ agents: [ba, tester, researcher], slots: 3 }), codex()]);
    v.type(query);
    expect(roles(v.rows())).toEqual([label]);
    expect(v.rowsOf("codex")).toEqual([]);
    expect(v.room("codex").find("room-empty").textContent).toBe("Không có agent khớp");
  });

  it.each(Object.entries(NEW_ROLES))("role lạ → %s → lạ rồi null: cùng node, nhãn, màu và avatar đổi", (role, style) => {
    const person = agent("p1", "foo", "T-9", "Việc");
    const v = setup([claude({ agents: [person], slots: 1 })]);
    const row = v.rows()[0];
    const label = row.find("agent-role");
    expect(label.textContent).toBe("foo");
    expect(label.style.color).toBe(FALLBACK_SHIRT);
    const base = avatarMock.calls;

    const apply = (next: string | null) => {
      v.update([claude({ agents: [{ ...person, role: next }], slots: 1 })]);
    };

    // Đang lọc theo ticket: dòng không bị tháo khi chỉ vai trò đổi.
    v.type("t-9");
    apply(role);
    expect(v.rows()[0]).toBe(row);
    expect(label.textContent).toBe(style.label);
    expect(label.style.color).toBe(style.shirt);
    expect(avatarMock.calls).toBe(base + 1);
    v.update([claude({ agents: [{ ...person, role }], slots: 1 })]);
    expect(avatarMock.calls).toBe(base + 1);

    apply("zzz");
    expect(v.rows()[0]).toBe(row);
    expect(label.textContent).toBe("zzz");
    expect(label.style.color).toBe(FALLBACK_SHIRT);
    expect(avatarMock.calls).toBe(base + 2);

    apply(role);
    apply(null);
    expect(v.rows()[0]).toBe(row);
    expect(label.textContent).toBe("?");
    expect(label.style.color).toBe(FALLBACK_SHIRT);
    expect(avatarMock.calls).toBe(base + 4);
    expect(roles(v.rows())).toEqual(["?"]);
  });

  it.each([
    ["tester", tester, "Tester"],
    ["ba", ba, "BA"],
    ["Research", researcher, "Researcher"],
  ] as const)("agent khớp %s mất rồi xuất hiện lại khi đang lọc", (query, person, label) => {
    const v = setup([claude({ agents: [ba, tester, researcher], slots: 3 }), codex()]);
    v.type(query);
    expect(roles(v.rows())).toEqual([label]);
    const row = v.rows()[0];
    const rest = [ba, tester, researcher].filter((item) => item !== person);
    v.update([claude({ agents: rest, slots: 3 }), codex()]);
    expect(v.rooms()).toEqual([]);
    expect(v.none().textContent).toBe(`Không tìm thấy “${query.trim()}”`);
    v.update([claude({ agents: [ba, tester, researcher], slots: 3 }), codex()]);
    expect(roles(v.rows())).toEqual([label]);
    expect(v.rows()[0]).not.toBe(row);
    expect(v.rows()[0].find("agent-role").style.color).toBe(NEW_ROLES[person.role as keyof typeof NEW_ROLES].shirt);
    expect(v.none().hidden).toBe(true);
    expect(v.room("codex").find("room-empty").textContent).toBe("Không có agent khớp");
  });

  it.each(Object.entries(NEW_ROLES))("phòng offline giữ dòng mờ đúng nhãn %s", (role, style) => {
    const person = agent("p1", role, "T-7", "Việc");
    const v = setup([claude({ agents: [person] }), codex()]);
    const row = v.rowsOf("claude")[0];
    for (const state of ["offline", "working", "offline"] as const) {
      v.update([claude({ state, agents: [person] }), codex()]);
      expect(v.rowsOf("claude")[0]).toBe(row);
      expect(row.classList.contains("offline")).toBe(state === "offline");
      expect(row.find("agent-role").textContent).toBe(style.label);
      expect(row.find("agent-role").style.color).toBe(style.shirt);
      expect(row.find("status-dot").dataset.state).toBe(state === "offline" ? "offline" : "working");
    }
  });
});
