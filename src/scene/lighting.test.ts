import { describe, expect, it, vi } from "vitest";
import { brightnessAt, createLightmapCache, lightingKey, lightingMinutes, monitorLight, parseHour, type LightingInput } from "./lighting";

function input(): LightingInput {
  return { width: 400, height: 240, minutes: 1290,
    rooms: [{ x: 20, y: 20, w: 100, h: 80, state: "working", agents: 1 }],
    sources: [{ x: 40, y: 50, radius: 22, strength: 0.65, color: "white" }],
  };
}

function harness() {
  const ctx = {
    save: vi.fn(), restore: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
  const getContext = vi.fn(() => ctx as unknown as CanvasRenderingContext2D);
  const createCanvas = vi.fn(() => ({ width: 0, height: 0, getContext }));
  return { ctx, getContext, createCanvas, cache: createLightmapCache(createCanvas) };
}

describe("giờ địa phương", () => {
  it.each([[0, 0], [120, 0], [300, 0], [360, 0.5], [420, 1], [720, 1], [1020, 1], [1080, 0.5], [1140, 0], [1439, 0], [1440, 0], [-1, 0]])("phút %s có độ sáng %s", (minute, expected) => {
    expect(brightnessAt(minute)).toBe(expected);
  });
  it("liên tục qua nửa đêm và nội suy bình minh/hoàng hôn", () => {
    expect(brightnessAt(1441)).toBe(brightnessAt(1));
    expect(brightnessAt(359)).toBeLessThan(brightnessAt(360));
    expect(brightnessAt(1079)).toBeGreaterThan(brightnessAt(1080));
    expect(() => brightnessAt(NaN)).toThrow(RangeError);
    expect(() => brightnessAt(Infinity)).toThrow(RangeError);
  });
  it("đọc HH:MM nghiêm ngặt", () => {
    expect(parseHour("21:30")).toBe(1290);
    expect(parseHour("00:00")).toBe(0);
    expect(parseHour("23:59")).toBe(1439);
    for (const value of [null, undefined, "", "24:00", "12:60", "-1:00", "1:00", "12:1", " 12:00", "12:00x", "NaN"]) {
      expect(parseHour(value)).toBeNull();
    }
  });
  it("?hour ghi đè ánh sáng; chuỗi sai dùng giờ địa phương", () => {
    const morning = new Date(2026, 5, 2, 6, 15, 45).getTime();
    expect(lightingMinutes(morning, null)).toBe(6 * 60 + 15);
    expect(lightingMinutes(morning, undefined)).toBe(6 * 60 + 15);
    expect(lightingMinutes(morning, "21:30")).toBe(21 * 60 + 30);
    expect(lightingMinutes(morning, "24:00")).toBe(6 * 60 + 15);
    expect(lightingMinutes(Number.NaN, "nope")).toBe(0);
    expect(lightingMinutes(morning, "00:00")).toBe(0);
  });
});

describe("lightmap cache", () => {
  it("chỉ dựng một lần trong bucket, ghép multiply mỗi frame", () => {
    const { cache, ctx, getContext } = harness();
    const first = input();
    cache.draw(ctx as unknown as CanvasRenderingContext2D, first);
    cache.draw(ctx as unknown as CanvasRenderingContext2D, { ...first, minutes: 1294.9 });
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
    expect(ctx).toHaveProperty("globalCompositeOperation", "multiply");
    cache.get({ ...first, minutes: 1295 });
    expect(getContext).toHaveBeenCalledTimes(2);
    cache.reset();
    cache.get(first);
    expect(getContext).toHaveBeenCalledTimes(3);
  });
  it("cập nhật khi agent mất/xuất hiện, overflow, trạng thái, hình học hoặc nguồn đổi", () => {
    const { cache, getContext } = harness();
    const base = input();
    cache.get(base);
    let count = 1;
    for (const agents of [0, 1, 4, 8, 0]) {
      cache.get({ ...base, rooms: [{ ...base.rooms[0], agents }] });
      expect(getContext).toHaveBeenCalledTimes(++count);
    }
    for (const state of ["offline", "limited", "idle", "working"] as const) {
      cache.get({ ...base, rooms: [{ ...base.rooms[0], state }] });
      expect(getContext).toHaveBeenCalledTimes(++count);
    }
    for (const next of [
      { ...base, width: 450 }, { ...base, height: 300 },
      { ...base, rooms: [{ ...base.rooms[0], x: 60 }] },
      { ...base, sources: [] }, { ...base, sources: [{ ...base.sources[0], x: 80 }] },
      { ...base, minutes: 0 },
    ]) {
      cache.get(next);
      expect(getContext).toHaveBeenCalledTimes(++count);
    }
  });
  it("không phụ thuộc thứ tự nguồn và object identity", () => {
    const base = input();
    const sources = [...base.sources, { ...base.sources[0], x: 90 }];
    expect(lightingKey({ ...base, sources })).toBe(lightingKey({ ...base, sources: sources.slice().reverse() }));
    expect(lightingKey({ ...base, minutes: 1440 })).toBe(lightingKey({ ...base, minutes: 0 }));
  });
  it("màn hình tắt và offline/limited không phát quầng; cursor vẫn bật", () => {
    for (const state of ["working", "idle", "offline", "limited"] as const) {
      expect(monitorLight({ x: 1, y: 2, state, screen: "off" })).toBeNull();
      for (const screen of ["cursor", "code", "read", "terminal", "browser", "search"] as const) {
        const light = monitorLight({ x: 1, y: 2, state, screen });
        if (state === "offline" || state === "limited") expect(light).toBeNull();
        else expect(light).toMatchObject({ x: 1, y: 2, radius: 22 });
      }
    }
  });
  it("canvas thiếu context có thể thử lại", () => {
    const cache = createLightmapCache(() => ({ width: 0, height: 0, getContext: () => null }));
    expect(cache.get(input())).toBeNull();
    expect(cache.get(input())).toBeNull();
  });
});
