import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ticket } from "./api";
import { createNeedsColumn, type NeedItem, type NeedList } from "./needs-column";

// DOM nhỏ chạy trong node; click tôn trọng nút bị khoá như trình duyệt. Sự kiện nổi bọt lên tới
// document, isConnected theo cây thật (lightbox gắn vào body).
interface FakeEvent {
  type: string;
  target: Node;
  key?: string;
  stopped: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}
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
  href = "";
  target = "";
  rel = "";
  listeners = new Map<string, ((event: FakeEvent) => void)[]>();
  constructor(readonly tag = "div") {}
  get isConnected(): boolean { return this === docNode || (this.parent !== null && this.parent.isConnected); }
  get firstElementChild(): Node | null { return this.children[0] ?? null; }
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
  replaceWith(other: Node) {
    const parent = this.parent;
    if (!parent) return;
    parent.insertBefore(other, this);
    this.remove();
  }
  replaceChildren(...children: Node[]) { for (const child of [...this.children]) child.remove(); this.append(...children); }
  contains(child: Node | null): boolean { return child === this || this.children.some((c) => c.contains(child)); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  focus() { dom.activeElement = this; }
  scrollIntoView() {}
  addEventListener(type: string, listener: (event: FakeEvent) => void) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
  }
  dispatch(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const event: FakeEvent = {
      type, target: this, stopped: false, defaultPrevented: false, ...init,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
    };
    for (let at: Node | null = this; at && !event.stopped; at = at.parent) {
      for (const listener of at.listeners.get(type) ?? []) listener(event);
    }
    return event;
  }
  click() { if (!this.disabled) this.dispatch("click"); }
}
let docNode: Node;
let body: Node;

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
  docNode = new Node("#document");
  body = new Node("body");
  docNode.append(body);
  vi.stubGlobal("document", { createElement: (tag: string) => new Node(tag), body, get activeElement() { return dom.activeElement; } });
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

function doneTicket(id = "T-done"): Ticket {
  return { id, title: id, status: "done", project: null, updated_at: null, artifacts: [{ kind: "merge_request", ref: "!1", url: "https://example.com/mr/1" }] };
}

describe("snapshot ticket sau gate", () => {
  it("mảng cũ không phát snapshot; mảng kèm tickets và object thì phát, kể cả done", async () => {
    const root = new Node();
    const onItems = vi.fn();
    const onSnapshot = vi.fn();
    const plain = vi.fn(async () => [item("T-plan", "plan")]);
    const column = createNeedsColumn(root as unknown as HTMLElement, { list: plain, act: vi.fn() }, onItems, () => {}, onSnapshot);
    await column.refresh();
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(onItems).toHaveBeenCalledOnce();

    const withDone = Object.assign([item()], { tickets: [doneTicket(), item().ticket] });
    plain.mockResolvedValueOnce(withDone);
    await column.refresh();
    expect(onSnapshot).toHaveBeenLastCalledWith(withDone.tickets);
    expect(card(root).dataset.ticketId).toBe("T-merge");

    const packed: NeedList = { items: [item("T-new", "escalated")], tickets: [doneTicket("T-xong"), item("T-new", "escalated").ticket] };
    plain.mockResolvedValueOnce(packed as unknown as NeedItem[]);
    await column.refresh();
    expect(onSnapshot).toHaveBeenLastCalledWith(packed.tickets);
    expect(() => card(root, "T-xong")).toThrow();
    expect(card(root, "T-new").dataset.kind).toBe("escalated");
  });

  it("lỗi tải, request cũ và đổi nguồn không phát snapshot", async () => {
    const root = new Node();
    const onSnapshot = vi.fn();
    let resolveOld!: (value: NeedList) => void;
    const old = new Promise<NeedList>((resolve) => { resolveOld = resolve; });
    const list = vi.fn<() => Promise<NeedList>>()
      .mockReturnValueOnce(old)
      .mockResolvedValueOnce({ items: [item("T-2", "plan")], tickets: [doneTicket()] });
    const column = createNeedsColumn(root as unknown as HTMLElement, { list, act: vi.fn() }, vi.fn(), () => {}, onSnapshot);
    const first = column.refresh();
    await column.refresh();
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledWith([doneTicket()]);
    resolveOld({ items: [item()], tickets: [doneTicket("T-cũ")] });
    await first;
    expect(onSnapshot).toHaveBeenCalledTimes(1);

    list.mockRejectedValueOnce(new Error("mất mạng"));
    await column.refresh();
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(byClass(root, "needs-error").textContent).toContain("mất mạng");
    expect(card(root, "T-2")).toBeTruthy();

    let resolveLate!: (value: NeedList) => void;
    list.mockReturnValueOnce(new Promise<NeedList>((resolve) => { resolveLate = resolve; }));
    const late = column.refresh();
    column.setSource({ list: vi.fn(async () => [item("T-3", "merge")]), act: vi.fn() });
    resolveLate({ items: [item()], tickets: [doneTicket("T-nguồn-cũ")] });
    await late;
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(() => card(root, "T-2")).toThrow();
  });
});

