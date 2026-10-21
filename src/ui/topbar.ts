// Thanh trên: tên + kết nối, ô số (agent, đang làm, cần bạn), thẻ hạn mức từng phòng, nút cài đặt
// (popover chứa #settings) và nút Demo. Giữ id sẵn có để main.ts và test tìm được node;
// node nào chưa có trong DOM thì tự tạo. Cập nhật tăng dần: chỉ gán khi chữ đổi.

import { type WorkerStatus, roomAgents } from "../api";
import { paletteOf } from "../scene/palette";
import { agentStatus, providerLetter, usageTile, type UsageTile } from "./format";
import "./topbar.css";

export interface TopbarOptions {
  // Báo khi popover cài đặt mở/đóng (main có thể đo lại vùng trống).
  onSettings?: (open: boolean) => void;
}

export interface Topbar {
  update(workers: readonly WorkerStatus[], needCount: number, now: number, needIds?: ReadonlySet<string>): void;
  setSettingsOpen(open: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setAttr(node: HTMLElement, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

// Lấy node theo id nếu index.html đã có (giữ listener main gắn sẵn), không thì tạo mới.
function adopt<K extends keyof HTMLElementTagNameMap>(root: HTMLElement, id: string, tag: K, cls: string): HTMLElementTagNameMap[K] {
  const found = root.querySelector<HTMLElementTagNameMap[K]>(`#${id}`) ?? document.getElementById(id) as HTMLElementTagNameMap[K] | null;
  const node = found ?? el(tag, cls);
  node.id = id;
  node.classList.add(...cls.split(" ").filter(Boolean));
  return node;
}

interface Tile { root: HTMLElement; value: HTMLElement; label: HTMLElement }

// Ô số: số to ở trên, nhãn nhỏ ở dưới. Node gốc có thể là button (cần bạn) hoặc div.
function tile(root: HTMLElement, label: string): Tile {
  root.classList.add("tile");
  const value = root.querySelector<HTMLElement>(".tile-value") ?? el("span", "tile-value", "0");
  const name = root.querySelector<HTMLElement>(".tile-label") ?? el("span", "tile-label", label);
  root.replaceChildren(value, name);
  return { root, value, label: name };
}

interface UsageLineNodes { row: HTMLElement; label: HTMLElement; fill: HTMLElement; pct: HTMLElement; reset: HTMLElement }
interface UsageCard {
  root: HTMLElement;
  letter: HTMLElement;
  lines: HTMLElement;
  rows: UsageLineNodes[];
  plan: HTMLElement;
  compact: HTMLElement;
}

const STATE_LABEL: Record<WorkerStatus["state"], string> = {
  idle: "rảnh",
  working: "đang làm",
  limited: "hết hạn mức",
  offline: "mất kết nối",
};

function usageCard(): UsageCard {
  const root = el("div", "usage-card");
  const letter = el("span", "prov-letter title-pixel");
  const lines = el("div", "usage-lines");
  const plan = el("span", "usage-plan");
  // Màn hẹp chỉ hiện chữ cái + % cao nhất (hoặc gói).
  const compact = el("span", "usage-compact mono");
  root.append(letter, lines, compact);
  return { root, letter, lines, rows: [], plan, compact };
}

function usageRow(): UsageLineNodes {
  const row = el("div", "usage-row");
  const label = el("span", "usage-label mono");
  const bar = el("span", "usage-bar");
  const fill = el("span", "usage-fill");
  bar.append(fill);
  const pct = el("span", "usage-pct mono");
  const reset = el("span", "usage-reset mono");
  row.append(label, bar, pct, reset);
  return { row, label, fill, pct, reset };
}

function renderUsage(card: UsageCard, worker: WorkerStatus, data: UsageTile): void {
  setText(card.letter, providerLetter(worker.name));
  const color = paletteOf(worker).shirt;
  if (card.letter.style.background !== color) card.letter.style.background = color;
  card.root.dataset.state = worker.state;

  while (card.rows.length > data.lines.length) card.rows.pop()!.row.remove();
  while (card.rows.length < data.lines.length) card.rows.push(usageRow());
  data.lines.forEach((line, i) => {
    const nodes = card.rows[i];
    setText(nodes.label, line.label);
    setText(nodes.pct, `${line.percent}%`);
    setText(nodes.reset, line.reset);
    const width = `${line.percent}%`;
    if (nodes.fill.style.width !== width) nodes.fill.style.width = width;
    nodes.row.dataset.level = line.level;
    setAttr(nodes.row, "title", `${line.label}: đã dùng ${line.percent}%, reset sau ${line.reset}`);
  });
  // Phòng không công bố hạn mức (Cursor) thì ghi gói thay cho hai dòng.
  const children: HTMLElement[] = data.lines.length ? card.rows.map((r) => r.row) : [card.plan];
  if (!data.lines.length) setText(card.plan, data.plan === "?" ? "?" : `Gói ${data.plan}`);
  const current = Array.from(card.lines.children);
  if (current.length !== children.length || children.some((node, i) => current[i] !== node)) card.lines.replaceChildren(...children);

  const top = data.lines.reduce<UsageTile["lines"][number] | null>((max, line) => (!max || line.percent > max.percent ? line : max), null);
  setText(card.compact, top ? `${top.percent}%` : data.plan);
  card.compact.dataset.level = top?.level ?? "";
  setAttr(card.root, "title", `Phòng ${worker.name}: ${STATE_LABEL[worker.state] ?? worker.state}${data.lines.length ? "" : ` · ${data.plan === "?" ? "chưa rõ hạn mức" : `gói ${data.plan}`}`}`);
}

export function createTopbar(root: HTMLElement, options: TopbarOptions = {}): Topbar {
  root.classList.add("topbar");

  const conn = adopt(root, "conn", "span", "conn");
  const brand = el("div", "brand");
  const logo = el("span", "brand-logo title-pixel", "▣");
  logo.setAttribute("aria-hidden", "true");
  const brandText = el("div", "brand-text");
  brandText.append(el("span", "brand-name title-pixel", "AICO Office"), conn);
  brand.append(logo, brandText);

  const agents = tile(adopt(root, "agents-count", "div", "tile-agents"), "agent");
  const working = tile(el("div", "tile-working"), "đang làm");
  const needsButton = adopt(root, "needs-count", "button", "tile-need");
  if (needsButton instanceof HTMLButtonElement) needsButton.type = "button";
  const needs = tile(needsButton, "cần bạn");
  needsButton.setAttribute("aria-label", "Cần bạn: 0");
  const ticketsError = adopt(root, "tickets-error", "span", "tickets-error");
  ticketsError.setAttribute("role", "status");
  if (!ticketsError.textContent) ticketsError.textContent = "!";
  const needsWrap = el("div", "tile-need-wrap");
  needsWrap.append(needsButton, ticketsError);
  const counters = el("div", "counters");
  counters.append(agents.root, working.root, needsWrap);

  const usage = el("div", "usage-cards");
  usage.setAttribute("aria-label", "Hạn mức từng phòng");

  // #settings chuyển vào popover; #demo nằm ngoài để luôn bấm được một lần.
  const form = adopt(root, "settings", "form", "settings-form");
  const demo = adopt(root, "demo", "button", "demo-button");
  if (demo instanceof HTMLButtonElement) demo.type = "button";
  if (!demo.textContent) demo.textContent = "Demo";
  const gear = el("button", "settings-toggle", "⚙");
  gear.type = "button";
  gear.title = "Cài đặt kết nối";
  gear.setAttribute("aria-label", "Cài đặt kết nối");
  gear.setAttribute("aria-haspopup", "dialog");
  gear.setAttribute("aria-expanded", "false");
  const popover = el("div", "settings-popover glass");
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "Cài đặt kết nối");
  popover.hidden = true;
  popover.append(el("p", "settings-hint", "Địa chỉ aico và API token. Để trống thì chạy demo."), form);
  const actions = el("div", "topbar-actions");
  actions.append(gear, demo, popover);

  root.replaceChildren(brand, counters, usage, actions);

  let open = false;
  const setOpen = (next: boolean) => {
    if (open === next) return;
    open = next;
    popover.hidden = !next;
    gear.setAttribute("aria-expanded", String(next));
    gear.classList.toggle("active", next);
    if (next) form.querySelector<HTMLInputElement>("input")?.focus();
    options.onSettings?.(next);
  };
  gear.addEventListener("click", () => setOpen(!open));
  // Lưu xong thì đóng; main.ts tự xử lý submit.
  form.addEventListener("submit", () => setOpen(false));
  demo.addEventListener("click", () => setOpen(false));
  popover.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // Esc ở đây chỉ đóng popover, không để main đóng ngăn chi tiết.
    event.stopPropagation();
    setOpen(false);
    gear.focus();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!open || !(event.target instanceof Node)) return;
    if (!popover.contains(event.target) && !gear.contains(event.target)) setOpen(false);
  });

  const cards = new Map<string, UsageCard>();

  return {
    update(workers, needCount, now, needIds = new Set()) {
      let total = 0;
      let busy = 0;
      for (const worker of workers) {
        if (worker.state === "offline") continue;
        const { agents: list } = roomAgents(worker);
        total += list.length;
        for (const agent of list) if (agentStatus(worker, agent, needIds, now).state === "working") busy++;
      }
      setText(agents.value, String(total));
      setAttr(agents.root, "title", `${total} agent đang chạy`);
      setText(working.value, String(busy));
      setAttr(working.root, "title", `${busy} agent đang làm`);
      const count = Math.max(0, Math.floor(needCount));
      setText(needs.value, String(count));
      setAttr(needsButton, "aria-label", `Cần bạn: ${count}`);
      needsButton.classList.toggle("hot", count > 0);
      if (needsButton instanceof HTMLButtonElement) needsButton.disabled = count === 0;

      const names = new Set<string>();
      workers.forEach((worker, i) => {
        names.add(worker.name);
        let card = cards.get(worker.name);
        if (!card) {
          card = usageCard();
          cards.set(worker.name, card);
        }
        // Dữ liệu usage hỏng không được làm đứng thanh trên: lỗi thì hiện "?".
        let data: UsageTile;
        try {
          data = usageTile(worker, now);
        } catch {
          data = { lines: [], plan: "?", label: "?" };
        }
        renderUsage(card, worker, data);
        if (usage.children[i] !== card.root) usage.insertBefore(card.root, usage.children[i] ?? null);
      });
      for (const [name, card] of cards) {
        if (names.has(name)) continue;
        card.root.remove();
        cards.delete(name);
      }
    },
    setSettingsOpen: setOpen,
  };
}
