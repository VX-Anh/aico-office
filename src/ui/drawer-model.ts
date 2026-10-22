// Dữ liệu cho tab Agent của ngăn chi tiết: trạng thái, nhãn phòng, checklist task, timeline.
// Hàm thuần: không DOM, không đọc giờ thật (`now` do nơi gọi truyền vào).
// Dữ liệu sai kiểu thì từ chối (null/rỗng, warn một lần), không ném để vòng vẽ không đứng.

import type { WorkerAgent, WorkerStatus } from "../api";
import { readAgentActivity, taskProgress, type AgentTask } from "../activity";
import { NEED_LABEL, type NeedKind } from "../tickets";
import { relativeTime } from "../time";
import { agentStatus } from "./format";

export type StatusTone = "working" | "need" | "error" | "idle" | "offline" | "limited";
// ticketId/needKind chỉ có khi tone need, để drawer dựng nút mở đúng thẻ Cần bạn.
export interface StatusView { tone: StatusTone; label: string; ago: string | null; ticketId: string | null; needKind: NeedKind | null }
export interface TaskChecklist { items: AgentTask[]; done: number; total: number }
export interface RecentRow { icon: string; text: string; ago: string; at: string }

const TONE_LABEL: Record<StatusTone, string> = {
  offline: "Mất kết nối",
  limited: "Hết hạn mức",
  error: "Lỗi",
  need: "Chờ bạn",
  working: "Đang làm",
  idle: "Rảnh",
};

// escalated không phải động từ nên thêm "xử lý" cho câu đọc trọn nghĩa.
function needLabel(kind: NeedKind | null): string {
  if (kind === null) return "Chờ bạn";
  return kind === "escalated" ? `Chờ bạn xử lý (${NEED_LABEL.escalated})` : `Chờ bạn ${NEED_LABEL[kind]}`;
}

const CARD_TITLE: Record<StatusTone, string> = {
  working: "Đang làm",
  need: "Hoạt động gần nhất",
  idle: "Hoạt động gần nhất",
  offline: "Hoạt động gần nhất",
  limited: "Hoạt động gần nhất",
  error: "Lỗi gần nhất",
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

function isNeedKind(v: unknown): v is NeedKind {
  return typeof v === "string" && Object.hasOwn(NEED_LABEL, v);
}

// Set là cách gọi cũ (không biết loại việc); Map mang loại theo ticket id để nhãn nói rõ chờ gì.
function needIdSet(needs: ReadonlyMap<string, NeedKind> | ReadonlySet<string>): ReadonlySet<string> {
  if (needs instanceof Map) return new Set(needs.keys());
  if (needs instanceof Set) return needs;
  warnOnce("danh sách Cần bạn phải là Map hoặc Set");
  return new Set();
}

function readNeedKind(needs: ReadonlyMap<string, NeedKind> | ReadonlySet<string>, ticketId: string): NeedKind | null {
  if (!(needs instanceof Map)) {
    warnOnce("danh sách Cần bạn là Set, không rõ loại việc");
    return null;
  }
  const kind: unknown = needs.get(ticketId);
  if (isNeedKind(kind)) return kind;
  warnOnce(`${ticketId}: loại việc Cần bạn lạ (${describeKind(kind)})`);
  return null;
}

// Không String(kind): object kiểu { toString: null } làm phép chuyển chuỗi ném lỗi.
// JSON giữ nội dung để kind khác nhau trên cùng ticket vẫn mỗi loại warn một lần.
function describeKind(kind: unknown): string {
  if (typeof kind === "string") return kind;
  if (typeof kind !== "object" || kind === null) return kind === null ? "null" : typeof kind;
  try {
    const json = JSON.stringify(kind);
    if (typeof json === "string") return json.length > 60 ? `${json.slice(0, 60)}…` : json;
  } catch {
    // toJSON/getter ném, vòng lặp hoặc BigInt: chỉ còn kiểu.
  }
  return Array.isArray(kind) ? "array" : "object";
}

// Lỗi đứng sau offline/limited: phòng mất kết nối thì lỗi cũ của agent không còn là việc cần xem trước.
export function statusView(
  worker: WorkerStatus, agent: WorkerAgent, needs: ReadonlyMap<string, NeedKind> | ReadonlySet<string>, now: number,
): StatusView {
  if (!isRecord(worker)) warnOnce("worker phải là object");
  if (!isRecord(agent)) warnOnce("agent phải là object");
  const safeWorker = isRecord(worker) ? worker : ({ state: "idle" } as WorkerStatus);
  const safeAgent = isRecord(agent) ? agent : ({ ticket_id: null } as unknown as WorkerAgent);
  const { state, error } = agentStatus(safeWorker, safeAgent, needIdSet(needs), now);
  const tone: StatusTone = state === "offline" || state === "limited" ? state : error ? "error" : state;
  const activity = readAgentActivity(safeAgent).activity;
  const startedAt = (safeAgent as unknown as Record<string, unknown>).started_at;
  const at = activity ? activity.at : validIso(startedAt) ? startedAt : null;
  const ago = at === null ? null : relativeTime(at, now);
  const ticketId: unknown = safeAgent.ticket_id;
  if (tone !== "need" || typeof ticketId !== "string") return { tone, label: TONE_LABEL[tone], ago, ticketId: null, needKind: null };
  const needKind = readNeedKind(needs, ticketId);
  return { tone, label: needLabel(needKind), ago, ticketId, needKind };
}

// Thẻ chỉ là "Đang làm" khi agent thật sự đang làm; còn lại là hoạt động đã qua.
export function nowCardTitle(tone: StatusTone, hasActivity: boolean): string {
  return hasActivity && Object.hasOwn(CARD_TITLE, tone) ? CARD_TITLE[tone] : "Đang làm";
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
