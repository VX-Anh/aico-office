// Cột "Cần bạn" cạnh canvas: một thẻ cho mỗi ticket cần người (duyệt kế hoạch, duyệt merge, escalated).
// Logic chọn nút, ghi chú bắt buộc, xác nhận nằm ở tickets.ts (thuần); file này chỉ dựng DOM.

import type { Ticket } from "./api";
import { createLatestGate } from "./latest";
import {
  type NeedAction,
  type NeedKind,
  NEED_LABEL,
  actionsFor,
  canSubmit,
  needsConfirmation,
  mergeRequest,
  needsYou,
  previewLink,
  waitedLabel,
} from "./tickets";
import "./needs-column.css";

export interface NeedItem {
  ticket: Ticket;
  kind: NeedKind;
  reason: string | null;
}

/** Mảng cũ chỉ là thẻ cột. `{ items, tickets }` hoặc mảng có thêm `tickets` là snapshot đầy đủ. */
export type NeedList = NeedItem[] | { items: NeedItem[]; tickets: Ticket[] };

export interface NeedSource {
  list(): Promise<NeedList>;
  act(item: NeedItem, action: NeedAction, comment: string): Promise<void>;
}

function needItemsOf(raw: NeedList): NeedItem[] {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.items)) return raw.items;
  return [];
}

function needSnapshotOf(raw: NeedList): Ticket[] | null {
  const tickets = Array.isArray(raw)
    ? (raw as NeedItem[] & { tickets?: unknown }).tickets
    : raw && Array.isArray(raw.tickets) ? raw.tickets : null;
  return Array.isArray(tickets) ? tickets : null;
}

const LABELS: Record<NeedKind, Partial<Record<NeedAction, string>>> = {
  plan: { approved: "Duyệt kế hoạch", revise: "Yêu cầu sửa", rejected: "Từ chối" },
  merge: { approved: "Duyệt merge", changes_requested: "Yêu cầu sửa", rejected: "Từ chối" },
  escalated: { retry_push: "Đẩy lại", merge: "Merge", close: "Đóng", fail: "Đánh dấu lỗi" },
};

