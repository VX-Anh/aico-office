import type { WorkerStatus } from "../api";
import type { NeedItem } from "../needs-column";
import { readAgentActivity } from "../activity";
import { NEED_LABEL } from "../tickets";

export interface FeedLine {
  key: string;
  at: string;
  room: string;
  agentId: string | null;
  name: string;
  icon: string;
  text: string;
}
export interface FeedState {
  lines: FeedLine[];
  seen: ReadonlyMap<string, number>;
  needs: ReadonlyMap<string, NeedItem>;
  floor: number;
  sequence: number;
}
export function createFeedState(): FeedState {
  return { lines: [], seen: new Map(), needs: new Map(), floor: -Infinity, sequence: 0 };
}
export function resetFeed(): FeedState { return createFeedState(); }

export function reduceFeed(state: FeedState, workers: readonly WorkerStatus[], needItems: readonly NeedItem[], now: number, max = 100): FeedState {
  const seen = new Map(state.seen), lines = [...state.lines];
  let sequence = state.sequence;
  const add = (line: FeedLine) => {
    const at = Date.parse(line.at);
    if (!Number.isFinite(at) || at < state.floor || seen.has(line.key)) return;
    seen.set(line.key, at);
    lines.push(line);
  };
  for (const worker of workers) {
    if (worker.state === "offline" || worker.state === "limited") continue;
    for (const agent of Array.isArray(worker.agents) ? worker.agents : []) {
      for (const a of readAgentActivity(agent, `${worker.name}/${agent.id}`).recent ?? []) {
        add({ key: JSON.stringify([worker.name, agent.id, a.at, a.text]), at: a.at,
          room: worker.name, agentId: agent.id, name: agent.role || agent.id, icon: a.icon, text: a.text });
      }
    }
  }
  const needs = new Map(needItems.map((item) => [item.ticket.id, item]));
  const ticketLine = (item: NeedItem, resolved: boolean) => {
    if (!Number.isFinite(now)) return;
    const at = new Date(now).toISOString();
    add({ key: `ticket:${++sequence}`, at, room: "", agentId: null, name: item.ticket.id,
      icon: resolved ? "✓" : "!", text: `${item.ticket.title}: ${resolved ? "đã xử lý" : NEED_LABEL[item.kind]}` });
  };
  for (const [id, item] of needs) {
    if (state.needs.get(id)?.kind !== item.kind) ticketLine(item, false);
  }
  for (const [id, item] of state.needs) if (!needs.has(id)) ticketLine(item, true);
  lines.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 100;
  const kept = limit ? lines.slice(-limit) : [];
  // Giữ các khoá cùng timestamp ở biên để không phát lại khi nhiều dòng trùng giờ.
  const floor = kept.length ? Math.max(state.floor, Date.parse(kept[0].at))
    : lines.length ? Math.max(state.floor, ...lines.map((line) => Date.parse(line.at))) : state.floor;
  for (const [key, at] of seen) if (at < floor) seen.delete(key);
  return { lines: kept, seen, needs, floor, sequence };
}
