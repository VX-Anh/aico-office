import { type ApiConfig, type WorkerStatus, demoWorkers, needAction, fetchEscalationReason, fetchTickets, fetchWorkers, loadConfig, roomAgents, saveConfig } from "./api";
import { ROLE_STYLES, USAGE, drawScene, resetActors, roleStyle, sceneSize } from "./scene/index";
import { isStale, parseUsage, shortCountdown, usageLevel, usagePercent } from "./usage";
import { createNeedsColumn, type NeedItem, type NeedSource } from "./needs-column";
import { isShortcut, nextAttention, tabTitle } from "./attention";
import { createToasts } from "./toasts";
import { createLatestGate } from "./latest";
import { applyDemoAction, createReasonCache, demoNeedTickets, NEED_LABEL, needKind, needsYou } from "./tickets";
import "./style.css";

const POLL_MS = 3000;
const STATE_LABEL: Record<WorkerStatus["state"], string> = {
  idle: "Đang rảnh",
  working: "Đang làm",
  limited: "Hết hạn mức",
  offline: "Mất kết nối",
};

const canvas = document.querySelector<HTMLCanvasElement>("#office")!;
const cards = document.querySelector<HTMLDivElement>("#cards")!;
const status = document.querySelector<HTMLSpanElement>("#conn")!;
const form = document.querySelector<HTMLFormElement>("#settings")!;
const legend = document.querySelector<HTMLDivElement>("#legend")!;
const ctx = canvas.getContext("2d")!;

let config: ApiConfig | null = loadConfig();
let workers: WorkerStatus[] = demoWorkers(Date.now());
const workerGate = createLatestGate();

const workspace = document.querySelector<HTMLElement>(".workspace")!;
const needsRoot = document.querySelector<HTMLElement>("#needs")!;
const needsCount = document.querySelector<HTMLButtonElement>("#needs-count")!;
const agentsCount = document.querySelector<HTMLElement>("#agents-count")!;
const ticketError = document.querySelector<HTMLElement>("#tickets-error")!;
let attentionItems: NeedItem[] = [];
let currentAttention: string | null = null;

function ticketSource(current: ApiConfig | null): NeedSource {
  if (!current) {
    let tickets = demoNeedTickets(Date.now());
    return {
      async list() {
        return needsYou(tickets).map((ticket) => ({
          ticket, kind: needKind(ticket.status)!, reason: ticket.reason,
        }));
      },
      async act(item, action) {
        tickets = applyDemoAction(tickets, item.ticket.id, item.kind, action);
      },
    };
  }
  const reasons = createReasonCache((id) => fetchEscalationReason(current, id));
  return {
    async list() {
      const tickets = await fetchTickets(current);
      const resolved = await reasons.resolve(tickets.filter((ticket) => needKind(ticket.status) === "escalated"));
      const byId = new Map(resolved.map((item) => [item.ticket.id, item.reason]));
      return tickets.map((ticket) => ({
        ticket, kind: needKind(ticket.status)!, reason: byId.get(ticket.id) ?? null,
      }));
    },
    act(item, action, comment) { return needAction(current, item.kind, item.ticket.id, action, comment); },
  };
}

function focusTicket(id: string): void {
  if (column.focus(id)) currentAttention = id;
}

const toasts = createToasts(document.querySelector<HTMLElement>("#toasts")!, { onOpen: focusTicket });

function onItems(items: NeedItem[]): void {
  attentionItems = items;
  const n = items.length;
  needsCount.textContent = `Cần bạn: ${n}`;
  needsCount.disabled = n === 0;
  needsCount.classList.toggle("hot", n > 0);
  document.title = tabTitle(n);
  workspace.classList.toggle("has-needs", n > 0);
  toasts.update(items.map(({ ticket, kind }) => ({ id: ticket.id, kind, label: NEED_LABEL[kind] })));
}

const column = createNeedsColumn(needsRoot, ticketSource(config), onItems);
// Cột đã gate kết quả tải: đọc dòng lỗi này để request cũ không báo lỗi sang nguồn mới.
new MutationObserver(() => {
  const message = needsRoot.querySelector(".needs-error")?.textContent ?? "";
  ticketError.hidden = !message;
  ticketError.title = message;
  ticketError.setAttribute("aria-label", message);
}).observe(needsRoot.querySelector(".needs-error")!, { childList: true, characterData: true, subtree: true });

