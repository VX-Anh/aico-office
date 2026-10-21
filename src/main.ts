import { withDemoActivity } from "./activity";
import { hitFigure, createAgentTooltip } from "./agent-tooltip";
import { type ApiConfig, type Ticket, type WorkerStatus, demoWorkers, fetchEscalationReason, fetchTicketSnapshot, fetchWorkers, loadConfig, needAction, roomAgents, saveConfig } from "./api";
import { isShortcut, nextAttention, tabTitle } from "./attention";
import { createLatestGate } from "./latest";
import { createNeedsColumn, type NeedItem, type NeedSource } from "./needs-column";
import { createOverlay } from "./overlay";
import { demoEventAssignments, demoEventTickets } from "./scene/demo-events";
import { type SceneFigure, drawScene, resetActors, resetSceneCache, sceneSize } from "./scene/index";
import { computeLayout, roomSigns } from "./scene/layout";
import { lightingMinutes } from "./scene/lighting";
import { type RoomBanner, createRoomEvents } from "./scene/room-events";
import { applyDemoAction, createReasonCache, demoNeedTickets, needKind, needsYou, NEED_LABEL } from "./tickets";
import { createToasts } from "./toasts";
import { createDrawer } from "./ui/drawer";
import { createFeed } from "./ui/feed";
import { createFeedState, reduceFeed, resetFeed, type FeedState } from "./ui/feed-model";
import { agentKey, drawerView, resolveSelection, type SelectedAgent } from "./ui/selection";
import { createSidebar, type Sidebar } from "./ui/sidebar";
import { createTopbar } from "./ui/topbar";
import { computeInsets, fitScene, type Rect } from "./ui/viewport";
import "./style.css";

const POLL_MS = 3000;
const NARROW_QUERY = "(max-width: 899px)";
// Trùng --gap và minFree mà viewport.test dùng: vùng trống không bị panel che, vẫn còn chỗ vẽ.
const GAP = 10;
const MIN_FREE = 100;

const canvas = document.querySelector<HTMLCanvasElement>("#office")!;
const stage = document.querySelector<HTMLElement>("#stage")!;
const topbarRoot = document.querySelector<HTMLElement>("#topbar")!;
const sidebarRoot = document.querySelector<HTMLElement>("#sidebar")!;
const drawerRoot = document.querySelector<HTMLElement>("#drawer")!;
const feedRoot = document.querySelector<HTMLElement>("#feed")!;
const status = document.querySelector<HTMLSpanElement>("#conn")!;
const form = document.querySelector<HTMLFormElement>("#settings")!;
const demoButton = document.querySelector<HTMLButtonElement>("#demo")!;
const ctx = canvas.getContext("2d")!;
const overlay = createOverlay(canvas);
const tooltip = createAgentTooltip(canvas);

let config: ApiConfig | null = loadConfig();
const initialNow = Date.now();
let workers: WorkerStatus[] = withDemoActivity(demoWorkers(initialNow), initialNow);
const workerGate = createLatestGate();
// Đổi nguồn giữa chừng: poll cũ không được ghi feed hay mở lại ngăn.
let sourceEpoch = 0;

const needsCount = document.querySelector<HTMLButtonElement>("#needs-count")!;
const ticketsError = document.querySelector<HTMLElement>("#tickets-error")!;
let needItems: NeedItem[] = [];
let focusedTicket: string | null = null;
let selectedKey: string | null = null;
// null: theo drawerView. "needs": người dùng mở tab Cần bạn dù đang chọn agent.
let tab: "agent" | "needs" | null = null;
let needsDismissed = false;
let previousNeedsCount = 0;
let narrow = false;
let feedState: FeedState = createFeedState();
let free: Rect = { left: 0, top: 0, width: 0, height: 0 };
let figures: SceneFigure[] = [];
const roomEvents = createRoomEvents();
let banners: RoomBanner[] = [];
let pendingSnapshot: Ticket[] | null = null;
let snapshotSeq = 0;
let appliedSnapshot = 0;

