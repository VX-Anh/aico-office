// So sánh hai snapshot ticket: MR mới, chuyển done, chuyển escalated.
// Baseline lần đầu không phát lại lịch sử. Ticket biến mất không bị coi là done.
// Ánh xạ ticket → phòng được nhớ lại để agent rời trước poll vẫn gắn đúng phòng.

import type { Ticket, TicketArtifact } from "../api";

export const BANNER_MS = 10_000;
export const MAX_QUEUE = 8;
export const MAX_HISTORY = 64;
// Cửa sổ LRU chung cho snapshot và ánh xạ; ticket bị loại trở lại làm baseline.
export const MAX_TICKETS = 512;
// Chạm trần thì ngừng banner MR cho ticket này để không quên rồi phát lại MR cũ.
// done/escalated vẫn hoạt động; reset hoặc loại ticket khỏi LRU sẽ xoá cờ.
export const MAX_MRS = 64;

export type BannerKind = "mr" | "done" | "escalated";

export interface RoomBanner {
  key: string;
  provider: string;
  ticket: string;
  kind: BannerKind;
  startedAt: number;
  expiresAt: number;
}

export interface TicketAssignment {
  ticketId: string;
  provider: string;
}

export interface RoomEventInput {
  tickets: readonly Ticket[];
  assignments: readonly TicketAssignment[];
  now: number;
}

const RANK: Record<BannerKind, number> = { mr: 1, done: 2, escalated: 3 };

export function bannerText(kind: BannerKind, ticket: string): string {
  if (kind === "mr") return `MR mở: ${ticket}`;
  if (kind === "done") return `Đã merge ${ticket}`;
  return `Leo thang: ${ticket}`;
}

interface Memory {
  status: string;
  /** Mọi định danh MR đã thấy (ref: và url:); một MR có thể có cả hai. */
  named: Set<string>;
  /** Định danh của từng MR trong snapshot này (để biết MR nào mới). */
  mrs: string[][];
  anon: number;
  saturated: boolean;
}

interface Pending {
  key: string;
  provider: string;
  ticket: string;
  kind: BannerKind;
}

// Mọi định danh của một MR: aico có thể bổ sung hoặc bỏ ref/url giữa hai lần poll, nên một MR
// được nhận ra qua bất kỳ định danh nào đã thấy (không chỉ định danh ưu tiên). [] = MR không tên.
function artifactKeys(artifact: TicketArtifact): string[] | null {
  if (artifact.kind !== "merge_request") return null;
  const ref = typeof artifact.ref === "string" ? artifact.ref.trim() : "";
  const url = typeof artifact.url === "string" ? artifact.url.trim() : "";
  return [...(ref ? [`ref:${ref}`] : []), ...(url ? [`url:${url}`] : [])];
}

function capture(ticket: Ticket): Memory | null {
  if (!ticket || typeof ticket.id !== "string" || !ticket.id || typeof ticket.status !== "string") return null;
  const named = new Set<string>();
  const mrs: string[][] = [];
  let anon = 0;
  const artifacts = Array.isArray(ticket.artifacts) ? ticket.artifacts : [];
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object") continue;
    const keys = artifactKeys(artifact);
    if (keys === null) continue;
    if (keys.length && mrs.length < MAX_MRS) {
      mrs.push(keys);
      for (const key of keys) named.add(key);
    } else if (!keys.length) anon = Math.min(MAX_MRS, anon + 1);
  }
  return { status: ticket.status, named, mrs, anon, saturated: mrs.length >= MAX_MRS || anon >= MAX_MRS };
}

function mergeMemory(prev: Memory, next: Memory): Memory {
  const named = new Set(prev.named);
  // Mỗi MR tối đa 2 định danh (ref, url): trần gấp đôi số MR.
  for (const id of next.named) {
    if (named.size < MAX_MRS * 2) named.add(id);
  }
  return {
    status: next.status, named, mrs: next.mrs, anon: Math.max(prev.anon, next.anon),
    saturated: prev.saturated || next.saturated || named.size >= MAX_MRS * 2,
  };
}

