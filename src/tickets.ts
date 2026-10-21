// Logic thuần cho bảng ticket escalated: đọc phòng thủ dữ liệu /tickets và /events, chọn nút bật/tắt,
// dựng request POST /tickets/{id}/escalation, dữ liệu demo. Không DOM, không fetch, không đọc giờ thật.

import type { ApiConfig, EscalationAction, Ticket, TicketArtifact } from "./api";

export const ESCALATION_ACTIONS: EscalationAction[] = ["retry_push", "merge", "close", "fail"];

// aico ghi lý do bằng tiền tố này khi escalate vì push lỗi: chỉ lúc đó đẩy lại mới có nghĩa.
export const RETRY_PUSH_PREFIX = "đẩy code lên Git lỗi";

const warned = new Set<string>();

// /tickets được poll lại mỗi vài giây: cùng lỗi chỉ warn lần đầu để không ngập console.
function warnOnce(who: string, msg: string): void {
  const line = `${who}: ${msg}`;
  if (!warned.has(line)) {
    warned.add(line);
    console.warn(`[tickets] ${line}`);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Trường chuỗi tuỳ chọn: vắng hoặc null là hợp lệ, có mặt mà sai kiểu thì báo sai (undefined).
function optString(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  return typeof v === "string" ? v : undefined;
}

function parseArtifact(raw: unknown): TicketArtifact | string {
  if (!isRecord(raw)) return "phải là object";
  if (typeof raw.kind !== "string") return "kind phải là chuỗi";
  const ref = optString(raw.ref);
  const url = optString(raw.url);
  if (ref === undefined) return "ref phải là chuỗi hoặc null";
  if (url === undefined) return "url phải là chuỗi hoặc null";
  return { kind: raw.kind, ref, url };
}

function parseTicket(raw: unknown, who: string, index: number): Ticket | null {
  if (!isRecord(raw)) {
    warnOnce(who, `phần tử ${index} phải là object, bỏ qua`);
    return null;
  }
  const { id, title, status } = raw;
  if (typeof id !== "string" || !id) {
    warnOnce(who, `phần tử ${index} thiếu id dạng chuỗi, bỏ qua`);
    return null;
  }
  if (typeof title !== "string" || typeof status !== "string") {
    warnOnce(who, `${id}: title và status phải là chuỗi, bỏ qua`);
    return null;
  }
  const project = optString(raw.project);
  const updated_at = optString(raw.updated_at);
  if (project === undefined || updated_at === undefined) {
    warnOnce(who, `${id}: project và updated_at phải là chuỗi hoặc null, bỏ qua`);
    return null;
  }
  // artifacts vắng là aico bản cũ; sai kiểu thì không đoán MR (Merge tắt) nhưng vẫn hiện ticket.
  const artifacts: TicketArtifact[] = [];
  if (Array.isArray(raw.artifacts)) {
    raw.artifacts.forEach((a, i) => {
      const parsed = parseArtifact(a);
      if (typeof parsed === "string") warnOnce(who, `${id}: artifact ${i} ${parsed}, bỏ qua`);
      else artifacts.push(parsed);
    });
  } else if (raw.artifacts !== undefined && raw.artifacts !== null) {
    warnOnce(who, `${id}: artifacts phải là mảng, coi như chưa có MR`);
  }
  return { id, title, status, project, artifacts, updated_at };
}

// Không phải mảng thì từ chối cả danh sách (null) để nơi gọi giữ danh sách cũ.
// Phần tử hỏng thì bỏ riêng phần tử đó; mỗi lỗi chỉ warn một lần.
export function parseTickets(raw: unknown, who = "tickets"): Ticket[] | null {
  if (!Array.isArray(raw)) {
    warnOnce(who, "danh sách ticket phải là mảng");
    return null;
  }
  const out: Ticket[] = [];
  raw.forEach((item, i) => {
    const t = parseTicket(item, who, i);
    if (t) out.push(t);
  });
  return out;
}

export function escalatedOnly(tickets: Ticket[]): Ticket[] {
  return tickets.filter((t) => t.status === "escalated");
}

// Lý do chỉ tải lại khi ticket đổi: khoá theo id + updated_at.
export function reasonKey(ticket: Ticket): string {
  return `${ticket.id}@${ticket.updated_at ?? ""}`;
}

export interface TicketWithReason {
  ticket: Ticket;
  reason: string | null;
}

// Cache lý do theo reasonKey; `load` là lời gọi /events được tiêm vào. Chỉ cache kết quả thành công:
// lỗi mạng, HTTP lỗi hay /events hỏng thì lượt đó trả null và lượt poll sau hỏi lại, nếu không
// Đẩy lại sẽ tắt mãi tới khi ticket đổi updated_at. Các lượt chồng nhau dùng chung một request.
export function createReasonCache(load: (id: string) => Promise<string | null>) {
  const entries = new Map<string, Promise<string | null>>();
  return {
    resolve(tickets: Ticket[]): Promise<TicketWithReason[]> {
      const keys = new Set(tickets.map(reasonKey));
      for (const key of entries.keys()) if (!keys.has(key)) entries.delete(key);
      return Promise.all(tickets.map(async (ticket) => {
        const key = reasonKey(ticket);
        let entry = entries.get(key);
        if (!entry) {
          const pending = load(ticket.id);
          entries.set(key, pending);
          // request cũ lỗi muộn không được xoá request mới hơn của cùng khoá
          pending.catch(() => {
            if (entries.get(key) === pending) entries.delete(key);
          });
          entry = pending;
        }
        return { ticket, reason: await entry.catch(() => null) };
      }));
    },
  };
}

// Lý do của lần escalate mới nhất. Mọi event escalated đều có created_at hợp lệ thì chọn theo giờ
// (bằng giờ thì lấy cái sau trong mảng); thiếu giờ thì tin thứ tự của aico (cuối mảng là mới nhất).
// Lần mới nhất không có data.reason dạng chuỗi thì trả null, không lùi về lý do cũ.
export function latestEscalationReason(events: unknown, who = "events"): string | null {
  if (!Array.isArray(events)) {
    warnOnce(who, "danh sách event phải là mảng");
    return null;
  }
  const escalated = events.filter((e): e is Record<string, unknown> => isRecord(e) && e.to_status === "escalated");
  if (!escalated.length) return null;
  const times = escalated.map((e) => (typeof e.created_at === "string" ? Date.parse(e.created_at) : NaN));
  let latest = escalated[escalated.length - 1];
  if (times.every(Number.isFinite)) {
    let best = 0;
    times.forEach((t, i) => {
      if (t >= times[best]) best = i;
    });
    latest = escalated[best];
  }
  const data = latest.data;
  return isRecord(data) && typeof data.reason === "string" ? data.reason : null;
}

// Chỉ nhận link http/https: url lấy từ API, không để `javascript:` lọt vào thẻ <a>.
function safeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

export function mergeRequest(ticket: Ticket): { present: boolean; url: string | null } {
  const mrs = ticket.artifacts.filter((a) => a.kind === "merge_request");
  let url: string | null = null;
  for (const a of mrs) url = safeUrl(a.url) ?? url;
  return { present: mrs.length > 0, url };
}

export function actionAvailability(reason: string | null, ticket: Ticket): Record<EscalationAction, boolean> {
  return {
    retry_push: reason?.trimStart().startsWith(RETRY_PUSH_PREFIX) ?? false,
    merge: mergeRequest(ticket).present,
    close: true,
    fail: true,
  };
}

// Đẩy lại không mất gì nên gửi ngay; merge, đóng, đánh dấu lỗi khó quay lại nên hỏi trước.
export function needsConfirm(action: EscalationAction): boolean {
  return action !== "retry_push";
}

export function apiUrl(config: ApiConfig, path: string): string {
  return `${config.baseUrl.replace(/\/$/, "")}${path}`;
}

export function ticketPath(id: string, suffix: string): string {
  return `/tickets/${encodeURIComponent(id)}/${suffix}`;
}

export interface EscalationRequest {
  url: string;
  init: { method: "POST"; headers: Record<string, string>; body: string };
}

export function buildEscalationRequest(
  config: ApiConfig,
  id: string,
  action: EscalationAction,
  actor: string,
  comment: string,
): EscalationRequest {
  return {
    url: apiUrl(config, ticketPath(id, "escalation")),
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, actor, comment }),
    },
  };
}

