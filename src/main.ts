import { type ApiConfig, type WorkerStatus, demoWorkers, fetchWorkers, loadConfig, roomAgents, saveConfig } from "./api";
import { ROLE_STYLES, drawScene, roleStyle, sceneSize } from "./scene";
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

function fmtCountdown(iso: string, now: number): string {
  const s = Math.max(0, Math.round((Date.parse(iso) - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}g ${m}p` : `${m}p ${String(sec).padStart(2, "0")}s`;
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
          el("strong", "", w.limit.resets_at ? `Mở lại sau ${fmtCountdown(w.limit.resets_at, now)}` : "Chưa rõ giờ mở lại"),
          el("p", "", w.limit.message),
          el("p", "", "Hạn mức chung cho cả phòng"),
        );
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

async function poll(): Promise<void> {
  if (!config) {
    workers = demoWorkers(Date.now());
    status.textContent = "Chế độ demo (dữ liệu giả)";
    status.className = "conn demo";
    return;
  }
  try {
    workers = await fetchWorkers(config);
    status.textContent = `Đã nối ${config.baseUrl}`;
    status.className = "conn ok";
  } catch (exc) {
    status.textContent = `Lỗi: ${(exc as Error).message}`;
    status.className = "conn bad";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const baseUrl = String(data.get("baseUrl") ?? "").trim();
  const token = String(data.get("token") ?? "").trim();
  config = baseUrl && token ? { baseUrl, token } : null;
  saveConfig(config);
  void poll();
});
form.querySelector<HTMLButtonElement>("#demo")!.addEventListener("click", () => {
  config = null;
  saveConfig(null);
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
  const size = sceneSize(workers);
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width;
    canvas.height = size.height;
  }
  drawScene(ctx, workers, t);
  requestAnimationFrame(frame);
}

void poll();
setInterval(() => void poll(), POLL_MS);
setInterval(() => renderCards(Date.now()), 1000);
renderCards(Date.now());
renderLegend();
requestAnimationFrame(frame);
