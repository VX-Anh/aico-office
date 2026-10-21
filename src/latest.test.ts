// API chậm hơn chu kỳ poll: request chồng nhau nhưng giao diện vẫn phải cập nhật; chỉ bỏ kết quả cũ hơn
// kết quả đã áp dụng, request trước thao tác và request của nguồn cũ.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLatestGate, type LatestGate } from "./latest";

const POLL_MS = 3000;

// Mô phỏng cách main.ts/panel dùng gate: poll không chờ lượt trước, kết quả hoặc lỗi về sau `delay` ms.
function poller(gate: LatestGate, respond: (n: number) => { delay: number; ok: boolean }) {
  const shown: string[] = [];
  let calls = 0;
  async function poll(): Promise<void> {
    const n = calls++;
    const request = gate.start();
    const { delay, ok } = respond(n);
    try {
      const value = await new Promise<string>((resolve, reject) =>
        setTimeout(() => (ok ? resolve(`ok${n}`) : reject(new Error(`lỗi${n}`))), delay));
      if (!gate.accept(request)) return;
      shown.push(value);
    } catch (exc) {
      if (!gate.accept(request)) return;
      shown.push((exc as Error).message);
    }
  }
  return { shown, poll };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("createLatestGate", () => {
  it("/workers hoặc /tickets luôn chậm 4 giây: vẫn áp dụng kết quả theo thứ tự", async () => {
    const gate = createLatestGate();
    const p = poller(gate, () => ({ delay: 4000, ok: true }));
    void p.poll();
    const timer = setInterval(() => void p.poll(), POLL_MS);
    await vi.advanceTimersByTimeAsync(10_500);
    clearInterval(timer);
    // A(0→4), B(3→7), C(6→10) đều được áp dụng.
    expect(p.shown).toEqual(["ok0", "ok1", "ok2"]);
  });

  it("lỗi trả chậm vẫn được hiện, rồi kết quả lành xoá lỗi", async () => {
    const gate = createLatestGate();
    const p = poller(gate, (n) => ({ delay: 4000, ok: n !== 1 }));
    void p.poll();
    const timer = setInterval(() => void p.poll(), POLL_MS);
    await vi.advanceTimersByTimeAsync(10_500);
    clearInterval(timer);
    expect(p.shown).toEqual(["ok0", "lỗi1", "ok2"]);
  });

  it("kết quả cũ về sau kết quả mới đã áp dụng thì bị bỏ, kể cả lỗi", async () => {
    const gate = createLatestGate();
    const p = poller(gate, (n) => ({ delay: n === 0 ? 5000 : 1000, ok: n !== 0 }));
    void p.poll();
    await vi.advanceTimersByTimeAsync(500);
    void p.poll();
    await vi.advanceTimersByTimeAsync(6000);
    expect(p.shown).toEqual(["ok1"]);
  });

  it("refresh sau thao tác bị poll kế tiếp vượt qua: vẫn áp dụng poll mới, không bỏ hết", async () => {
    const gate = createLatestGate();
    // Lượt 0: list bắt đầu trước khi thao tác xong. Lượt 1: refresh sau thao tác (chậm). Lượt 2: poll kế tiếp (nhanh).
    const delays = [3000, 4000, 1000];
    const p = poller(gate, (n) => ({ delay: delays[n] ?? 1000, ok: true }));
    void p.poll();
    await vi.advanceTimersByTimeAsync(100);
    gate.invalidate();
    void p.poll();
    await vi.advanceTimersByTimeAsync(100);
    void p.poll();
    await vi.advanceTimersByTimeAsync(5000);
    // ok0 bắt đầu trước thao tác nên bị bỏ; ok2 về trước ok1 và mới hơn nên ok1 bị bỏ.
    expect(p.shown).toEqual(["ok2"]);
  });

  it("refresh sau thao tác về trước poll kế tiếp: cả hai được áp dụng", async () => {
    const gate = createLatestGate();
    const delays = [5000, 1000, 2000];
    const p = poller(gate, (n) => ({ delay: delays[n] ?? 1000, ok: true }));
    void p.poll();
    await vi.advanceTimersByTimeAsync(100);
    gate.invalidate();
    void p.poll();
    void p.poll();
    await vi.advanceTimersByTimeAsync(6000);
    expect(p.shown).toEqual(["ok1", "ok2"]);
  });

  it("đổi nguồn (config/Demo): bỏ mọi request cũ, request mới vẫn áp dụng dù về trước hay sau", async () => {
    const gate = createLatestGate();
    const delays = [4000, 4000, 1000, 6000];
    const p = poller(gate, (n) => ({ delay: delays[n] ?? 1000, ok: true }));
    void p.poll();
    void p.poll();
    await vi.advanceTimersByTimeAsync(100);
    gate.reset();
    void p.poll();
    void p.poll();
    await vi.advanceTimersByTimeAsync(7000);
    expect(p.shown).toEqual(["ok2", "ok3"]);
  });

  it("đổi nguồn nhiều lần liên tiếp: chỉ nguồn cuối được áp dụng", async () => {
    const gate = createLatestGate();
    const p = poller(gate, () => ({ delay: 2000, ok: false }));
    void p.poll();
    gate.reset();
    void p.poll();
    gate.reset();
    void p.poll();
    await vi.advanceTimersByTimeAsync(3000);
    expect(p.shown).toEqual(["lỗi2"]);
  });
});
