// Thanh bên trái: ô tìm (phím /, Esc xoá), chip ẩn/hiện phòng, mỗi phòng provider một khối (tên, số agent,
// trạng thái, thanh chỗ, ! khi lỗi), dưới là agent con (avatar, vai trò, ticket, câu đang làm · thời gian chạy,
// chấm trạng thái). Bấm dòng gọi onSelect. Phím [ thu gọn; màn hẹp thành ngăn kéo có nền mờ.
// DOM cập nhật tăng dần theo khoá để không mất vị trí cuộn và focus; dòng bị lọc vẫn giữ node để hiện lại.

import { type WorkerAgent, type WorkerStatus, roomAgents } from "../api";
import { readAgentActivity } from "../activity";
import { ROLE_STYLES, paletteOf, roleStyle } from "../scene/palette";
import { avatarIdentity, createAvatar } from "./avatar";
import { type AgentState, agentStatus, providerLetter } from "./format";
import { agentKey } from "./selection";
import { type HiddenRoomsStorage, agentMatches, formatElapsed, loadHiddenRooms, saveHiddenRooms, slotFill } from "./sidebar-model";
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
  activity: HTMLElement;
  elapsed: HTMLElement;
  dot: HTMLElement;
}

interface RoomBlock {
  root: HTMLElement;
  head: HTMLElement;
  letter: HTMLElement;
  name: HTMLElement;
  state: HTMLElement;
  count: HTMLElement;
  alert: HTMLElement;
  slots: HTMLElement;
  slotsFill: HTMLElement;
  slotsText: HTMLElement;
  list: HTMLElement;
  empty: HTMLElement;
  rows: Map<string, AgentRow>;
}

function createRoom(): RoomBlock {
  const root = el("section", "room");
  const head = el("header", "room-head");
  const line = el("div", "room-line");
  const letter = el("span", "room-letter title-pixel");
  const name = el("span", "room-name");
  const count = el("span", "room-count");
  const alert = el("span", "room-alert", "!");
  alert.hidden = true;
  alert.setAttribute("role", "img");
  line.append(letter, name, count, alert);
  const state = el("span", "room-state");
  const slots = el("div", "room-slots");
  const bar = el("span", "room-slots-bar");
  const slotsFill = el("i", "");
  bar.append(slotsFill);
  const slotsText = el("span", "room-slots-text");
  slots.append(bar, slotsText);
  head.append(line, state, slots);
  const list = el("div", "room-agents");
  const empty = el("p", "room-empty", "Không có agent");
  root.append(head, list, empty);
  return { root, head, letter, name, state, count, alert, slots, slotsFill, slotsText, list, empty, rows: new Map() };
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
  const activity = el("span", "agent-activity");
  const elapsed = el("span", "agent-elapsed");
  elapsed.hidden = true;
  text.append(activity, elapsed);
  main.append(top, text);
  const dot = el("span", "status-dot");
  root.append(avatar, main, dot);
  root.addEventListener("click", () => onSelect(key));
  return { root, avatarId: avatarIdentity(agent), avatar, role, ticket, text, activity, elapsed, dot };
}

// Trả về agent có khớp từ khoá không; dòng vẫn được cập nhật kể cả khi bị lọc để hiện lại là đúng ngay.
function renderRow(row: AgentRow, worker: WorkerStatus, agent: WorkerAgent, needIds: ReadonlySet<string>, selected: boolean, now: number, query: string): boolean {
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
  setText(row.activity, text);
  const elapsed = formatElapsed(agent.started_at, now);
  setText(row.elapsed, elapsed ? ` · ${elapsed}` : "");
  row.elapsed.hidden = !elapsed;
  setAttr(row.text, "title", activity?.detail ? `${activity.text}\n${activity.detail}` : activity?.text ?? null);
  const status = agentStatus(worker, agent, needIds, now);
  row.dot.dataset.state = status.state;
  row.dot.classList.toggle("error", status.error);
  setAttr(row.dot, "title", `${AGENT_STATE[status.state]}${status.error ? " · có lỗi" : ""}`);
  row.root.classList.toggle("need", status.state === "need");
  row.root.classList.toggle("offline", status.state === "offline");
  row.root.classList.toggle("selected", selected);
  setAttr(row.root, "aria-current", selected ? "true" : null);
  setAttr(row.root, "aria-label", `${style.label} ${agent.ticket_id ?? ""}, ${AGENT_STATE[status.state]}: ${activity?.text ?? ""}`.trim());
  return agentMatches(query, {
    roleLabel: style.label,
    role: agent.role,
    id: agent.id,
    ticket: agent.ticket_id,
    activity: activity?.text ?? text,
    room: worker.name,
  });
}

