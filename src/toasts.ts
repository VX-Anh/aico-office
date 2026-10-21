// DOM cho toast "cần bạn". Gộp, huỷ và giới hạn 3 toast nằm ở attention.ts;
// file này chỉ dựng phần tử và giữ node theo khoá id|kind để poll không nháy lại.

import {
  dismissToast, reconcileToasts, resetToasts,
  type AttentionEntry, type ToastState,
} from "./attention";
import "./toasts.css";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

// Cùng quy ước khoá với attention.ts (không export hàm đó).
function toastKey(entry: AttentionEntry): string {
  return `${entry.id}|${entry.kind}`;
}

function toastText(entry: AttentionEntry): string {
  return `${entry.id} cần bạn: ${entry.label}`;
}

interface ToastView {
  root: HTMLElement;
  update(entry: AttentionEntry): void;
}

export function createToasts(
  root: HTMLElement,
  handlers: { onOpen(id: string): void },
): { update(entries: AttentionEntry[]): void; reset(): void } {
  let state: ToastState = resetToasts();
  const views = new Map<string, ToastView>();

  root.classList.add("toast-stack");
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.replaceChildren();

  function createToast(entry: AttentionEntry): ToastView {
    let current = entry;
    const article = node("article");
    article.className = "toast";
    const message = node("p");
    const actions = node("div");
    actions.className = "toast-actions";
    const open = node("button", "Xử lý");
    const close = node("button", "×");
    open.type = "button";
    close.type = "button";
    close.setAttribute("aria-label", "Đóng thông báo");
    open.addEventListener("click", () => { handlers.onOpen(current.id); });
    close.addEventListener("click", () => {
      state = dismissToast(state, toastKey(current));
      render();
    });
    actions.append(open, close);
    article.append(message, actions);

    const view: ToastView = {
      root: article,
      update(next) {
        current = next;
        const text = toastText(next);
        // Gán lại cùng chuỗi vẫn thay text node, dễ nháy chữ toast đang giữ.
        if (message.textContent !== text) message.textContent = text;
      },
    };
    view.update(entry);
    return view;
  }

  function render(): void {
    const live = new Set(state.toasts.map(toastKey));
    for (const [key, view] of views) {
      if (live.has(key)) continue;
      view.root.remove();
      views.delete(key);
    }
    // Mới nhất đứng trước. insertBefore chỉ đổi chỗ node cũ, không tạo lại.
    let cursor: ChildNode | null = root.firstChild;
    for (const entry of state.toasts) {
      const key = toastKey(entry);
      let view = views.get(key);
      if (!view) {
        view = createToast(entry);
        views.set(key, view);
      } else view.update(entry);
      if (view.root !== cursor) root.insertBefore(view.root, cursor);
      cursor = view.root.nextSibling;
    }
  }

  return {
    update(entries) {
      state = reconcileToasts(state, entries);
      render();
    },
    reset() {
      state = resetToasts();
      render();
    },
  };
}
