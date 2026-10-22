import { describe, expect, it, vi } from "vitest";
import type { WorkerAgent, WorkerStatus } from "../api";
import { agentStatus, clock, fmtAgo, fmtNumber, fmtTokenCount, providerLetter, tokenStatsLines, tokenStatsRows, usageTile } from "./format";
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
  it("fmtTokenCount: nghìn/triệu, bỏ số 0 và biên làm tròn", () => {
    expect(fmtTokenCount(0)).toBe("0");
    expect(fmtTokenCount(999)).toBe("999");
    expect(fmtTokenCount(1_000)).toBe("1 nghìn");
    expect(fmtTokenCount(1_494)).toBe("1,49 nghìn");
    expect(fmtTokenCount(1_495)).toBe("1,5 nghìn");
    expect(fmtTokenCount(2_500)).toBe("2,5 nghìn");
    expect(fmtTokenCount(10_000)).toBe("10 nghìn");
    expect(fmtTokenCount(87_000)).toBe("87 nghìn");
    expect(fmtTokenCount(1_120_000)).toBe("1,12 triệu");
    expect(fmtTokenCount(999_994)).toBe("999,99 nghìn");
    expect(fmtTokenCount(999_995)).toBe("1 triệu");
    expect(fmtTokenCount(1_000_000)).toBe("1 triệu");
    expect(fmtTokenCount(1_004_999)).toBe("1 triệu");
    expect(fmtTokenCount(1_005_000)).toBe("1,01 triệu");
    expect(fmtTokenCount(1_010_000)).toBe("1,01 triệu");
    expect(fmtTokenCount(1_125_000)).toBe("1,13 triệu");
  });
  it("fmtTokenCount thiếu hoặc không hữu hạn ra 0", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(fmtTokenCount(value)).toBe("0");
    }
  });
  it("có cache: 1,12 triệu, 92% và Token mới trừ thẳng 87 nghìn", () => {
    expect(tokenStatsLines({
      tool_calls: 12_000, tokens_in: 1_120_000, tokens_out: 2_500, tokens_cached: 1_033_000,
    })).toEqual([
      { text: "Lần gọi tool: 12.000", cacheSuffix: null, level: null },
      { text: "Token vào: 1,12 triệu", cacheSuffix: " (92% từ cache)", level: "ok" },
      { text: "Token mới: 87 nghìn", cacheSuffix: null, level: null },
      { text: "Token ra: 2,5 nghìn", cacheSuffix: null, level: null },
    ]);
  });
  it("thiếu cache, stats rỗng hoặc cache hỏng giữ số cũ", () => {
    const legacy = [
      { text: "Lần gọi tool: 3", cacheSuffix: null, level: null },
      { text: "Token vào: 1.120.000", cacheSuffix: null, level: null },
      { text: "Token ra: 87.000", cacheSuffix: null, level: null },
    ];
    expect(tokenStatsLines({ tool_calls: 3, tokens_in: 1_120_000, tokens_out: 87_000, tokens_cached: null })).toEqual(legacy);
    expect(tokenStatsLines({ tool_calls: 3, tokens_in: 1_120_000, tokens_out: 87_000 })).toEqual(legacy);
    const empty = [
      { text: "Lần gọi tool: chưa có", cacheSuffix: null, level: null },
      { text: "Token vào: chưa có", cacheSuffix: null, level: null },
      { text: "Token ra: chưa có", cacheSuffix: null, level: null },
    ];
    expect(tokenStatsLines(null)).toEqual(empty);
    expect(tokenStatsLines(undefined)).toEqual(empty);
    expect(tokenStatsLines({})).toEqual(empty);
    for (const tokens_cached of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(tokenStatsLines({ tool_calls: 3, tokens_in: 1_120_000, tokens_out: 87_000, tokens_cached })).toEqual(legacy);
    }
  });
  it("đầu vào 0 hoặc thiếu không hiện phần trăm; Token mới không âm", () => {
    expect(tokenStatsLines({ tool_calls: 0, tokens_in: 0, tokens_out: 1_120_000, tokens_cached: 0 })).toEqual([
      { text: "Lần gọi tool: 0", cacheSuffix: null, level: null },
      { text: "Token vào: 0", cacheSuffix: null, level: null },
      { text: "Token mới: 0", cacheSuffix: null, level: null },
      { text: "Token ra: 1,12 triệu", cacheSuffix: null, level: null },
    ]);
    expect(tokenStatsLines({ tool_calls: 1, tokens_in: 0, tokens_out: 0, tokens_cached: 40 })).toEqual([
      { text: "Lần gọi tool: 1", cacheSuffix: null, level: null },
      { text: "Token vào: 0", cacheSuffix: null, level: null },
      { text: "Token mới: 0", cacheSuffix: null, level: null },
      { text: "Token ra: 0", cacheSuffix: null, level: null },
    ]);
    expect(tokenStatsLines({ tool_calls: 2, tokens_in: null, tokens_out: null, tokens_cached: 10 })).toEqual([
      { text: "Lần gọi tool: 2", cacheSuffix: null, level: null },
      { text: "Token vào: chưa có", cacheSuffix: null, level: null },
      { text: "Token mới: chưa có", cacheSuffix: null, level: null },
      { text: "Token ra: chưa có", cacheSuffix: null, level: null },
    ]);
  });
  it.each([
    [0, 1_000, "0", "crit"],
    [5, 1_000, "1", "crit"],
    [395, 1_000, "40", "crit"],
    [399, 1_000, "40", "crit"],
    [400, 1_000, "40", "warn"],
    [500, 1_000, "50", "warn"],
    [695, 1_000, "70", "warn"],
    [699, 1_000, "70", "warn"],
    [700, 1_000, "70", "ok"],
    [925, 1_000, "93", "ok"],
    [1_000, 1_000, "100", "ok"],
    [1_500, 1_000, "100", "ok"],
  ] as const)("cache %i/%i hiện %s%% mức %s theo tỉ lệ chưa làm tròn", (cached, input, percent, level) => {
    const lines = tokenStatsLines({ tool_calls: 1, tokens_in: input, tokens_out: 8, tokens_cached: cached });
    expect(lines.map((row) => row.text)).toEqual([
      "Lần gọi tool: 1",
      "Token vào: 1 nghìn",
      `Token mới: ${fmtTokenCount(Math.max(0, input - cached))}`,
      "Token ra: 8",
    ]);
    expect(lines[1]).toEqual({ text: "Token vào: 1 nghìn", cacheSuffix: ` (${percent}% từ cache)`, level });
    expect(lines.filter((row) => row.cacheSuffix !== null || row.level !== null)).toEqual([lines[1]]);
  });
  it("tokenStatsRows có cache: nhãn, giá trị, hậu tố và Token mới", () => {
    expect(tokenStatsRows({ tool_calls: 12_000, tokens_in: 1_120_000, tokens_out: 2_500, tokens_cached: 1_033_000 })).toEqual([
      { label: "Lần gọi tool", value: "12.000", cacheSuffix: null, level: null },
      { label: "Token vào", value: "1,12 triệu", cacheSuffix: " (92% từ cache)", level: "ok" },
      { label: "Token mới", value: "87 nghìn", cacheSuffix: null, level: null },
      { label: "Token ra", value: "2,5 nghìn", cacheSuffix: null, level: null },
    ]);
  });
  it("tokenStatsRows thiếu hoặc hỏng cache: không có Token mới, không màu", () => {
    const legacy = [
      { label: "Lần gọi tool", value: "3", cacheSuffix: null, level: null },
      { label: "Token vào", value: "1.120.000", cacheSuffix: null, level: null },
      { label: "Token ra", value: "87.000", cacheSuffix: null, level: null },
    ];
    for (const tokens_cached of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(tokenStatsRows({ tool_calls: 3, tokens_in: 1_120_000, tokens_out: 87_000, tokens_cached })).toEqual(legacy);
    }
    expect(tokenStatsRows(null).map((r) => r.value)).toEqual(["chưa có", "chưa có", "chưa có"]);
    expect(tokenStatsRows({ tool_calls: -2, tokens_in: Number.NaN, tokens_out: null }).map((r) => r.value)).toEqual(["chưa có", "chưa có", "chưa có"]);
  });
  it.each([
    [399, "crit"], [400, "warn"], [699, "warn"], [700, "ok"],
  ] as const)("tokenStatsRows biên cache %i/1000 mức %s", (cached, level) => {
    const rows = tokenStatsRows({ tool_calls: 1, tokens_in: 1_000, tokens_out: 8, tokens_cached: cached });
    expect(rows.map((r) => r.label)).toEqual(["Lần gọi tool", "Token vào", "Token mới", "Token ra"]);
    expect(rows[1].level).toBe(level);
    expect(rows.filter((r) => r.level !== null)).toEqual([rows[1]]);
  });
  it("tokenStatsLines dựng từ tokenStatsRows", () => {
    for (const stats of [null, { tool_calls: 1, tokens_in: 1_000, tokens_out: 8, tokens_cached: 500 }, { tokens_in: 5 }]) {
      expect(tokenStatsLines(stats)).toEqual(tokenStatsRows(stats).map((r) => ({ text: `${r.label}: ${r.value}`, cacheSuffix: r.cacheSuffix, level: r.level })));
    }
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
