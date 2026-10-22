// Lớp xem ảnh lớn (lightbox) cho ảnh Reviewer chụp. Gắn thẳng vào body: drawer dùng
// backdrop-filter nên mọi position: fixed bên trong nó bị giới hạn trong khung drawer.

import "./shot-viewer.css";

export interface ShotViewerItem {
  url: string;
  label: string;
}

export interface ShotViewer {
  open(shots: readonly ShotViewerItem[], index: number, returnFocus: () => HTMLElement | null): void;
  close(): void;
  isOpen(): boolean;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function button(className: string, text: string, label: string): HTMLButtonElement {
  const result = node("button", className, text);
  result.setAttribute("type", "button");
  result.setAttribute("aria-label", label);
  return result;
}

export function createShotViewer(): ShotViewer {
  const root = node("div", "shot-viewer");
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Xem ảnh review");
  // Bấm vào vùng không có nút thì focus về root, phím vẫn tới listener của dialog.
  root.setAttribute("tabindex", "-1");

  const stage = node("div", "shot-viewer-stage");
  const bar = node("div", "shot-viewer-bar");
  const caption = node("p", "shot-viewer-caption");
  const name = node("span", "shot-viewer-name");
  const position = node("span", "shot-viewer-pos mono");
  const prev = button("shot-viewer-prev", "‹ Trước", "Ảnh trước");
  const next = button("shot-viewer-next", "Sau ›", "Ảnh sau");
  const close = button("shot-viewer-close", "Đóng", "Đóng xem ảnh");
  caption.append(name, position);
  bar.append(caption, prev, next, close);
  root.append(stage, bar);

  let shots: ShotViewerItem[] = [];
  let index = 0;
  let open = false;
  let returnFocus: () => HTMLElement | null = () => null;
  // Ảnh đang hiện; lỗi đến từ ảnh cũ (đã chuyển ảnh) thì bỏ qua.
  let current: HTMLImageElement | null = null;
  // Liên kết thay ảnh lỗi, nằm trong vòng Tab của dialog.
  let link: HTMLAnchorElement | null = null;

  function fallback(shot: ShotViewerItem): HTMLAnchorElement {
    const result = node("a", "shot-viewer-fallback", `Không tải được ${shot.label}. Mở ảnh ↗`);
    result.setAttribute("href", shot.url);
    result.setAttribute("target", "_blank");
    result.setAttribute("rel", "noopener noreferrer");
    return result;
  }

  function show(toward: HTMLButtonElement | null = null): void {
    const shot = shots[index];
    // Liên kết ảnh lỗi đang focus sắp bị gỡ: không giữ lại thì focus rơi về body, Esc lọt xuống drawer.
    const lost = stage.contains(document.activeElement);
    // Không đặt crossOrigin: ảnh sau Cloudflare Access cần gửi cookie như ảnh thường.
    const img = node("img", "shot-viewer-img");
    img.setAttribute("alt", shot.label);
    img.setAttribute("decoding", "async");
    img.addEventListener("error", () => {
      if (img !== current) return;
      current = null;
      link = fallback(shot);
      img.replaceWith(link);
    });
    img.setAttribute("src", shot.url);
    current = img;
    link = null;
    stage.replaceChildren(img);

    name.textContent = shot.label;
    position.textContent = `${index + 1}/${shots.length}`;
    const single = shots.length < 2;
    prev.hidden = single;
    next.hidden = single;
    prev.disabled = index === 0;
    next.disabled = index === shots.length - 1;
    // Nút đang focus vừa bị khoá (tới biên) thì focus mất khỏi dialog; chuyển sang Đóng.
    const active = document.activeElement;
    if (lost) (toward && !toward.hidden && !toward.disabled ? toward : close).focus();
    else if ((active === prev && prev.disabled) || (active === next && next.disabled)) close.focus();
  }

  function go(step: number): void {
    const target = index + step;
    if (target < 0 || target >= shots.length) return;
    index = target;
    show(step < 0 ? prev : next);
  }

  function focusables(): HTMLElement[] {
    const list: HTMLElement[] = link ? [link] : [];
    for (const item of [prev, next, close]) if (!item.hidden && !item.disabled) list.push(item);
    return list;
  }

  function trapTab(event: KeyboardEvent): void {
    const list = focusables();
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    const inside = list.some((item) => item === active);
    if (event.shiftKey ? (!inside || active === first) : (!inside || active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  function hide(): void {
    if (!open) return;
    open = false;
    root.hidden = true;
    current = null;
    link = null;
    // Gỡ ảnh để trình duyệt dừng tải ảnh lớn khi đã đóng.
    stage.replaceChildren();
    const target = returnFocus();
    returnFocus = () => null;
    if (target && target.isConnected) target.focus();
  }

  root.addEventListener("keydown", (event) => {
    if (!open) return;
    if (event.key === "Tab") {
      trapTab(event);
      return;
    }
    // Alt+← là "quay lại" của trình duyệt, không giành.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") hide();
    else if (event.key === "ArrowLeft") go(-1);
    else if (event.key === "ArrowRight") go(1);
    else return;
    // Esc không được lan lên document, nơi main.ts và drawer.ts đóng ngăn chi tiết.
    event.preventDefault();
    event.stopPropagation();
  });
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (target === root || target === stage) hide();
    else if ((target as Element | null)?.className === "shot-viewer-img" &&
             outsideContent(target as HTMLImageElement, event)) hide();
  });
  prev.addEventListener("click", () => { go(-1); });
  next.addEventListener("click", () => { go(1); });
  close.addEventListener("click", () => { hide(); });

  return {
    open(list, at, focusBack) {
      // Chụp lại danh sách: poll đổi mảng gốc thì ảnh đang xem không nhảy.
      const copy = list
        .filter((shot) => shot && typeof shot.url === "string" && typeof shot.label === "string")
        .map((shot) => ({ url: shot.url, label: shot.label }));
      if (copy.length === 0) {
        hide();
        return;
      }
      shots = copy;
      index = Number.isInteger(at) ? Math.min(Math.max(at, 0), copy.length - 1) : 0;
      returnFocus = focusBack;
      if (!root.isConnected) document.body.append(root);
      open = true;
      root.hidden = false;
      show();
      close.focus();
    },
    close: hide,
    isOpen: () => open,
  };
}

// Ảnh phủ cả khung (object-fit: contain): bấm vào dải viền quanh phần ảnh thật cũng là bấm nền.
function outsideContent(img: HTMLImageElement, event: MouseEvent): boolean {
  if (typeof img.getBoundingClientRect !== "function") return false;
  const box = img.getBoundingClientRect();
  if (!img.naturalWidth || !img.naturalHeight || !box.width || !box.height) return false;
  const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
  const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
  const left = box.left + (box.width - w) / 2, top = box.top + (box.height - h) / 2;
  return event.clientX < left || event.clientX > left + w || event.clientY < top || event.clientY > top + h;
}
