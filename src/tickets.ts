// Logic thuần cho ticket cần người (duyệt kế hoạch, duyệt merge, escalated): đọc phòng thủ /tickets và
// /events, chọn nút bật/tắt, ghi chú bắt buộc, dựng request /escalation và /decisions, dữ liệu demo.
// Không DOM, không fetch, không đọc giờ thật.

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

export type NeedKind = "plan" | "merge" | "escalated";

const NEED_STATUS: Record<string, NeedKind> = {
  awaiting_plan_approval: "plan",
  awaiting_merge_approval: "merge",
  escalated: "escalated",
};

export const NEED_LABEL: Record<NeedKind, string> = {
  plan: "duyệt kế hoạch",
  merge: "duyệt merge",
  escalated: "escalated",
};

export function needKind(status: string): NeedKind | null {
  return Object.hasOwn(NEED_STATUS, status) ? NEED_STATUS[status] : null;
}

function updatedMs(ticket: Ticket): number {
  return ticket.updated_at ? Date.parse(ticket.updated_at) : NaN;
}

// Mới nhất lên đầu; giờ thiếu hoặc hỏng xếp cuối. Bằng giờ thì theo id để thứ tự không nhảy qua các lần poll.
export function needsYou<T extends Ticket>(tickets: T[]): T[] {
  return tickets
    .filter((t) => needKind(t.status) !== null)
    .map((t) => ({ t, ms: updatedMs(t) }))
    .sort((a, b) => {
      const aOk = Number.isFinite(a.ms);
      const bOk = Number.isFinite(b.ms);
      if (aOk !== bOk) return aOk ? -1 : 1;
      if (aOk && a.ms !== b.ms) return b.ms - a.ms;
      return a.t.id < b.t.id ? -1 : a.t.id > b.t.id ? 1 : 0;
    })
    .map(({ t }) => t);
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

export function previewLink(ticket: Ticket): string | null {
  let url: string | null = null;
  for (const a of ticket.artifacts) if (a.kind === "preview") url = safeUrl(a.url) ?? url;
  return url;
}

export function actionAvailability(reason: string | null, ticket: Ticket): Record<EscalationAction, boolean> {
  return {
    retry_push: reason?.trimStart().startsWith(RETRY_PUSH_PREFIX) ?? false,
    merge: mergeRequest(ticket).present,
    close: true,
    fail: true,
  };
}

export type PlanDecision = "approved" | "revise" | "rejected";
export type MergeDecision = "approved" | "changes_requested" | "rejected";
export type Decision = PlanDecision | MergeDecision;
export type NeedAction = Decision | EscalationAction;

export const NEED_ACTIONS: { plan: PlanDecision[]; merge: MergeDecision[]; escalated: EscalationAction[] } = {
  plan: ["approved", "revise", "rejected"],
  merge: ["approved", "changes_requested", "rejected"],
  escalated: ESCALATION_ACTIONS,
};

// Hành động có thuộc loại ticket không: thẻ cũ sau khi ticket đổi loại không được gửi nhầm endpoint.
export function isActionOf(kind: "escalated", action: NeedAction): action is EscalationAction;
export function isActionOf(kind: "plan" | "merge", action: NeedAction): action is Decision;
export function isActionOf(kind: NeedKind, action: NeedAction): boolean;
export function isActionOf(kind: NeedKind, action: NeedAction): boolean {
  return (NEED_ACTIONS[kind] as NeedAction[]).includes(action);
}

// Duyệt kế hoạch/merge luôn bấm được (aico tự từ chối nếu trạng thái đã đổi); escalated theo lý do và MR.
export function actionsFor(kind: NeedKind, reason: string | null, ticket: Ticket): { action: NeedAction; enabled: boolean }[] {
  if (kind === "escalated") {
    const available = actionAvailability(reason, ticket);
    return ESCALATION_ACTIONS.map((action) => ({ action, enabled: available[action] }));
  }
  return NEED_ACTIONS[kind].map((action) => ({ action, enabled: true }));
}

// Trả về hay từ chối mà không nói lý do thì agent không biết sửa gì.
export function commentRequired(action: NeedAction): boolean {
  return action === "revise" || action === "changes_requested" || action === "rejected";
}

export function canSubmit(action: NeedAction, comment: string): boolean {
  return !commentRequired(action) || comment.trim() !== "";
}

// Từ chối, merge, đóng, đánh dấu lỗi không quay lại được nên xác nhận trước; duyệt, yêu cầu sửa, đẩy lại thì gửi ngay.
export function irreversible(action: NeedAction): boolean {
  return action === "rejected" || action === "close" || action === "fail" || action === "merge";
}

/** @deprecated dùng `irreversible`; giữ cho escalation-panel.ts tới khi bỏ panel cũ */
export function needsConfirm(action: EscalationAction): boolean {
  return irreversible(action);
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

function postRequest(config: ApiConfig, path: string, body: unknown): EscalationRequest {
  return {
    url: apiUrl(config, path),
    init: {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  };
}

export function buildEscalationRequest(
  config: ApiConfig,
  id: string,
  action: EscalationAction,
  actor: string,
  comment: string,
): EscalationRequest {
  return postRequest(config, ticketPath(id, "escalation"), { action, actor, comment });
}

export function buildDecisionRequest(config: ApiConfig, id: string, decision: Decision, comment: string): EscalationRequest {
  return postRequest(config, ticketPath(id, "decisions"), { decision, actor: "owner", comment });
}

// `detail` của aico là chuỗi (HTTPException) hoặc mảng {msg} (FastAPI 422); body khác thì chỉ báo mã.
function detailText(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const { detail } = body;
  if (typeof detail === "string") return detail.trim() ? detail : null;
  if (!Array.isArray(detail)) return null;
  const msgs = detail
    .map((d) => (isRecord(d) && typeof d.msg === "string" ? d.msg.trim() : ""))
    .filter((m) => m);
  return msgs.length ? msgs.join("; ") : null;
}

export function actionError(status: number, body: unknown): string {
  if (status === 401) return "Sai API token";
  const detail = status >= 400 ? detailText(body) : null;
  return detail ?? `aico trả ${status}`;
}

/** @deprecated dùng `actionError` */
export const escalationError = actionError;

// Thời gian chờ tính từ lần đổi trạng thái gần nhất; giờ tương lai (lệch đồng hồ) coi như vừa xong.
export function waitedLabel(updatedAt: string | null, now: number): string {
  const ms = updatedAt ? Date.parse(updatedAt) : NaN;
  if (!Number.isFinite(ms) || !Number.isFinite(now)) return "chưa rõ";
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `chờ ${s} giây`;
  if (s < 3600) return `chờ ${Math.floor(s / 60)} phút`;
  if (s < 86_400) {
    const m = Math.floor((s % 3600) / 60);
    return `chờ ${Math.floor(s / 3600)} giờ${m ? ` ${m} phút` : ""}`;
  }
  return `chờ ${Math.floor(s / 86_400)} ngày`;
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

// Đủ 3 loại cần người. `now` cho trước thì giờ cập nhật tính lùi từ đó để "đã chờ" trông như thật.
export function demoNeedTickets(now?: number): DemoTicket[] {
  const at = (iso: string, minutesAgo: number) =>
    now === undefined ? iso : new Date(now - minutesAgo * 60_000).toISOString();
  const [push, merge] = demoTickets();
  return [
    {
      id: "T-demo-plan",
      title: "Cột Cần bạn thay bảng nổi",
      status: "awaiting_plan_approval",
      project: "aico-office",
      artifacts: [],
      updated_at: at("2026-10-21T08:20:00Z", 2),
      reason: null,
    },
    {
      id: "T-demo-review",
      title: "Toast báo ticket cần người",
      status: "awaiting_merge_approval",
      project: "aico-office",
      artifacts: [
        { kind: "branch", ref: "aico/T-demo-review", url: null },
        { kind: "merge_request", ref: "!57", url: "https://example.com/aico-office/merge_requests/57" },
        { kind: "preview", ref: null, url: "https://example.com/aico-office/preview/57" },
      ],
      updated_at: at("2026-10-21T08:10:00Z", 12),
      reason: null,
    },
    { ...push, updated_at: at(push.updated_at!, 45) },
    { ...merge, updated_at: at(merge.updated_at!, 30) },
  ];
}

const DEMO_RESULT: { plan: Record<PlanDecision, string>; merge: Record<MergeDecision, string>; escalated: Record<EscalationAction, string> } = {
  plan: { approved: "in_progress", revise: "planning", rejected: "rejected" },
  merge: { approved: "done", changes_requested: "in_progress", rejected: "rejected" },
  escalated: { retry_push: "in_progress", merge: "done", close: "closed", fail: "failed" },
};

function demoResult(kind: NeedKind, action: NeedAction): string | null {
  if (!isActionOf(kind, action)) return null;
  return (DEMO_RESULT[kind] as Record<string, string>)[action];
}

// Đổi trạng thái giả tại chỗ: ticket rời danh sách cần người như khi aico xử lý xong.
// Ticket đã đổi loại (thẻ cũ) hoặc hành động không thuộc loại thì không đổi gì, như aico trả 409.
export function applyDemoAction<T extends Ticket>(list: T[], id: string, kind: NeedKind, action: NeedAction): T[];
/** @deprecated dạng cũ chỉ cho escalated; giữ cho main.ts tới khi ghép cột "Cần bạn" */
export function applyDemoAction<T extends Ticket>(list: T[], id: string, action: EscalationAction): T[];
export function applyDemoAction<T extends Ticket>(
  list: T[],
  id: string,
  kindOrAction: NeedKind | EscalationAction,
  maybeAction?: NeedAction,
): T[] {
  const [kind, action]: [NeedKind, NeedAction] =
    maybeAction === undefined ? ["escalated", kindOrAction as EscalationAction] : [kindOrAction as NeedKind, maybeAction];
  const status = demoResult(kind, action);
  if (status === null) return list;
  return list.map((t) => (t.id === id && needKind(t.status) === kind ? { ...t, status } : t));
}
