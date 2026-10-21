import type { WorkerAgent, WorkerStatus } from "../api";
import { readAgentActivity } from "../activity";
import { relativeTime } from "../time";
import { parseUsage, shortCountdown, usageLevel, usagePercent, usageWindows } from "../usage";

export function fmtNumber(n: number | undefined | null): string {
  return new Intl.NumberFormat("vi-VN", { notation: "compact" }).format(typeof n === "number" && Number.isFinite(n) ? n : 0);
}
export function fmtAgo(iso: string | null | undefined, now: number): string {
  return iso ? relativeTime(iso, now) : "chưa chạy";
}
// UTC giữ kết quả độc lập múi giờ của máy chạy; không đọc giờ hệ thống.
export function clock(iso: string): string {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? new Date(at).toISOString().slice(11, 16) : "--:--";
}
export function providerLetter(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("claude")) return "C";
  if (lower.includes("codex")) return "X";
  if (lower.includes("cursor")) return "U";
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}
export interface UsageTileLine { label: string; percent: number; level: "ok" | "warn" | "crit"; reset: string }
export interface UsageTile { lines: UsageTileLine[]; plan: string; label: string }
export function usageTile(worker: Pick<WorkerStatus, "name" | "usage">, now: number): UsageTile {
  const usage = parseUsage(worker.usage, worker.name);
  const lines = usageWindows(usage).map((w): UsageTileLine => ({
    label: w.label === "WK" ? "Wk" : w.label.toLowerCase(),
    percent: usagePercent(w.used_percent),
    level: usageLevel(w.used_percent) === "high" ? "crit" : usageLevel(w.used_percent) as "ok" | "warn",
    reset: shortCountdown(w.resets_at, now),
  }));
  const plan = usage?.plan?.trim() || "?";
  return { lines, plan, label: lines.length ? "" : plan };
}
export type AgentState = "offline" | "limited" | "need" | "working" | "idle";
export function agentStatus(worker: WorkerStatus, agent: WorkerAgent, needIds: ReadonlySet<string>, _now: number): { state: AgentState; error: boolean } {
  const activity = readAgentActivity(agent).activity;
  const state = worker.state === "offline" || worker.state === "limited" ? worker.state
    : agent.ticket_id && needIds.has(agent.ticket_id) ? "need"
    : worker.state === "working" ? "working" : "idle";
  // Lỗi cũ vẫn cần hiển thị cho tới hoạt động tiếp theo.
  return { state, error: !!activity?.error };
}