needsCount.addEventListener("click", () => {
  const first = attentionItems[0];
  if (first) focusTicket(first.ticket.id);
});
needsRoot.addEventListener("focusin", (event) => {
  const target = event.target;
  if (target instanceof Element) currentAttention = target.closest<HTMLElement>("[data-ticket-id]")?.dataset.ticketId ?? currentAttention;
});
document.addEventListener("keydown", (event) => {
  const target = event.target;
  const editable = target instanceof Element && (
    !!target.closest("input, textarea, select") ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
  if (!isShortcut({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, editable })) return;
  const next = nextAttention(attentionItems.map((item) => item.ticket.id), currentAttention);
  if (next) {
    event.preventDefault();
    focusTicket(next);
  }
});

function changeSource(): void {
  workerGate.reset();
  column.setSource(ticketSource(config));
  currentAttention = null;
  onItems([]);
  // Nguồn mới cần được primed bằng lần tải thành công đầu, kể cả khi nguồn cũ đang tải.
  toasts.reset();
  ticketError.hidden = true;
  ticketError.title = "";
  ticketError.setAttribute("aria-label", "");
}


function fmtNumber(n: number | undefined): string {
  return new Intl.NumberFormat("vi-VN", { notation: "compact" }).format(n ?? 0);
}

function fmtAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return "chưa chạy";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} giây trước`;
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  return `${Math.round(s / 3600)} giờ trước`;
}

function fmtElapsed(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} giây`;
  if (s < 3600) return `${Math.floor(s / 60)} phút ${s % 60} giây`;
  return `${Math.floor(s / 3600)} giờ ${Math.floor((s % 3600) / 60)} phút`;
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(label: string, value: string): HTMLElement {
  const r = el("div", "row");
  r.append(el("span", "label", label), el("span", "value", value));
  return r;
}

function renderCards(now: number): void {
  column.tick(now);
  const count = workers.filter((w) => w.state !== "offline").reduce((sum, w) => sum + roomAgents(w).agents.length, 0);
  agentsCount.textContent = `Đang làm: ${count} agent`;
  cards.replaceChildren(
    ...workers.map((w) => {
      const card = el("article", `card state-${w.state}`);
      const head = el("header", "card-head");
      head.append(el("h2", "name", `Phòng ${w.name}`), el("span", "badge", STATE_LABEL[w.state]));
      card.append(head);
      card.append(el("p", "roles", w.roles.length ? `Vai trò: ${w.roles.join(", ")}` : "Chưa giao vai trò"));

      const { agents, slots } = roomAgents(w);
      card.append(row("Agent con", `${agents.length}/${slots}`));
      if (agents.length) {
        const list = el("ul", "agents");
        for (const a of agents) {
          const style = roleStyle(a.role);
          const item = el("li", "agent-row");
          const dot = el("span", "swatch");
          dot.style.background = style.shirt;
          item.append(
            dot,
            el("span", "agent-role", style.label),
            el("span", "value", `${a.ticket_id ?? "?"} · ${a.mode} · ${fmtElapsed(a.started_at, now)}`),
          );
          list.append(item);
        }
        card.append(list);
      }
      if (w.state === "limited" && w.limit) {
        const box = el("div", "limit");
        box.append(
          el("strong", "", w.limit.resets_at ? `Mở lại sau ${shortCountdown(w.limit.resets_at, now)}` : "Chưa rõ giờ mở lại"),
          el("p", "", w.limit.message),
          el("p", "", "Hạn mức chung cho cả phòng"),
        );
        card.append(box);
      }
      const usage = parseUsage(w.usage, w.name);
      if (usage) {
        const box = el("section", "usage");
        box.append(el("h3", "usage-title", "Hạn mức"));
        for (const window of usage.windows) {
          const item = el("div", "usage-window");
          const dot = el("span", "swatch");
          dot.style.background = USAGE[usageLevel(window.used_percent)];
          item.append(
            dot,
            el("span", "", `${window.name}: ${usagePercent(window.used_percent)}% · reset sau ${shortCountdown(window.resets_at, now)}`),
          );
          box.append(item);
        }
        if (usage.plan) box.append(row("Gói", usage.plan));
        if (usage.source) box.append(row("Nguồn số liệu", usage.source));
        if (usage.note) box.append(el("p", "usage-note", usage.note));
        if (usage.error) box.append(el("p", "error", `Lỗi hạn mức: ${usage.error}`));
        if (isStale(usage.checked_at, now)) {
          const minutes = Math.floor((now - Date.parse(usage.checked_at)) / 60_000);
          box.append(el("p", "usage-stale", `số liệu cũ (${minutes} phút trước)`));
        }
        card.append(box);
      }
      const total = (w.runs_ok ?? 0) + (w.runs_failed ?? 0);
      card.append(
        row("Hôm nay", `${w.runs_today ?? 0} lượt · ${fmtNumber(w.tokens_today)} token`),
        row("Tổng", `${total} lượt (${w.runs_failed ?? 0} lỗi) · ${fmtNumber((w.input_tokens ?? 0) + (w.output_tokens ?? 0))} token`),
        row("Lần cuối", `${fmtAgo(w.last_run_at, now)}${w.last_duration_seconds ? ` · ${w.last_duration_seconds}s` : ""}`),
      );
      if (w.last_error && w.state !== "limited") card.append(el("p", "error", w.last_error));
      if (w.state === "offline") card.append(el("p", "error", `Không gọi được phòng${w.error ? ` (${w.error})` : ""}`));
      return card;
    }),
  );
}