function actionLabel(kind: NeedKind, action: NeedAction): string {
  return LABELS[kind][action] ?? action;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

function link(text: string): HTMLAnchorElement {
  const a = node("a", text);
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

function setHref(a: HTMLAnchorElement, url: string | null): void {
  a.hidden = !url;
  if (url) a.href = url;
  else a.removeAttribute("href");
}

// Ticket đổi loại (vd plan sang merge) là thẻ khác: không mang theo ghi chú hay xác nhận của loại cũ.
function keyOf(item: NeedItem): string {
  return `${item.ticket.id}|${item.kind}`;
}

interface Card {
  root: HTMLElement;
  id: string;
  update(item: NeedItem): void;
  tick(): void;
  focus(): void;
}

export function createNeedsColumn(
  root: HTMLElement,
  initialSource: NeedSource,
  onItems: (items: NeedItem[]) => void,
  onError: (error: string | null) => void = () => {},
  onSnapshot: (tickets: Ticket[]) => void = () => {},
) {
  let source = initialSource;
  let generation = 0;
  let now = Date.now();
  const gate = createLatestGate();
  root.classList.add("needs-column");
  const heading = node("h2");
  const error = node("p");
  error.className = "needs-error";
  error.setAttribute("role", "status");
  const list = node("div");
  list.className = "needs-list";
  root.append(heading, error, list);
  const cards = new Map<string, Card>();
  let items = new Map<string, NeedItem>();
  // Khoá theo id|kind kể cả khi một poll tạm gỡ thẻ đang gửi: thẻ hiện lại vẫn bị khoá tới khi gửi xong.
  const pending = new Set<string>();

  function layout(): void {
    heading.textContent = `Cần bạn (${cards.size})`;
    root.hidden = cards.size === 0;
  }

  function createCard(first: NeedItem): Card {
    const key = keyOf(first);
    const { id } = first.ticket;
    const kind = first.kind;
    const cardGeneration = generation;
    const article = node("article");
    article.className = "need-card";
    article.dataset.ticketId = id;
    article.dataset.kind = kind;
    const head = node("div");
    head.className = "need-head";
    const code = node("strong", id);
    const badge = node("span", NEED_LABEL[kind]);
    badge.className = `need-kind need-kind-${kind}`;
    const waited = node("span");
    waited.className = "need-waited";
    head.append(code, badge, waited);
    const title = node("h3");
    const reason = node("p");
    reason.className = "need-reason";
    const links = node("div");
    links.className = "need-links";
    const mr = link("Xem MR ↗");
    const preview = link("Xem trước ↗");
    links.append(mr, preview);
    const comment = node("textarea");
    comment.rows = 2;
    comment.placeholder = "Ghi chú";
    comment.setAttribute("aria-label", `Ghi chú ${id}`);
    const actions = node("div");
    actions.className = "need-actions";
    const confirmation = node("div");
    confirmation.className = "need-confirm";
    const question = node("span");
    const yes = node("button", "Xác nhận");
    const cancel = node("button", "Huỷ");
    yes.type = cancel.type = "button";
    confirmation.append(question, yes, cancel);
    const message = node("p");
    message.className = "need-message";
    message.setAttribute("role", "status");
    article.append(head, title, reason, links, comment, actions, confirmation, message);
    let item = first;
    let confirming: NeedAction | null = null;
    // Nhắc thiếu ghi chú tự tắt khi người gõ; lỗi từ aico thì giữ tới lần gửi sau.
    let hint = false;
    const buttons = new Map<NeedAction, HTMLButtonElement>();

    function enabled(action: NeedAction): boolean {
      return actionsFor(kind, item.reason, item.ticket).some((a) => a.action === action && a.enabled);
    }

    function say(text: string, isHint: boolean): void {
      message.textContent = text;
      hint = isHint;
    }

    function render(): void {
      const busy = pending.has(key);
      const available = new Map(actionsFor(kind, item.reason, item.ticket).map((a) => [a.action, a.enabled]));
      // Vd MR mất khi đang hỏi "Merge?": huỷ xác nhận thay vì gửi hành động không còn hợp lệ.
      if (confirming && !available.get(confirming)) confirming = null;
      title.textContent = item.ticket.title;
      reason.hidden = kind !== "escalated";
      reason.textContent = kind === "escalated" ? item.reason ?? "chưa rõ lý do" : "";
      setHref(mr, mergeRequest(item.ticket).url);
      setHref(preview, previewLink(item.ticket));
      links.hidden = mr.hidden && preview.hidden;
      for (const [action, button] of buttons) button.disabled = busy || !available.get(action);
      comment.readOnly = busy;
      confirmation.hidden = confirming === null;
      question.textContent = confirming
        ? kind === "merge" && confirming === "approved"
          ? `Merge PR vào main: ${id}?`
          : `${actionLabel(kind, confirming)} ${id}?`
        : "";
      yes.disabled = cancel.disabled = busy;
      article.setAttribute("aria-busy", String(busy));
      tick();
    }

    function tick(): void {
      waited.textContent = waitedLabel(item.ticket.updated_at, now);
    }

    function needComment(action: NeedAction): boolean {
      if (canSubmit(action, comment.value)) return false;
      say(`Cần ghi chú để ${actionLabel(kind, action).toLowerCase()}.`, true);
      comment.focus();
      return true;
    }

    async function submit(action: NeedAction): Promise<void> {
      // Thẻ đã bị poll gỡ hoặc thay thế không được gửi từ listener cũ.
      if (generation !== cardGeneration || cards.get(key) !== card || pending.has(key) || !enabled(action)) return;
      if (needComment(action)) return;
      const requestSource = source;
      pending.add(key);
      say("", false);
      render();
      try {
        await requestSource.act(item, action, comment.value);
        if (generation !== cardGeneration) return;
        confirming = null;
        comment.value = "";
        // Bỏ kết quả list bắt đầu trước lúc hành động hoàn tất.
        gate.invalidate();
        await refresh();
      } catch (exc) {
        if (generation === cardGeneration && cards.get(key) === card) {
          say(exc instanceof Error ? exc.message : String(exc), false);
        }
      } finally {
        if (generation === cardGeneration) {
          pending.delete(key);
          // Thẻ có thể đã bị gỡ rồi dựng lại trong lúc gửi: mở khoá thẻ đang hiện, không phải thẻ cũ.
          const current = items.get(key);
          if (current) cards.get(key)?.update(current);
        }
      }
    }

    for (const { action } of actionsFor(kind, first.reason, first.ticket)) {
      const button = node("button", actionLabel(kind, action));
      button.type = "button";
      button.addEventListener("click", () => {
        if (needComment(action)) return;
        if (needsConfirmation(kind, action)) {
          confirming = action;
          say("", false);
          render();
        } else void submit(action);
      });
      buttons.set(action, button);
      actions.append(button);
    }
    yes.addEventListener("click", () => { if (confirming) void submit(confirming); });
    cancel.addEventListener("click", () => { confirming = null; render(); });
    comment.addEventListener("input", () => { if (hint) say("", false); });
    article.addEventListener("animationend", () => article.classList.remove("flash"));

    const card: Card = {
      root: article,
      id,
      update(next) { item = next; render(); },
      tick,
      focus() {
        article.scrollIntoView({ block: "nearest" });
        comment.focus({ preventScroll: true });
        // Bỏ class rồi đọc layout để lần nháy sau vẫn chạy lại animation.
        article.classList.remove("flash");
        void article.offsetWidth;
        article.classList.add("flash");
      },
    };
    render();
    return card;
  }

  // Mới nhất trên cùng theo cùng thứ tự với tickets.ts; trùng khoá thì giữ cái đầu.
  function ordered(next: NeedItem[]): NeedItem[] {
    const rank = new Map<Ticket, number>(needsYou(next.map((i) => i.ticket)).map((t, i) => [t, i]));
    const seen = new Set<string>();
    return next
      .filter((item) => {
        const key = keyOf(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((item, i) => ({ item, r: rank.get(item.ticket) ?? next.length + i }))
      .sort((a, b) => a.r - b.r)
      .map(({ item }) => item);
  }

  // Chỉ chèn thẻ lệch chỗ để không mất chữ đang gõ; nếu phải dời thẻ đang focus thì trả focus lại.
  function place(order: NeedItem[]): void {
    const active = document.activeElement;
    order.forEach((item, i) => {
      const el = cards.get(keyOf(item))!.root;
      const at = list.children[i] ?? null;
      if (el !== at) list.insertBefore(el, at);
    });
    if (active instanceof HTMLElement && active !== document.activeElement && list.contains(active)) {
      active.focus({ preventScroll: true });
    }
  }

  async function refresh(): Promise<void> {
    const request = gate.start();
    const requestSource = source;
    try {
      const raw = await requestSource.list();
      if (!gate.accept(request)) return;
      const next = ordered(needItemsOf(raw));
      const tickets = needSnapshotOf(raw);
      items = new Map(next.map((item) => [keyOf(item), item]));
      for (const [key, card] of cards) {
        if (!items.has(key)) { card.root.remove(); cards.delete(key); }
      }
      for (const [key, item] of items) {
        const card = cards.get(key);
        if (card) card.update(item);
        else cards.set(key, createCard(item));
      }
      place(next);
      error.textContent = "";
      onError(null);
      layout();
      onItems(next);
      // Lỗi và request bị gate bỏ không tới đây, nên không phát snapshot cũ.
      if (tickets) onSnapshot(tickets);
    } catch (exc) {
      if (!gate.accept(request)) return;
      // Giữ thẻ cũ: mất mạng một lượt không được xoá ghi chú đang gõ.
      error.textContent = `Lỗi tải ticket: ${exc instanceof Error ? exc.message : String(exc)}`;
      onError(error.textContent);
    }
  }

  layout();
  return {
    refresh,
    setSource(next: NeedSource): void {
      generation++;
      gate.reset();
      source = next;
      cards.clear();
      items.clear();
      pending.clear();
      list.replaceChildren();
      error.textContent = "";
      onError(null);
      layout();
    },
    /** Cuộn tới thẻ đầu tiên của ticket, focus ô ghi chú và nháy viền; false nếu không có thẻ. */
    focus(id: string): boolean {
      const el = [...list.children].find((e) => e instanceof HTMLElement && e.dataset.ticketId === id);
      const card = [...cards.values()].find((c) => c.root === el);
      card?.focus();
      return card !== undefined;
    },
    /** Gọi mỗi giây để cập nhật "chờ N phút" mà không chờ poll. */
    tick(at: number): void {
      now = at;
      for (const card of cards.values()) card.tick();
    },
  };
}
