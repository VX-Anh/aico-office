// relativeTime: biên giây/phút/giờ/ngày, tương lai, at hỏng, now hỏng. Không bao giờ ra số âm.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AT = "2026-10-21T12:05:00.000Z";
const AT_MS = Date.parse(AT);

// warn một lần là trạng thái của module: nạp lại mỗi test để các test không phụ thuộc thứ tự.
async function load() {
  vi.resetModules();
  return (await import("./time")).relativeTime;
}

describe("relativeTime", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it.each([
    [0, "0 giây trước"],
    [1, "1 giây trước"],
    [59, "59 giây trước"],
    [60, "1 phút trước"],
    [3599, "59 phút trước"],
    [3600, "1 giờ trước"],
    [86399, "23 giờ trước"],
    [86400, "1 ngày trước"],
  ])("%i giây -> %s", async (sec, want) => {
    const relativeTime = await load();
    expect(relativeTime(AT, AT_MS + sec * 1000)).toBe(want);
  });

  it("làm tròn xuống, không lên", async () => {
    const relativeTime = await load();
    expect(relativeTime(AT, AT_MS + 59_999)).toBe("59 giây trước");
    expect(relativeTime(AT, AT_MS + 90_000)).toBe("1 phút trước");
    expect(relativeTime(AT, AT_MS + 10 * 86400_000)).toBe("10 ngày trước");
  });

  it("dữ liệu ticket: các at cách nhau nhiều giây ra chuỗi khác nhau", async () => {
    const relativeTime = await load();
    const now = Date.parse("2026-10-21T12:05:30Z");
    const ats = ["2026-10-21T12:05:26.114Z", "2026-10-21T12:05:13.332Z", "2026-10-21T12:05:03.511Z", "2026-10-21T12:05:01.803Z"];
    expect(ats.map((at) => relativeTime(at, now))).toEqual(["3 giây trước", "16 giây trước", "26 giây trước", "28 giây trước"]);
  });

  it("tương lai 1 giây: vừa xong, không warn (lệch đồng hồ nhỏ)", async () => {
    const relativeTime = await load();
    expect(relativeTime(AT, AT_MS - 1000)).toBe("vừa xong");
    expect(warn).not.toHaveBeenCalled();
  });

  it("tương lai 3 giờ: vừa xong, warn đúng một lần dù gọi nhiều lần", async () => {
    const relativeTime = await load();
    for (let i = 0; i < 5; i++) expect(relativeTime(AT, AT_MS - 3 * 3600_000 + i * 1000)).toBe("vừa xong");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/^\[time\]/);
  });

  it("đúng 5 phút chưa warn, quá 5 phút mới warn", async () => {
    const relativeTime = await load();
    expect(relativeTime(AT, AT_MS - 5 * 60_000)).toBe("vừa xong");
    expect(warn).not.toHaveBeenCalled();
    expect(relativeTime(AT, AT_MS - 5 * 60_000 - 1)).toBe("vừa xong");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([["abc"], [""], [null], [undefined]])("at hỏng/thiếu %j -> chưa rõ", async (at) => {
    const relativeTime = await load();
    expect(relativeTime(at, AT_MS)).toBe("chưa rõ");
  });

  it.each([[NaN], [Infinity], [-Infinity]])("nowMs %s -> chưa rõ, không ra NaN", async (now) => {
    const relativeTime = await load();
    expect(relativeTime(AT, now)).toBe("chưa rõ");
  });

  // nowMs=0 là dấu hiệu lỗi ticket (now khởi tạo 0 hoặc t của rAF): ra "vừa xong" và warn, không số âm.
  it("nowMs=0 với at năm 2026: vừa xong, warn một lần, không ra số âm", async () => {
    const relativeTime = await load();
    const out = relativeTime(AT, 0);
    expect(out).toBe("vừa xong");
    expect(out).not.toMatch(/-/);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("không bao giờ ra số âm hay NaN", async () => {
    const relativeTime = await load();
    for (const off of [-86400_000 * 3, -3600_000, -1, 0, 1, 61_000, 7200_000, 86400_000 * 400]) {
      const out = relativeTime(AT, AT_MS + off);
      expect(out).not.toMatch(/-|NaN/);
    }
  });
});
