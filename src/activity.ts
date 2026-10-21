// Hoạt động chi tiết của từng agent con (trường `activity`, `recent`, `tasks`, `tasks_done`, `stats`
// trong agents[] của GET /workers): đọc phòng thủ và các hàm thuần cho bong bóng, màn hình bàn, tiến độ.
// Không sửa kiểu `WorkerAgent` trong api.ts: dữ liệu đi qua nguyên vẹn nên đọc từ `unknown`.
// Không đọc thời gian thật: `now` do nơi gọi truyền vào.

import { isIso } from "./usage";

export type ActivityKind =
  | "think" | "respond" | "read" | "search" | "edit" | "write" | "run" | "test"
  | "git" | "web" | "plan" | "delegate" | "mcp" | "remote" | "error" | "other";

export interface Activity {
  kind: ActivityKind;
  icon: string;
  text: string;
  detail: string | null;
  tool: string | null;
  at: string;
  error: boolean;
}

export interface AgentTask {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed";
}

export interface AgentStats {
  tool_calls: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_cached: number | null;
}

export interface AgentActivity {
  activity: Activity | null;
  recent: Activity[] | null;
  tasks: AgentTask[] | null;
  tasksDone: number | null;
  stats: AgentStats | null;
}

export type ScreenMode = "code" | "terminal" | "browser" | "search" | "read" | "idle";

// `at` là timestamp (ms) của activity, dùng để chọn cái mới hơn khi bong bóng chồng nhau.
export interface Bubble {
  icon: string;
  text: string;
  error: boolean;
  stale: boolean;
  at: number;
}

// Quá 60 giây không có hoạt động mới thì bong bóng chỉ còn icon, mờ (agent có thể đang chờ hoặc kẹt).
export const STALE_MS = 60_000;
const RECENT_MAX = 20;
const TEXT_MAX = 28;

const KIND_ICON: Record<ActivityKind, string> = {
  think: "💭",
  respond: "💬",
  read: "📖",
  search: "🔍",
  edit: "✏️",
  write: "📝",
  run: "▶️",
  test: "🧪",
  git: "🔀",
  web: "🌐",
  plan: "📋",
  delegate: "👥",
  mcp: "🔌",
  remote: "🛰️",
  error: "⚠️",
  other: "⚙️",
};

const KINDS = Object.keys(KIND_ICON) as ActivityKind[];
const TASK_STATUS = ["pending", "in_progress", "completed"] as const;

const warned = new Set<string>();

// Cùng dữ liệu hỏng được poll lại mỗi vài giây và đọc lại mỗi frame: chỉ warn lần đầu.
function warnOnce(who: string, msg: string): void {
  const line = `${who}: ${msg}`;
  if (!warned.has(line)) {
    warned.add(line);
    console.warn(`[activity] ${line}`);
  }
}

