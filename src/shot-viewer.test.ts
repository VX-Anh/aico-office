import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShotViewer } from "./shot-viewer";

// DOM nhỏ chạy trong node: sự kiện nổi bọt lên tới document, isConnected theo cây thật.
interface FakeEvent {
  type: string;
  target: Node;
  key?: string;
  shiftKey?: boolean;
  altKey?: boolean;
  clientX?: number;
  clientY?: number;
  defaultPrevented: boolean;
  stopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}
const dom = { activeElement: null as Node | null };
class Node {
  children: Node[] = [];
  parent: Node | null = null;
  attributes = new Map<string, string>();
  className = "";
  textContent = "";
  hidden = false;
  disabled = false;
  listeners = new Map<string, ((event: FakeEvent) => void)[]>();
  constructor(readonly tag = "div") {}
  get isConnected(): boolean { return this === docNode || (this.parent !== null && this.parent.isConnected); }
  append(...children: Node[]) {
    for (const child of children) { child.remove(); this.children.push(child); child.parent = this; }
  }
  remove() {
    // Như Chromium: gỡ phần tử đang focus (hoặc cha của nó) thì focus rơi về body.
    if (this.contains(dom.activeElement)) dom.activeElement = body;
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  replaceWith(other: Node) {
    const parent = this.parent;
    if (!parent) return;
    other.remove();
    parent.children.splice(parent.children.indexOf(this), 1, other);
    other.parent = parent;
    this.parent = null;
  }
  replaceChildren(...children: Node[]) { for (const child of [...this.children]) child.remove(); this.append(...children); }
  contains(child: Node | null): boolean { return child === this || this.children.some((c) => c.contains(child)); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  focus() { dom.activeElement = this; }
  addEventListener(type: string, listener: (event: FakeEvent) => void) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
  }
  dispatch(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const event: FakeEvent = {
      type, target: this, defaultPrevented: false, stopped: false, ...init,
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

function find(root: Node, predicate: (node: Node) => boolean): Node | null {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}
function must(root: Node, predicate: (node: Node) => boolean): Node {
  const found = find(root, predicate);
  if (!found) throw new Error("Không tìm thấy node");
  return found;
}
const byClass = (name: string) => must(body, (n) => n.className.split(" ").includes(name));
const dialog = () => byClass("shot-viewer");
const img = () => must(body, (n) => n.tag === "img");
const caption = () => `${byClass("shot-viewer-name").textContent} ${byClass("shot-viewer-pos").textContent}`;
const key = (name: string, init: Partial<FakeEvent> = {}) => (dom.activeElement ?? dialog()).dispatch("keydown", { key: name, ...init });

const shots = [
  { url: "https://x.test/a.png", label: "1440x900-hour-11" },
  { url: "https://x.test/b.png", label: "1440x900-hour-21" },
  { url: "https://x.test/c.png", label: "390x844-hour-11" },
];

beforeEach(() => {
  docNode = new Node("#document");
  body = new Node("body");
  docNode.append(body);
  dom.activeElement = null;
  vi.stubGlobal("document", {
    createElement: (tag: string) => new Node(tag),
    body,
    get activeElement() { return dom.activeElement; },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

function openAt(index = 0, list = shots) {
  const thumb = new Node("button");
  body.append(thumb);
  const viewer = createShotViewer();
  viewer.open(list, index, () => thumb as unknown as HTMLElement);
  return { viewer, thumb };
}

describe("lightbox xem ảnh", () => {
  it("mở: gắn vào body, là dialog modal, đúng ảnh và focus nút Đóng", () => {
    const { viewer } = openAt(1);
    expect(viewer.isOpen()).toBe(true);
    expect(dialog().parent).toBe(body);
    expect(dialog().hidden).toBe(false);
    expect(dialog().attributes.get("role")).toBe("dialog");
    expect(dialog().attributes.get("aria-modal")).toBe("true");
    expect(img().attributes.get("src")).toBe(shots[1].url);
    expect(img().attributes.get("alt")).toBe(shots[1].label);
    expect(img().attributes.has("crossorigin")).toBe(false);
    expect(caption()).toBe("1440x900-hour-21 2/3");
    expect(dom.activeElement).toBe(byClass("shot-viewer-close"));
  });

  it("←/→ chuyển ảnh, dừng ở đầu và cuối, không quay vòng", () => {
    openAt(0);
    expect(byClass("shot-viewer-prev").disabled).toBe(true);
    const left = key("ArrowLeft");
    expect(left.defaultPrevented).toBe(true);
    expect(caption()).toBe("1440x900-hour-11 1/3");
    key("ArrowRight");
    key("ArrowRight");
    expect(caption()).toBe("390x844-hour-11 3/3");
    expect(byClass("shot-viewer-next").disabled).toBe(true);
    key("ArrowRight");
    expect(caption()).toBe("390x844-hour-11 3/3");
    expect(img().attributes.get("src")).toBe(shots[2].url);
    key("ArrowLeft");
    expect(caption()).toBe("1440x900-hour-21 2/3");
  });

  it("nút Trước/Sau; nút đang focus bị khoá ở biên thì focus về Đóng", () => {
    openAt(1);
    const next = byClass("shot-viewer-next");
    next.focus();
    next.click();
    expect(caption()).toBe("390x844-hour-11 3/3");
    expect(dom.activeElement).toBe(byClass("shot-viewer-close"));
    byClass("shot-viewer-prev").click();
    expect(caption()).toBe("1440x900-hour-21 2/3");
  });

  it("Alt+← để trình duyệt xử lý", () => {
    openAt(1);
    const event = key("ArrowLeft", { altKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(caption()).toBe("1440x900-hour-21 2/3");
  });

  it("1 ảnh thì ẩn Trước/Sau", () => {
    openAt(0, [shots[0]]);
    expect(byClass("shot-viewer-prev").hidden).toBe(true);
    expect(byClass("shot-viewer-next").hidden).toBe(true);
    expect(caption()).toBe("1440x900-hour-11 1/1");
  });

  it("Esc đóng, trả focus và không lan lên document", () => {
    const { viewer, thumb } = openAt(0);
    const onDocument = vi.fn();
    docNode.addEventListener("keydown", onDocument);
    const event = key("Escape");
    expect(event.stopped).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(onDocument).not.toHaveBeenCalled();
    expect(viewer.isOpen()).toBe(false);
    expect(dialog().hidden).toBe(true);
    expect(dom.activeElement).toBe(thumb);
  });

  it("phím khác vẫn lan lên document", () => {
    openAt(0);
    const onDocument = vi.fn();
    docNode.addEventListener("keydown", onDocument);
    key("a");
    expect(onDocument).toHaveBeenCalledOnce();
  });

  it("đóng rồi thì Esc không bị giữ lại", () => {
    const { viewer } = openAt(0);
    viewer.close();
    const event = dialog().dispatch("keydown", { key: "Escape" });
    expect(event.stopped).toBe(false);
  });

  it("bấm nền thì đóng, bấm ảnh hay thanh chữ thì không", () => {
    const { viewer } = openAt(0);
    img().click();
    byClass("shot-viewer-caption").click();
    expect(viewer.isOpen()).toBe(true);
    byClass("shot-viewer-stage").click();
    expect(viewer.isOpen()).toBe(false);
    viewer.open(shots, 0, () => null);
    dialog().click();
    expect(viewer.isOpen()).toBe(false);
  });

  it("bấm vào dải viền quanh ảnh (object-fit: contain) cũng là bấm nền", () => {
    const { viewer } = openAt(0);
    // Khung 1000x500, ảnh 200x200 hiện 500x500 ở giữa: x 250..750.
    Object.assign(img(), {
      naturalWidth: 200,
      naturalHeight: 200,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }),
    });
    img().dispatch("click", { clientX: 500, clientY: 250 });
    expect(viewer.isOpen()).toBe(true);
    img().dispatch("click", { clientX: 100, clientY: 250 });
    expect(viewer.isOpen()).toBe(false);
  });

  it("nút Đóng đóng lightbox", () => {
    const { viewer, thumb } = openAt(2);
    byClass("shot-viewer-close").click();
    expect(viewer.isOpen()).toBe(false);
    expect(dom.activeElement).toBe(thumb);
  });

  it("ảnh lỗi thành liên kết mở tab mới; chuyển ảnh thì thử tải lại", () => {
    openAt(0);
    img().dispatch("error");
    expect(find(body, (n) => n.tag === "img")).toBeNull();
    const link = byClass("shot-viewer-fallback");
    expect(link.tag).toBe("a");
    expect(link.attributes.get("href")).toBe(shots[0].url);
    expect(link.attributes.get("target")).toBe("_blank");
    expect(link.attributes.get("rel")).toBe("noopener noreferrer");
    key("ArrowRight");
    expect(img().attributes.get("src")).toBe(shots[1].url);
    expect(find(body, (n) => n.className === "shot-viewer-fallback")).toBeNull();
  });

  it("lỗi đến muộn từ ảnh cũ không thay ảnh đang xem", () => {
    openAt(0);
    const old = img();
    key("ArrowRight");
    old.dispatch("error");
    expect(img().attributes.get("src")).toBe(shots[1].url);
  });

  it("Tab chạy vòng trong dialog, kể cả liên kết thay ảnh lỗi", () => {
    openAt(1);
    const prev = byClass("shot-viewer-prev");
    const close = byClass("shot-viewer-close");
    expect(key("Tab").defaultPrevented).toBe(true);
    expect(dom.activeElement).toBe(prev);
    close.focus();
    key("Tab", { shiftKey: false });
    expect(dom.activeElement).toBe(prev);
    key("Tab", { shiftKey: true });
    expect(dom.activeElement).toBe(close);
    img().dispatch("error");
    close.focus();
    key("Tab");
    expect(dom.activeElement).toBe(byClass("shot-viewer-fallback"));
    // Focus rơi về root (bấm vùng trống) thì Tab vào phần tử đầu.
    dialog().focus();
    key("Tab", { shiftKey: true });
    expect(dom.activeElement).toBe(close);
  });

  it("Tab giữa hai nút ở giữa để trình duyệt tự chuyển", () => {
    openAt(1);
    byClass("shot-viewer-prev").focus();
    expect(key("Tab").defaultPrevented).toBe(false);
  });

  it("returnFocus trả phần tử đã gỡ thì không lỗi, không focus", () => {
    const { viewer, thumb } = openAt(0);
    thumb.remove();
    expect(() => key("Escape")).not.toThrow();
    expect(viewer.isOpen()).toBe(false);
    expect(dom.activeElement).not.toBe(thumb);
    const other = createShotViewer();
    other.open(shots, 0, () => null);
    expect(() => other.close()).not.toThrow();
  });

  it("open lại khi đang mở thì thay nội dung, không tạo dialog thứ hai", () => {
    const { viewer } = openAt(0);
    const second = new Node("button");
    body.append(second);
    viewer.open([shots[2], shots[0]], 1, () => second as unknown as HTMLElement);
    expect(body.children.filter((n) => n.className === "shot-viewer")).toHaveLength(1);
    expect(caption()).toBe("1440x900-hour-11 2/2");
    key("Escape");
    expect(dom.activeElement).toBe(second);
  });

  it.each([
    [0, "ArrowRight"],
    [2, "ArrowLeft"],
  ])("giữ focus khi rời liên kết ảnh lỗi tại %s", (index, arrow) => {
    const { viewer, thumb } = openAt(index);
    img().dispatch("error");
    byClass("shot-viewer-fallback").focus();

    key(arrow);

    expect(dom.activeElement?.isConnected).toBe(true);
    expect(dialog().contains(dom.activeElement)).toBe(true);
    key("Escape");
    expect(viewer.isOpen()).toBe(false);
    expect(dom.activeElement).toBe(thumb);
  });

  it("rời liên kết ảnh lỗi sang ảnh cũng lỗi: focus vẫn trong dialog, phím vẫn chạy", () => {
    const { viewer, thumb } = openAt(0);
    img().dispatch("error");
    byClass("shot-viewer-fallback").focus();
    key("ArrowRight");
    img().dispatch("error");
    expect(dialog().contains(dom.activeElement)).toBe(true);
    byClass("shot-viewer-fallback").focus();
    key("ArrowRight");
    expect(caption()).toBe("390x844-hour-11 3/3");
    expect(dialog().contains(dom.activeElement)).toBe(true);
    key("ArrowLeft");
    expect(caption()).toBe("1440x900-hour-21 2/3");
    key("Escape");
    expect(viewer.isOpen()).toBe(false);
    expect(dom.activeElement).toBe(thumb);
  });

  it("rời liên kết ảnh lỗi: focus về nút cùng hướng, tới biên thì về Đóng", () => {
    openAt(1);
    img().dispatch("error");
    byClass("shot-viewer-fallback").focus();
    key("ArrowRight");
    expect(dom.activeElement).toBe(byClass("shot-viewer-close"));
    img().dispatch("error");
    byClass("shot-viewer-fallback").focus();
    key("ArrowLeft");
    expect(dom.activeElement).toBe(byClass("shot-viewer-prev"));
  });

  it("chụp lại danh sách lúc mở: đổi mảng gốc không ảnh hưởng", () => {
    const list = shots.map((shot) => ({ ...shot }));
    openAt(0, list);
    list.splice(0, 3, { url: "https://x.test/z.png", label: "z" });
    key("ArrowRight");
    expect(caption()).toBe("1440x900-hour-21 2/3");
  });

  it("index ngoài khoảng bị kẹp; danh sách rỗng không mở", () => {
    openAt(9);
    expect(caption()).toBe("390x844-hour-11 3/3");
    const viewer = createShotViewer();
    viewer.open([], 0, () => null);
    expect(viewer.isOpen()).toBe(false);
  });

  it("đóng gỡ ảnh để dừng tải và close hai lần không lỗi", () => {
    const { viewer } = openAt(0);
    viewer.close();
    viewer.close();
    expect(find(body, (n) => n.tag === "img")).toBeNull();
  });
});
