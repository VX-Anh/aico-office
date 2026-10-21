import { describe, expect, it, vi } from "vitest";
import type { WorkerAgent, WorkerStatus } from "../api";
import { agentStatus, clock, fmtAgo, fmtNumber, providerLetter, usageTile } from "./format";
const now = Date.parse("2026-01-01T10:00:00Z");
const agent: WorkerAgent = { id: "a", role: "coder", ticket_id: "t", mode: "write", started_at: "2026-01-01T00:00:00Z" };
const worker: WorkerStatus = { name: "claude", state: "working", roles: [], agents: [agent] };
const usage = { checked_at: "2026-01-01T10:00:00Z", plan: "Pro", windows: [
  { name: "session", window_minutes: 300, used_percent: 65, resets_at: "2026-01-01T11:05:00Z" },
  { name: "week", window_minutes: 10080, used_percent: 120, resets_at: null },
] };
describe("format", () => {
  it("hạn mức có cửa sổ, phần trăm kẹp và mức màu", () => {
    expect(usageTile({ ...worker, usage }, now)).toEqual({ plan: "Pro", label: "", lines: [
      { label: "5h", percent: 65, level: "warn", reset: "1H05" },
      { label: "Wk", percent: 100, level: "crit", reset: "?" },
    ] });
    expect(usageTile({ ...worker, usage: { ...usage, windows: [{ ...usage.windows[0], used_percent: 20 }] } }, now).lines[0].level).toBe("ok");
  });
  it("chỉ gói, thiếu và hỏng rồi hồi phục", () => {
    expect(usageTile({ ...worker, usage: { ...usage, windows: [] } }, now)).toEqual({ lines: [], plan: "Pro", label: "Pro" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const value of [null, undefined, { ...usage, windows: "sai" }, { ...usage, windows: [{ ...usage.windows[0], used_percent: "65" }] }]) {
      expect(usageTile({ ...worker, usage: value }, now)).toEqual({ lines: [], plan: "?", label: "?" });
    }
    expect(usageTile({ ...worker, usage }, now).lines).toHaveLength(2);
    warn.mockRestore();
  });
  it.each([["claude", "C"], ["codex", "X"], ["cursor", "U"], ["CLAUDE Code", "C"], ["Other", "O"], ["", "?"]])("provider %s", (name, letter) => {
    expect(providerLetter(name)).toBe(letter);
  });
  it("clock UTC và mốc sai", () => {
    expect(clock("2026-01-01T10:02:00Z")).toBe("10:02");
    expect(clock("2026-01-01T17:02:00+07:00")).toBe("10:02");
    expect(clock("sai")).toBe("--:--");
  });
  it("fmtNumber và fmtAgo giữ định dạng cũ, đọc phòng thủ", () => {
    expect(fmtNumber(1200)).toBe(new Intl.NumberFormat("vi-VN", { notation: "compact" }).format(1200));
    expect(fmtNumber(undefined)).toBe("0");
    expect(fmtNumber(NaN)).toBe("0");
    expect(fmtAgo(null, now)).toBe("chưa chạy");
    expect(fmtAgo("sai", now)).toBe("chưa rõ");
    expect(fmtAgo("2026-01-01T09:59:00Z", now)).toBe("1 phút trước");
    expect(fmtAgo("2026-01-01T10:00:01Z", now)).toBe("vừa xong");
  });
  it("ưu tiên offline/limited rồi cần bạn, working, idle; cờ lỗi riêng", () => {
    const needs = new Set(["t"]);
    for (const state of ["offline", "limited"] as const) expect(agentStatus({ ...worker, state }, agent, needs, now).state).toBe(state);
    expect(agentStatus(worker, agent, needs, now).state).toBe("need");
    expect(agentStatus(worker, agent, new Set(), now).state).toBe("working");
    expect(agentStatus({ ...worker, state: "idle" }, agent, new Set(), now).state).toBe("idle");
    expect(agentStatus(worker, { ...agent, ...{ activity: { kind: "error", text: "Lỗi", at: "2026-01-01T10:00:00Z" } } }, needs, now)).toEqual({ state: "need", error: true });
  });
});