function reject(who: string, msg: string): null {
  warnOnce(who, msg);
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isKind(v: string): v is ActivityKind {
  return (KINDS as string[]).includes(v);
}

// Trường chuỗi tuỳ chọn: vắng hoặc null là hợp lệ, có mặt mà sai kiểu thì báo sai (undefined).
function optString(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  return typeof v === "string" ? v : undefined;
}

function parseActivity(raw: unknown): Activity | string {
  if (!isRecord(raw)) return "phải là object";
  const { kind, icon, text, at, error } = raw;
  if (typeof kind !== "string") return "kind phải là chuỗi";
  if (typeof text !== "string") return "text phải là chuỗi";
  if (icon !== undefined && icon !== null && typeof icon !== "string") return "icon phải là chuỗi";
  if (!isIso(at)) return "at thiếu hoặc không phải giờ ISO";
  if (error !== undefined && error !== null && typeof error !== "boolean") return "error phải là boolean";
  const detail = optString(raw.detail);
  if (detail === undefined) return "detail phải là chuỗi";
  const tool = optString(raw.tool);
  if (tool === undefined) return "tool phải là chuỗi";
  // aico bản mới có thể thêm kind: hiện như việc khác thay vì bỏ cả bong bóng.
  const k: ActivityKind = isKind(kind) ? kind : "other";
  return {
    kind: k,
    icon: typeof icon === "string" && icon.trim() ? icon : KIND_ICON[k],
    text,
    detail,
    tool,
    at,
    error: error === true || k === "error",
  };
}

function parseTask(raw: unknown): AgentTask | string {
  if (!isRecord(raw)) return "phải là object";
  const { id, title, status } = raw;
  if (typeof id !== "string") return "id phải là chuỗi";
  if (typeof title !== "string") return "title phải là chuỗi";
  if (typeof status !== "string" || !(TASK_STATUS as readonly string[]).includes(status)) {
    return "status phải là pending|in_progress|completed";
  }
  return { id, title, status: status as AgentTask["status"] };
}

function readActivity(raw: unknown, who: string): Activity | null {
  if (raw === undefined || raw === null) return null;
  const a = parseActivity(raw);
  return typeof a === "string" ? reject(who, `activity: ${a}`) : a;
}

// Phần tử hỏng chỉ bỏ riêng nó: một mục lạ không làm mất cả lịch sử.
function readList<T>(raw: unknown, field: string, who: string, parse: (v: unknown) => T | string): T[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return reject(who, `${field} phải là mảng`);
  const out: T[] = [];
  raw.forEach((item, i) => {
    const v = parse(item);
    if (typeof v === "string") warnOnce(who, `${field}[${i}]: ${v}`);
    else out.push(v);
  });
  return out;
}

function readTasksDone(raw: unknown, total: number | null, who: string): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || (total !== null && raw > total)) {
    return reject(who, `tasks_done phải là số nguyên trong 0..${total ?? "∞"}`);
  }
  return raw;
}

function readStats(raw: unknown, who: string): AgentStats | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) return reject(who, "stats phải là object");
  const num = (key: keyof AgentStats): number | null => {
    const v = raw[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return reject(who, `stats.${key} phải là số hữu hạn không âm`);
    return v;
  };
  return { tool_calls: num("tool_calls"), tokens_in: num("tokens_in"), tokens_out: num("tokens_out"), tokens_cached: num("tokens_cached") };
}

function whoOf(agent: Record<string, unknown>, who: string | undefined): string {
  return who ?? (typeof agent.id === "string" ? `agent ${agent.id}` : "agent");
}

// Thiếu trường (aico bản cũ) thì trường đó null, không warn; sai kiểu thì null và warn một lần.
// Không ném lỗi để vòng vẽ không đứng.
export function readAgentActivity(agent: unknown, who?: string): AgentActivity {
  const empty: AgentActivity = { activity: null, recent: null, tasks: null, tasksDone: null, stats: null };
  if (!isRecord(agent)) {
    if (agent !== undefined && agent !== null) warnOnce(who ?? "agent", "agent phải là object");
    return empty;
  }
  const w = whoOf(agent, who);
  const recent = readList(agent.recent, "recent", w, parseActivity);
  const tasks = readList(agent.tasks, "tasks", w, parseTask);
  return {
    activity: readActivity(agent.activity, w),
    recent: recent && recent.slice(-RECENT_MAX),
    tasks,
    tasksDone: readTasksDone(agent.tasks_done, tasks ? tasks.length : null, w),
    stats: readStats(agent.stats, w),
  };
}

// Đầu vào đã gồm cache; số liệu cập nhật lệch nhau có thể tạm cho cache lớn hơn tổng.
export function cacheRatio(stats: AgentStats | null | undefined): number | null {
  if (!stats || stats.tokens_in === null || stats.tokens_in <= 0 || stats.tokens_cached === null) return null;
  return Math.min(1, Math.max(0, stats.tokens_cached / stats.tokens_in));
}

export function screenFor(kind: ActivityKind | null | undefined): ScreenMode {
  switch (kind) {
    case "edit":
    case "write":
      return "code";
    case "run":
    case "test":
    case "git":
    case "remote":
      return "terminal";
    case "web":
    case "mcp":
      return "browser";
    case "search":
      return "search";
    case "read":
    case "plan":
      return "read";
    default:
      return "idle";
  }
}

