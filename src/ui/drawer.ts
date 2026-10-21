import { readAgentActivity, taskProgress } from "../activity";
import type { NeedItem } from "../needs-column";
import { roleStyle } from "../scene/palette";
import { mergeRequest, previewLink } from "../tickets";
import { relativeTime } from "../time";
import { tokenStatsLines } from "./format";
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
      agentPanel.replaceChildren();
      const line = (parent: HTMLElement, text: string, className = "") => {
        const node = document.createElement("div");
        node.className = className;
        node.textContent = text;
        parent.append(node);
        return node;
      };
      const section = (title: string) => {
        const block = document.createElement("section");
        const heading = document.createElement("h3");
        heading.textContent = title;
        block.append(heading);
        agentPanel.append(block);
        return block;
      };
      if (!info) line(agentPanel, "Chọn một agent để xem chi tiết.", "drawer-muted");
      else {
        const { agent, worker } = info;
        const data = readAgentActivity(agent, info.key);
        line(agentPanel, agent.id, "drawer-title");
        line(agentPanel, `${roleStyle(agent.role ?? "").label} · ${worker.name}`, "drawer-muted");
        const ticket = info.needItems?.find(item => item.ticket.id === agent.ticket_id)?.ticket;
        const ticketRow = line(agentPanel, agent.ticket_id ?? "Chưa có ticket", "drawer-ticket");
        if (ticket) {
          line(agentPanel, ticket.title);
          for (const [label, url] of [["MR", mergeRequest(ticket).url], ["Xem trước", previewLink(ticket)]]) {
            if (!url) continue;
            const link = document.createElement("a");
            link.textContent = label;
            link.href = url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            ticketRow.append(link);
          }
        }
        const current = section("Đang làm");
        line(current, data.activity ? `${data.activity.icon} ${data.activity.text}` : "Chưa có hoạt động", data.activity?.error ? "drawer-error" : "");
        if (data.activity?.detail) line(current, data.activity.detail, "drawer-muted");
        const recent = section("Gần đây");
        const activities = data.recent?.slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
        if (!activities?.length) line(recent, "Chưa có hoạt động", "drawer-muted");
        for (const activity of activities ?? []) {
          const row = line(recent, `${activity.icon} ${activity.text}`, "drawer-recent");
          line(row, relativeTime(activity.at, now), "drawer-muted");
        }
        const tasks = section("Task");
        const progress = taskProgress(agent);
        if (progress) {
          line(tasks, `${progress.done}/${progress.total} đã xong`);
          const bar = document.createElement("progress");
          bar.max = progress.total;
          bar.value = progress.done;
          bar.setAttribute("aria-label", "Tiến độ task");
          tasks.append(bar);
        }
        if (!data.tasks?.length) line(tasks, "Chưa có task", "drawer-muted");
        for (const task of data.tasks ?? []) {
          const labels = { pending: "Chờ", in_progress: "Đang làm", completed: "Đã xong" };
          line(tasks, `${labels[task.status]} · ${task.title}`, `drawer-task ${task.status}`);
        }
        const stats = section("Số liệu");
        for (const item of tokenStatsLines(data.stats)) {
          const row = line(stats, item.text);
          if (item.cacheSuffix !== null) {
            const suffix = document.createElement("span");
            suffix.className = item.level ? `drawer-cache ${item.level}` : "drawer-cache";
            suffix.textContent = item.cacheSuffix;
            row.append(suffix);
          }
        }
      }
      if (changed) layout();
    },
    destroy() { document.removeEventListener("keydown", onKey); },
  };
}