// Trả về số agent khớp từ khoá (query rỗng thì là mọi agent đang hiện).
function renderRoom(room: RoomBlock, worker: WorkerStatus, needIds: ReadonlySet<string>, selectedKey: string | null, now: number, onSelect: (key: string) => void, query: string): number {
  room.root.dataset.state = worker.state;
  setText(room.letter, providerLetter(worker.name));
  const color = paletteOf(worker).shirt;
  if (room.letter.style.background !== color) room.letter.style.background = color;
  if (room.head.style.getPropertyValue("--room-color") !== color) room.head.style.setProperty("--room-color", color);
  setText(room.name, worker.name);
  setText(room.state, ROOM_STATE[worker.state] ?? worker.state);
  const { agents, slots } = roomAgents(worker);
  // Hết hạn mức: agent không còn chạy nên không liệt kê. Mất kết nối: không biết agent còn chạy không,
  // nên vẫn liệt kê agent dữ liệu còn báo, dòng mờ (class offline).
  const shown = worker.state === "limited" ? [] : Array.isArray(agents) ? agents : [];
  const fill = slotFill(shown.length, slots);
  setText(room.count, String(shown.length));
  setAttr(room.count, "aria-label", `${shown.length} agent`);
  room.count.classList.toggle("over", fill.over);
  room.slots.classList.toggle("over", fill.over);
  const width = `${Math.round(fill.ratio * 1000) / 10}%`;
  if (room.slotsFill.style.width !== width) room.slotsFill.style.width = width;
  setText(room.slotsText, fill.label);
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
    if (renderRow(row, worker, agent, needIds, key === selectedKey, now, query)) nodes.push(row.root);
  }
  for (const key of [...room.rows.keys()]) if (!keys.has(key)) room.rows.delete(key);
  syncChildren(room.list, nodes);
  const nomatch = query !== "" && nodes.length === 0;
  room.empty.hidden = nodes.length > 0;
  room.empty.classList.toggle("is-nomatch", nomatch);
  setText(room.empty, nomatch ? "Không có agent khớp"
    : worker.state === "offline" ? "Phòng tắt" : worker.state === "limited" ? "Chờ mở lại hạn mức" : "Không có agent");
  return nodes.length;
}

interface RoomChip {
  root: HTMLButtonElement;
  letter: HTMLElement;
  name: HTMLElement;
}

function createChip(name: string, onToggle: (name: string) => void): RoomChip {
  const root = el("button", "room-chip");
  root.type = "button";
  const letter = el("span", "room-chip-letter title-pixel");
  const label = el("span", "room-chip-name");
  root.append(letter, label);
  root.addEventListener("click", () => onToggle(name));
  return { root, letter, name: label };
}

