import { loadConfig, type WorkerAgent } from "./api";
import { readAgentActivity } from "./activity";
import { relativeTime } from "./time";
import { tokenStatsLines } from "./ui/format";
import { roleStyle } from "./scene/palette";
import "./agent-tooltip.css";

// Kiểu cấu trúc để nhận SceneFigure mà không phụ thuộc vòng vẽ cảnh.
interface TooltipFigure {
  key: string;
  agent: WorkerAgent;
  room: string;
  x: number;
  headY: number;
  footY: number;
}

export function hitFigure<T extends TooltipFigure>(figures: readonly T[], x: number, y: number): T | null {
  let hit: T | null = null;
  for (const figure of figures) {
    if (Math.abs(x - figure.x) <= 8 && y >= figure.headY && y <= figure.footY &&
        (!hit || figure.footY >= hit.footY)) hit = figure;
  }
  return hit;
}

const TASK_LABEL = { pending: "Chờ", in_progress: "Đang làm", completed: "Đã xong" };
const missing = "chưa có";

// Chỉ dùng giờ do vòng vẽ truyền vào, không làm đổi thứ tự dữ liệu từ poll.
export function recentLines(agent: unknown, key: string, nowMs: number): string[] {
  const recent = readAgentActivity(agent, key).recent?.slice()
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 5);
  return recent?.length
    ? recent.map((activity) => `${activity.icon} ${activity.text} · ${relativeTime(activity.at, nowMs)}`)
    : [missing];
}

export function createAgentTooltip(canvas: HTMLCanvasElement): {
  update(figures: readonly TooltipFigure[], sceneW: number, now: number): void;
} {
  const tooltip = document.createElement("div");
  tooltip.className = "agent-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.append(tooltip);

  let figures: readonly TooltipFigure[] = [];
  let sceneW = 0;
  let now = NaN;
  let selected: TooltipFigure | null = null;
  let renderedAt = -Infinity;
  let pointerX = 0;
  let pointerY = 0;
  let source = "";
  let touch = false;

  // Cấu hình đổi trước lần poll kế tiếp: đóng ngay cả khi figures cũ vẫn còn.
  const currentSource = () => JSON.stringify(loadConfig());
  const hide = () => {
    selected = null;
    tooltip.hidden = true;
  };
  const position = () => {
    const gap = 12;
    const margin = 8;
    const { width, height } = tooltip.getBoundingClientRect();
    let left = pointerX + gap;
    let top = pointerY + gap;
    if (left + width > window.innerWidth - margin) left = pointerX - width - gap;
    if (top + height > window.innerHeight - margin) top = pointerY - height - gap;
    tooltip.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - width - margin))}px`;
    tooltip.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - height - margin))}px`;
  };
  const render = (figure: TooltipFigure) => {
    const data = readAgentActivity(figure.agent, figure.key);
    tooltip.replaceChildren();
    const line = (text: string, className = "") => {
      const row = document.createElement("div");
      row.className = className;
      row.textContent = text;
      tooltip.append(row);
      return row;
    };
    const text = (value: unknown) => typeof value === "string" && value ? value : missing;
    line(`Ticket: ${text(figure.agent.ticket_id)}`, "agent-tooltip-title");
    line(`Vai trò: ${figure.agent.role ? roleStyle(figure.agent.role).label : missing}`);
    line("Hoạt động gần nhất", "agent-tooltip-heading");
    for (const activity of recentLines(figure.agent, figure.key, now)) line(activity);
    line("Task", "agent-tooltip-heading");
    if (!data.tasks?.length) line(missing);
    else for (const task of data.tasks) line(`${TASK_LABEL[task.status]}: ${task.title}`);
    line("Thống kê", "agent-tooltip-heading");
    for (const stat of tokenStatsLines(data.stats)) {
      const row = line(stat.text);
      if (stat.cacheSuffix) {
        const suffix = document.createElement("span");
        suffix.className = `agent-tooltip-cache ${stat.level ?? ""}`;
        suffix.textContent = stat.cacheSuffix;
        row.append(suffix);
      }
    }
    renderedAt = now;
  };
  const atPointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const width = canvas.clientWidth;
    if (sceneW <= 0 || width <= 0 || rect.width <= 0) return null;
    // clientWidth loại viền; rect/clientWidth còn tính cả CSS transform.
    const scale = rect.width / canvas.offsetWidth;
    const x = (event.clientX - rect.left - canvas.clientLeft * scale) / scale;
    const y = (event.clientY - rect.top - canvas.clientTop * scale) / scale;
    if (x < 0 || y < 0 || x > width || y > canvas.clientHeight) return null;
    return hitFigure(figures, x * sceneW / width, y * sceneW / width);
  };
  const show = (figure: TooltipFigure | null, event: PointerEvent) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!figure) return hide();
    const changed = !selected || selected.key !== figure.key;
    selected = figure;
    source = currentSource();
    tooltip.hidden = false;
    if (changed || !Number.isFinite(renderedAt) || now - renderedAt >= 1000 || now < renderedAt) render(figure);
    position();
  };
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    touch = false;
    show(atPointer(event), event);
  });
  canvas.addEventListener("pointerleave", () => {
    if (!touch) hide();
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "touch") return;
    touch = true;
    show(event.target === canvas ? atPointer(event) : null, event);
  });

  return {
    update(nextFigures, nextSceneW, nextNow) {
      figures = nextFigures;
      sceneW = nextSceneW;
      now = nextNow;
      if (!selected) return;
      const figure = figures.find((item) => item.key === selected?.key);
      if (!figure || figure.agent.started_at !== selected.agent.started_at || currentSource() !== source) {
        hide();
        return;
      }
      selected = figure;
      if (!Number.isFinite(renderedAt) || now - renderedAt >= 1000 || now < renderedAt) render(figure);
      position();
    },
  };
}
