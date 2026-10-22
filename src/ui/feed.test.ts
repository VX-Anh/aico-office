import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerStatus } from "../api";
import { createFeed } from "./feed";

vi.mock("./avatar", () => ({
  avatarIdentity: (agent: { id: string; role: string }) => `${agent.id}/${agent.role}`,
  createAvatar: () => document.createElement("canvas"),
}));

// Chiều cao và offset tính từ thứ tự con để kiểm cả việc cắt lịch sử.
class FeedNode {
  children: FeedNode[] = [];
  parentElement: FeedNode | null = null;
  private text = "";
  className = "";
  hidden = false;
  title = "";
  type = "";
  tabIndex = 0;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, (() => void)[]>();
  onclick: (() => void) | null = null;
  clientHeight = 52;
  private top = 0;
  constructor(readonly tagName = "div") {}
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(""); }
  set textContent(value: string) { this.replaceChildren(); this.text = value; }
  get scrollHeight() { return this.children.length * 26; }
  get scrollTop() { return this.top; }
  set scrollTop(value: number) { this.top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); }
  get offsetTop() { return (this.parentElement?.children.indexOf(this) ?? 0) * 26; }
  get offsetHeight() { return 26; }
  classList = {
    add: (...names: string[]) => { this.className = [this.className, ...names].filter(Boolean).join(" "); },
    toggle: (name: string, value: boolean) => {
      const names = this.className.split(" ").filter(item => item !== name);
      if (value) names.push(name);
      this.className = names.join(" ");
    },
  };
  append(...nodes: FeedNode[]) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node: FeedNode, before: FeedNode | null) {
    node.remove();
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, node);
    node.parentElement = this;
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
    this.parentElement = null;
  }
  replaceChildren(...nodes: FeedNode[]) {
    for (const node of this.children) node.parentElement = null;
    this.children = []; this.text = ""; this.append(...nodes);
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  addEventListener(name: string, callback: () => void) { this.listeners.set(name, [...this.listeners.get(name) ?? [], callback]); }
  fire(name: string) { this.listeners.get(name)?.forEach(callback => callback()); if (name === "click") this.onclick?.(); }
  closest() { return ["input", "textarea", "select", "editable"].includes(this.tagName) ? this : null; }
}