// localStorage có thể bị chặn (chế độ riêng tư, iframe): đọc thuộc tính cũng ném.
function readStorage(): HiddenRoomsStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createSidebar(root: HTMLElement, options: SidebarOptions): Sidebar {
  root.classList.add("sidebar");
  root.setAttribute("aria-label", root.getAttribute("aria-label") ?? "Phòng và agent");

  const head = el("div", "sidebar-head");
  const title = el("h2", "sidebar-title", "Phòng");
  const filtering = el("span", "sidebar-filtering", "đang lọc");
  filtering.hidden = true;
  const toggleButton = el("button", "sidebar-toggle");
  toggleButton.type = "button";
  head.append(title, filtering, toggleButton);

  const tools = el("div", "sidebar-tools");
  const search = el("label", "sidebar-search");
  const icon = el("span", "sidebar-search-icon", "⌕");
  icon.setAttribute("aria-hidden", "true");
  const input = el("input", "sidebar-input");
  input.type = "search";
  input.placeholder = "Tìm agent, ticket, việc…";
  input.setAttribute("aria-label", "Tìm agent");
  input.autocomplete = "off";
  input.spellcheck = false;
  const kbd = el("kbd", "sidebar-kbd", "/");
  kbd.setAttribute("aria-hidden", "true");
  search.append(icon, input, kbd);
  const chips = el("div", "sidebar-chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Ẩn hoặc hiện phòng");
  tools.append(search, chips);
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
  root.replaceChildren(head, tools, scroll, legend);

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
    tools.inert = c;
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
  // Phím / luôn bật (shortcut chỉ dành cho [): main.ts không dùng /, và bỏ qua phím khi đang gõ.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.repeat || isEditable(event.target)) return;
    event.preventDefault();
    if (collapsed()) setCollapsed(false);
    input.focus();
  });
  // Esc trong ô tìm: xoá chữ rồi bỏ focus, không để lan lên đóng ngăn kéo hay ngăn chi tiết.
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (input.value !== "") {
      input.value = "";
      setQuery("");
    }
    input.blur();
  });
  input.addEventListener("input", () => setQuery(input.value));
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
  const chipNodes = new Map<string, RoomChip>();
  const storage = readStorage();
  // Giữ cả tên phòng đang vắng trong dữ liệu để phòng quay lại vẫn ẩn.
  const hidden = loadHiddenRooms(storage);
  let query = "";
  let last: { workers: readonly WorkerStatus[]; needIds: ReadonlySet<string>; selectedKey: string | null; now: number } | null = null;

  const toggleRoom = (name: string) => {
    if (hidden.has(name)) hidden.delete(name);
    else hidden.add(name);
    // Lưu lỗi thì vẫn giữ trong phiên (tập hidden trong bộ nhớ).
    saveHiddenRooms(storage, hidden);
    render();
  };

  function setQuery(value: string): void {
    if (value === query) return;
    query = value;
    render();
  }

  function render(): void {
    const workers = last?.workers ?? [];
    const needIds = last?.needIds ?? new Set<string>();
    const selectedKey = last?.selectedKey ?? null;
    const now = last?.now ?? NaN;
    const q = query.trim();
    const names = new Set<string>();
    const nodes: HTMLElement[] = [];
    const chipList: HTMLElement[] = [];
    let anyHidden = false;
    let matched = 0;
    for (const worker of workers) {
      if (names.has(worker.name)) continue;
      names.add(worker.name);
      const off = hidden.has(worker.name);
      anyHidden ||= off;

      let chip = chipNodes.get(worker.name);
      if (!chip) {
        chip = createChip(worker.name, toggleRoom);
        chipNodes.set(worker.name, chip);
      }
      try {
        setText(chip.letter, providerLetter(worker.name));
        const color = paletteOf(worker).shirt;
        if (chip.letter.style.background !== color) chip.letter.style.background = color;
      } catch (exc) {
        console.warn(`[sidebar] chip ${worker.name}: ${(exc as Error).message}`);
      }
      setText(chip.name, worker.name);
      setAttr(chip.root, "aria-pressed", String(!off));
      setAttr(chip.root, "title", `${off ? "Hiện" : "Ẩn"} phòng ${worker.name}`);
      chipList.push(chip.root);

      let block = blocks.get(worker.name);
      if (!block) {
        block = createRoom();
        blocks.set(worker.name, block);
      }
      if (off) continue;
      // Một phòng dữ liệu hỏng không được làm mất cả thanh bên.
      try {
        matched += renderRoom(block, worker, needIds, selectedKey, now, select, q);
      } catch (exc) {
        console.warn(`[sidebar] phòng ${worker.name}: ${(exc as Error).message}`);
      }
      nodes.push(block.root);
    }
    for (const name of [...blocks.keys()]) if (!names.has(name)) blocks.delete(name);
    for (const name of [...chipNodes.keys()]) if (!names.has(name)) chipNodes.delete(name);
    syncChildren(chips, chipList);
    chips.hidden = chipList.length === 0;
    // Không khớp gì cả thì chỉ còn một dòng báo; khối phòng vẫn giữ trong blocks để hiện lại đúng node.
    const nothing = q !== "" && nodes.length > 0 && matched === 0;
    syncChildren(rooms, nothing ? [] : nodes);
    none.hidden = nodes.length > 0 && !nothing;
    setText(none, nothing ? `Không tìm thấy “${q}”` : names.size > 0 ? "Đã ẩn mọi phòng" : "Chưa có phòng nào");
    filtering.hidden = !(anyHidden || q !== "");
  }

  apply();

  return {
    update(workers, needIds, selectedKey, now) {
      last = { workers, needIds, selectedKey, now };
      render();
    },
    setCollapsed,
    toggle,
    isCollapsed: collapsed,
    onLayout(cb) {
      listeners.push(cb);
    },
  };
}
