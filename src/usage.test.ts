// usage hỏng phải bị từ chối (null, warn một lần) để không vẽ thanh sai; windows: [] là hợp lệ (Cursor).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoWorkers } from "./api";
import { isStale, parseUsage, shortCountdown, usageLevel, usagePercent, usageWindows } from "./usage";

const NOW = Date.parse("2026-10-20T15:40:00+00:00");
const at = (ms: number) => new Date(ms).toISOString();

const CLAUDE = {
  checked_at: "2026-10-20T15:40:00+00:00",
  source: "claude /usage",
  plan: "plus",
  windows: [
    { name: "session", window_minutes: 300, used_percent: 28.0, resets_at: "2026-10-20T19:59:00+00:00" },
    { name: "week (all models)", window_minutes: 10080, used_percent: 14.0, resets_at: "2026-10-23T13:59:00+00:00" },
  ],
  note: "CLI không công bố hạn mức",
  error: "không đọc được hạn mức từ CLI",
};
const CODEX = {
  checked_at: "2026-10-20T15:40:00Z",
  source: "codex /status",
  plan: "plus",
  windows: [
    { name: "5h", window_minutes: 300, used_percent: 40, resets_at: "2026-10-20T16:27:00Z" },
    { name: "week", window_minutes: 10080, used_percent: 35, resets_at: null },
  ],
};
const CURSOR = { checked_at: "2026-10-20T15:40:00Z", source: "cursor-agent", plan: "Pro", windows: [], note: "CLI không công bố hạn mức" };

