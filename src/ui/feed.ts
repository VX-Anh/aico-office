import type { WorkerStatus } from "../api";
import { paletteOf } from "../scene/palette";
import { avatarIdentity, createAvatar } from "./avatar";
import type { FeedLine } from "./feed-model";
import { clock, providerLetter } from "./format";
import "./feed.css";

type DisplayLine = FeedLine & { ticket?: string | null; tone?: "need" | "done" | "error" | null };
interface FeedActions {
  onAgent?(room: string, agentId: string): void;
  onTicket?(id: string): void;
}

export function createFeed(root: HTMLElement, actions: FeedActions = {}) {
  root.classList.add("feed", "glass");
  root.setAttribute("aria-label", "Hoạt động");
  const make = (tag: string, name: string) => {
    const node = document.createElement(tag);
    node.className = name;
    return node;
  };
  const header = make("div", "feed-header");
  const toggle = make("button", "feed-title") as HTMLButtonElement;
  toggle.type = "button";
  toggle.textContent = "Hoạt động";
  const ticker = make("span", "feed-ticker");
  const fresh = make("button", "feed-new") as HTMLButtonElement;
  fresh.type = "button";
  const chevron = make("button", "feed-chevron") as HTMLButtonElement;
  chevron.type = "button";
  header.append(toggle, ticker, fresh, chevron);
  const list = make("div", "feed-lines");
  list.setAttribute("role", "log");
  list.setAttribute("aria-live", "polite");
  list.tabIndex = 0;
  const empty = make("div", "feed-empty");
  empty.textContent = "Hoạt động của agent sẽ hiện ở đây.";
  root.replaceChildren(header, list);
  let collapsed = false;
  let hovering = false;
  let pending = 0;
  let resumeOnLeave = false;
  // scrollTop do chính feed đặt (giữ neo); sự kiện scroll kéo theo không phải cuộn tay.
  let settled: number | null = null;
  let layout = () => {};
  const rows = new Map<string, HTMLElement>();
  const atEnd = () => list.scrollHeight - list.scrollTop - list.clientHeight <= 4;
  const showPending = () => {
    fresh.textContent = `${pending} mới`;
    fresh.hidden = pending === 0;
  };
  const toEnd = () => {
    list.scrollTop = list.scrollHeight;
    pending = 0;
    showPending();
  };
  const setCollapsed = (value: boolean) => {
    const follow = atEnd() && !hovering;
    const changed = collapsed !== value;
    collapsed = value;
    root.classList.toggle("is-collapsed", collapsed);
    chevron.textContent = collapsed ? "▴" : "▾";
    for (const button of [toggle, chevron]) {
      button.title = collapsed ? "Mở (phím ])" : "Thu gọn (phím ])";
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-expanded", String(!collapsed));
    }
    if (follow) toEnd();
    if (changed) layout();
  };
  for (const button of [toggle, chevron]) button.addEventListener("click", () => setCollapsed(!collapsed));
  fresh.addEventListener("click", toEnd);
  list.addEventListener("pointerenter", () => { hovering = true; resumeOnLeave = atEnd(); });
  list.addEventListener("pointerleave", () => {
    hovering = false;
    if (resumeOnLeave || atEnd()) toEnd();
  });
  list.addEventListener("scroll", () => {
    if (settled !== null && list.scrollTop === settled) { settled = null; return; }
    settled = null;
    resumeOnLeave = atEnd();
    if (resumeOnLeave) { pending = 0; showPending(); }
  });
  const onKey = (event: KeyboardEvent) => {
    const target = event.target;
    if (event.key !== "]" || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
        (target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])"))) return;
    event.preventDefault();
    setCollapsed(!collapsed);
  };
  document.addEventListener("keydown", onKey);
  showPending();
  ticker.hidden = true;
  list.append(empty);
  setCollapsed(typeof matchMedia === "function" && matchMedia("(max-width: 899px)").matches);
  return {
    setCollapsed,
    onLayout(callback: () => void) { layout = callback; },
    render(lines: readonly DisplayLine[], workers: readonly WorkerStatus[] = []) {
      const follow = atEnd() && !hovering;
      // Giữ dòng neo khi giới hạn feed loại bớt các dòng đầu.
      const anchor = Array.from(list.children).find(node => node !== empty && (node as HTMLElement).offsetTop + (node as HTMLElement).offsetHeight > list.scrollTop) as HTMLElement | undefined;
      const offset = anchor ? anchor.offsetTop - list.scrollTop : 0;
      const added = lines.filter(line => !rows.has(line.key)).length;
      const keys = new Set(lines.map(line => line.key));
      empty.remove();
      for (const [key, row] of rows) if (!keys.has(key)) { row.remove(); rows.delete(key); }
      let index = 0;
      for (const line of lines) {
        let row = rows.get(line.key);
        if (!row) {
          row = make("button", "feed-line");
          (row as HTMLButtonElement).type = "button";
          rows.set(line.key, row);
        }
        const worker = workers.find(worker => worker.name === line.room);
        const agent = (Array.isArray(worker?.agents) ? worker.agents : []).find(agent => agent.id === line.agentId);
        const gone = !!line.agentId && (!agent || worker?.state === "offline" || worker?.state === "limited");
        const color = worker ? paletteOf(worker).shirt : "var(--line-strong)";
        const signature = JSON.stringify([line, gone, color, agent ? avatarIdentity(agent) : null]);
        if (row.dataset.content !== signature) {
          // Dòng ticket đã hiện mã ở cột tên; ô ticket để trống nhưng vẫn giữ để lưới thẳng hàng.
          const dup = !!line.ticket && line.ticket === line.name;
          row.className = ["feed-line", line.tone ? `tone-${line.tone}` : "", gone ? "is-gone" : "", dup ? "is-ticket" : ""].filter(Boolean).join(" ");
          row.replaceChildren();
          const content = [clock(line.at), "", line.name, line.room ? providerLetter(line.room) : "", dup ? "" : line.ticket ?? "", line.icon, line.text];
          content.forEach((text, i) => {
            const cell = make(i === 0 ? "time" : "span", ["feed-time", "feed-avatar", "feed-name", "feed-room", "feed-ticket", "feed-icon", "feed-text"][i]);
            cell.textContent = text;
            if (i === 0) cell.setAttribute("datetime", line.at);
            if (i === 1) {
              if (agent) cell.append(createAvatar(agent));
              else if (!line.agentId && line.ticket) cell.textContent = "🎫";
            }
            if (i === 3) { cell.style.background = line.room ? color : "transparent"; cell.title = line.room; }
            row!.append(cell);
          });
          row.dataset.content = signature;
          row.title = [clock(line.at), line.name, line.room, dup ? null : line.ticket, line.text].filter(Boolean).join(" · ");
          row.onclick = () => {
            if (line.agentId) actions.onAgent?.(line.room, line.agentId);
            else if (line.ticket) actions.onTicket?.(line.ticket);
          };
        }
        if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
        index++;
      }
      const latest = lines[lines.length - 1];
      ticker.textContent = latest ? `${latest.name}: ${latest.icon} ${latest.text}` : "";
      ticker.hidden = !latest;
      if (!lines.length) { list.append(empty); pending = 0; }
      else if (follow) toEnd();
      else {
        pending += added;
        if (anchor?.parentElement === list) {
          const before = list.scrollTop;
          list.scrollTop = anchor.offsetTop - offset;
          if (list.scrollTop !== before) settled = list.scrollTop;
        }
      }
      showPending();
    },
    destroy() { document.removeEventListener("keydown", onKey); },
  };
}