// 409 (trạng thái không cho phép) và 501 (aico chưa hỗ trợ) có `detail` đọc được cho người dùng.
export function escalationError(status: number, body: unknown): string {
  if (status === 401) return "Sai API token";
  if ((status === 409 || status === 501) && isRecord(body) && typeof body.detail === "string" && body.detail.trim()) {
    return body.detail;
  }
  return `aico trả ${status}`;
}

// Demo: ticket kèm lý do có sẵn, vì không có /events để hỏi.
export interface DemoTicket extends Ticket {
  reason: string | null;
}

export function demoTickets(): DemoTicket[] {
  return [
    {
      id: "T-demo-push",
      title: "Thêm thanh hạn mức tuần",
      status: "escalated",
      project: "aico-office",
      artifacts: [{ kind: "branch", ref: "aico/T-demo-push", url: null }],
      updated_at: "2026-10-21T08:00:00Z",
      reason: `${RETRY_PUSH_PREFIX}: remote từ chối (non-fast-forward)`,
    },
    {
      id: "T-demo-merge",
      title: "Sửa đường đi khi đổi số bàn",
      status: "escalated",
      project: "aico-office",
      artifacts: [{ kind: "merge_request", ref: "!42", url: "https://example.com/aico-office/merge_requests/42" }],
      updated_at: "2026-10-21T08:05:00Z",
      reason: "reviewer từ chối 3 lần, cần người quyết",
    },
  ];
}

const DEMO_RESULT: Record<EscalationAction, string> = {
  retry_push: "in_progress",
  merge: "done",
  close: "closed",
  fail: "failed",
};

// Đổi trạng thái giả tại chỗ: ticket rời danh sách escalated như khi aico xử lý xong.
export function applyDemoAction<T extends Ticket>(list: T[], id: string, action: EscalationAction): T[] {
  return list.map((t) => (t.id === id ? { ...t, status: DEMO_RESULT[action] } : t));
}
