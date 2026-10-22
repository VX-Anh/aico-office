// Tìm phải bỏ dấu và hoa thường; thời gian chạy hỏng thì null; lựa chọn lọc hỏng bị từ chối, lỗi storage không lan ra.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HIDDEN_ROOMS_KEY,
  agentMatches,
  formatElapsed,
  loadHiddenRooms,
  normalizeText,
  saveHiddenRooms,
  slotFill,
  type HiddenRoomsStorage,
} from "./sidebar-model";

describe("normalizeText", () => {
  it("hạ chữ thường, bỏ dấu, đ thành d", () => {
    expect(normalizeText("Thiết kế")).toBe("thiet ke");
    expect(normalizeText("Đường đi")).toBe("duong di");
    expect(normalizeText("CODER")).toBe("coder");
  });

  it("gộp khoảng trắng và trim", () => {
    expect(normalizeText("  Kiểm   thử \t")).toBe("kiem thu");
  });

  it("không phải chuỗi thì rỗng", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
    expect(normalizeText(42)).toBe("");
  });
});

describe("agentMatches", () => {
  const fields = {
    roleLabel: "Thiết kế",
    role: "designer",
    id: "agent-7",
    ticket: "T-01489c4d",
    activity: "Đang sửa sidebar.css",
    room: "Claude",
  };

  it("từ khoá rỗng hoặc chỉ khoảng trắng luôn khớp", () => {
    expect(agentMatches("", fields)).toBe(true);
    expect(agentMatches("   ", fields)).toBe(true);
    expect(agentMatches("", {})).toBe(true);
  });

  it("không phân biệt hoa thường", () => {
    expect(agentMatches("DESIGNER", fields)).toBe(true);
    expect(agentMatches("t-01489C4D", fields)).toBe(true);
  });

  it("bỏ dấu ở cả từ khoá và dữ liệu", () => {
    expect(agentMatches("thiet ke", fields)).toBe(true);
    expect(agentMatches("Thiết Kế", fields)).toBe(true);
    expect(agentMatches("dang sua", fields)).toBe(true);
  });

  it.each([
    ["nhãn vai trò", { roleLabel: "Kiểm thử" }, "kiem"],
    ["role", { role: "tester" }, "test"],
    ["id", { id: "agent-42" }, "nt-4"],
    ["ticket", { ticket: "T-abc123" }, "abc"],
    ["hoạt động", { activity: "Chạy npm test" }, "npm"],
    ["tên phòng", { room: "Codex" }, "codex"],
  ])("khớp theo %s", (_name, f, q) => {
    expect(agentMatches(q, f)).toBe(true);
  });

  it("không khớp khi không trường nào chứa từ khoá", () => {
    expect(agentMatches("reviewer", fields)).toBe(false);
  });

  it("trường null hoặc undefined không làm lỗi và không khớp", () => {
    const sparse = { roleLabel: null, role: undefined, id: "a1", ticket: null, activity: undefined, room: null };
    expect(agentMatches("a1", sparse)).toBe(true);
    expect(agentMatches("null", sparse)).toBe(false);
    expect(agentMatches("undefined", sparse)).toBe(false);
  });

  it("gộp khoảng trắng trong từ khoá", () => {
    expect(agentMatches("  thiet   ke ", fields)).toBe(true);
  });
});

