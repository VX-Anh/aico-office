// Dữ liệu cho tab Agent của ngăn chi tiết: trạng thái, nhãn phòng, checklist task, timeline.
// Hàm thuần: không DOM, không đọc giờ thật (`now` do nơi gọi truyền vào).
// Dữ liệu sai kiểu thì từ chối (null/rỗng, warn một lần), không ném để vòng vẽ không đứng.

import type { WorkerAgent, WorkerStatus } from "../api";
import { readAgentActivity, taskProgress, type AgentTask } from "../activity";
import { relativeTime } from "../time";
import { agentStatus } from "./format";

export type StatusTone = "working" | "need" | "error" | "idle" | "offline" | "limited";
export interface StatusView { tone: StatusTone; label: string; ago: string | null }
export interface TaskChecklist { items: AgentTask[]; done: number; total: number }
export interface RecentRow { icon: string; text: string; ago: string; at: string }

const TONE_LABEL: Record<StatusTone, string> = {
  offline: "Mất kết nối",
  limited: "Hết hạn mức",
  error: "Lỗi",
  need: "Chờ",
  working: "Đang làm",
  idle: "Rảnh",
};

const ROOM_LABEL: Record<string, string> = {
  working: "đang làm",
  idle: "rảnh",
  limited: "hết hạn mức",
  offline: "mất kết nối",
};

const warned = new Set<string>();

function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[drawer] ${msg}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validIso(v: unknown): v is string {
  return typeof v === "string" && Number.isFinite(Date.parse(v));
}

// Lỗi đứng sau offline/limited: phòng mất kết nối thì lỗi cũ của agent không còn là việc cần xem trước.
export function statusView(worker: WorkerStatus, agent: WorkerAgent, needIds: ReadonlySet<string>, now: number): StatusView {
  if (!isRecord(worker)) warnOnce("worker phải là object");
  if (!isRecord(agent)) warnOnce("agent phải là object");
  const safeWorker = isRecord(worker) ? worker : ({ state: "idle" } as WorkerStatus);
  const safeAgent = isRecord(agent) ? agent : ({ ticket_id: null } as unknown as WorkerAgent);
  const { state, error } = agentStatus(safeWorker, safeAgent, needIds, now);
  const tone: StatusTone = state === "offline" || state === "limited" ? state : error ? "error" : state;
  const activity = readAgentActivity(safeAgent).activity;
  const startedAt = (safeAgent as unknown as Record<string, unknown>).started_at;
  const at = activity ? activity.at : validIso(startedAt) ? startedAt : null;
  return { tone, label: TONE_LABEL[tone], ago: at === null ? null : relativeTime(at, now) };
}

export function roomStateLabel(state: unknown): string {
  return typeof state === "string" && Object.hasOwn(ROOM_LABEL, state) ? ROOM_LABEL[state] : "?";
}

// done theo taskProgress: tasks_done hợp lệ thì tin aico, hỏng thì tự đếm task completed.
export function taskChecklist(agent: unknown): TaskChecklist | null {
  const tasks = readAgentActivity(agent).tasks;
  const progress = taskProgress(agent);
  if (!tasks?.length || !progress) return null;
  return { items: tasks, done: progress.done, total: progress.total };
}

// readAgentActivity đã giữ tối đa 20 mục mới nhất; sort ổn định nên cùng `at` giữ thứ tự gốc đảo lại.
export function recentRows(agent: unknown, key: string | undefined, now: number): RecentRow[] {
  const recent = readAgentActivity(agent, key).recent ?? [];
  return recent
    .map((a, i) => ({ a, i }))
    .sort((x, y) => Date.parse(y.a.at) - Date.parse(x.a.at) || y.i - x.i)
    .map(({ a }) => ({ icon: a.icon, text: a.text, ago: relativeTime(a.at, now), at: a.at }));
}