const CLUSTER_TAIL = /^[\p{M}‍️\u{1f3fb}-\u{1f3ff}]$/u;

// Cắt theo code point (sau NFC) để không xé đôi emoji hay chữ có dấu; dài quá thì thêm "…" (tính cả nó).
export function truncate(text: string, max = TEXT_MAX): string {
  const chars = Array.from(text.normalize("NFC"));
  if (chars.length <= max) return chars.join("");
  if (max < 1) return "";
  let n = max - 1;
  // Không cắt giữa ký tự gốc và dấu tổ hợp, hay giữa các phần của emoji ghép (ZWJ, tông da).
  while (n > 0 && (CLUSTER_TAIL.test(chars[n]) || chars[n - 1] === "‍")) n--;
  return `${chars.slice(0, n).join("").trimEnd()}…`;
}

// Chỉ đọc `activity` (không đọc recent/tasks) vì được gọi mỗi frame cho từng agent.
export function bubbleFor(agent: unknown, now: number): Bubble | null {
  if (!isRecord(agent)) return null;
  const a = readActivity(agent.activity, whoOf(agent, undefined));
  if (!a) return null;
  const at = Date.parse(a.at);
  // `at` ở tương lai (lệch đồng hồ giữa máy aico và trình duyệt) thì coi như mới.
  return { icon: a.icon, text: truncate(a.text), error: a.error, stale: now - at > STALE_MS, at };
}

// `tasks_done` hợp lệ thì tin aico, không thì tự đếm task completed.
export function taskProgress(agent: unknown): { done: number; total: number } | null {
  if (!isRecord(agent)) return null;
  const w = whoOf(agent, undefined);
  const tasks = readList(agent.tasks, "tasks", w, parseTask);
  if (!tasks || tasks.length === 0) return null;
  const total = tasks.length;
  const done = readTasksDone(agent.tasks_done, total, w) ?? tasks.filter((t) => t.status === "completed").length;
  return { done, total };
}

