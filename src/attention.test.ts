import { describe, expect, it } from "vitest";
import {
  dismissToast, isShortcut, nextAttention, reconcileToasts, resetToasts, tabTitle,
  type AttentionEntry,
} from "./attention";

const entry = (id: string, kind = "plan", label = "duyệt kế hoạch"): AttentionEntry =>
  ({ id, kind, label });
const ids = (entries: AttentionEntry[]) => entries.map(item => item.id);
const primed = () => reconcileToasts(resetToasts(), []);

describe("tabTitle", () => {
  it.each([[0, "AICO Office"], [1, "(1) AICO Office"], [12, "(12) AICO Office"]])(
    "%s ticket", (n, title) => { expect(tabTitle(n as number)).toBe(title); },
  );
});

describe("nextAttention", () => {
  it("đi tiếp, quay vòng, hoặc lấy đầu khi chưa chọn hay id đã mất", () => {
    expect(nextAttention(["a", "b"], "a")).toBe("b");
    expect(nextAttention(["a", "b"], "b")).toBe("a");
    expect(nextAttention(["a", "b"], null)).toBe("a");
    expect(nextAttention(["a", "b"], "gone")).toBe("a");
    expect(nextAttention(["a"], "a")).toBe("a");
    expect(nextAttention([], null)).toBeNull();
    expect(nextAttention([], "gone")).toBeNull();
  });
});

describe("isShortcut", () => {
  const event = { key: "p", ctrlKey: false, metaKey: false, altKey: false, editable: false };
  it("nhận p/P, bỏ phím khác", () => {
    expect(isShortcut(event)).toBe(true);
    expect(isShortcut({ ...event, key: "P" })).toBe(true);
    expect(isShortcut({ ...event, key: "Enter" })).toBe(false);
  });
  it.each(["ctrlKey", "metaKey", "altKey", "editable"] as const)("bỏ khi %s", flag => {
    for (const key of ["p", "P"]) expect(isShortcut({ ...event, key, [flag]: true })).toBe(false);
  });
});

describe("toast", () => {
  it("lần đọc đầu chỉ ghi nhận, kể cả trùng", () => {
    const state = reconcileToasts(resetToasts(), [entry("a"), entry("a")]);
    expect(state.primed).toBe(true);
    expect([...state.known]).toEqual(["a|plan"]);
    expect(state.toasts).toEqual([]);
    expect(reconcileToasts(state, [entry("a")]).toasts).toEqual([]);
  });

  it("gộp trùng, giữ mới nhất trước và cập nhật nhãn mà không tạo toast mới", () => {
    const state = reconcileToasts(primed(), [entry("a"), entry("a")]);
    expect(state.toasts).toEqual([entry("a")]);
    const next = reconcileToasts(state, [entry("b"), entry("a", "plan", "nhãn mới"), entry("b")]);
    expect(next.toasts).toEqual([entry("b"), entry("a", "plan", "nhãn mới")]);
    expect(state.toasts).toEqual([entry("a")]);
    expect([...state.known]).toEqual(["a|plan"]);
  });

  it("0 → 5 chỉ giữ 3; toast bị bỏ không xuất hiện lại qua poll hay khi giảm số lượng", () => {
    const entries = ["e", "d", "c", "b", "a"].map(id => entry(id));
    const state = reconcileToasts(primed(), entries);
    expect(ids(state.toasts)).toEqual(["e", "d", "c"]);
    expect(state.known.size).toBe(5);
    expect(ids(reconcileToasts(state, entries).toasts)).toEqual(["e", "d", "c"]);
    const reduced = reconcileToasts(state, [entry("c"), entry("b")]);
    expect(ids(reduced.toasts)).toEqual(["c"]);
    expect([...reduced.known]).toEqual(["c|plan", "b|plan"]);
    expect(reconcileToasts(reduced, []).toasts).toEqual([]);
  });

  it("ticket mới đẩy toast cũ nhất ra ngoài và tôn trọng max", () => {
    const state = reconcileToasts(primed(), [entry("b"), entry("a")]);
    const entries = [entry("d"), entry("c"), entry("b"), entry("a")];
    expect(ids(reconcileToasts(state, entries).toasts)).toEqual(["d", "c", "b"]);
    expect(ids(reconcileToasts(state, entries, 1).toasts)).toEqual(["d"]);
    expect(reconcileToasts(state, entries, 0).toasts).toEqual([]);
  });

  it.each([false, true])("mất rồi xuất hiện lại, đã đóng: %s", closed => {
    const initial = reconcileToasts(primed(), [entry("a")]);
    const state = closed ? dismissToast(initial, "a|plan") : initial;
    expect(initial.dismissed.size).toBe(0);
    expect(reconcileToasts(state, [entry("a")]).toasts).toHaveLength(closed ? 0 : 1);
    const gone = reconcileToasts(state, []);
    expect(gone.toasts).toEqual([]);
    expect(gone.known.size).toBe(0);
    expect(gone.dismissed.size).toBe(0);
    expect(reconcileToasts(gone, [entry("a")]).toasts).toEqual([entry("a")]);
  });

  it.each([["plan", "merge"], ["merge", "escalated"], ["escalated", "plan"]])(
    "đổi loại %s → %s huỷ toast cũ và quên lần đóng cũ", (from, to) => {
      const state = dismissToast(reconcileToasts(primed(), [entry("a", from)]), `a|${from}`);
      const changed = reconcileToasts(state, [entry("a", to)]);
      expect(changed.toasts).toEqual([entry("a", to)]);
      expect([...changed.known]).toEqual([`a|${to}`]);
      expect(changed.dismissed.size).toBe(0);
      expect(reconcileToasts(changed, [entry("a", from)]).toasts).toEqual([entry("a", from)]);
    },
  );

  it("reset khi đổi nguồn: xoá toast, known, dismissed và không bật toast lượt đầu", () => {
    const old = dismissToast(reconcileToasts(primed(), [entry("a"), entry("b")]), "a|plan");
    const reset = resetToasts();
    expect(reset).toEqual({ toasts: [], known: new Set(), dismissed: new Set(), primed: false });
    const first = reconcileToasts(reset, [entry("a"), entry("c")]);
    expect(first.toasts).toEqual([]);
    expect(ids(reconcileToasts(first, [entry("d"), entry("a"), entry("c")]).toasts)).toEqual(["d"]);
    expect(ids(old.toasts)).toEqual(["b"]);
  });
});