let keydown: (event: KeyboardEvent) => void;
beforeEach(() => {
  vi.stubGlobal("Element", FeedNode);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("document", {
    createElement: (tag: string) => new FeedNode(tag),
    addEventListener: (_name: string, callback: typeof keydown) => { keydown = callback; },
    removeEventListener: vi.fn(),
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const line = (key: string) => ({ key, at: "2026-10-21T12:00:00Z", room: "codex", agentId: "a", name: "coder", icon: "›", text: `Nội dung đầy đủ ${key}`, ticket: "T-1", tone: null });
const worker: WorkerStatus = { name: "codex", state: "working", roles: ["coder"], agents: [{ id: "a", role: "coder", ticket_id: "T-1", mode: "write", started_at: "" }] };
function setup() {
  const root = new FeedNode();
  const onAgent = vi.fn(), onTicket = vi.fn();
  const feed = createFeed(root as unknown as HTMLElement, { onAgent, onTicket });
  const [header, list] = root.children;
  const [title, ticker, fresh, chevron] = header.children;
  return { feed, root, list, title, ticker, fresh, chevron, onAgent, onTicket };
}
const batch = (count: number, start = 0) => Array.from({ length: count }, (_, i) => line(String(start + i)));

describe("khung hoạt động", () => {
  it("dựng đủ bảy cột, title đầy đủ và giữ DOM khi dữ liệu không đổi", () => {
    const { feed, list } = setup();
    feed.render([line("1")], [worker]);
    const row = list.children[0], cells = [...row.children];
    expect(row.tagName).toBe("button");
    expect(cells.map(cell => cell.className)).toEqual(["feed-time", "feed-avatar", "feed-name", "feed-room", "feed-ticket", "feed-icon", "feed-text"]);
    expect(row.title).toBe(`${cells[0].textContent} · coder · codex · T-1 · Nội dung đầy đủ 1`);
    expect(cells[1].children[0].tagName).toBe("canvas");
    expect(cells[3].textContent).toBe("X");
    feed.render([line("1")], [worker]);
    expect(list.children[0].children).toEqual(cells);
  });

  it("cập nhật tone, agent đi/qua lại, offline/limited và phòng biến mất", () => {
    const { feed, list } = setup();
    for (const tone of ["need", "done", "error"] as const) {
      feed.render([{ ...line("1"), tone }], [worker]);
      expect(list.children[0].className).toContain(`tone-${tone}`);
    }
    for (const workers of [[{ ...worker, agents: [] }], [worker], [{ ...worker, state: "offline" as const }], [worker], [{ ...worker, state: "limited" as const }], [], [worker]]) {
      feed.render([line("1")], workers);
      expect(list.children[0].className.includes("is-gone")).toBe(workers[0] !== worker);
      expect(list.children[0].children[3].textContent).toBe("X");
    }
  });

  it("ticker luôn lấy dòng cuối, rỗng không có ticker và đặt lại bộ đếm", () => {
    const { feed, list, ticker, fresh } = setup();
    feed.setCollapsed(true);
    feed.render(batch(5));
    expect(ticker.textContent).toBe("coder: › Nội dung đầy đủ 4");
    list.scrollTop = 0;
    feed.render(batch(6));
    expect(ticker.textContent).toBe("coder: › Nội dung đầy đủ 5");
    expect(fresh.hidden).toBe(false);
    feed.render([]);
    expect(ticker.hidden).toBe(true);
    expect(fresh.hidden).toBe(true);
    expect(list.textContent).toBe("Hoạt động của agent sẽ hiện ở đây.");
    feed.render(batch(1));
    expect(fresh.hidden).toBe(true);
  });

  it("cộng dồn 3 rồi 5 mới, bấm về cuối; cuộn tay về cuối cũng xoá", () => {
    const { feed, list, fresh } = setup();
    feed.render(batch(10));
    list.scrollTop = 26;
    feed.render(batch(13));
    expect(fresh.textContent).toBe("3 mới");
    feed.render(batch(15));
    expect(fresh.textContent).toBe("5 mới");
    fresh.fire("click");
    expect(list.scrollTop).toBe(list.scrollHeight - list.clientHeight);
    expect(fresh.hidden).toBe(true);
    list.scrollTop = 0;
    feed.render(batch(16));
    list.scrollTop = list.scrollHeight;
    list.fire("scroll");
    expect(fresh.hidden).toBe(true);
  });

  it("rê chuột dừng tự cuộn, rời chuột theo tiếp nếu chưa cuộn tay", () => {
    const { feed, list, fresh } = setup();
    feed.render(batch(10));
    const top = list.scrollTop;
    list.fire("pointerenter");
    feed.render(batch(13));
    expect(list.scrollTop).toBe(top);
    expect(fresh.textContent).toBe("3 mới");
    list.fire("pointerleave");
    expect(list.scrollTop).toBe(list.scrollHeight - list.clientHeight);
    list.fire("pointerenter");
    list.scrollTop = 26;
    list.fire("scroll");
    feed.render(batch(15));
    list.fire("pointerleave");
    expect(list.scrollTop).toBe(26);
  });

  it("cắt đầu giữ dòng neo cùng vị trí", () => {
    const { feed, list } = setup();
    feed.render(batch(10));
    list.scrollTop = 3 * 26 + 7;
    const anchor = list.children[3];
    feed.render(batch(10, 2));
    expect(list.children[1]).toBe(anchor);
    expect(anchor.offsetTop - list.scrollTop).toBe(-7);
  });

  it("bấm agent/ticket gọi đúng callback, hết hạn mức không gọi", () => {
    const { feed, list, onAgent, onTicket } = setup();
    feed.render([line("1"), { ...line("2"), agentId: null }, { ...line("3"), agentId: null, ticket: null }]);
    list.children.forEach(row => row.fire("click"));
    expect(onAgent.mock.calls).toEqual([["codex", "a"]]);
    expect(onTicket.mock.calls).toEqual([["T-1"]]);
  });

  it("hai nút và phím ] đổi aria-expanded; bỏ qua nhập chữ và phím bổ trợ", () => {
    const { feed, title, chevron } = setup();
    expect(title.attributes.get("aria-expanded")).toBe("true");
    title.fire("click");
    expect(chevron.textContent).toBe("▴");
    expect(chevron.attributes.get("aria-expanded")).toBe("false");
    chevron.fire("click");
    const press = (extra = {}) => keydown({ key: "]", preventDefault() {}, ...extra } as KeyboardEvent);
    press();
    expect(title.attributes.get("aria-expanded")).toBe("false");
    for (const tag of ["input", "textarea", "select", "editable"]) press({ target: new FeedNode(tag) });
    for (const modifier of ["repeat", "ctrlKey", "metaKey", "altKey"]) press({ [modifier]: true });
    expect(title.attributes.get("aria-expanded")).toBe("false");
    press();
    expect(chevron.textContent).toBe("▾");
    feed.destroy();
    expect(document.removeEventListener).toHaveBeenCalledWith("keydown", keydown);
  });

  it("dòng ticket giữ ô phòng trống trong lưới bảy cột", () => {
    const { feed, list } = setup();
    feed.render([{ ...line("ticket"), room: "", agentId: null }]);
    const cells = list.children[0].children;
    expect(cells).toHaveLength(7);
    expect(cells[3].hidden).toBe(false);
    expect(cells[3].textContent).toBe("");
    expect(cells[6].textContent).toBe("Nội dung đầy đủ ticket");
  });

  it("màn hẹp bắt đầu thu gọn", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(setup().title.attributes.get("aria-expanded")).toBe("false");
  });
});