let seq = 0;
// Mỗi lần đọc một tên phòng riêng vì warn chỉ in một lần theo nội dung.
const who = () => `room${seq++}`;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe("parseUsage: dữ liệu đúng", () => {
  it("giữ nguyên Claude, Codex, Cursor", () => {
    expect(parseUsage(CLAUDE, who())).toEqual(CLAUDE);
    expect(parseUsage(CODEX, who())).toEqual({ ...CODEX, note: null, error: null });
    expect(parseUsage(CURSOR, who())).toEqual({ ...CURSOR, error: null });
    expect(warn).not.toHaveBeenCalled();
  });

  it("giữ ngày nhuận, phần giây và múi giờ ISO hợp lệ", () => {
    for (const value of ["2024-02-29T23:59:59Z", "2026-10-20T15:40:00.123Z", "2026-10-20T15:40:00+07:00", "2026-10-20T15:40:00-05:30"]) {
      expect(parseUsage({ ...CODEX, checked_at: value, windows: [{ ...CODEX.windows[0], resets_at: value }] }, who())).not.toBeNull();
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("windows: [] hợp lệ, không chuẩn hoá thành null", () => {
    const u = parseUsage({ checked_at: CURSOR.checked_at, windows: [] }, who());
    expect(u).toEqual({ checked_at: CURSOR.checked_at, source: null, plan: null, windows: [], note: null, error: null });
    expect(warn).not.toHaveBeenCalled();
  });

  it("plan/note/error/source/resets_at/window_minutes là null hoặc vắng đều hợp lệ", () => {
    const u = parseUsage(
      { checked_at: CODEX.checked_at, plan: null, note: null, error: null, source: null, windows: [{ name: "5h", used_percent: 0, resets_at: null }] },
      who(),
    );
    expect(u?.windows).toEqual([{ name: "5h", window_minutes: null, used_percent: 0, resets_at: null }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("null hoặc vắng: chưa có số liệu, không warn", () => {
    expect(parseUsage(null, who())).toBeNull();
    expect(parseUsage(undefined, who())).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("used_percent vượt 100 vẫn giữ (CLI báo vậy), kẹp khi hiện", () => {
    const raw = { ...CODEX, windows: [{ ...CODEX.windows[0], used_percent: 130 }] };
    expect(parseUsage(raw, who())?.windows[0].used_percent).toBe(130);
  });
});

describe("parseUsage: dữ liệu hỏng trả null và warn một lần", () => {
  const win = CODEX.windows[0];
  const broken: [string, unknown][] = [
    ["raw là số", 42],
    ["raw là chuỗi", "plus"],
    ["raw là mảng", [CODEX]],
    ["raw là boolean", true],
    ["thiếu checked_at", { ...CODEX, checked_at: undefined }],
    ["checked_at null", { ...CODEX, checked_at: null }],
    ["checked_at hỏng", { ...CODEX, checked_at: "hôm qua" }],
    ["checked_at là số", { ...CODEX, checked_at: NOW }],
    ["thiếu windows", { ...CODEX, windows: undefined }],
    ["windows null", { ...CODEX, windows: null }],
    ["windows là object", { ...CODEX, windows: { 0: win } }],
    ["windows là chuỗi", { ...CODEX, windows: "5h" }],
    ["cửa sổ là null", { ...CODEX, windows: [null] }],
    ["cửa sổ là chuỗi", { ...CODEX, windows: ["5h"] }],
    ["cửa sổ là mảng", { ...CODEX, windows: [[win]] }],
    ["name không phải chuỗi", { ...CODEX, windows: [{ ...win, name: 5 }] }],
    ["thiếu name", { ...CODEX, windows: [{ ...win, name: undefined }] }],
    ["used_percent là chuỗi", { ...CODEX, windows: [{ ...win, used_percent: "28" }] }],
    ["used_percent NaN", { ...CODEX, windows: [{ ...win, used_percent: NaN }] }],
    ["used_percent Infinity", { ...CODEX, windows: [{ ...win, used_percent: Infinity }] }],
    ["used_percent âm", { ...CODEX, windows: [{ ...win, used_percent: -1 }] }],
    ["thiếu used_percent", { ...CODEX, windows: [{ ...win, used_percent: undefined }] }],
    ["used_percent null", { ...CODEX, windows: [{ ...win, used_percent: null }] }],
    ["window_minutes là chuỗi", { ...CODEX, windows: [{ ...win, window_minutes: "300" }] }],
    ["window_minutes âm", { ...CODEX, windows: [{ ...win, window_minutes: -300 }] }],
    ["resets_at hỏng", { ...CODEX, windows: [{ ...win, resets_at: "sắp" }] }],
    ["resets_at là số", { ...CODEX, windows: [{ ...win, resets_at: NOW }] }],
    ["một cửa sổ hỏng giữa các cửa sổ đúng", { ...CODEX, windows: [win, { ...win, used_percent: "x" }, CODEX.windows[1]] }],
    ["plan là số", { ...CODEX, plan: 1 }],
    ["plan là object", { ...CODEX, plan: { name: "plus" } }],
    ["note là số", { ...CURSOR, note: 0 }],
    ["error là boolean", { ...CLAUDE, error: true }],
    ["source là mảng", { ...CLAUDE, source: ["claude"] }],
  ];
  for (const value of [
    "0", "10/20/2026", "2026-02-30T15:40:00Z", "2025-02-29T15:40:00Z",
    "2026-04-31T15:40:00Z", "2026-00-20T15:40:00Z", "2026-10-20T24:00:00Z",
    "2026-10-20T15:60:00Z", "2026-10-20T15:40:00+24:00",
  ]) {
    broken.push([`checked_at không hợp lệ: ${value}`, { ...CODEX, checked_at: value }]);
    broken.push([`resets_at không hợp lệ: ${value}`, { ...CODEX, windows: [{ ...win, resets_at: value }] }]);
  }
  for (const [label, raw] of broken) {
    it(label, () => {
      const name = who();
      expect(parseUsage(raw, name)).toBeNull();
      expect(parseUsage(raw, name)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  }
});

describe("usageWindows", () => {
  it("Claude/Codex: 5H rồi WK", () => {
    expect(usageWindows(parseUsage(CLAUDE, who())).map((w) => [w.label, w.used_percent])).toEqual([["5H", 28], ["WK", 14]]);
    expect(usageWindows(parseUsage(CODEX, who())).map((w) => w.label)).toEqual(["5H", "WK"]);
  });

  it("3 cửa sổ chỉ lấy 2: ngắn nhất dưới 1 ngày và dài nhất từ 1 ngày", () => {
    const u = parseUsage(
      {
        ...CODEX,
        windows: [
          { name: "week (opus)", window_minutes: 10080, used_percent: 50, resets_at: null },
          { name: "day", window_minutes: 1440, used_percent: 90, resets_at: null },
          { name: "session", window_minutes: 300, used_percent: 10, resets_at: null },
        ],
      },
      who(),
    );
    expect(usageWindows(u).map((w) => [w.label, w.name])).toEqual([["5H", "session"], ["WK", "week (opus)"]]);
  });

  it("thiếu window_minutes thì đoán theo tên", () => {
    const u = parseUsage(
      { ...CODEX, windows: [{ name: "week", used_percent: 1 }, { name: "session", used_percent: 2 }] },
      who(),
    );
    expect(usageWindows(u).map((w) => [w.label, w.name])).toEqual([["5H", "session"], ["WK", "week"]]);
  });

  it("chỉ có cửa sổ tuần, rỗng, hoặc null", () => {
    expect(usageWindows(parseUsage({ ...CODEX, windows: [CODEX.windows[1]] }, who())).map((w) => w.label)).toEqual(["WK"]);
    expect(usageWindows(parseUsage(CURSOR, who()))).toEqual([]);
    expect(usageWindows(null)).toEqual([]);
  });
});

describe("usageLevel: mốc ngưỡng", () => {
  const cases: [number, string][] = [
    [0, "ok"],
    [59.9, "ok"],
    [59.99, "ok"],
    [60, "warn"],
    [79.9, "warn"],
    [79.99, "warn"],
    [80, "high"],
    [100, "high"],
    [130, "high"],
  ];
  for (const [pct, level] of cases) {
    it(`${pct}% → ${level}`, () => expect(usageLevel(pct)).toBe(level));
  }

  it("kẹp về 0..100 khi hiện", () => {
    expect(usagePercent(130)).toBe(100);
    expect(usagePercent(28.4)).toBe(28);
    expect(usagePercent(-5)).toBe(0);
    expect(usagePercent(NaN)).toBe(0);
  });
});

describe("shortCountdown", () => {
  it("phút, giờ, đã qua, không rõ", () => {
    expect(shortCountdown(at(NOW + 47 * 60_000), NOW)).toBe("47M");
    expect(shortCountdown(at(NOW + 60 * 60_000), NOW)).toBe("1H00");
    expect(shortCountdown(at(NOW + 65 * 60_000), NOW)).toBe("1H05");
    expect(shortCountdown(at(NOW + 71 * 3_600_000 + 5 * 60_000), NOW)).toBe("71H05");
    expect(shortCountdown(at(NOW - 60_000), NOW)).toBe("0M");
    expect(shortCountdown(at(NOW), NOW)).toBe("0M");
    expect(shortCountdown(null, NOW)).toBe("?");
    expect(shortCountdown(undefined, NOW)).toBe("?");
    expect(shortCountdown("sắp", NOW)).toBe("?");
  });

  it("làm tròn lên: còn 30 giây vẫn là 1M", () => {
    expect(shortCountdown(at(NOW + 30_000), NOW)).toBe("1M");
  });
});

describe("isStale", () => {
  it("cũ hơn 15 phút mới tính", () => {
    expect(isStale(at(NOW - (14 * 60 + 59) * 1000), NOW)).toBe(false);
    expect(isStale(at(NOW - 15 * 60_000), NOW)).toBe(false);
    expect(isStale(at(NOW - (15 * 60 + 1) * 1000), NOW)).toBe(true);
    expect(isStale(at(NOW), NOW)).toBe(false);
  });
});

describe("dữ liệu đổi giữa chừng", () => {
  it("usage có → null → hỏng → có lại", () => {
    const name = who();
    const seen = [CODEX, null, { ...CODEX, windows: "x" }, undefined, CODEX].map((raw) => usageWindows(parseUsage(raw, name)).length);
    expect(seen).toEqual([2, 0, 0, 0, 2]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("số cửa sổ 2 → 1 → 0 → 2", () => {
    const name = who();
    const polls = [CODEX.windows, [CODEX.windows[0]], [], CODEX.windows];
    expect(polls.map((windows) => usageWindows(parseUsage({ ...CODEX, windows }, name)).map((w) => w.label))).toEqual([
      ["5H", "WK"],
      ["5H"],
      [],
      ["5H", "WK"],
    ]);
  });

  it("phần trăm vượt ngưỡng giữa hai lần đọc, kể cả đi xuống sau reset", () => {
    const name = who();
    const levels = [59, 61, 79, 85, 100, 130, 3].map((p) => {
      const u = parseUsage({ ...CODEX, windows: [{ ...CODEX.windows[0], used_percent: p }] }, name);
      return usageLevel(usageWindows(u)[0].used_percent);
    });
    expect(levels).toEqual(["ok", "warn", "warn", "high", "high", "high", "ok"]);
  });

  it("checked_at mới → cũ → mới", () => {
    const name = who();
    const stale = [NOW, NOW - 20 * 60_000, NOW].map((t) => isStale(parseUsage({ ...CODEX, checked_at: at(t) }, name)!.checked_at, NOW));
    expect(stale).toEqual([false, true, false]);
  });
});

describe("demo 48 giây", () => {
  const T0 = 1_000 * 48_000; // đầu một chu kỳ
  const room = (s: number, name: string) => demoWorkers(T0 + s * 1000).find((w) => w.name === name)!;
  const usage = (s: number, name: string) => parseUsage(room(s, name).usage, `demo-${name}`);

  it("mọi thời điểm usage đọc được hoặc null, không warn", () => {
    for (let s = 0; s < 48; s += 0.5) {
      for (const w of demoWorkers(T0 + s * 1000)) {
        if (w.usage !== null) expect(parseUsage(w.usage, `demo-${w.name}`)).not.toBeNull();
      }
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("claude: session 20 → 70%, tuần 84%, 40–48 giây số liệu cũ", () => {
    expect(usageWindows(usage(0, "claude")).map((w) => usagePercent(w.used_percent))).toEqual([20, 84]);
    expect(usageWindows(usage(47.99, "claude"))[0].used_percent).toBeCloseTo(70, 0);
    expect(usageLevel(usageWindows(usage(10, "claude"))[0].used_percent)).toBe("ok");
    expect(usageLevel(usageWindows(usage(46, "claude"))[0].used_percent)).toBe("warn");
    expect(usageLevel(usageWindows(usage(0, "claude"))[1].used_percent)).toBe("high");
    expect(isStale(usage(39, "claude")!.checked_at, T0 + 39_000)).toBe(false);
    expect(isStale(usage(40, "claude")!.checked_at, T0 + 40_000)).toBe(true);
    expect(usage(0, "claude")!.plan).toBe("max");
  });

  it("codex: 5h 40 → 100% đi qua ba màu, rồi limited tới cuối chu kỳ và agent rời bàn", () => {
    const pct = (s: number) => usageWindows(usage(s, "codex"))[0].used_percent;
    expect(pct(0)).toBe(40);
    expect(usageLevel(pct(5))).toBe("ok");
    expect(usageLevel(pct(20))).toBe("warn");
    expect(usageLevel(pct(30))).toBe("high");
    expect(pct(36)).toBe(100);
    expect(room(35, "codex").state).toBe("working");
    expect(room(35, "codex").agents).toHaveLength(1);
    const limited = room(36, "codex");
    expect(limited.state).toBe("limited");
    expect(limited.agents).toEqual([]);
    expect(limited.limit?.resets_at).toBe(at(T0 + 48_000));
    expect(room(47, "codex").state).toBe("limited");
    expect(room(48, "codex").state).toBe("idle");
    expect(usageWindows(usage(0, "codex"))[1].used_percent).toBe(35);
    expect(usage(0, "codex")!.plan).toBe("plus");
  });

  it("cursor: windows rỗng, gói Pro, có note; offline thì usage null", () => {
    const u = usage(0, "cursor")!;
    expect(u.windows).toEqual([]);
    expect(u.plan).toBe("Pro");
    expect(u.note).toBeTruthy();
    expect(room(30, "cursor").state).toBe("offline");
    expect(room(30, "cursor").usage).toBeNull();
    expect(usage(40, "cursor")?.plan).toBe("Pro");
  });
});
