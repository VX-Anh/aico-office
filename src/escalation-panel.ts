import type { EscalationAction, Ticket } from "./api";
import { actionAvailability, ESCALATION_ACTIONS, mergeRequest, needsConfirm } from "./tickets";

export interface EscalationItem {
  ticket: Ticket;
  reason: string | null;
}

export interface EscalationSource {
  list(): Promise<EscalationItem[]>;
  act(id: string, action: EscalationAction, comment: string): Promise<void>;
}

const LABELS: Record<EscalationAction, string> = {
  retry_push: "Đẩy lại", merge: "Merge", close: "Đóng", fail: "Đánh dấu lỗi",
};
const STORAGE_KEY = "aico-office.escalations";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

interface TicketRow {
  root: HTMLElement;
  update(item: EscalationItem): void;
}

export function createEscalationPanel(root: HTMLElement, initialSource: EscalationSource) {
  let source = initialSource;
  let generation = 0;
  let revision = 0;
  let collapsed = false;
  try { collapsed = localStorage.getItem(STORAGE_KEY) === "collapsed"; } catch { /* Chỉ lưu trong phiên nếu bị chặn. */ }
  const toggle = node("button");
  toggle.type = "button";
  toggle.className = "escalation-toggle";
  const body = node("div");
  body.id = "escalation-body";
  toggle.setAttribute("aria-controls", body.id);
  const error = node("p");
  error.className = "error";
  error.setAttribute("role", "status");
  const empty = node("p", "Không có ticket cần xử lý");
  const list = node("div");
  list.className = "escalation-list";
  body.append(error, empty, list);
  root.append(toggle, body);
  const rows = new Map<string, TicketRow>();
  // Khoá theo id kể cả khi một poll tạm gỡ dòng đang gửi.
  const pending = new Set<string>();

  function heading(): void {
    toggle.textContent = `${collapsed ? "▸" : "▾"} Ticket cần xử lý (${rows.size})`;
    toggle.setAttribute("aria-expanded", String(!collapsed));
    body.hidden = collapsed;
    empty.hidden = rows.size > 0;
  }
  toggle.addEventListener("click", () => {
    collapsed = !collapsed;
    try { localStorage.setItem(STORAGE_KEY, collapsed ? "collapsed" : "expanded"); } catch { /* Giữ trạng thái trong phiên. */ }
    heading();
  });

  function createRow(first: EscalationItem): TicketRow {
    const id = first.ticket.id;
    const rowGeneration = generation;
    const article = node("article");
    article.className = "escalation-ticket";
    article.dataset.ticketId = id;
    const code = node("strong", id);
    const title = node("h3");
    const reason = node("p");
    const mr = node("a", "Xem MR ↗");
    mr.target = "_blank";
    mr.rel = "noopener noreferrer";
    const comment = node("textarea");
    comment.rows = 2;
    comment.placeholder = "Ghi chú";
    comment.setAttribute("aria-label", `Ghi chú ${id}`);
    const actions = node("div");
    actions.className = "escalation-actions";
    const confirmation = node("div");
    confirmation.className = "escalation-confirm";
    const question = node("span");
    const yes = node("button", "Xác nhận");
    const cancel = node("button", "Huỷ");
    yes.type = cancel.type = "button";
    confirmation.append(question, yes, cancel);
    const message = node("p");
    message.className = "error";
    message.setAttribute("role", "status");
    article.append(code, title, reason, mr, comment, actions, confirmation, message);
    let item = first;
    let confirming: EscalationAction | null = null;
    const buttons = new Map<EscalationAction, HTMLButtonElement>();

    function render(): void {
      const available = actionAvailability(item.reason, item.ticket);
      if (confirming && !available[confirming]) confirming = null;
      title.textContent = item.ticket.title;
      reason.textContent = item.reason ?? "chưa rõ lý do";
      const link = mergeRequest(item.ticket).url;
      mr.hidden = !link;
      if (link) mr.href = link;
      else mr.removeAttribute("href");
      for (const [action, button] of buttons) button.disabled = pending.has(id) || !available[action];
      confirmation.hidden = confirming === null;
      question.textContent = confirming ? `${LABELS[confirming]} ticket này?` : "";
      yes.disabled = cancel.disabled = pending.has(id);
      article.setAttribute("aria-busy", String(pending.has(id)));
    }

    async function submit(action: EscalationAction): Promise<void> {
      if (generation !== rowGeneration || pending.has(id) || !actionAvailability(item.reason, item.ticket)[action]) return;
      const requestSource = source;
      pending.add(id);
      message.textContent = "";
      render();
      try {
        await requestSource.act(id, action, comment.value);
        if (generation !== rowGeneration) return;
        confirming = null;
        // Bỏ kết quả list bắt đầu trước lúc action hoàn tất.
        revision++;
        await refresh();
      } catch (exc) {
        if (generation === rowGeneration && rows.get(id) === row) {
          message.textContent = exc instanceof Error ? exc.message : String(exc);
        }
      } finally {
        if (generation === rowGeneration) {
          pending.delete(id);
          rows.get(id)?.update(itemFor(id) ?? item);
        }
      }
    }

    for (const action of ESCALATION_ACTIONS) {
      const button = node("button", LABELS[action]);
      button.type = "button";
      button.addEventListener("click", () => {
        if (needsConfirm(action)) { confirming = action; render(); }
        else void submit(action);
      });
      buttons.set(action, button);
      actions.append(button);
    }
    yes.addEventListener("click", () => { if (confirming) void submit(confirming); });
    cancel.addEventListener("click", () => { confirming = null; render(); });
    const row: TicketRow = { root: article, update(next) { item = next; render(); } };
    render();
    return row;
  }

  let items = new Map<string, EscalationItem>();
  function itemFor(id: string): EscalationItem | undefined { return items.get(id); }

  async function refresh(): Promise<void> {
    const requestGeneration = generation;
    const requestRevision = ++revision;
    const requestSource = source;
    try {
      const next = await requestSource.list();
      if (generation !== requestGeneration || revision !== requestRevision) return;
      items = new Map(next.map((item) => [item.ticket.id, item]));
      for (const [id, row] of rows) {
        if (!items.has(id)) { row.root.remove(); rows.delete(id); }
      }
      for (const [id, item] of items) {
        let row = rows.get(id);
        if (!row) {
          row = createRow(item);
          rows.set(id, row);
          list.append(row.root);
        } else row.update(item);
      }
      error.textContent = "";
      heading();
    } catch (exc) {
      if (generation !== requestGeneration || revision !== requestRevision) return;
      error.textContent = `Lỗi tải ticket: ${exc instanceof Error ? exc.message : String(exc)}`;
    }
  }

  heading();
  return {
    refresh,
    setSource(next: EscalationSource): void {
      generation++;
      revision++;
      source = next;
      rows.clear();
      items.clear();
      pending.clear();
      list.replaceChildren();
      error.textContent = "";
      heading();
    },
  };
}
