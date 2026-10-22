import { describe, expect, it } from "vitest";
import type { WorkerStatus } from "../api";
import type { NeedItem } from "../needs-column";
import { createFeedState, reduceFeed, resetFeed, type FeedState } from "./feed-model";
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
    // Phòng limited có thêm dòng hết hạn mức riêng; ở đây chỉ đếm dòng recent.
    expect(state.lines.filter((line) => line.agentId)).toHaveLength(2);
  });
  it("reset sạch và không sửa state đầu vào", () => {
    const initial = createFeedState();
    reduceFeed(initial, [worker()], [item("plan")], 5000);
    expect(initial.lines).toEqual([]);
    expect(initial.seen.size).toBe(0);
    expect(initial.needs.size).toBe(0);
    expect(initial.rooms.size).toBe(0);
    expect(resetFeed()).toEqual(initial);
  });
  it("resetFeed xoá rooms và bằng createFeedState", () => {
    const state = reduceFeed(createFeedState(), [room("limited")], [], 1000);
    expect(state.rooms.size).toBe(1);
    expect(resetFeed()).toEqual(createFeedState());
    expect(state.rooms.get("claude")).toBe("limited");
  });
});

const room = (state: WorkerStatus["state"], name = "claude"): WorkerStatus => ({ ...worker([], name), state });
const limits = (state: FeedState) => state.lines.filter((line) => line.key.startsWith("limit:"));

describe("trường ticket và tone", () => {
  const withTicket = (ticket_id: unknown) => {
    const w = worker([1]);
    return { ...w, agents: w.agents?.map((a) => ({ ...a, ticket_id })) } as WorkerStatus;
  };
  it("dòng agent lấy agent.ticket_id khi là chuỗi khác rỗng", () => {
    expect(reduceFeed(createFeedState(), [withTicket("T-1")], [], 2000).lines[0].ticket).toBe("T-1");
  });
  it.each([["thiếu", undefined], ["null", null], ["sai kiểu", 42], ["rỗng", ""]])("ticket_id %s thì null", (_, v) => {
    const line = reduceFeed(createFeedState(), [withTicket(v)], [], 2000).lines[0];
    expect(line.ticket).toBeNull();
    expect(line.tone).toBeNull();
  });
  it("ticket_id đổi giữa chừng: dòng mới theo giá trị mới, dòng cũ giữ nguyên", () => {
    let state = reduceFeed(createFeedState(), [withTicket("T-1")], [], 2000);
    const w = worker([2]);
    state = reduceFeed(state, [{ ...w, agents: w.agents?.map((a) => ({ ...a, ticket_id: "" })) }], [], 3000);
    expect(state.lines.map((line) => line.ticket)).toEqual(["T-1", null]);
  });
  it("activity.error ra tone error", () => {
    const w = worker([]);
    const agents = w.agents?.map((a) => ({ ...a, recent: [
      { kind: "error", text: "Build lỗi", at: at(1) },
      { kind: "bash", text: "Lệnh lỗi", at: at(2), error: true },
      { kind: "read", text: "Đọc", at: at(3) },
    ] }));
    expect(reduceFeed(createFeedState(), [{ ...w, agents }], [], 5000).lines.map((line) => line.tone))
      .toEqual(["error", "error", null]);
  });
  it("dòng ticket: need, escalated ra error, đã xử lý ra done, ticket là id", () => {
    let state = reduceFeed(createFeedState(), [], [item("plan")], 1000);
    expect(state.lines.at(-1)).toMatchObject({ ticket: "t", tone: "need", icon: "!" });
    state = reduceFeed(state, [], [item("escalated")], 2000);
    expect(state.lines.at(-1)).toMatchObject({ ticket: "t", tone: "error" });
    state = reduceFeed(state, [], [], 3000);
    expect(state.lines.at(-1)).toMatchObject({ ticket: "t", tone: "done", icon: "✓" });
  });
});

describe("dòng hết hạn mức", () => {
  it("working → limited → limited → working → limited ra đúng 2 dòng", () => {
    let state = createFeedState();
    (["working", "limited", "limited", "working", "limited"] as const).forEach((s, i) => {
      state = reduceFeed(state, [room(s)], [], 1000 * (i + 1));
    });
    const lines = limits(state);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ room: "claude", agentId: null, name: "claude", icon: "⏳",
      text: "hết hạn mức", ticket: null, tone: "error", at: new Date(2000).toISOString() });
    expect(lines[1].at).toBe(new Date(5000).toISOString());
    expect(new Set(lines.map((line) => line.key)).size).toBe(2);
  });
  it("lần đầu thấy đã limited ra 1 dòng, mỗi phòng tách riêng", () => {
    const state = reduceFeed(createFeedState(), [room("limited"), room("limited", "codex"), room("working", "cursor")], [], 1000);
    expect(limits(state).map((line) => line.room)).toEqual(["claude", "codex"]);
    expect(limits(reduceFeed(state, [room("limited"), room("limited", "codex")], [], 2000))).toHaveLength(2);
  });
  it("phòng biến mất rồi xuất hiện lại vẫn limited thì không lặp", () => {
    let state = reduceFeed(createFeedState(), [room("limited")], [], 1000);
    state = reduceFeed(state, [], [], 2000);
    state = reduceFeed(state, [room("limited")], [], 3000);
    expect(limits(state)).toHaveLength(1);
  });
  it("offline → limited ra 1 dòng", () => {
    let state = reduceFeed(createFeedState(), [room("offline")], [], 1000);
    expect(limits(state)).toHaveLength(0);
    state = reduceFeed(state, [room("limited")], [], 2000);
    expect(limits(state)).toHaveLength(1);
  });
  it("now NaN không thêm và không lỗi; lần sau có now thì vẫn báo", () => {
    let state = reduceFeed(createFeedState(), [room("limited")], [], NaN);
    expect(state.lines).toEqual([]);
    state = reduceFeed(state, [room("limited")], [], 2000);
    expect(limits(state)).toHaveLength(1);
  });
  it("không sửa state đầu vào", () => {
    const initial = reduceFeed(createFeedState(), [room("working")], [], 1000);
    reduceFeed(initial, [room("limited")], [], 2000);
    expect(initial.rooms.get("claude")).toBe("working");
    expect(initial.lines).toEqual([]);
    expect(initial.sequence).toBe(0);
  });
});