const STAMP = "20261022-075400";
function shot(file: string, stamp = STAMP, url = `https://img.test/${stamp}/${file}.png`) {
  return { kind: "screenshot", ref: `${stamp}/${file}.png`, url };
}
function withShots(shots: ReturnType<typeof shot>[], id = "T-merge", kind: NeedItem["kind"] = "merge"): NeedItem {
  const base = item(id, kind);
  return { ...base, ticket: { ...base.ticket, artifacts: [{ kind: "merge_request", ref: "!1", url: "https://example.com/mr/1" }, ...shots] } };
}
const SET = [shot("390x844-hour-11"), shot("1440x900-hour-21"), shot("1440x900-hour-11")];
const NEWER = [shot("1440x900-hour-11", "20261023-090000"), shot("1440x900-hour-21", "20261023-090000")];

async function setupShots(initial = [withShots(SET)]) {
  const root = new Node();
  body.append(root);
  const list = vi.fn<() => Promise<NeedList>>(async () => initial);
  const act = vi.fn(async () => {});
  const column = createNeedsColumn(root as unknown as HTMLElement, { list, act }, vi.fn());
  await column.refresh();
  return { root, list, act, column };
}
const row = (root: Node, id = "T-merge") => byClass(card(root, id), "need-shots");
const thumbs = (root: Node, id = "T-merge") => row(root, id).children;
const imgOf = (cell: Node) => cell.children[0];
const viewerRoot = () => byClass(body, "shot-viewer");
const viewerName = () => byClass(body, "shot-viewer-name").textContent;
const key = (name: string) => (dom.activeElement ?? viewerRoot()).dispatch("keydown", { key: name });

