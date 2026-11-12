import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToasts } from "./toasts";

// DOM tối thiểu: đủ cho createToasts dựng, xếp và gỡ toast.
class Node {
  children: Node[] = [];
  parent: Node | null = null;
  className = "";
  textContent = "";
  type = "";
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  classList = { add: (name: string) => { this.className += ` ${name}`; } };
  constructor(readonly tag = "div") {}
  get firstChild(): Node | null { return this.children[0] ?? null; }
  get nextSibling(): Node | null {
    const list = this.parent?.children ?? [];
    return list[list.indexOf(this) + 1] ?? null;
  }
  append(...nodes: Node[]) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node: Node, before: Node | null) {
    node.remove();
    this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node);
    node.parent = this;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((n) => n !== this);
    this.parent = null;
  }
  replaceChildren(...nodes: Node[]) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
  click() { this.listeners.get("click")?.(); }
}

beforeEach(() => { vi.stubGlobal("document", { createElement: (tag: string) => new Node(tag) }); });
afterEach(() => { vi.unstubAllGlobals(); });

const entry = (id: string, kind = "plan") => ({ id, kind, label: "chờ duyệt" });
function setup() {
  const root = new Node();
  const onOpen = vi.fn();
  const toasts = createToasts(root as unknown as HTMLElement, { onOpen });
  // Lượt đầu chỉ ghi nhớ, không hiện toast.
  toasts.update([entry("T-old")]);
  return { root, toasts, onOpen };
}
const tickets = (root: Node) => root.children.map((t) => t.dataset.ticket);
const button = (toast: Node, action: string) => toast.children[1].children.find((b) => b.dataset.action === action)!;

describe("selector ổn định của toast", () => {
  it("toast có data-ticket, data-ticket-id, data-kind; nút có data-action", () => {
    const { root, toasts } = setup();
    expect(root.children).toEqual([]);
    toasts.update([entry("T-new", "merge"), entry("T-old")]);
    expect(root.children.length).toBe(1);
    const [toast] = root.children;
    expect(toast.className).toBe("toast");
    expect(toast.dataset).toEqual({ ticket: "T-new", ticketId: "T-new", kind: "merge" });
    expect(toast.children[1].children.map((b) => [b.dataset.action, b.textContent])).toEqual([["open", "Xử lý"], ["dismiss", "×"]]);
  });

  it("nút open gọi onOpen đúng ticket; dismiss gỡ toast và poll sau không hiện lại", () => {
    const { root, toasts, onOpen } = setup();
    const entries = [entry("T-b"), entry("T-a"), entry("T-old")];
    toasts.update(entries);
    expect(tickets(root)).toEqual(["T-b", "T-a"]);
    button(root.children[1], "open").click();
    expect(onOpen).toHaveBeenCalledWith("T-a");
    button(root.children[0], "dismiss").click();
    expect(tickets(root)).toEqual(["T-a"]);
    toasts.update(entries);
    expect(tickets(root)).toEqual(["T-a"]);
  });
});