const shell: {
  sidebar?: Sidebar;
  feed?: ReturnType<typeof createFeed>;
} = {};

function readHour(): string | null {
  const search = globalThis.location?.search;
  if (typeof search !== "string" || !search) return null;
  return new URLSearchParams(search).get("hour");
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function assignmentsAt(now: number): { ticketId: string; provider: string }[] {
  const list: { ticketId: string; provider: string }[] = [];
  for (const worker of workers) {
    for (const agent of roomAgents(worker).agents) {
      if (typeof agent.ticket_id === "string" && agent.ticket_id) list.push({ ticketId: agent.ticket_id, provider: worker.name });
    }
  }
  if (!config) list.push(...demoEventAssignments(now));
  return list;
}

function onSnapshot(tickets: Ticket[]): void {
  pendingSnapshot = tickets;
  snapshotSeq += 1;
}

function ticketSource(current: ApiConfig | null): NeedSource {
  let tickets = demoNeedTickets(Date.now());
  const reasons = current ? createReasonCache((id) => fetchEscalationReason(current, id)) : null;
  return {
    async list() {
      const now = Date.now();
      // Một request. Demo giữ 4 thẻ cần người; snapshot thêm ticket sự kiện cho banner.
      const full = current ? await fetchTicketSnapshot(current) : [...tickets, ...demoEventTickets(now)];
      const list = needsYou(current ? full : tickets);
      const escalated = list.filter((ticket) => needKind(ticket.status) === "escalated");
      const resolved = reasons ? await reasons.resolve(escalated) : [];
      const items = list.map((ticket) => ({
        ticket,
        kind: needKind(ticket.status)!,
        reason: current
          ? resolved.find((item) => item.ticket.id === ticket.id)?.reason ?? null
          : tickets.find((item) => item.id === ticket.id)?.reason ?? null,
      }));
      return Object.assign(items, { tickets: full });
    },
    async act(item, action, comment) {
      if (current) await needAction(current, item.kind, item.ticket.id, action, comment);
      else tickets = applyDemoAction(tickets, item.ticket.id, item.kind, action);
    },
  };
}

function needIds(): Set<string> {
  return new Set(needItems.map((item) => item.ticket.id));
}

function selectedAgent(): SelectedAgent | null {
  return resolveSelection(selectedKey, workers);
}

// Agent biến mất, đổi started_at, hoặc phòng offline/limited: bỏ khoá để lần sau không tự mở.
function dropMissingSelection(): boolean {
  if (!selectedKey || selectedAgent()) return false;
  selectedKey = null;
  if (tab === "agent") tab = null;
  return true;
}

function publish(): void {
  const now = Date.now();
  dropMissingSelection();
  const selected = selectedAgent();
  if (needItems.length === 0 && tab === "needs") tab = selected ? "agent" : null;
  const showAgent = tab !== "needs" && selected !== null;
  const view = drawerView({
    selected: showAgent ? selected : null,
    needsCount: needItems.length,
    needsDismissed,
    narrow,
    previousNeedsCount,
  });
  // 0→1 sau khi đã đóng: drawerView mở lại, và phải xoá cờ kẻo lần publish sau đóng mất.
  if (view.open && view.tab === "needs") {
    needsDismissed = false;
    tab = "needs";
  }
  drawer.render(
    { ...view, needsCount: needItems.length },
    selected ? { ...selected, needItems } : null,
    now,
  );
  const ids = needIds();
  topbar.update(workers, needItems.length, now, ids);
  shell.sidebar?.update(workers, ids, selected?.key ?? null, now);
}

function absorbFeed(): void {
  feedState = reduceFeed(feedState, workers, needItems, Date.now());
  shell.feed?.render(feedState.lines);
}

function showNeeds(id: string): void {
  needsDismissed = false;
  tab = "needs";
  publish();
  if (panel.focus(id)) focusedTicket = id;
}

function selectAgent(key: string): void {
  selectedKey = key;
  tab = "agent";
  publish();
}

function closeDrawer(): void {
  selectedKey = null;
  tab = null;
  needsDismissed = true;
  publish();
}

function onNeedItems(items: NeedItem[]): void {
  previousNeedsCount = needItems.length;
  needItems = items;
  absorbFeed();
  publish();
  previousNeedsCount = items.length;
  document.title = tabTitle(items.length);
  if (!items.some((item) => item.ticket.id === focusedTicket)) focusedTicket = null;
  toasts.update(items.map((item) => ({ id: item.ticket.id, kind: item.kind, label: NEED_LABEL[item.kind] })));
}

const toasts = createToasts(document.querySelector<HTMLElement>("#toasts")!, { onOpen: showNeeds });
const needsRoot = document.querySelector<HTMLElement>("#needs")!;
const panel = createNeedsColumn(needsRoot, ticketSource(config), onNeedItems, (error) => {
  ticketsError.hidden = !error;
  ticketsError.title = error ?? "";
  ticketsError.setAttribute("aria-label", error ?? "");
}, onSnapshot);

const topbar = createTopbar(topbarRoot, { onSettings: () => relayout() });
const sidebar = createSidebar(sidebarRoot, { onSelect: selectAgent, shortcut: false });
shell.sidebar = sidebar;

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest("input, textarea, select"));
}

