import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerAgent, WorkerStatus } from "../api";
import { recentRows, roomStateLabel, statusView, taskChecklist } from "./drawer-model";

const now = Date.parse("2026-01-01T10:00:00Z");
const agent: WorkerAgent = { id: "a", role: "coder", ticket_id: "t", mode: "write", started_at: "2026-01-01T09:50:00Z" };
const worker: WorkerStatus = { name: "claude", state: "working", roles: [], agents: [agent] };
const act = (at: string, extra: Record<string, unknown> = {}) => ({ kind: "edit", text: `Sửa ${at}`, at, ...extra });
const tasks = (n: number, done = 0) => Array.from({ length: n }, (_, i) => ({
  id: `t${i}`, title: `Việc ${i}`, status: i < done ? "completed" : i === done ? "in_progress" : "pending",
}));

afterEach(() => vi.restoreAllMocks());

describe("statusView", () => {
  it.each([
    ["offline", { ...worker, state: "offline" }, new Set(["t"]), "Mất kết nối"],
    ["limited", { ...worker, state: "limited" }, new Set(["t"]), "Hết hạn mức"],
    ["need", worker, new Set(["t"]), "Chờ"],
    ["working", worker, new Set<string>(), "Đang làm"],
    ["idle", { ...worker, state: "idle" }, new Set<string>(), "Rảnh"],
  ] as const)("tone %s", (tone, w, needs, label) => {
    expect(statusView(w as WorkerStatus, agent, needs, now)).toEqual({ tone, label, ago: "10 phút trước" });
  });
  it("lỗi đứng sau offline/limited nhưng trước need, working, idle", () => {
    const failed = { ...agent, activity: act("2026-01-01T09:59:00Z", { kind: "error" }) } as WorkerAgent;
    for (const [state, needs] of [["working", new Set(["t"])], ["working", new Set<string>()], ["idle", new Set<string>()]] as const) {
      expect(statusView({ ...worker, state }, failed, needs, now)).toEqual({ tone: "error", label: "Lỗi", ago: "1 phút trước" });
    }
    expect(statusView({ ...worker, state: "offline" }, failed, new Set(), now).tone).toBe("offline");
    expect(statusView({ ...worker, state: "limited" }, failed, new Set(), now).tone).toBe("limited");
  });
  it("cờ lỗi cũ vẫn đỏ dù activity đã cũ và kind không phải error", () => {
    const old = { ...agent, activity: act("2026-01-01T08:00:00Z", { error: true }) } as WorkerAgent;
    expect(statusView(worker, old, new Set(), now)).toEqual({ tone: "error", label: "Lỗi", ago: "2 giờ trước" });
  });
  it("ago từ activity.at, không có thì started_at, không có cả hai thì null", () => {
    expect(statusView(worker, { ...agent, activity: act("2026-01-01T09:59:48Z") } as WorkerAgent, new Set(), now).ago).toBe("12 giây trước");
    expect(statusView(worker, agent, new Set(), now).ago).toBe("10 phút trước");
    expect(statusView(worker, { ...agent, started_at: undefined } as unknown as WorkerAgent, new Set(), now).ago).toBeNull();
  });
  it("thời gian tương lai ra 'vừa xong'; started_at hỏng thì null", () => {
    expect(statusView(worker, { ...agent, activity: act("2026-01-01T10:00:30Z") } as WorkerAgent, new Set(), now).ago).toBe("vừa xong");
    expect(statusView(worker, { ...agent, started_at: "2026-01-01T10:01:00Z" }, new Set(), now).ago).toBe("vừa xong");
    expect(statusView(worker, { ...agent, started_at: "sai" }, new Set(), now).ago).toBeNull();
  });
  it("activity sai kiểu bị từ chối, warn một lần, rơi về started_at", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = { ...agent, id: "bad-activity", activity: { kind: "edit", text: 5, at: "2026-01-01T09:59:00Z", error: true } } as unknown as WorkerAgent;
    expect(statusView(worker, bad, new Set(), now)).toEqual({ tone: "working", label: "Đang làm", ago: "10 phút trước" });
    statusView(worker, bad, new Set(), now);
    expect(warn).toHaveBeenCalledTimes(1);
    const badAt = { ...agent, id: "bad-at", activity: act("hôm qua") } as unknown as WorkerAgent;
    expect(statusView(worker, badAt, new Set(), now).ago).toBe("10 phút trước");
  });
  it("worker hoặc agent không phải object: không ném, warn một lần", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nullWorker = null as unknown as WorkerStatus;
    expect(statusView(nullWorker, agent, new Set(), now)).toEqual({ tone: "idle", label: "Rảnh", ago: "10 phút trước" });
    expect(statusView(nullWorker, agent, new Set(), now).tone).toBe("idle");
    expect(statusView(worker, "x" as unknown as WorkerAgent, new Set(), now)).toEqual({ tone: "working", label: "Đang làm", ago: null });
    expect(warn.mock.calls.filter(([msg]) => String(msg).includes("worker phải là object"))).toHaveLength(1);
  });
  it("now hỏng không ném", () => {
    expect(statusView(worker, agent, new Set(), Number.NaN).ago).toBe("chưa rõ");
  });
});

