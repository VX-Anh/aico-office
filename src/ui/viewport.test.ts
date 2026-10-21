import { describe, expect, it } from "vitest";
import { demoWorkers } from "../api";
import { sceneSize } from "../scene/layout";
import { computeInsets, fitScene, type Panels } from "./viewport";

const view = { width: 1440, height: 900 };
const panels: Panels = {
  topbar: { left: 0, top: 0, width: 1440, height: 64 },
  sidebar: { left: 10, top: 74, width: 304, height: 600 },
  drawer: { left: 1050, top: 74, width: 380, height: 600 },
  feed: { left: 324, top: 690, width: 716, height: 200 },
};
const opts = { gap: 10, narrow: false, minFree: 100 };
describe("computeInsets", () => {
  it("tính các panel mở và khoảng cách", () => {
    expect(computeInsets(view, panels, opts)).toEqual({ top: 74, left: 324, right: 400, bottom: 220 });
  });
  it("mọi tổ hợp đóng/mở sidebar, drawer và feed thu gọn", () => {
    for (const sidebar of [null, panels.sidebar]) for (const drawer of [null, panels.drawer]) {
      for (const height of [38, 200]) {
        const result = computeInsets(view, { ...panels, sidebar, drawer, feed: { left: 0, top: 900 - height, width: 1440, height } }, opts);
        expect(result.left).toBe(sidebar ? 324 : 0);
        expect(result.right).toBe(drawer ? 400 : 0);
        expect(result.bottom).toBe(height + 10);
      }
    }
    expect(computeInsets(view, {}, opts)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
  it("màn hẹp bỏ sidebar, sheet tối đa 55% và không cộng đôi feed", () => {
    const result = computeInsets({ width: 390, height: 844 }, {
      ...panels, feed: { left: 0, top: 806, width: 390, height: 38 },
    }, { ...opts, narrow: true });
    expect(result.left).toBe(0);
    expect(result.right).toBe(0);
    expect(result.bottom).toBe(844 * .55);
  });
  it("thiếu chỗ thì giảm drawer trước sidebar", () => {
    expect(computeInsets({ width: 800, height: 900 }, { ...panels, drawer: { left: 410, top: 74, width: 380, height: 600 } }, { ...opts, minFree: 400 })).toMatchObject({ left: 324, right: 76 });
  });
  it("màn rất nhỏ vẫn có minFree khả thi và không âm", () => {
    for (const narrow of [true, false]) for (const size of [{ width: 320, height: 480 }, { width: 30, height: 20 }]) {
      const result = computeInsets(size, panels, { ...opts, narrow });
      expect(Object.values(result).every((n) => n >= 0)).toBe(true);
      expect(size.width - result.left - result.right).toBeGreaterThanOrEqual(Math.min(size.width, 100));
      expect(size.height - result.top - result.bottom).toBeGreaterThanOrEqual(Math.min(size.height, 100));
    }
  });
});
describe("fitScene", () => {
  const free = { left: 20, top: 30, width: 550, height: 340 };
  const scene = { width: 200, height: 100 };
  it("k thiết bị nguyên lớn nhất và căn giữa", () => {
    expect(fitScene(free, scene, 2)).toEqual({ k: 5, cssW: 500, cssH: 250, left: 45, top: 75, crisp: true });
  });
  it("căn theo focus và kẹp cả hai mép, không đẩy cảnh ra ngoài", () => {
    expect(fitScene(free, scene, 2, { x: 0, y: 0 })).toMatchObject({ left: 70, top: 120 });
    expect(fitScene(free, scene, 2, { x: 200, y: 100 })).toMatchObject({ left: 20, top: 30 });
    expect(fitScene(free, scene, 2, { x: 100, y: 50 })).toMatchObject({ left: 45, top: 75 });
  });
  it("co không nguyên khi k=1 vẫn không lọt", () => {
    expect(fitScene({ left: 0, top: 0, width: 70, height: 70 }, scene, 2)).toEqual({ k: 1, cssW: 70, cssH: 35, left: 0, top: 17.5, crisp: false });
  });
  it("dpr 1: hệ số nguyên phủ quá ít thì phóng lấp đầy vùng trống", () => {
    // Cảnh 430x180 trong vùng 720x600 (màn 1440x900 có thanh bên và ngăn chi tiết): trước chỉ 430px.
    const fit = fitScene({ left: 0, top: 0, width: 720, height: 600 }, { width: 430, height: 180 }, 1);
    expect(fit.crisp).toBe(false);
    expect(fit.k).toBe(2);
    expect(fit.cssW).toBeCloseTo(720);
  });
  it("hệ số nguyên phủ gần đủ (>= 85%) thì giữ pixel đều", () => {
    const fit = fitScene({ left: 0, top: 0, width: 420, height: 400 }, scene, 1);
    expect(fit).toMatchObject({ k: 2, cssW: 400, crisp: true });
  });
  it("vùng trống bằng 0 và dpr hỏng không gây NaN", () => {
    expect(fitScene({ left: 0, top: 0, width: 0, height: 0 }, scene, NaN)).toMatchObject({ k: 1, cssW: 0, cssH: 0, crisp: false });
  });
  it("cảnh có sân vẫn nằm gọn trong vùng trống 1440×900", () => {
    const insets = computeInsets(view, panels, opts);
    const free = {
      left: insets.left,
      top: insets.top,
      width: view.width - insets.left - insets.right,
      height: view.height - insets.top - insets.bottom,
    };
    const size = sceneSize(demoWorkers(0));
    expect(size.width).toBeGreaterThan(400);
    expect(size.height).toBeGreaterThan(200);
    const fit = fitScene(free, size, 1);
    expect(fit.cssW).toBeGreaterThan(0);
    expect(fit.cssW).toBeLessThanOrEqual(free.width + 0.01);
    expect(fit.cssH).toBeLessThanOrEqual(free.height + 0.01);
    expect(fit.left).toBeGreaterThanOrEqual(free.left - 0.01);
    expect(fit.top).toBeGreaterThanOrEqual(free.top - 0.01);
    expect(fit.left + fit.cssW).toBeLessThanOrEqual(free.left + free.width + 0.01);
    expect(fit.top + fit.cssH).toBeLessThanOrEqual(free.top + free.height + 0.01);
  });
});