// Bubble, đăng ký trước feed/drawer để stopImmediatePropagation chặn lần thu/đóng thứ hai.
// Popover cài đặt nghe Esc trên chính nó và stopPropagation, nên không tới đây.
document.addEventListener("keydown", (event) => {
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !typing(event.target);
  if ((event.key === "[" || event.key === "]" || event.key === "Escape") && plain && !event.repeat) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === "[") shell.sidebar?.toggle();
    else if (event.key === "]") shell.feed?.setCollapsed(!feedRoot.classList.contains("is-collapsed"));
    else closeDrawer();
    relayout();
    return;
  }
  // Bộ đếm luôn tới ticket đầu; phím P đi tiếp từ thẻ đang chọn (kể cả thẻ người dùng tự bấm/Tab tới).
  if (!isShortcut({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, editable: typing(event.target) })) return;
  const next = nextAttention(needItems.map((item) => item.ticket.id), focusedTicket);
  if (!next) return;
  event.preventDefault();
  showNeeds(next);
});

const drawer = createDrawer(drawerRoot, needsRoot, {
  onClose: closeDrawer,
  onTab(next) {
    if (next === "needs") {
      needsDismissed = false;
      tab = "needs";
    } else tab = "agent";
    publish();
  },
});
const feed = createFeed(feedRoot);
shell.feed = feed;
sidebar.onLayout(relayout);
drawer.onLayout(relayout);
feed.onLayout(relayout);

needsCount.addEventListener("click", () => {
  const first = needItems[0];
  if (first) showNeeds(first.ticket.id);
});
needsRoot.addEventListener("focusin", (event) => {
  const target = event.target;
  if (target instanceof HTMLElement) {
    focusedTicket = target.closest<HTMLElement>("[data-ticket-id]")?.dataset.ticketId ?? focusedTicket;
  }
});

function changeSource(): void {
  sourceEpoch += 1;
  workerGate.reset();
  roomEvents.reset();
  banners = [];
  pendingSnapshot = null;
  appliedSnapshot = snapshotSeq;
  resetSceneCache();
  selectedKey = null;
  tab = null;
  needsDismissed = false;
  previousNeedsCount = 0;
  needItems = [];
  focusedTicket = null;
  figures = [];
  feedState = resetFeed();
  shell.feed?.render([]);
  const now = Date.now();
  const width = sceneSize(workers).width;
  overlay.draw([], width, now, { signs: [], banners: [], reducedMotion: reducedMotion() });
  tooltip.update([], width, now);
  document.title = tabTitle(0);
  ticketsError.hidden = true;
  ticketsError.title = "";
  ticketsError.setAttribute("aria-label", "");
  toasts.reset();
  panel.setSource(ticketSource(config));
  publish();
}

