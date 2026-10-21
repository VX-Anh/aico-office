// So sánh hai snapshot ticket: MR mới, chuyển done, chuyển escalated.
// Baseline lần đầu không phát lại lịch sử. Ticket biến mất không bị coi là done.
// Ánh xạ ticket → phòng được nhớ lại để agent rời trước poll vẫn gắn đúng phòng.

import type { Ticket, TicketArtifact } from "../api";

export const BANNER_MS = 10_000;
export const MAX_QUEUE = 8;
export const MAX_HISTORY = 64;

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
  named: Set<string>;
  anon: number;
}

interface Pending {
  key: string;
  provider: string;
  ticket: string;
  kind: BannerKind;
}

function artifactKey(artifact: TicketArtifact): string | null {
  if (artifact.kind !== "merge_request") return null;
  const ref = typeof artifact.ref === "string" ? artifact.ref.trim() : "";
  const url = typeof artifact.url === "string" ? artifact.url.trim() : "";
  if (ref) return `ref:${ref}`;
  if (url) return `url:${url}`;
  return "";
}

function capture(ticket: Ticket): Memory | null {
  if (!ticket || typeof ticket.id !== "string" || !ticket.id || typeof ticket.status !== "string") return null;
  const named = new Set<string>();
  let anon = 0;
  const artifacts = Array.isArray(ticket.artifacts) ? ticket.artifacts : [];
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object") continue;
    const key = artifactKey(artifact);
    if (key === null) continue;
    if (key) named.add(key);
    else anon += 1;
  }
  return { status: ticket.status, named, anon };
}

function mergeMemory(prev: Memory, next: Memory): Memory {
  const named = new Set(prev.named);
  for (const id of next.named) named.add(id);
  return { status: next.status, named, anon: Math.max(prev.anon, next.anon) };
}

export function createRoomEvents() {
  let primed = false;
  const memories = new Map<string, Memory>();
  const providers = new Map<string, Set<string>>();
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
      let set = providers.get(item.ticketId);
      if (!set) providers.set(item.ticketId, (set = new Set()));
      set.add(item.provider);
    }
  }

  function emit(ticket: Ticket, prev: Memory, next: Memory, now: number): void {
    const rooms = providers.get(ticket.id);
    if (!rooms || rooms.size === 0) return;
    for (const id of next.named) {
      if (prev.named.has(id)) continue;
      for (const provider of rooms) {
        accept({ key: `${provider}|${ticket.id}|mr|${id}`, provider, ticket: ticket.id, kind: "mr" }, now);
      }
    }
    const freshAnon = Math.max(0, next.anon - prev.anon);
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
    reset(): void {
      primed = false;
      memories.clear();
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
          if (memory) memories.set(ticket.id, memory);
        }
        primed = true;
        return tick(now);
      }
      for (const ticket of byId.values()) {
        const next = capture(ticket);
        if (!next) continue;
        const prev = memories.get(ticket.id);
        if (prev) emit(ticket, prev, next, now);
        memories.set(ticket.id, prev ? mergeMemory(prev, next) : next);
      }
      return tick(now);
    },
  };
}
