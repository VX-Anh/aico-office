import { describe, expect, it } from "vitest";
import { backoffDelay, createPoller } from "./poller";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("backoffDelay", () => {
  it("gấp đôi theo số lần lỗi, chặn trên", () => {
    expect(backoffDelay(3000, 0, 60_000)).toBe(3000);
    expect(backoffDelay(3000, 1, 60_000)).toBe(6000);
    expect(backoffDelay(3000, 3, 60_000)).toBe(24_000);
    expect(backoffDelay(3000, 50, 60_000)).toBe(60_000);
  });
});

describe("createPoller", () => {
  it("không chồng request: tick trong lúc chạy không gửi thêm; now() lúc chạy thì chạy lại một lần khi xong", async () => {
    let clock = 0;
    const releases: ((ok: boolean) => void)[] = [];
    let calls = 0;
    const poller = createPoller(() => {
      calls++;
      return new Promise<boolean>((resolve) => releases.push(resolve));
    }, { baseMs: 3000, clock: () => clock });
    poller.now();
    expect(calls).toBe(1);
    clock = 100_000;
    poller.tick(clock);
    poller.tick(clock);
    expect(calls).toBe(1);
    poller.now();
    poller.now();
    releases.shift()!(true);
    await flush();
    expect(calls).toBe(2);
    releases.shift()!(true);
    await flush();
    // Hạn lượt sau tính từ lúc lượt trước xong.
    poller.tick(clock + 2999);
    expect(calls).toBe(2);
    poller.tick(clock + 3000);
    expect(calls).toBe(3);
  });

  it("lỗi thì giãn nhịp, thành công thì về nhịp gốc", async () => {
    let clock = 0;
    const results = [false, false, true, true];
    let calls = 0;
    const poller = createPoller(async () => {
      calls++;
      const ok = results.shift();
      if (ok === false) throw new Error("mạng");
      return true;
    }, { baseMs: 1000, maxMs: 10_000, clock: () => clock });
    poller.now();
    await flush();
    poller.tick(clock + 1999);
    expect(calls).toBe(1);
    clock += 2000;
    poller.tick(clock);
    await flush();
    poller.tick(clock + 3999);
    expect(calls).toBe(2);
    clock += 4000;
    poller.tick(clock);
    await flush();
    expect(calls).toBe(3);
    clock += 1000;
    poller.tick(clock);
    expect(calls).toBe(4);
  });

  it("tab ẩn thì bỏ lượt; nhịp đọc lại từ hàm", async () => {
    let shown = false;
    let base = 1000;
    let calls = 0;
    let clock = 0;
    const poller = createPoller(async () => {
      calls++;
      return true;
    }, { baseMs: () => base, visible: () => shown, clock: () => clock });
    poller.now();
    poller.tick(5000);
    await flush();
    expect(calls).toBe(0);
    shown = true;
    base = 15_000;
    poller.now();
    await flush();
    expect(calls).toBe(1);
    poller.tick(14_999);
    expect(calls).toBe(1);
    poller.tick(15_000);
    expect(calls).toBe(2);
  });
});