function panelRect(el: HTMLElement): Rect | null {
  // hidden: ngăn đóng không chiếm vùng trống. Thu gọn vẫn đo vì còn một dải hẹp.
  if (el.hidden) return null;
  const box = el.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  return { left: box.left, top: box.top, width: box.width, height: box.height };
}

function relayout(): void {
  narrow = typeof matchMedia === "function" && matchMedia(NARROW_QUERY).matches;
  const width = document.documentElement.clientWidth || globalThis.innerWidth || 0;
  const height = document.documentElement.clientHeight || globalThis.innerHeight || 0;
  const insets = computeInsets(
    { width, height },
    { topbar: panelRect(topbarRoot), sidebar: panelRect(sidebarRoot), drawer: panelRect(drawerRoot), feed: panelRect(feedRoot) },
    { gap: GAP, narrow, minFree: MIN_FREE },
  );
  const style = document.documentElement.style;
  style.setProperty("--free-top", `${insets.top}px`);
  style.setProperty("--free-right", `${insets.right}px`);
  style.setProperty("--free-bottom", `${insets.bottom}px`);
  style.setProperty("--free-left", `${insets.left}px`);
  free = {
    left: insets.left,
    top: insets.top,
    width: Math.max(0, width - insets.left - insets.right),
    height: Math.max(0, height - insets.top - insets.bottom),
  };
}

function focusOf(list: readonly SceneFigure[]): { x: number; y: number } | undefined {
  const selected = selectedAgent();
  if (!selected) return undefined;
  const figure = list.find((item) => item.room === selected.worker.name
    && item.agent.id === selected.agent.id
    && item.agent.started_at === selected.agent.started_at);
  if (!figure) return undefined;
  return { x: figure.x, y: (figure.headY + figure.footY) / 2 };
}

// Cùng phép đổi toạ độ với tooltip để bấm trúng đúng nhân vật đang hiện.
function scenePoint(event: PointerEvent): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const width = canvas.clientWidth;
  const sceneW = sceneSize(workers).width;
  if (sceneW <= 0 || width <= 0 || rect.width <= 0) return null;
  const scale = rect.width / (canvas.offsetWidth || rect.width);
  const x = (event.clientX - rect.left - canvas.clientLeft * scale) / scale;
  const y = (event.clientY - rect.top - canvas.clientTop * scale) / scale;
  if (x < 0 || y < 0 || x > width || y > canvas.clientHeight) return null;
  return { x: x * sceneW / width, y: y * sceneW / width };
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button) return;
  const point = scenePoint(event);
  if (!point) return;
  const figure = hitFigure(figures, point.x, point.y);
  if (!figure) return;
  selectAgent(agentKey(figure.room, figure.agent));
});

type PollOutcome = "applied" | "error" | "stale";

async function pollWorkers(): Promise<PollOutcome> {
  const current = config;
  const request = workerGate.start();
  if (!current) {
    const now = Date.now();
    workers = withDemoActivity(demoWorkers(now), now);
    status.textContent = "Chế độ demo (dữ liệu giả)";
    status.className = "conn demo";
    return "applied";
  }
  try {
    const next = await fetchWorkers(current);
    if (!workerGate.accept(request)) return "stale";
    workers = next;
    status.textContent = `Đã nối ${current.baseUrl}`;
    status.className = "conn ok";
    return "applied";
  } catch (exc) {
    if (!workerGate.accept(request)) return "stale";
    status.textContent = `Lỗi: ${(exc as Error).message}`;
    status.className = "conn bad";
    return "error";
  }
}

