import { readAgentActivity } from "../activity";
import type { NeedItem } from "../needs-column";
import { paletteOf, roleStyle } from "../scene/palette";
import { mergeRequest, previewLink } from "../tickets";
import { createAvatar } from "./avatar";
import { recentRows, roomStateLabel, statusView, taskChecklist } from "./drawer-model";
import { providerLetter, tokenStatsRows } from "./format";
import type { DrawerView, SelectedAgent } from "./selection";
import "./drawer.css";

export interface DrawerAgentInfo extends SelectedAgent {
  needItems?: readonly NeedItem[];
}
export interface DrawerOptions {
  onClose(): void;
  onTab(tab: "agent" | "needs"): void;
}

export function createDrawer(root: HTMLElement, needsRoot: HTMLElement, options: DrawerOptions) {
  root.classList.add("drawer", "glass");
  root.setAttribute("aria-label", "Chi tiết");
  const header = document.createElement("div");
  header.className = "drawer-header";
  const tabs = document.createElement("div");
  tabs.className = "drawer-tabs";
  tabs.setAttribute("role", "tablist");
  const agentTab = document.createElement("button");
  const needsTab = document.createElement("button");
  const agentPanel = document.createElement("div");
  const needsPanel = document.createElement("div");
  agentPanel.className = "drawer-content";
  needsPanel.className = "drawer-content drawer-needs";
  agentPanel.id = `${root.id || "drawer"}-agent-panel`;
  needsPanel.id = `${root.id || "drawer"}-needs-panel`;
  for (const [tab, panel, name] of [[agentTab, agentPanel, "agent"], [needsTab, needsPanel, "needs"]] as const) {
    tab.type = "button";
    tab.id = `${panel.id}-tab`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panel.id);
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    tab.addEventListener("click", () => options.onTab(name));
  }
  agentTab.textContent = "Agent";
  needsTab.textContent = "Cần bạn (0)";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "drawer-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Đóng chi tiết (Esc)");
  close.addEventListener("click", options.onClose);
  tabs.append(agentTab, needsTab);
  header.append(tabs, close);
  // Di chuyển node gốc để giữ ghi chú, xác nhận và listener của cột Cần bạn.
  needsPanel.append(needsRoot);
  root.replaceChildren(header, agentPanel, needsPanel);
  root.hidden = true;
  const onKey = (event: KeyboardEvent) => {
    const target = event.target;
    if (event.key !== "Escape" || event.ctrlKey || event.metaKey || event.altKey || root.hidden ||
        (target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])"))) return;
    event.preventDefault();
    options.onClose();
  };
  document.addEventListener("keydown", onKey);
  let layout = () => {};
  return {
    onLayout(callback: () => void) { layout = callback; },
    render(view: DrawerView & { needsCount?: number }, info: DrawerAgentInfo | null, now: number) {
      const changed = root.hidden === view.open || root.dataset.tab !== view.tab;
      root.hidden = !view.open;
      root.dataset.tab = view.tab;
      agentPanel.hidden = view.tab !== "agent";
      needsPanel.hidden = view.tab !== "needs";
      for (const [tab, selected] of [[agentTab, view.tab === "agent"], [needsTab, view.tab === "needs"]] as const) {
        tab.setAttribute("aria-selected", String(selected));
      }
      needsTab.textContent = `Cần bạn (${view.needsCount ?? info?.needItems?.length ?? needsRoot.querySelectorAll(".need-card").length})`;
      // Dựng lại cả tab mỗi lần: dữ liệu đổi giữa chừng (mất ticket, đổi agent) không sót nút cũ.
      agentPanel.replaceChildren();
      const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
        const node = document.createElement(tag);
        node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
      };
      const section = (title: string, count: string | null) => {
        const block = el("section", "drawer-section");
        const heading = el("h3", "drawer-section-head");
        heading.append(el("span", "drawer-section-title", title));
        if (count !== null) heading.append(el("span", "drawer-section-count", count));
        block.append(heading);
        agentPanel.append(block);
        return block;
      };
      if (!info) agentPanel.append(el("div", "drawer-muted", "Chọn một agent để xem chi tiết."));
      else {
        const { agent, worker } = info;
        const data = readAgentActivity(agent, info.key);
        const needItems = info.needItems ?? [];
        const ticketId = typeof agent.ticket_id === "string" && agent.ticket_id ? agent.ticket_id : null;
        const ticket = ticketId === null ? undefined : needItems.find(item => item.ticket.id === ticketId)?.ticket;

        const hero = el("div", "drawer-hero");
        const avatarBox = el("div", "drawer-hero-avatar");
        avatarBox.append(createAvatar(agent));
        const body = el("div", "drawer-hero-body");
        const name = el("div", "drawer-hero-name");
        const id = el("span", "drawer-agent-id mono", agent.id);
        id.title = agent.id;
        name.append(el("span", "drawer-role", roleStyle(agent.role ?? "").label), id);
        const room = el("div", "drawer-hero-room");
        const chip = el("span", "drawer-room-chip", providerLetter(worker.name));
        chip.style.background = paletteOf(worker).shirt;
        chip.setAttribute("aria-hidden", "true");
        room.append(chip, el("span", "drawer-room-name", worker.name), el("span", "drawer-room-state", roomStateLabel(worker.state)));
        body.append(name, room);
        if (ticketId !== null) {
          const row = el("div", "drawer-hero-ticket");
          row.append(el("span", "drawer-ticket-label", "Ticket"), el("span", "drawer-ticket-id mono", ticketId));
          body.append(row);
        }
        hero.append(avatarBox, body);

        const mission = el("div", ticketId === null ? "drawer-mission is-empty" : "drawer-mission");
        if (ticketId === null) mission.append(el("div", "drawer-mission-title", "Chưa có ticket"));
        else if (ticket?.title) mission.append(el("div", "drawer-mission-title", ticket.title));
        // Ticket không nằm trong Cần bạn thì không có tiêu đề: hiện mã mờ thay cho hộp trống.
        else mission.append(el("div", "drawer-mission-title drawer-muted mono", ticketId));
        if (ticket) {
          const links = el("div", "drawer-mission-links");
          for (const [label, url] of [["MR ↗", mergeRequest(ticket).url], ["Xem trước ↗", previewLink(ticket)]] as const) {
            if (!url) continue;
            const link = el("a", "drawer-link", label);
            link.href = url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            links.append(link);
          }
          if (links.children.length) mission.append(links);
        }

        const status = statusView(worker, agent, new Set(needItems.map(item => item.ticket.id)), now);
        const statusRow = el("div", `drawer-status tone-${status.tone}`);
        statusRow.append(el("span", "drawer-status-dot"), el("span", "drawer-status-label", status.label));
        if (status.ago !== null) statusRow.append(el("span", "drawer-status-ago", `· ${status.ago}`));

        const activity = data.activity;
        const card = el("div", activity?.error ? "drawer-now is-error" : "drawer-now");
        const main = el("div", "drawer-now-main");
        if (activity) main.append(el("span", "drawer-now-icon", activity.icon), el("span", "drawer-now-text", activity.text));
        else main.append(el("span", "drawer-now-text drawer-muted", "Chưa có hoạt động"));
        card.append(el("div", "drawer-now-title", "Đang làm"), main);
        if (activity?.detail) card.append(el("div", "drawer-now-detail", activity.detail));
        agentPanel.append(hero, mission, statusRow, card);

        const checklist = taskChecklist(agent);
        const tasks = section("Task", checklist ? `${checklist.done}/${checklist.total}` : null);
        if (!checklist) tasks.append(el("div", "drawer-muted", "Chưa có task"));
        else {
          const bar = el("div", "drawer-progress");
          bar.setAttribute("role", "progressbar");
          bar.setAttribute("aria-label", "Tiến độ task");
          bar.setAttribute("aria-valuemin", "0");
          bar.setAttribute("aria-valuemax", String(checklist.total));
          bar.setAttribute("aria-valuenow", String(checklist.done));
          const fill = el("div", "drawer-progress-fill");
          fill.style.width = `${Math.round((checklist.done * 100) / checklist.total)}%`;
          bar.append(fill);
          const list = el("ul", "drawer-checklist");
          const marks = { pending: "○", in_progress: "◐", completed: "✓" };
          for (const task of checklist.items) {
            const item = el("li", `drawer-check ${task.status}`);
            const title = el("span", "drawer-check-title", task.title);
            title.title = task.title;
            item.append(el("span", "drawer-check-mark", marks[task.status]), title);
            list.append(item);
          }
          tasks.append(bar, list);
        }

        const rows = recentRows(agent, info.key, now);
        const recent = section("Gần đây", String(rows.length));
        if (!rows.length) recent.append(el("div", "drawer-muted", "Chưa có hoạt động"));
        else {
          const list = el("ol", "drawer-timeline");
          for (const row of rows) {
            const item = el("li", "drawer-tl-row");
            const text = el("span", "drawer-tl-text", row.text);
            text.title = row.text;
            const ago = el("time", "drawer-tl-ago", row.ago);
            ago.setAttribute("datetime", row.at);
            item.append(el("span", "drawer-tl-icon", row.icon), text, ago);
            list.append(item);
          }
          recent.append(list);
        }

        const stats = section("Số liệu", null);
        const table = el("dl", "drawer-stats");
        for (const row of tokenStatsRows(data.stats)) {
          const item = el("div", "drawer-stat");
          const value = el("dd", "");
          value.append(el("span", "drawer-stat-value", row.value));
          if (row.cacheSuffix !== null) value.append(el("span", row.level ? `drawer-cache ${row.level}` : "drawer-cache", row.cacheSuffix));
          item.append(el("dt", "", row.label), value);
          table.append(item);
        }
        stats.append(table);
      }
      if (changed) layout();
    },
    destroy() { document.removeEventListener("keydown", onKey); },
  };
}
