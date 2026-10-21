import { describe, expect, it } from "vitest";
import type { WorkerAgent, WorkerStatus } from "../api";
import { agentKey, drawerView, resolveSelection } from "./selection";
const agent: WorkerAgent = { id: "a", role: "coder", ticket_id: "t", mode: "write", started_at: "2026-01-01T00:00:00Z" };
const worker: WorkerStatus = { name: "claude", state: "working", roles: [], agents: [agent] };
describe("selection", () => {
  it("tìm đúng phòng và lần chạy", () => {
    const key = agentKey(worker.name, agent);
    expect(resolveSelection(key, [worker])?.agent).toBe(agent);
    expect(resolveSelection(key, [{ ...worker, name: "codex" }])).toBeNull();
    expect(resolveSelection(key, [{ ...worker, agents: [{ ...agent, started_at: "2026-01-02T00:00:00Z" }] }])).toBeNull();
  });
  it.each(["offline", "limited"] as const)("phòng %s đóng lựa chọn; online không tự mở", (state) => {
    let selected: string | null = agentKey(worker.name, agent);
    const resolved = resolveSelection(selected, [{ ...worker, state }]);
    selected = resolved?.key ?? null;
    expect(selected).toBeNull();
    expect(resolveSelection(selected, [worker])).toBeNull();
  });
  it("mất agent rồi trở lại không mở nếu nơi gọi lưu kết quả null", () => {
    let selected: string | null = agentKey(worker.name, agent);
    selected = resolveSelection(selected, [{ ...worker, agents: [] }])?.key ?? null;
    expect(resolveSelection(selected, [worker])).toBeNull();
    expect(resolveSelection(agentKey(worker.name, agent), [{ ...worker, agents: undefined }])).toBeNull();
  });
  it("khoá không đụng nhau khi có ký tự phân cách", () => {
    expect(agentKey("a|b", agent)).not.toBe(agentKey("a", { ...agent, id: "b|a" }));
  });
});
describe("drawerView", () => {
  const input = { selected: null, needsCount: 1, needsDismissed: false, narrow: false };
  it.each([true, false])("quy tắc tab như nhau ở narrow=%s", (narrow) => {
    expect(drawerView({ ...input, narrow })).toEqual({ open: true, tab: "needs" });
    expect(drawerView({ ...input, narrow, needsCount: 0 })).toEqual({ open: false, tab: "needs" });
    expect(drawerView({ ...input, narrow, needsDismissed: true })).toEqual({ open: false, tab: "needs" });
    expect(drawerView({ ...input, narrow, needsDismissed: true, previousNeedsCount: 0 })).toEqual({ open: true, tab: "needs" });
    expect(drawerView({ ...input, narrow, selected: "a", needsCount: 0 })).toEqual({ open: true, tab: "agent" });
  });
});