async function poll(): Promise<void> {
  const epoch = sourceEpoch;
  // Ticket và worker chạy cùng lúc như trước; kết quả worker cũ bị gate bỏ.
  const workersTask = pollWorkers();
  await Promise.allSettled([workersTask, panel.refresh()]);
  if (epoch !== sourceEpoch) return;
  if (snapshotSeq !== appliedSnapshot) {
    appliedSnapshot = snapshotSeq;
    if (pendingSnapshot) {
      const now = Date.now();
      banners = roomEvents.observe({ tickets: pendingSnapshot, assignments: assignmentsAt(now), now });
      pendingSnapshot = null;
    }
  }
  // Lỗi hoặc kết quả cũ: giữ feed và ngăn. onItems của ticket (nếu có) đã cập nhật riêng.
  if (await workersTask !== "applied") return;
  absorbFeed();
  publish();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const baseUrl = String(data.get("baseUrl") ?? "").trim();
  const token = String(data.get("token") ?? "").trim();
  config = baseUrl && token ? { baseUrl, token } : null;
  saveConfig(config);
  // Nguồn thật chưa kịp poll: đừng giữ agent demo trên thanh bên.
  if (config) workers = [];
  changeSource();
  resetActors();
  void poll();
});
demoButton.addEventListener("click", () => {
  config = null;
  saveConfig(null);
  changeSource();
  resetActors();
  void poll();
});
if (config) (form.elements.namedItem("baseUrl") as HTMLInputElement).value = config.baseUrl;

function frame(t: number): void {
  // demo tính lại mỗi frame để nhân vật bắt đầu đi ngay khi kịch bản đổi pha, không trễ theo nhịp polling 3 giây
  const now = Date.now();
  if (!config) workers = withDemoActivity(demoWorkers(now), now);
  // Biến mất giữa hai lần poll (demo đổi pha): đóng ngăn ngay frame này.
  if (dropMissingSelection()) publish();
  banners = roomEvents.tick(now);
  const reduced = reducedMotion();
  const size = sceneSize(workers);
  // Focus lấy từ frame trước: frame này mới biết nhân vật đang đứng đâu sau khi cảnh đổi.
  const fit = fitScene(free, size, globalThis.devicePixelRatio || 1, focusOf(figures));
  const backingW = size.width * fit.k;
  const backingH = size.height * fit.k;
  if (canvas.width !== backingW || canvas.height !== backingH) {
    canvas.width = backingW;
    canvas.height = backingH;
  }
  canvas.style.left = `${fit.left}px`;
  canvas.style.top = `${fit.top}px`;
  canvas.style.width = `${fit.cssW}px`;
  canvas.style.height = `${fit.cssH}px`;
  ctx.setTransform(fit.k, 0, 0, fit.k, 0, 0);
  figures = drawScene(ctx, workers, t, now, { minutes: lightingMinutes(now, readHour()), reducedMotion: reduced });
  overlay.draw(figures, size.width, now, { signs: roomSigns(computeLayout(workers)), banners, reducedMotion: reduced });
  // Agent đi ra hoặc phòng tắt thì đóng tooltip cùng lúc với bong bóng.
  tooltip.update(figures.filter((figure) => figure.working), size.width, now);
  requestAnimationFrame(frame);
}

if (typeof ResizeObserver === "function") {
  const observer = new ResizeObserver(() => relayout());
  for (const el of [document.documentElement, stage, topbarRoot, sidebarRoot, drawerRoot, feedRoot]) observer.observe(el);
}
if (typeof matchMedia === "function") {
  matchMedia(NARROW_QUERY).addEventListener("change", () => relayout());
}

relayout();
publish();
void poll();
setInterval(() => void poll(), POLL_MS);
setInterval(() => {
  publish();
  panel.tick(Date.now());
}, 1000);
requestAnimationFrame(frame);