export function createRoomEvents() {
  let primed = false;
  const memories = new Map<string, Memory>();
  const providers = new Map<string, Set<string>>();
  const recent = new Map<string, true>();
  function touch(ticketId: string): void {
    recent.delete(ticketId);
    recent.set(ticketId, true);
  }
  // Giới hạn bộ nhớ sau mỗi lượt (không loại giữa lượt, kẻo ticket sau mất lịch sử để so sánh);
  // loại ticket cũ nhất không gắn phòng trước, vì chỉ ticket có phòng mới sinh banner.
  function trim(): void {
    const excess = recent.size - MAX_TICKETS;
    if (excess <= 0) return;
    const victims: string[] = [];
    for (const id of recent.keys()) {
      if (victims.length >= excess) break;
      if (!providers.has(id)) victims.push(id);
    }
    for (const id of recent.keys()) {
      if (victims.length >= excess) break;
      if (!victims.includes(id)) victims.push(id);
    }
    for (const id of victims) {
      recent.delete(id);
      memories.delete(id);
      providers.delete(id);
    }
  }
  const seen = new Set<string>();
  const history: string[] = [];
  const queue: Pending[] = [];
  const active = new Map<string, RoomBanner>();

  function remember(key: string): boolean {
    if (seen.has(key)) return false;
    seen.add(key);
    history.push(key);
    while (history.length > MAX_HISTORY) {
      const old = history.shift();
      if (old) seen.delete(old);
    }
    return true;
  }

  function show(ev: Pending, now: number): void {
    active.set(ev.provider, { ...ev, startedAt: now, expiresAt: now + BANNER_MS });
  }

  function trimQueue(): void {
    while (queue.length > MAX_QUEUE) {
      let drop = 0;
      for (let i = 1; i < queue.length; i++) {
        const worse = RANK[queue[i].kind] < RANK[queue[drop].kind];
        const newerTie = RANK[queue[i].kind] === RANK[queue[drop].kind];
        if (worse || newerTie) drop = i;
      }
      queue.splice(drop, 1);
    }
  }

  function accept(ev: Pending, now: number): void {
    if (!remember(ev.key)) return;
    const expired = active.get(ev.provider);
    if (expired && now >= expired.expiresAt) active.delete(ev.provider);
    const current = active.get(ev.provider);
    if (!current) {
      show(ev, now);
      return;
    }
    if (RANK[ev.kind] > RANK[current.kind]) {
      queue.unshift({ key: current.key, provider: current.provider, ticket: current.ticket, kind: current.kind });
      show(ev, now);
      trimQueue();
      return;
    }
    queue.push(ev);
    trimQueue();
  }

  function promote(now: number): void {
    const rooms = new Set(queue.map((item) => item.provider));
    for (const provider of rooms) {
      if (active.has(provider)) continue;
      let best = -1;
      queue.forEach((item, index) => {
        if (item.provider !== provider) return;
        if (best < 0 || RANK[item.kind] > RANK[queue[best].kind]) best = index;
      });
      if (best < 0) continue;
      const [ev] = queue.splice(best, 1);
      show(ev, now);
    }
  }

  function tick(now: number): RoomBanner[] {
    if (!Number.isFinite(now)) return [...active.values()].map((banner) => ({ ...banner }));
    for (const [provider, banner] of active) {
      if (now >= banner.expiresAt) active.delete(provider);
    }
    promote(now);
    return [...active.values()].map((banner) => ({ ...banner }));
  }

  function rememberProviders(assignments: readonly TicketAssignment[]): void {
    for (const item of assignments) {
      if (!item || typeof item.ticketId !== "string" || !item.ticketId) continue;
      if (typeof item.provider !== "string" || !item.provider) continue;
      touch(item.ticketId);
      let set = providers.get(item.ticketId);
      if (!set) providers.set(item.ticketId, (set = new Set()));
      if (set.size < MAX_HISTORY) set.add(item.provider);
    }
  }

  function emit(ticket: Ticket, prev: Memory, next: Memory, now: number): void {
    const rooms = providers.get(ticket.id);
    if (!rooms || rooms.size === 0) return;
    for (const keys of next.mrs) {
      // MR đã thấy dưới bất kỳ định danh nào thì không phải MR mới.
      if (prev.saturated || keys.some((key) => prev.named.has(key))) continue;
      const id = keys[0];
      for (const provider of rooms) {
        accept({ key: `${provider}|${ticket.id}|mr|${id}`, provider, ticket: ticket.id, kind: "mr" }, now);
      }
    }
    const freshAnon = prev.saturated ? 0 : Math.max(0, next.anon - prev.anon);
    for (let i = 0; i < freshAnon; i++) {
      const id = `anon:${prev.anon + i}`;
      for (const provider of rooms) {
        accept({ key: `${provider}|${ticket.id}|mr|${id}`, provider, ticket: ticket.id, kind: "mr" }, now);
      }
    }
    if (prev.status !== "done" && next.status === "done") {
      for (const provider of rooms) {
        accept({ key: `${provider}|${ticket.id}|done`, provider, ticket: ticket.id, kind: "done" }, now);
      }
    }
    if (prev.status !== "escalated" && next.status === "escalated") {
      for (const provider of rooms) {
        accept({ key: `${provider}|${ticket.id}|escalated`, provider, ticket: ticket.id, kind: "escalated" }, now);
      }
    }
  }

  return {
    tick,
    rememberAssignments(assignments: readonly TicketAssignment[]): void {
      rememberProviders(assignments);
      trim();
    },
    reset(): void {
      primed = false;
      memories.clear();
      recent.clear();
      providers.clear();
      seen.clear();
      history.length = 0;
      queue.length = 0;
      active.clear();
    },
    observe(input: RoomEventInput): RoomBanner[] {
      if (!Number.isFinite(input.now)) return tick(input.now);
      const now = input.now;
      rememberProviders(Array.isArray(input.assignments) ? input.assignments : []);
      const byId = new Map<string, Ticket>();
      for (const ticket of Array.isArray(input.tickets) ? input.tickets : []) {
        if (ticket && typeof ticket.id === "string" && ticket.id) byId.set(ticket.id, ticket);
      }
      if (!primed) {
        for (const ticket of byId.values()) {
          const memory = capture(ticket);
          if (memory) {
            touch(ticket.id);
            memories.set(ticket.id, memory);
          }
        }
        primed = true;
        trim();
        return tick(now);
      }
      for (const ticket of byId.values()) {
        const next = capture(ticket);
        if (!next) continue;
        touch(ticket.id);
        const prev = memories.get(ticket.id);
        if (prev) emit(ticket, prev, next, now);
        memories.set(ticket.id, prev ? mergeMemory(prev, next) : next);
      }
      trim();
      return tick(now);
    },
  };
}
