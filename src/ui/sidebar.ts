// Thanh bên trái: mỗi phòng provider một khối (tên, trạng thái, agents/slots, ! khi lỗi), dưới là agent con
// (avatar, vai trò, ticket, câu đang làm, chấm trạng thái). Bấm dòng gọi onSelect. Phím [ thu gọn;
// màn hẹp thành ngăn kéo có nền mờ. DOM cập nhật tăng dần theo khoá để không mất vị trí cuộn và focus.

import { type WorkerAgent, type WorkerStatus, roomAgents } from "../api";
import { readAgentActivity } from "../activity";
import { ROLE_STYLES, paletteOf, roleStyle } from "../scene/palette";
import { avatarIdentity, createAvatar } from "./avatar";
import { type AgentState, agentStatus, providerLetter } from "./format";
import { agentKey } from "./selection";
import "./sidebar.css";

export interface SidebarOptions {
  onSelect(key: string): void;
  // Tắt khi main.ts tự xử lý phím [ để không bật/tắt hai lần.
  shortcut?: boolean;
}

export interface Sidebar {
  update(workers: readonly WorkerStatus[], needIds: ReadonlySet<string>, selectedKey: string | null, now: number): void;
  setCollapsed(collapsed: boolean): void;
  toggle(): void;
  isCollapsed(): boolean;
  // Báo khi kích thước thanh bên đổi (thu gọn/mở, đổi màn hẹp) để main đo lại vùng trống.
  onLayout(cb: () => void): void;
}

const NARROW = "(max-width: 899px)";

const ROOM_STATE: Record<WorkerStatus["state"], string> = {
  idle: "Đang rảnh",
  working: "Đang làm",
  limited: "Hết hạn mức",
  offline: "Mất kết nối",
};

