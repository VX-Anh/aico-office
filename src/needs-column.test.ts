import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNeedsColumn, type NeedItem } from "./needs-column";

// DOM nhỏ chạy trong node; click tôn trọng nút bị khoá như trình duyệt.
const dom = { activeElement: null as Node | null };
class Node {
  children: Node[] = [];
  parent: Node | null = null;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  className = "";
  classList = {
    add: (name: string) => { this.className += ` ${name}`; },
    remove: (name: string) => { this.className = this.className.split(" ").filter((c) => c !== name).join(" "); },
    contains: (name: string) => this.className.split(" ").includes(name),
  };
  textContent = "";
  hidden = false;
  disabled = false;
  readOnly = false;
  value = "";
  listeners = new Map<string, (() => void)[]>();
  constructor(readonly tag = "div") {}
  append(...children: Node[]) { for (const child of children) this.insertBefore(child, null); }
  insertBefore(child: Node, at: Node | null) {
    child.remove();
    this.children.splice(at === null ? this.children.length : this.children.indexOf(at), 0, child);
    child.parent = this;
    return child;
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  replaceChildren(...children: Node[]) { for (const child of [...this.children]) child.remove(); this.append(...children); }
  contains(child: Node): boolean { return child === this || this.children.some((c) => c.contains(child)); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  focus() { dom.activeElement = this; }
  scrollIntoView() {}
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
  }
  click() { if (!this.disabled) for (const listener of this.listeners.get("click") ?? []) listener(); }
}

function find(root: Node, predicate: (node: Node) => boolean): Node {
  if (predicate(root)) return root;
  for (const child of root.children) {
    try { return find(child, predicate); } catch { /* Tìm tiếp nhánh khác. */ }
  }
  throw new Error("Không tìm thấy node");
}
const button = (root: Node, text: string) => find(root, (n) => n.tag === "button" && n.textContent === text);
const byClass = (root: Node, name: string) => find(root, (n) => n.classList.contains(name));
const card = (root: Node, id = "T-merge") => find(root, (n) => n.dataset.ticketId === id);
function item(id = "T-merge", kind: NeedItem["kind"] = "merge", updated_at: string | null = null): NeedItem {
  const status = { merge: "awaiting_merge_approval", plan: "awaiting_plan_approval", escalated: "escalated" }[kind];
  return { kind, reason: null, ticket: { id, title: id, status, project: null, updated_at, artifacts: [] } };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function setup(initial = [item()]) {
  const root = new Node();
  const list = vi.fn(async () => initial);
  const act = vi.fn(async (_item: NeedItem, _action: string, _comment: string) => {});
  const column = createNeedsColumn(root as unknown as HTMLElement, { list, act }, vi.fn());
  await column.refresh();
  return { root, list, act, column };
}
function confirm(root: Node) {
  const target = card(root);
  button(target, "Duyệt merge").click();
  expect(byClass(target, "need-confirm").hidden).toBe(false);
  expect(byClass(target, "need-confirm").children[0].textContent).toBe("Merge PR vào main: T-merge?");
  return target;
}

beforeEach(() => {
  vi.stubGlobal("HTMLElement", Node);
  dom.activeElement = null;
  vi.stubGlobal("document", { createElement: (tag: string) => new Node(tag), get activeElement() { return dom.activeElement; } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("xác nhận trong thẻ Cần bạn", () => {
  it("Duyệt merge chờ xác nhận, chỉ gửi một lần khi đang gửi", async () => {
    const { root, act } = await setup();
    const pending = deferred();
    act.mockReturnValueOnce(pending.promise);
    const target = confirm(root);
    expect(act).not.toHaveBeenCalled();
    find(target, (n) => n.tag === "textarea").value = "đồng ý";
    button(target, "Xác nhận").click();
    button(target, "Xác nhận").click();
    expect(act).toHaveBeenCalledExactlyOnceWith(item(), "approved", "đồng ý");
    pending.resolve();
    await vi.waitFor(() => expect(button(target, "Duyệt merge").disabled).toBe(false));
  });

  it("Huỷ không gửi", async () => {
    const { root, act } = await setup();
    const target = confirm(root);
    button(target, "Huỷ").click();
    expect(byClass(target, "need-confirm").hidden).toBe(true);
    button(target, "Xác nhận").click();
    expect(act).not.toHaveBeenCalled();
  });

  it("Duyệt kế hoạch gửi ngay", async () => {
    const plan = item("T-plan", "plan");
    const { root, act } = await setup([plan]);
    button(root, "Duyệt kế hoạch").click();
    expect(act).toHaveBeenCalledExactlyOnceWith(plan, "approved", "");
    expect(byClass(root, "need-confirm").hidden).toBe(true);
  });

  it.each(["Yêu cầu sửa", "Từ chối"])("%s giữ luồng ghi chú và xác nhận cũ", async (label) => {
    const { root, act } = await setup();
    button(root, label).click();
    expect(act).not.toHaveBeenCalled();
    find(root, (n) => n.tag === "textarea").value = "cần sửa";
    button(root, label).click();
    if (label === "Từ chối") {
      expect(act).not.toHaveBeenCalled();
      expect(byClass(root, "need-confirm").children[0].textContent).toBe("Từ chối T-merge?");
      button(root, "Xác nhận").click();
    }
    expect(act).toHaveBeenCalledExactlyOnceWith(item(), label === "Từ chối" ? "rejected" : "changes_requested", "cần sửa");
  });

  it("poll thêm, bớt, đổi thứ tự giữ xác nhận trên đúng ticket", async () => {
    const { root, list, act, column } = await setup([item(), item("T-other")]);
    const target = confirm(root);
    for (const next of [
      [item("T-new", "plan", "2026-10-21T10:00:00Z"), item("T-other"), item()],
      [item("T-other"), item("T-merge", "merge", "2026-10-21T11:00:00Z")],
      [item()],
    ]) {
      list.mockResolvedValueOnce(next);
      await column.refresh();
      expect(card(root)).toBe(target);
      expect(byClass(target, "need-confirm").hidden).toBe(false);
    }
    button(target, "Xác nhận").click();
    expect(act).toHaveBeenCalledExactlyOnceWith(item(), "approved", "");
  });

  it.each(["mất rồi trở lại", "đổi loại", "đổi nguồn"])("%s bỏ xác nhận cũ và không gửi từ thẻ cũ", async (change) => {
    const { root, list, act, column } = await setup();
    const old = confirm(root);
    if (change === "đổi nguồn") column.setSource({ list, act });
    else {
      list.mockResolvedValueOnce(change === "đổi loại" ? [item("T-merge", "escalated")] : []);
      await column.refresh();
    }
    expect(root.contains(old)).toBe(false);
    button(old, "Xác nhận").click();
    expect(act).not.toHaveBeenCalled();
    if (change === "mất rồi trở lại") {
      await column.refresh();
      expect(card(root)).not.toBe(old);
      expect(byClass(card(root), "need-confirm").hidden).toBe(true);
    }
  });

  it("list lỗi giữ thẻ, xác nhận và cho gửi một lần", async () => {
    const { root, list, act, column } = await setup();
    const target = confirm(root);
    list.mockRejectedValueOnce(new Error("mất mạng"));
    await column.refresh();
    expect(card(root)).toBe(target);
    expect(byClass(root, "needs-error").textContent).toContain("mất mạng");
    expect(byClass(target, "need-confirm").hidden).toBe(false);
    button(target, "Xác nhận").click();
    button(target, "Xác nhận").click();
    expect(act).toHaveBeenCalledExactlyOnceWith(item(), "approved", "");
  });

  it("act lỗi hiện lỗi, mở khoá và chỉ gửi lại khi người bấm", async () => {
    const { root, act } = await setup();
    act.mockRejectedValueOnce(new Error("không gửi được"));
    const target = confirm(root);
    button(target, "Xác nhận").click();
    button(target, "Xác nhận").click();
    await vi.waitFor(() => expect(byClass(target, "need-message").textContent).toBe("không gửi được"));
    expect(button(target, "Xác nhận").disabled).toBe(false);
    expect(button(target, "Duyệt merge").disabled).toBe(false);
    expect(act).toHaveBeenCalledTimes(1);
    button(target, "Xác nhận").click();
    expect(act).toHaveBeenCalledTimes(2);
  });
});
