import type { FeedLine } from "./feed-model";
import { clock } from "./format";
import "./feed.css";

export function createFeed(root: HTMLElement) {
  root.classList.add("feed", "glass");
  root.setAttribute("aria-label", "Hoạt động");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "feed-toggle";
  toggle.setAttribute("aria-label", "Thu gọn hoặc mở hoạt động (])");
  const list = document.createElement("div");
  list.className = "feed-lines";
  list.setAttribute("role", "log");
  list.setAttribute("aria-live", "polite");
  list.tabIndex = 0;
  root.replaceChildren(toggle, list);
  let collapsed = false;
  let layout = () => {};
  const rows = new Map<string, HTMLElement>();
  const atEnd = () => list.scrollHeight - list.scrollTop - list.clientHeight <= 4;
  const setCollapsed = (value: boolean) => {
    const follow = atEnd();
    const changed = collapsed !== value;
    collapsed = value;
    root.classList.toggle("is-collapsed", collapsed);
    toggle.textContent = collapsed ? "Hoạt động · ] mở" : "Hoạt động · ] thu gọn";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    if (follow) list.scrollTop = list.scrollHeight;
    if (changed) layout();
  };
  toggle.addEventListener("click", () => setCollapsed(!collapsed));
  const onKey = (event: KeyboardEvent) => {
    const target = event.target;
    if (event.key !== "]" || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
        (target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])"))) return;
    event.preventDefault();
    setCollapsed(!collapsed);
  };
  document.addEventListener("keydown", onKey);
  setCollapsed(false);
  return {
    setCollapsed,
    onLayout(callback: () => void) { layout = callback; },
    render(lines: readonly FeedLine[]) {
      const follow = atEnd();
      // Giữ dòng neo khi giới hạn feed loại bớt các dòng đầu.
      const anchor = Array.from(list.children).find(node => (node as HTMLElement).offsetTop + (node as HTMLElement).offsetHeight > list.scrollTop) as HTMLElement | undefined;
      const offset = anchor ? anchor.offsetTop - list.scrollTop : 0;
      const keys = new Set(lines.map(line => line.key));
      for (const [key, row] of rows) if (!keys.has(key)) { row.remove(); rows.delete(key); }
      let index = 0;
      for (const line of lines) {
        let row = rows.get(line.key);
        if (!row) {
          row = document.createElement("div");
          row.className = "feed-line";
          rows.set(line.key, row);
        }
        const content = [clock(line.at), [line.name, line.room].filter(Boolean).join(" / "), line.icon, line.text];
        if (row.dataset.content !== JSON.stringify(content)) {
          row.replaceChildren();
          content.forEach((text, i) => {
            const cell = document.createElement(i === 0 ? "time" : "span");
            cell.className = ["feed-time", "feed-name", "feed-icon", "feed-text"][i];
            cell.textContent = text;
            if (i === 0) cell.setAttribute("datetime", line.at);
            row.append(cell);
          });
          row.dataset.content = JSON.stringify(content);
          row.title = content.join(" · ");
        }
        if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
        index++;
      }
      if (follow) list.scrollTop = list.scrollHeight;
      else if (anchor?.parentElement === list) list.scrollTop = anchor.offsetTop - offset;
    },
    destroy() { document.removeEventListener("keydown", onKey); },
  };
}