async function pollWorkers(): Promise<void> {
  const current = config;
  const request = workerGate.start();
  if (!current) {
    workers = demoWorkers(Date.now());
    status.textContent = "Chế độ demo (dữ liệu giả)";
    status.className = "conn demo";
    return;
  }
  try {
    const next = await fetchWorkers(current);
    if (!workerGate.accept(request)) return;
    workers = next;
    status.textContent = `Đã nối ${current.baseUrl}`;
    status.className = "conn ok";
  } catch (exc) {
    if (!workerGate.accept(request)) return;
    status.textContent = `Lỗi: ${(exc as Error).message}`;
    status.className = "conn bad";
  }
}

async function poll(): Promise<void> {
  await Promise.allSettled([pollWorkers(), column.refresh()]);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const baseUrl = String(data.get("baseUrl") ?? "").trim();
  const token = String(data.get("token") ?? "").trim();
  config = baseUrl && token ? { baseUrl, token } : null;
  saveConfig(config);
  changeSource();
  // đổi nguồn dữ liệu: xoá cảnh cũ, agent của nguồn mới được đặt thẳng vào ghế
  if (config) workers = [];
  resetActors();
  void poll();
});
form.querySelector<HTMLButtonElement>("#demo")!.addEventListener("click", () => {
  config = null;
  saveConfig(null);
  changeSource();
  resetActors();
  void poll();
});
if (config) (form.elements.namedItem("baseUrl") as HTMLInputElement).value = config.baseUrl;

function renderLegend(): void {
  legend.replaceChildren(
    ...Object.values(ROLE_STYLES).map((style) => {
      const item = el("span", "legend-item");
      const dot = el("span", "swatch");
      dot.style.background = style.shirt;
      item.append(dot, document.createTextNode(`${style.label} (${style.accessory})`));
      return item;
    }),
  );
}

function frame(t: number): void {
  // demo tính lại mỗi frame để nhân vật bắt đầu đi ngay khi kịch bản đổi pha, không trễ theo nhịp polling 3 giây
  if (!config) workers = demoWorkers(Date.now());
  const size = sceneSize(workers);
  // vẽ với hệ số phóng nguyên: pixel đều nhau và vẫn sắc khi phóng to hoặc trên màn hình HiDPI
  const k = Math.min(8, Math.max(1, Math.ceil((canvas.clientWidth * devicePixelRatio) / size.width)));
  if (canvas.width !== size.width * k || canvas.height !== size.height * k) {
    canvas.width = size.width * k;
    canvas.height = size.height * k;
  }
  ctx.setTransform(k, 0, 0, k, 0, 0);
  drawScene(ctx, workers, t, Date.now());
  requestAnimationFrame(frame);
}

void poll();
setInterval(() => void poll(), POLL_MS);
setInterval(() => renderCards(Date.now()), 1000);
renderCards(Date.now());
renderLegend();
requestAnimationFrame(frame);
