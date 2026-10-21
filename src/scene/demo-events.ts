// Snapshot ticket giả theo chu kỳ 48 giây. Banner demo đi qua createRoomEvents,
// không dựng RoomBanner tại đây.

import type { Ticket } from "../api";
import type { TicketAssignment } from "./room-events";

export const DEMO_EVENT_MS = 48_000;

function cycleOf(now: number): { cycle: number; second: number } {
  const time = Number.isFinite(now) ? Math.max(0, now) : 0;
  const cycle = Math.floor(time / DEMO_EVENT_MS);
  return { cycle, second: (time - cycle * DEMO_EVENT_MS) / 1000 };
}

function ticket(id: string, status: string, now: number, artifacts: Ticket["artifacts"]): Ticket {
  return {
    id,
    title: id,
    status,
    project: "aico-office",
    artifacts,
    updated_at: new Date(Number.isFinite(now) ? now : 0).toISOString(),
  };
}

// 0–12s đang làm; 12–24s có MR; 24–48s done. Codex leo thang trong 28–40s rồi trở lại đang làm.
export function demoEventTickets(now: number): Ticket[] {
  const { cycle, second } = cycleOf(now);
  const claude = `T-ev-claude-${cycle}`;
  const codex = `T-ev-codex-${cycle}`;
  const mr = second >= 12
    ? [{ kind: "merge_request", ref: `!ev${cycle}`, url: `https://example.com/aico-office/merge_requests/ev${cycle}` }]
    : [];
  return [
    ticket(claude, second >= 24 ? "done" : "in_progress", now, mr),
    ticket(codex, second >= 28 && second < 40 ? "escalated" : "in_progress", now, []),
  ];
}

export function demoEventAssignments(now: number): TicketAssignment[] {
  const { cycle } = cycleOf(now);
  return [
    { ticketId: `T-ev-claude-${cycle}`, provider: "claude" },
    { ticketId: `T-ev-codex-${cycle}`, provider: "codex" },
  ];
}
