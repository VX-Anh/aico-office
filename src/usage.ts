// Hạn mức subscription của phòng (trường `usage` của GET /workers): đọc phòng thủ và các hàm thuần
// cho thanh hạn mức và thẻ trạng thái. Không vẽ, không đọc thời gian thật: `now` do nơi gọi truyền vào.

export interface UsageWindow {
  name: string;
  window_minutes: number;
  used_percent: number;
  resets_at: string | null;
}

export interface WorkerUsage {
  checked_at: string;
  source: string | null;
  plan: string | null;
  windows: UsageWindow[];
  note: string | null;
  error: string | null;
}

export type UsageLevel = "ok" | "warn" | "high";

// Cửa sổ đã chọn để hiện: nhãn ngắn cho chữ pixel (`5H`, `WK`).
export interface LabeledWindow extends UsageWindow {
  label: string;
}

const DAY_MINUTES = 24 * 60;
const STALE_MS = 15 * 60_000;

// Ngưỡng màu; 80 là mức aico bắt đầu giao việc cho phòng khác.
export const USAGE_WARN = 60;
export const USAGE_HIGH = 80;

const warned = new Set<string>();

// Cùng dữ liệu hỏng được poll lại mỗi vài giây: chỉ warn lần đầu để không ngập console.
function reject(who: string, msg: string): null {
  const line = `${who}: ${msg}`;
  if (!warned.has(line)) {
    warned.add(line);
    console.warn(`[usage] ${line}`);
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isIso(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(v);
  if (!parts) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = parts;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // Date.parse tự dời ngày như 30/2 sang tháng sau, nên kiểm lịch trước khi đọc timestamp.
  return m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1] &&
    Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60 &&
    (offsetHour === undefined || (Number(offsetHour) < 24 && Number(offsetMinute) < 60)) &&
    Number.isFinite(Date.parse(v));
}

// Trường chuỗi tuỳ chọn: vắng hoặc null là hợp lệ, có mặt mà sai kiểu thì báo sai (undefined).
function optString(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  return typeof v === "string" ? v : undefined;
}

function parseWindow(raw: unknown): UsageWindow | string {
  if (!isRecord(raw)) return "phải là object";
  const { name, window_minutes, used_percent, resets_at } = raw;
  if (typeof name !== "string") return "name phải là chuỗi";
  if (typeof used_percent !== "number" || !Number.isFinite(used_percent) || used_percent < 0) {
    return "used_percent phải là số hữu hạn không âm";
  }
  if (typeof window_minutes !== "number" || !Number.isFinite(window_minutes) || window_minutes <= 0) {
    return "window_minutes phải là số hữu hạn dương";
  }
  if (resets_at !== null && !isIso(resets_at)) return "resets_at phải là giờ ISO hoặc null";
  return {
    name,
    window_minutes,
    used_percent,
    resets_at,
  };
}

// `null`/vắng là chưa có số liệu (worker chưa đọc xong, aico bản cũ): trả null, không warn.
// Sai kiểu thì từ chối cả cụm (null, warn một lần), không chuẩn hoá thành rỗng "hợp lệ".
// `who` (thường là tên phòng) để lời warn chỉ rõ phòng nào.
export function parseUsage(raw: unknown, who = "usage"): WorkerUsage | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) return reject(who, "usage phải là object");
  if (!isIso(raw.checked_at)) return reject(who, "checked_at thiếu hoặc không phải giờ ISO");
  if (!Array.isArray(raw.windows)) return reject(who, "windows phải là mảng");
  const fields = { source: optString(raw.source), plan: optString(raw.plan), note: optString(raw.note), error: optString(raw.error) };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) return reject(who, `${key} phải là chuỗi`);
  }
  const windows: UsageWindow[] = [];
  for (let i = 0; i < raw.windows.length; i++) {
    const w = parseWindow(raw.windows[i]);
    if (typeof w === "string") return reject(who, `windows[${i}]: ${w}`);
    windows.push(w);
  }
  return {
    checked_at: raw.checked_at,
    source: fields.source ?? null,
    plan: fields.plan ?? null,
    windows,
    note: fields.note ?? null,
    error: fields.error ?? null,
  };
}

// Chỉ phân loại theo thời lượng đã được kiểm tra, không đoán từ tên cửa sổ.
function isLong(w: UsageWindow): boolean {
  return w.window_minutes >= DAY_MINUTES;
}

function shortLabel(w: UsageWindow): string {
  return `${Math.max(1, Math.round(w.window_minutes / 60))}H`;
}

// Tối đa 2 cửa sổ (bảng trên tường chỉ có 2 hàng): ngắn nhất dưới 1 ngày, rồi dài nhất từ 1 ngày.
export function usageWindows(u: WorkerUsage | null): LabeledWindow[] {
  if (!u) return [];
  const minutes = (w: UsageWindow) => w.window_minutes;
  const short = u.windows.filter((w) => !isLong(w)).sort((a, b) => minutes(a) - minutes(b))[0];
  const long = u.windows.filter(isLong).sort((a, b) => minutes(b) - minutes(a))[0];
  const out: LabeledWindow[] = [];
  if (short) out.push({ ...short, label: shortLabel(short) });
  if (long) out.push({ ...long, label: "WK" });
  return out;
}

// Phần trăm để hiện: kẹp 0..100 (CLI có lúc báo vượt 100), làm tròn cho chữ pixel.
export function usagePercent(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.round(Math.min(100, Math.max(0, pct)));
}

export function usageLevel(pct: number): UsageLevel {
  const p = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  return p >= USAGE_HIGH ? "high" : p >= USAGE_WARN ? "warn" : "ok";
}

// Đếm ngược kiểu biển hết hạn mức: `47M`, `1H05`; đã qua giờ thì `0M`, không rõ giờ thì `?`.
export function shortCountdown(iso: string | null | undefined, now: number): string {
  if (!iso) return "?";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "?";
  const m = Math.max(0, Math.ceil((at - now) / 60000));
  return m < 60 ? `${m}M` : `${Math.floor(m / 60)}H${String(m % 60).padStart(2, "0")}`;
}

// Số liệu cũ hơn 15 phút (đúng 15 phút chưa tính); giờ đọc không được thì coi như cũ.
export function isStale(checkedAt: string, now: number): boolean {
  const at = Date.parse(checkedAt);
  return Number.isNaN(at) || now - at > STALE_MS;
}