describe("formatElapsed", () => {
  const start = "2026-10-22T10:00:00Z";
  const t0 = Date.parse(start);

  it.each([
    [5, "0:05"],
    [0, "0:00"],
    [3 * 60 + 3, "3:03"],
    [59 * 60 + 59, "59:59"],
    [3600, "1:00:00"],
    [2 * 3600 + 5 * 60 + 9, "2:05:09"],
  ])("%i giây thành %s", (sec, out) => {
    expect(formatElapsed(start, t0 + sec * 1000)).toBe(out);
  });

  it("làm tròn xuống theo giây", () => {
    expect(formatElapsed(start, t0 + 5999)).toBe("0:05");
  });

  it("started_at null, undefined, không phải chuỗi thì null", () => {
    expect(formatElapsed(null, t0)).toBeNull();
    expect(formatElapsed(undefined, t0)).toBeNull();
    expect(formatElapsed(123 as unknown as string, t0)).toBeNull();
  });

  it("chuỗi hỏng thì null", () => {
    expect(formatElapsed("không phải ngày", t0)).toBeNull();
    expect(formatElapsed("", t0)).toBeNull();
  });

  it("ở tương lai thì null, không kẹp về 0:00", () => {
    expect(formatElapsed(start, t0 - 1000)).toBeNull();
  });

  it("now NaN hoặc vô hạn thì null", () => {
    expect(formatElapsed(start, Number.NaN)).toBeNull();
    expect(formatElapsed(start, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("slotFill", () => {
  it("1/3", () => {
    const f = slotFill(1, 3);
    expect(f.ratio).toBeCloseTo(1 / 3);
    expect(f.over).toBe(false);
    expect(f.label).toBe("1/3 chỗ");
  });

  it("3/3 đầy nhưng không vượt", () => {
    expect(slotFill(3, 3)).toEqual({ ratio: 1, over: false, label: "3/3 chỗ" });
  });

  it("4/3 vượt, ratio kẹp 1", () => {
    expect(slotFill(4, 3)).toEqual({ ratio: 1, over: true, label: "4/3 chỗ" });
  });

  it("0 agent thì ratio 0", () => {
    expect(slotFill(0, 3)).toEqual({ ratio: 0, over: false, label: "0/3 chỗ" });
  });

  it("slots 0 không có agent: rỗng, không vượt", () => {
    expect(slotFill(0, 0)).toEqual({ ratio: 0, over: false, label: "0/0 chỗ" });
  });

  it("slots 0 có agent: đầy và vượt", () => {
    expect(slotFill(2, 0)).toEqual({ ratio: 1, over: true, label: "2/0 chỗ" });
  });

  it("đầu vào âm hoặc NaN kẹp về 0, ratio trong 0–1", () => {
    for (const [c, s] of [[-1, 3], [Number.NaN, 3], [2, -5], [2, Number.NaN]]) {
      const f = slotFill(c, s);
      expect(f.ratio).toBeGreaterThanOrEqual(0);
      expect(f.ratio).toBeLessThanOrEqual(1);
    }
    expect(slotFill(-1, 3).label).toBe("0/3 chỗ");
  });
});

function memoryStorage(initial: Record<string, string> = {}): HiddenRoomsStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
  };
}

describe("loadHiddenRooms / saveHiddenRooms", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("lưu rồi đọc lại", () => {
    const s = memoryStorage();
    expect(saveHiddenRooms(s, new Set(["Claude", "Codex"]))).toBe(true);
    expect(JSON.parse(s.data.get(HIDDEN_ROOMS_KEY)!)).toEqual(["Claude", "Codex"]);
    expect(loadHiddenRooms(s)).toEqual(new Set(["Claude", "Codex"]));
    expect(warn).not.toHaveBeenCalled();
  });

  it("lưu tập rỗng thì đọc lại rỗng", () => {
    const s = memoryStorage();
    saveHiddenRooms(s, new Set());
    expect(loadHiddenRooms(s)).toEqual(new Set());
  });

  it("chưa lưu gì thì rỗng, không warn", () => {
    expect(loadHiddenRooms(memoryStorage())).toEqual(new Set());
    expect(warn).not.toHaveBeenCalled();
  });

  it("storage null hoặc undefined", () => {
    expect(loadHiddenRooms(null)).toEqual(new Set());
    expect(loadHiddenRooms(undefined)).toEqual(new Set());
    expect(saveHiddenRooms(null, new Set(["A"]))).toBe(false);
  });

  it("JSON hỏng bị từ chối, warn một lần", () => {
    const s = memoryStorage({ [HIDDEN_ROOMS_KEY]: "[\"Claude\"" });
    expect(loadHiddenRooms(s)).toEqual(new Set());
    expect(loadHiddenRooms(s)).toEqual(new Set());
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["object", "{\"a\":1}"],
    ["chuỗi", "\"Claude\""],
    ["null", "null"],
    ["số", "3"],
    ["mảng lẫn số", "[\"Claude\",1]"],
    ["mảng lẫn null", "[null,\"Codex\"]"],
  ])("không phải mảng chuỗi (%s) bị từ chối cả mảng, warn một lần", (_name, raw) => {
    const s = memoryStorage({ [HIDDEN_ROOMS_KEY]: raw });
    expect(loadHiddenRooms(s)).toEqual(new Set());
    expect(loadHiddenRooms(s)).toEqual(new Set());
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("getItem ném lỗi không lan ra", () => {
    const s: HiddenRoomsStorage = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => {},
    };
    expect(() => loadHiddenRooms(s)).not.toThrow();
    expect(loadHiddenRooms(s)).toEqual(new Set());
  });

  it("setItem ném lỗi không lan ra, trả false", () => {
    const s: HiddenRoomsStorage = {
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
    };
    expect(() => saveHiddenRooms(s, new Set(["A"]))).not.toThrow();
    expect(saveHiddenRooms(s, new Set(["A"]))).toBe(false);
  });
});