// (x, y) là góc trên trái khung bong bóng. Trả về key các bong bóng phải thu về chỉ icon:
// cái mới nhất hiện đủ, cái sau chồng lên một bong bóng đầy đủ đã đặt thì thu lại.
export function resolveBubbles(items: { key: string; x: number; y: number; w: number; h: number; at: number }[]): Set<string> {
  const atOf = (v: number) => (Number.isFinite(v) ? v : -Infinity);
  const sorted = [...items].sort((a, b) => atOf(b.at) - atOf(a.at) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const placed: typeof items = [];
  const collapsed = new Set<string>();
  for (const it of sorted) {
    const hit = placed.some((p) => it.x < p.x + p.w && p.x < it.x + it.w && it.y < p.y + p.h && p.y < it.y + it.h);
    if (hit) collapsed.add(it.key);
    else placed.push(it);
  }
  return collapsed;
}

// ---- Dữ liệu demo ----

const DEMO_CYCLE = 48_000;
const DEMO_STEP = 3_000;
const DEMO_TASKS = 7;
// Đủ 16 kind: agent đầu của claude (giây 8–40) đi 11 bước đầu, agent thứ hai (từ giây 16, lệch pha 11) đi nốt.
const DEMO_SEQ: { kind: ActivityKind; text: string; tool?: string; detail?: string }[] = [
  { kind: "think", text: "Đang suy nghĩ cách chia việc" },
  { kind: "read", text: "Đọc src/scene/layout.ts", tool: "Read" },
  { kind: "search", text: "Tìm chỗ gọi drawDesk trong toàn bộ src", tool: "Grep" },
  { kind: "plan", text: "Lập danh sách việc cần làm", tool: "TodoWrite" },
  { kind: "edit", text: "Sửa src/scene/furniture.ts", tool: "Edit", detail: "drawMonitor: thêm màn hình terminal" },
  { kind: "write", text: "Tạo src/activity.test.ts", tool: "Write" },
  { kind: "run", text: "npm run build", tool: "Bash" },
  { kind: "test", text: "npm test: chạy lại toàn bộ kịch bản actors", tool: "Bash" },
  { kind: "git", text: "git diff --stat", tool: "Bash" },
  { kind: "web", text: "Mở tài liệu CanvasRenderingContext2D", tool: "WebFetch" },
  { kind: "mcp", text: "aico: đọc file từ repo", tool: "mcp__aico__read_file" },
  { kind: "respond", text: "Viết tóm tắt thay đổi cho Tech Lead" },
  { kind: "delegate", text: "Giao reviewer xem lại diff", tool: "Agent" },
  { kind: "remote", text: "aico-remote: npm run build && npm test", tool: "Bash" },
  { kind: "error", text: "Build lỗi: thiếu kiểu SceneFigure", tool: "Bash", detail: "TS2304: Cannot find name" },
  { kind: "other", text: "Dọn thư mục tạm" },
];

function demoActivity(idx: number, atMs: number): Activity {
  const d = DEMO_SEQ[((idx % DEMO_SEQ.length) + DEMO_SEQ.length) % DEMO_SEQ.length];
  return {
    kind: d.kind,
    icon: KIND_ICON[d.kind],
    text: d.text,
    detail: d.detail ?? null,
    tool: d.tool ?? null,
    at: new Date(atMs).toISOString(),
    error: d.kind === "error",
  };
}

// Thêm activity/recent/tasks/stats giả cho agent của `demoWorkers` (api.ts) mà không sửa api.ts.
// Kind đổi 3 giây một lần, lệch pha theo phòng và vị trí agent; agent đầu tiên của phòng đầu
// đứng im từ giây 36 (activity cũ 90 giây → stale). Tasks 7 mục xong dần theo thời gian chạy.
export function withDemoActivity<T>(workers: T[], now: number): T[] {
  const cycleStart = Math.floor(now / DEMO_CYCLE) * DEMO_CYCLE;
  const s = (now - cycleStart) / 1000;
  return workers.map((w, i) => {
    if (!isRecord(w) || !Array.isArray(w.agents)) return w;
    const agents = w.agents.map((a: unknown, k: number) => {
      if (!isRecord(a)) return a;
      const started = typeof a.started_at === "string" ? Date.parse(a.started_at) : NaN;
      const begin = Number.isFinite(started) && started <= now ? started : now;
      const elapsed = now - begin;
      const step = Math.floor(elapsed / DEMO_STEP);
      const offset = i * 5 + k * 11;
      const recent = Array.from({ length: Math.min(8, step + 1) }, (_, j) => {
        const st = step - Math.min(7, step) + j;
        return demoActivity(st + offset, begin + st * DEMO_STEP);
      });
      const current = recent[recent.length - 1];
      const stale = i === 0 && k === 0 && s >= 36;
      const activity = stale ? { ...current, at: new Date(now - 90_000).toISOString() } : current;
      const done = Math.min(DEMO_TASKS, Math.floor(elapsed / 4_000));
      const tasks: AgentTask[] = Array.from({ length: DEMO_TASKS }, (_, n) => ({
        id: `${String(a.id)}-t${n + 1}`,
        title: `Việc ${n + 1}: ${DEMO_SEQ[(n * 3 + offset) % DEMO_SEQ.length].text}`,
        status: n < done ? "completed" : n === done ? "in_progress" : "pending",
      }));
      const tokensIn = 8_000 + Math.floor(elapsed / 1000) * 2_400;
      // Cursor mô phỏng worker cũ: thiếu hẳn khóa cache, không chỉ trả null.
      const stats = {
        tool_calls: step * 2 + 1,
        tokens_in: tokensIn,
        ...(i === 2 && k === 0 ? {} : { tokens_cached: Math.floor(tokensIn * (70 + ((i + k) % 6) * 5) / 100) }),
        tokens_out: 600 + Math.floor(elapsed / 1000) * 180,
      };
      return { ...a, activity, recent, tasks, tasks_done: done, stats };
    });
    return { ...w, agents } as T;
  });
}