describe("roomStateLabel", () => {
  it.each([["working", "đang làm"], ["idle", "rảnh"], ["limited", "hết hạn mức"], ["offline", "mất kết nối"]])("%s", (state, label) => {
    expect(roomStateLabel(state)).toBe(label);
  });
  it.each([["busy"], [""], ["toString"], [null], [undefined], [3]])("trạng thái lạ %s ra ?", (state) => {
    expect(roomStateLabel(state)).toBe("?");
  });
});

describe("taskChecklist", () => {
  it("task 3 → 7 → 0 trên cùng agent", () => {
    const three = taskChecklist({ ...agent, tasks: tasks(3, 1) });
    expect(three).toEqual({ done: 1, total: 3, items: [
      { id: "t0", title: "Việc 0", status: "completed" },
      { id: "t1", title: "Việc 1", status: "in_progress" },
      { id: "t2", title: "Việc 2", status: "pending" },
    ] });
    const seven = taskChecklist({ ...agent, tasks: tasks(7, 4), tasks_done: 4 });
    expect(seven && { done: seven.done, total: seven.total, n: seven.items.length }).toEqual({ done: 4, total: 7, n: 7 });
    expect(taskChecklist({ ...agent, tasks: [] })).toBeNull();
    expect(taskChecklist({ ...agent, tasks: null })).toBeNull();
    expect(taskChecklist(agent)).toBeNull();
  });
  it("tasks_done hợp lệ thì tin, hỏng thì tự đếm", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(taskChecklist({ ...agent, tasks: tasks(3, 1), tasks_done: 2 })?.done).toBe(2);
    for (const tasks_done of [9, -1, 1.5, "2", Number.NaN]) {
      expect(taskChecklist({ ...agent, tasks: tasks(3, 1), tasks_done })?.done).toBe(1);
    }
  });
  it("tasks sai kiểu bị từ chối, warn một lần; mục hỏng bị bỏ riêng", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = { ...agent, id: "bad-tasks", tasks: "sai" };
    expect(taskChecklist(bad)).toBeNull();
    expect(taskChecklist(bad)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const mixed = taskChecklist({ ...agent, id: "mixed", tasks: [...tasks(2, 0), { id: "x", title: "Lạ", status: "done" }] });
    expect(mixed).toMatchObject({ done: 0, total: 2 });
    expect(taskChecklist(null)).toBeNull();
    expect(taskChecklist("x")).toBeNull();
  });
});

describe("recentRows", () => {
  it("rỗng hoặc thiếu ra mảng rỗng", () => {
    expect(recentRows({ ...agent, recent: [] }, "k", now)).toEqual([]);
    expect(recentRows(agent, "k", now)).toEqual([]);
    expect(recentRows(null, "k", now)).toEqual([]);
  });
  it("sắp mới nhất trước, có thời gian tương đối", () => {
    const recent = [act("2026-01-01T09:58:00Z"), act("2026-01-01T09:59:50Z"), act("2026-01-01T09:00:00Z", { icon: "★" })];
    expect(recentRows({ ...agent, recent }, "k", now)).toEqual([
      { icon: "✏️", text: "Sửa 2026-01-01T09:59:50Z", ago: "10 giây trước", at: "2026-01-01T09:59:50Z" },
      { icon: "✏️", text: "Sửa 2026-01-01T09:58:00Z", ago: "2 phút trước", at: "2026-01-01T09:58:00Z" },
      { icon: "★", text: "Sửa 2026-01-01T09:00:00Z", ago: "1 giờ trước", at: "2026-01-01T09:00:00Z" },
    ]);
  });
  it("đủ 20 thì giữ cả 20; hơn 20 giữ 20 mục mới nhất", () => {
    const at = (i: number) => new Date(now - (30 - i) * 1000).toISOString();
    const twenty = Array.from({ length: 20 }, (_, i) => act(at(i)));
    expect(recentRows({ ...agent, recent: twenty }, "k", now)).toHaveLength(20);
    const rows = recentRows({ ...agent, recent: Array.from({ length: 25 }, (_, i) => act(at(i))) }, "k", now);
    expect(rows).toHaveLength(20);
    expect(rows[0].at).toBe(at(24));
    expect(rows[19].at).toBe(at(5));
  });
  it("cùng mốc thời gian: mục đến sau đứng trước", () => {
    const rows = recentRows({ ...agent, recent: [{ ...act("2026-01-01T09:59:00Z"), text: "A" }, { ...act("2026-01-01T09:59:00Z"), text: "B" }] }, "k", now);
    expect(rows.map((r) => r.text)).toEqual(["B", "A"]);
  });
  it("recent sai kiểu bị từ chối, warn một lần, không ném", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(recentRows({ ...agent, recent: 5 }, "recent-sai", now)).toEqual([]);
    expect(recentRows({ ...agent, recent: 5 }, "recent-sai", now)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