describe("hàng ảnh review trong thẻ", () => {
  it("hiện ngay dưới liên kết, đúng thứ tự tên file, lazy, alt và title theo nhãn", async () => {
    const { root } = await setupShots();
    const target = card(root);
    const links = byClass(target, "need-links");
    expect(target.children[target.children.indexOf(links) + 1]).toBe(row(root));
    expect(row(root).hidden).toBe(false);
    const labels = ["1440x900-hour-11", "1440x900-hour-21", "390x844-hour-11"];
    expect(thumbs(root).map((c) => c.tag)).toEqual(["button", "button", "button"]);
    expect(thumbs(root).map((c) => c.attributes.get("title"))).toEqual(labels);
    thumbs(root).forEach((cell, i) => {
      const img = imgOf(cell);
      expect(img.tag).toBe("img");
      expect(Object.fromEntries(img.attributes)).toEqual({
        loading: "lazy", decoding: "async", alt: labels[i], title: labels[i], src: `https://img.test/${STAMP}/${labels[i]}.png`,
      });
    });
  });

  it("không có ảnh hợp lệ thì ẩn hàng", async () => {
    const { root } = await setupShots([withShots([shot("a", STAMP, "javascript:alert(1)")])]);
    expect(row(root).hidden).toBe(true);
    expect(thumbs(root)).toHaveLength(0);
  });

  it("ảnh lỗi thành liên kết mở tab mới, ảnh khác giữ nguyên", async () => {
    const { root } = await setupShots();
    const [first, second] = thumbs(root);
    imgOf(second).dispatch("error");
    expect(thumbs(root)[0]).toBe(first);
    const fallback = thumbs(root)[1];
    expect(fallback.tag).toBe("a");
    expect(fallback.textContent).toBe("1440x900-hour-21 ↗");
    expect(fallback.href).toBe(`https://img.test/${STAMP}/1440x900-hour-21.png`);
    expect(fallback.target).toBe("_blank");
    expect(fallback.rel).toBe("noopener noreferrer");
  });

  it("bấm ảnh mở lightbox đúng ảnh, ←/→ chuyển, Esc đóng, không lan và trả focus về ảnh đã bấm", async () => {
    const { root } = await setupShots();
    const clicked = thumbs(root)[1];
    clicked.click();
    expect(viewerRoot().hidden).toBe(false);
    expect(viewerRoot().parent).toBe(body);
    expect(viewerName()).toBe("1440x900-hour-21");
    key("ArrowRight");
    expect(viewerName()).toBe("390x844-hour-11");
    key("ArrowLeft");
    key("ArrowLeft");
    expect(viewerName()).toBe("1440x900-hour-11");
    const esc = key("Escape");
    expect(esc.stopped).toBe(true);
    expect(viewerRoot().hidden).toBe(true);
    expect(dom.activeElement).toBe(clicked);
  });

  it("poll cùng bộ giữ nguyên node ảnh và ô đã thành liên kết", async () => {
    const { root, list, column } = await setupShots();
    imgOf(thumbs(root)[0]).dispatch("error");
    const before = [...thumbs(root)];
    const imgs = before.slice(1).map(imgOf);
    // Mảng và object mới nhưng cùng url: không dựng lại.
    list.mockResolvedValueOnce([withShots([...SET].reverse())]);
    await column.refresh();
    expect(thumbs(root)).toEqual(before);
    thumbs(root).forEach((cell, i) => expect(cell).toBe(before[i]));
    expect(thumbs(root).slice(1).map(imgOf)).toEqual(imgs);
    expect(thumbs(root)[0].tag).toBe("a");
  });

  it("ảnh mất rồi xuất hiện lại: hàng ẩn rồi hiện, ghi chú và xác nhận vẫn giữ", async () => {
    const { root, list, column } = await setupShots();
    const target = confirm(root);
    find(target, (n) => n.tag === "textarea").value = "xem ảnh rồi";
    list.mockResolvedValueOnce([withShots([])]);
    await column.refresh();
    expect(card(root)).toBe(target);
    expect(row(root).hidden).toBe(true);
    expect(thumbs(root)).toHaveLength(0);
    await column.refresh();
    expect(card(root)).toBe(target);
    expect(row(root).hidden).toBe(false);
    expect(thumbs(root).map((c) => c.attributes.get("title"))).toEqual(["1440x900-hour-11", "1440x900-hour-21", "390x844-hour-11"]);
    expect(find(target, (n) => n.tag === "textarea").value).toBe("xem ảnh rồi");
    expect(byClass(target, "need-confirm").hidden).toBe(false);
  });

  it("bộ mới với số ảnh khác thì dựng lại đúng bộ mới", async () => {
    const { root, list, column } = await setupShots();
    const old = [...thumbs(root)];
    list.mockResolvedValueOnce([withShots([...SET, ...NEWER])]);
    await column.refresh();
    expect(thumbs(root)).toHaveLength(2);
    expect(thumbs(root).some((c) => old.includes(c))).toBe(false);
    expect(thumbs(root).map((c) => imgOf(c).attributes.get("src"))).toEqual([
      "https://img.test/20261023-090000/1440x900-hour-11.png",
      "https://img.test/20261023-090000/1440x900-hour-21.png",
    ]);
  });

  it("bộ mới tới khi lightbox đang mở: vẫn xem bộ cũ, đóng thì focus ảnh đầu hàng mới", async () => {
    const { root, list, column } = await setupShots();
    thumbs(root)[2].click();
    list.mockResolvedValueOnce([withShots(NEWER)]);
    await column.refresh();
    expect(viewerRoot().hidden).toBe(false);
    expect(viewerName()).toBe("390x844-hour-11");
    key("Escape");
    expect(dom.activeElement).toBe(thumbs(root)[0]);
    expect(imgOf(thumbs(root)[0]).attributes.get("src")).toContain("20261023-090000");
  });

  it("ảnh đã bấm thành liên kết khi lightbox mở: đóng thì focus ô đầu hàng", async () => {
    const { root } = await setupShots();
    const clicked = thumbs(root)[1];
    clicked.click();
    imgOf(clicked).dispatch("error");
    key("Escape");
    expect(dom.activeElement).toBe(thumbs(root)[0]);
  });

  it.each(["rời danh sách", "đổi loại"])("ticket %s khi lightbox mở thì lightbox đóng", async (change) => {
    const { root, list, column } = await setupShots([withShots(SET), withShots(SET, "T-other")]);
    thumbs(root).at(0)!.click();
    list.mockResolvedValueOnce(change === "đổi loại" ? [withShots(SET, "T-merge", "escalated"), withShots(SET, "T-other")] : [withShots(SET, "T-other")]);
    await expect(column.refresh()).resolves.toBeUndefined();
    expect(viewerRoot().hidden).toBe(true);
    // Thẻ cũ đã gỡ: không còn chỗ nào hợp lệ để trả focus.
    expect(root.contains(dom.activeElement)).toBe(false);
  });

  it("thẻ khác bị gỡ không đóng lightbox của thẻ đang xem", async () => {
    const { root, list, column } = await setupShots([withShots(SET), withShots(SET, "T-other")]);
    thumbs(root).at(0)!.click();
    list.mockResolvedValueOnce([withShots(SET)]);
    await column.refresh();
    expect(viewerRoot().hidden).toBe(false);
  });

  it("list lỗi (offline) giữ hàng ảnh và lightbox đang mở", async () => {
    const { root, list, column } = await setupShots();
    const before = [...thumbs(root)];
    before[1].click();
    list.mockRejectedValueOnce(new Error("mất mạng"));
    await column.refresh();
    expect(byClass(root, "needs-error").textContent).toContain("mất mạng");
    before.forEach((cell, i) => expect(thumbs(root)[i]).toBe(cell));
    expect(viewerRoot().hidden).toBe(false);
    expect(viewerName()).toBe("1440x900-hour-21");
    key("Escape");
    expect(dom.activeElement).toBe(before[1]);
  });

  it("đổi nguồn đóng lightbox", async () => {
    const { root, list, act, column } = await setupShots();
    thumbs(root)[0].click();
    column.setSource({ list, act });
    expect(viewerRoot().hidden).toBe(true);
  });
});
