import type { WorkerAgent, WorkerStatus } from "../api";

// JSON tránh đụng khoá khi id hoặc tên phòng chứa dấu phân cách.
export function agentKey(room: string, agent: WorkerAgent): string {
  return JSON.stringify([room, agent.id, agent.started_at]);
}
export interface SelectedAgent { key: string; worker: WorkerStatus; agent: WorkerAgent }
export function resolveSelection(sel: string | null, workers: readonly WorkerStatus[]): SelectedAgent | null {
  if (sel === null) return null;
  for (const worker of workers) {
    if (worker.state === "offline" || worker.state === "limited") continue;
    for (const agent of Array.isArray(worker.agents) ? worker.agents : []) {
      if (agentKey(worker.name, agent) === sel) return { key: sel, worker, agent };
    }
  }
  return null;
}

export interface DrawerInput {
  selected: SelectedAgent | string | null;
  needsCount: number;
  needsDismissed: boolean;
  narrow: boolean;
  // Nơi gọi giữ số lượng lần trước để ticket mới sau khi rỗng được mở lại.
  previousNeedsCount?: number;
}
export interface DrawerView { open: boolean; tab: "agent" | "needs" }
export function drawerView(input: DrawerInput): DrawerView {
  if (input.selected !== null) return { open: true, tab: "agent" };
  const reopened = input.previousNeedsCount === 0 && input.needsCount > 0;
  return { open: input.needsCount > 0 && (!input.needsDismissed || reopened), tab: "needs" };
}
