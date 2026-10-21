import { describe, expect, it } from "vitest";
import type { WorkerStatus } from "../api";
import type { NeedItem } from "../needs-column";
import { createFeedState, reduceFeed, resetFeed } from "./feed-model";
const at = (n: number) => new Date(n * 1000).toISOString();
function worker(times = [1, 2], room = "claude", id = "a"): WorkerStatus {
  return { name: room, roles: [], state: "working", agents: [{ id, role: "coder", ticket_id: "t", mode: "write", started_at: at(0),
    ...{ recent: times.map((n) => ({ kind: "read", text: `Đọc ${n}`, at: at(n) })) },
  }] };
}
const item = (kind: NeedItem["kind"]): NeedItem => ({ kind, reason: null,
  ticket: { id: "t", title: "Việc", status: "x", artifacts: [], project: null, updated_at: null },
});
describe("reduceFeed", () => {
  it("nạp recent lần đầu, khử trùng cả phòng/agent/at/text và xếp theo giờ", () => {
    const workers = [worker([3, 1, 2, 2]), worker([1], "codex"), worker([1], "claude", "b")];
    const state = reduceFeed(createFeedState(), workers, [], 5000);
    expect(state.lines).toHaveLength(5);
    expect(state.lines.map((line) => line.at)).toEqual([at(1), at(1), at(1), at(2), at(3)]);
    expect(reduceFeed(state, workers, [], 6000).lines).toEqual(state.lines);
    expect(state.seen.size).toBe(5);
  });
  it("cùng giờ khác text vẫn là dòng khác", () => {
    const w = worker([1]);
    const initial = reduceFeed(createFeedState(), [w], [], 2000);
    const changed = { ...w, agents: w.agents?.map((a) => ({ ...a, recent: [{ kind: "read", text: "Khác", at: at(1) }] })) };
    expect(reduceFeed(initial, [changed], [], 3000).lines).toHaveLength(2);
  });
  it("cắt max, bỏ dữ liệu cũ hơn cửa sổ và thu gọn seen", () => {
    const state = reduceFeed(createFeedState(), [worker([1, 2, 3, 4])], [], 5000, 2);
    expect(state.lines.map((line) => line.at)).toEqual([at(3), at(4)]);
    expect(state.seen.size).toBe(2);
    expect(reduceFeed(state, [worker([0, 1, 2, 3, 4])], [], 6000, 2).lines).toEqual(state.lines);
    expect(reduceFeed(state, [], [], 6000, 0).lines).toEqual([]);
  });
  it("giữ khoá tại biên cùng timestamp, không phát lại dòng đã cắt", () => {
    const workers = [worker([1], "a"), worker([1], "b"), worker([1], "c")];
    const state = reduceFeed(createFeedState(), workers, [], 2000, 1);
    expect(reduceFeed(state, workers, [], 3000, 1).lines).toEqual(state.lines);
  });
  it("ticket xuất hiện, đổi loại, biến mất và xuất hiện lại", () => {
    let state = reduceFeed(createFeedState(), [], [item("plan")], 1000);
    expect(state.lines).toHaveLength(1);
    state = reduceFeed(state, [], [item("plan")], 2000);
    expect(state.lines).toHaveLength(1);
    state = reduceFeed(state, [], [item("merge")], 2000);
    expect(state.lines).toHaveLength(2);
    state = reduceFeed(state, [], [], 2000);
    expect(state.lines.at(-1)?.text).toContain("đã xử lý");
    state = reduceFeed(state, [], [item("plan")], 2000);
    expect(state.lines).toHaveLength(4);
    expect(new Set(state.lines.map((line) => line.key)).size).toBe(4);
  });
  it.each(["offline", "limited"] as const)("agent biến mất và phòng %s rồi online không lặp recent", (roomState) => {
    let state = reduceFeed(createFeedState(), [worker()], [], 5000);
    state = reduceFeed(state, [], [], 6000);
    state = reduceFeed(state, [worker()], [], 7000);
    state = reduceFeed(state, [{ ...worker(), state: roomState }], [], 8000);
    state = reduceFeed(state, [worker()], [], 9000);
    expect(state.lines).toHaveLength(2);
  });
  it("reset sạch và không sửa state đầu vào", () => {
    const initial = createFeedState();
    reduceFeed(initial, [worker()], [item("plan")], 5000);
    expect(initial.lines).toEqual([]);
    expect(initial.seen.size).toBe(0);
    expect(initial.needs.size).toBe(0);
    expect(resetFeed()).toEqual(initial);
  });
});