const AGENT_STATE: Record<AgentState, string> = {
  offline: "mất kết nối",
  limited: "hết hạn mức",
  need: "cần bạn",
  working: "đang làm",
  idle: "rảnh",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setAttr(node: HTMLElement, name: string, value: string | null): void {
  if (value === null) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

// Đặt đúng thứ tự con mà chỉ di chuyển node lệch chỗ (không dựng lại, giữ focus).
function syncChildren(parent: HTMLElement, nodes: readonly HTMLElement[], after = 0): void {
  nodes.forEach((node, i) => {
    const at = parent.children[after + i] ?? null;
    if (at !== node) parent.insertBefore(node, at);
  });
  while (parent.children.length > after + nodes.length) parent.lastElementChild!.remove();
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest("input, textarea, select"));
}

interface AgentRow {
  root: HTMLButtonElement;
  avatarId: string;
  avatar: HTMLElement;
  role: HTMLElement;
  ticket: HTMLElement;
  text: HTMLElement;
  dot: HTMLElement;
}

interface RoomBlock {
  root: HTMLElement;
  letter: HTMLElement;
  name: HTMLElement;
  state: HTMLElement;
  count: HTMLElement;
  alert: HTMLElement;
  list: HTMLElement;
  empty: HTMLElement;
  rows: Map<string, AgentRow>;
}

function createRoom(): RoomBlock {
  const root = el("section", "room");
  const head = el("header", "room-head");
  const letter = el("span", "room-letter title-pixel");
  const name = el("span", "room-name title-pixel");
  const state = el("span", "room-state");
  const count = el("span", "room-count mono");
  const alert = el("span", "room-alert", "!");
  alert.hidden = true;
  alert.setAttribute("role", "img");
  const title = el("div", "room-title");
  title.append(name, state);
  head.append(letter, title, alert, count);
  const list = el("div", "room-agents");
  const empty = el("p", "room-empty", "Không có agent");
  root.append(head, list, empty);
  return { root, letter, name, state, count, alert, list, empty, rows: new Map() };
}

function createRow(agent: WorkerAgent, onSelect: (key: string) => void, key: string): AgentRow {
  const root = el("button", "agent-row");
  root.type = "button";
  root.dataset.key = key;
  const avatar = createAvatar(agent);
  const main = el("span", "agent-main");
  const top = el("span", "agent-top");
  const role = el("span", "agent-role");
  const ticket = el("span", "agent-ticket mono");
  top.append(role, ticket);
  const text = el("span", "agent-text");
  main.append(top, text);
  const dot = el("span", "status-dot");
  root.append(avatar, main, dot);
  root.addEventListener("click", () => onSelect(key));
  return { root, avatarId: avatarIdentity(agent), avatar, role, ticket, text, dot };
}

function renderRow(row: AgentRow, worker: WorkerStatus, agent: WorkerAgent, needIds: ReadonlySet<string>, selected: boolean, now: number): void {
  const id = avatarIdentity(agent);
  if (id !== row.avatarId) {
    const next = createAvatar(agent);
    row.avatar.replaceWith(next);
    row.avatar = next;
    row.avatarId = id;
  }
  const style = roleStyle(agent.role);
  setText(row.role, style.label);
  if (row.role.style.color !== style.shirt) row.role.style.color = style.shirt;
  setText(row.ticket, agent.ticket_id ?? "?");
  const activity = readAgentActivity(agent, `${worker.name}/${agent.id}`).activity;
  const text = activity ? `${activity.icon} ${activity.text}` : agent.mode ? `chế độ ${agent.mode}` : "—";
  setText(row.text, text);
  setAttr(row.text, "title", activity?.detail ? `${activity.text}\n${activity.detail}` : activity?.text ?? null);
  const status = agentStatus(worker, agent, needIds, now);
  row.dot.dataset.state = status.state;
  row.dot.classList.toggle("error", status.error);
  setAttr(row.dot, "title", `${AGENT_STATE[status.state]}${status.error ? " · có lỗi" : ""}`);
  row.root.classList.toggle("need", status.state === "need");
  row.root.classList.toggle("selected", selected);
  setAttr(row.root, "aria-current", selected ? "true" : null);
  setAttr(row.root, "aria-label", `${style.label} ${agent.ticket_id ?? ""}, ${AGENT_STATE[status.state]}: ${activity?.text ?? ""}`.trim());
}

function renderRoom(room: RoomBlock, worker: WorkerStatus, needIds: ReadonlySet<string>, selectedKey: string | null, now: number, onSelect: (key: string) => void): void {
  room.root.dataset.state = worker.state;
  setText(room.letter, providerLetter(worker.name));
  const color = paletteOf(worker).shirt;
  if (room.letter.style.background !== color) room.letter.style.background = color;
  setText(room.name, worker.name);
  setText(room.state, ROOM_STATE[worker.state] ?? worker.state);
  const { agents, slots } = roomAgents(worker);
  // Phòng tắt hoặc hết hạn mức: agent không còn chạy nên không liệt kê.
  const shown = worker.state === "offline" || worker.state === "limited" ? [] : Array.isArray(agents) ? agents : [];
  setText(room.count, `${shown.length}/${slots}`);
  room.count.classList.toggle("over", shown.length > slots);
  const error = worker.state === "offline"
    ? `Không gọi được phòng${worker.error ? ` (${worker.error})` : ""}`
    : worker.last_error || worker.error || null;
  room.alert.hidden = !error;
  setAttr(room.alert, "title", error);
  setAttr(room.alert, "aria-label", error ? `Lỗi: ${error}` : null);

  const keys = new Set<string>();
  const nodes: HTMLElement[] = [];
  for (const agent of shown) {
    const key = agentKey(worker.name, agent);
    if (keys.has(key)) continue;
    keys.add(key);
    let row = room.rows.get(key);
    if (!row) {
      row = createRow(agent, onSelect, key);
      room.rows.set(key, row);
    }
    renderRow(row, worker, agent, needIds, key === selectedKey, now);
    nodes.push(row.root);
  }
  for (const key of [...room.rows.keys()]) if (!keys.has(key)) room.rows.delete(key);
  syncChildren(room.list, nodes);
  room.empty.hidden = nodes.length > 0;
  setText(room.empty, worker.state === "offline" ? "Phòng tắt" : worker.state === "limited" ? "Chờ mở lại hạn mức" : "Không có agent");
}

export function createSidebar(root: HTMLElement, options: SidebarOptions): Sidebar {
  root.classList.add("sidebar");
  root.setAttribute("aria-label", root.getAttribute("aria-label") ?? "Phòng và agent");

  const head = el("div", "sidebar-head");
  const title = el("h2", "sidebar-title", "Phòng");
  const toggleButton = el("button", "sidebar-toggle");
  toggleButton.type = "button";
  head.append(title, toggleButton);
  const scroll = el("div", "sidebar-scroll");
  const rooms = el("div", "sidebar-rooms");
  const none = el("p", "sidebar-empty", "Chưa có phòng nào");
  scroll.append(rooms, none);

  // Chú thích vai trò, thay cho #legend dưới canvas cũ.
  const legend = el("footer", "sidebar-legend");
  legend.setAttribute("aria-label", "Chú thích vai trò agent con");
  for (const style of Object.values(ROLE_STYLES)) {
    const item = el("span", "legend-item");
    const swatch = el("span", "swatch");
    swatch.style.background = style.shirt;
    item.append(swatch, document.createTextNode(`${style.label} (${style.accessory})`));
    legend.append(item);
  }
  root.replaceChildren(head, scroll, legend);

  // Nền mờ khi là ngăn kéo trên màn hẹp; bấm nền thì đóng.
  const scrim = el("div", "sidebar-scrim");
  scrim.hidden = true;
  root.after(scrim);

  const media = typeof matchMedia === "function" ? matchMedia(NARROW) : null;
  let narrow = media?.matches ?? false;
  let wideCollapsed = false;
  // Màn hẹp mặc định đóng để cảnh không bị che.
  let narrowOpen = false;
  const listeners: (() => void)[] = [];
  const notify = () => { for (const cb of listeners) cb(); };

  const collapsed = () => (narrow ? !narrowOpen : wideCollapsed);
  const apply = () => {
    const c = collapsed();
    root.classList.toggle("collapsed", c);
    root.classList.toggle("narrow", narrow);
    scroll.inert = c;
    legend.inert = c;
    scrim.hidden = !narrow || c;
    toggleButton.textContent = c ? "»" : "«";
    const label = c ? "Mở thanh bên ([)" : "Thu gọn thanh bên ([)";
    toggleButton.title = label;
    toggleButton.setAttribute("aria-label", label);
    toggleButton.setAttribute("aria-expanded", String(!c));
    notify();
  };
  const setCollapsed = (value: boolean) => {
    if (narrow) narrowOpen = !value;
    else wideCollapsed = value;
    apply();
  };
  const toggle = () => setCollapsed(!collapsed());

  toggleButton.addEventListener("click", toggle);
  scrim.addEventListener("click", () => setCollapsed(true));
  root.addEventListener("transitionend", (event) => {
    if (event.target === root) notify();
  });
  media?.addEventListener("change", (event) => {
    narrow = event.matches;
    narrowOpen = false;
    apply();
  });
  if (options.shortcut !== false) {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "[" || event.ctrlKey || event.metaKey || event.altKey || isEditable(event.target)) return;
      event.preventDefault();
      toggle();
    });
  }
  // Ngăn kéo màn hẹp: Esc đóng ngăn kéo trước, chưa đóng ngăn chi tiết.
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !narrow || !narrowOpen) return;
    event.stopPropagation();
    setCollapsed(true);
    toggleButton.focus();
  });

  const select = (key: string) => {
    options.onSelect(key);
    // Màn hẹp: đóng ngăn kéo để thấy cảnh và tấm chi tiết.
    if (narrow && narrowOpen) setCollapsed(true);
  };

  const blocks = new Map<string, RoomBlock>();
  apply();

  return {
    update(workers, needIds, selectedKey, now) {
      const names = new Set<string>();
      const nodes: HTMLElement[] = [];
      for (const worker of workers) {
        if (names.has(worker.name)) continue;
        names.add(worker.name);
        let block = blocks.get(worker.name);
        if (!block) {
          block = createRoom();
          blocks.set(worker.name, block);
        }
        // Một phòng dữ liệu hỏng không được làm mất cả thanh bên.
        try {
          renderRoom(block, worker, needIds, selectedKey, now, select);
        } catch (exc) {
          console.warn(`[sidebar] phòng ${worker.name}: ${(exc as Error).message}`);
        }
        nodes.push(block.root);
      }
      for (const name of [...blocks.keys()]) if (!names.has(name)) blocks.delete(name);
      syncChildren(rooms, nodes);
      none.hidden = nodes.length > 0;
    },
    setCollapsed,
    toggle,
    isCollapsed: collapsed,
    onLayout(cb) {
      listeners.push(cb);
    },
  };
}
