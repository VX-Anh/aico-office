import type { WorkerAgent, WorkerStatus } from "../api";
import { readAgentActivity } from "../activity";
import { relativeTime } from "../time";
import { parseUsage, shortCountdown, usageLevel, usagePercent, usageWindows } from "../usage";

export function fmtNumber(n: number | undefined | null): string {
  return new Intl.NumberFormat("vi-VN", { notation: "compact" }).format(typeof n === "number" && Number.isFinite(n) ? n : 0);
}
// Compact của ICU không cố định "1,12 triệu". Tự chia nghìn/triệu, tối đa hai số lẻ, bỏ số 0 cuối.
export function fmtTokenCount(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  let value = Math.abs(n);
  let unit: "" | "nghìn" | "triệu" = "";
  if (value >= 1_000_000) {
    value = Math.round(value / 10_000) / 100;
    unit = "triệu";
  } else if (value >= 1_000) {
    value = Math.round(value / 10) / 100;
    unit = "nghìn";
  } else {
    value = Math.round(value * 100) / 100;
  }
  // 999.995 nghìn làm tròn thành 1 triệu, không thành "1000 nghìn".
  if (unit === "nghìn" && value >= 1_000) {
    value /= 1_000;
    unit = "triệu";
  } else if (unit === "" && value >= 1_000) {
    value = 1;
    unit = "nghìn";
  }
  const text = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value);
  return unit ? `${sign}${text} ${unit}` : sign + text;
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

export interface TokenStatsLine {
  text: string;
  cacheSuffix: string | null;
  level: "ok" | "warn" | "crit" | null;
}

// Kiểu cấu trúc, không import AgentStats: tokens_cached nullable để làm song song với phần đọc dữ liệu.
export interface TokenStatsInput {
  tool_calls?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  tokens_cached?: number | null;
}

function finiteCount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function legacyCount(value: number | null | undefined): string {
  const n = finiteCount(value);
  return n === null ? "chưa có" : n.toLocaleString("vi-VN");
}

function tokenOrMissing(value: number | null): string {
  return value === null ? "chưa có" : fmtTokenCount(value);
}

// Có cache thì nghìn/triệu và dòng Token mới. Thiếu cache giữ số đầy đủ như drawer và tooltip cũ.
// Màu chỉ gắn hậu tố, theo tỉ lệ trước khi làm tròn phần trăm (69,5% hiện 70% nhưng vẫn warn).
export function tokenStatsLines(stats: TokenStatsInput | null | undefined): TokenStatsLine[] {
  const tool: TokenStatsLine = { text: `Lần gọi tool: ${legacyCount(stats?.tool_calls)}`, cacheSuffix: null, level: null };
  const cached = finiteCount(stats?.tokens_cached);
  const tokensIn = finiteCount(stats?.tokens_in);
  const tokensOut = finiteCount(stats?.tokens_out);
  if (cached === null) {
    return [
      tool,
      { text: `Token vào: ${legacyCount(tokensIn)}`, cacheSuffix: null, level: null },
      { text: `Token ra: ${legacyCount(tokensOut)}`, cacheSuffix: null, level: null },
    ];
  }
  let cacheSuffix: string | null = null;
  let level: TokenStatsLine["level"] = null;
  if (tokensIn !== null && tokensIn > 0) {
    const capped = Math.min(cached, tokensIn);
    const ratio = capped / tokensIn;
    cacheSuffix = ` (${Math.round((capped * 100) / tokensIn)}% từ cache)`;
    level = ratio >= 0.7 ? "ok" : ratio >= 0.4 ? "warn" : "crit";
  }
  const fresh = tokensIn === null ? null : Math.max(0, tokensIn - cached);
  return [
    tool,
    { text: `Token vào: ${tokenOrMissing(tokensIn)}`, cacheSuffix, level },
    { text: `Token mới: ${tokenOrMissing(fresh)}`, cacheSuffix: null, level: null },
    { text: `Token ra: ${tokenOrMissing(tokensOut)}`, cacheSuffix: null, level: null },
  ];
}
