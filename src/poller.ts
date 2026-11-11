// Vòng poll tuần tự: lượt sau chỉ tới hạn khi lượt trước xong, nên API chậm không làm request dồn ứ.
// Lỗi liên tiếp thì giãn nhịp (gấp đôi, tối đa maxMs); tab ẩn thì bỏ lượt, hiện lại thì gọi now().
// Không tự đặt timer: main gọi tick() từ nhịp một giây sẵn có (test giả lập được, không rò timer).

export interface PollerOptions {
  /** Nhịp gốc; hàm thì đọc lại mỗi lượt (vd demo nhanh hơn dữ liệu thật). */
  baseMs: number | (() => number);
  maxMs?: number;
  /** Trả false khi tab đang ẩn; vắng thì coi như luôn hiện. */
  visible?: () => boolean;
  clock?: () => number;
}

export interface Poller {
  /** Chạy ngay. Đang chạy dở thì chạy lại ngay khi lượt đó xong (không chồng request). */
  now(): void;
  /** Gọi định kỳ: tới hạn và không có lượt nào đang chạy thì chạy. */
  tick(at: number): void;
}

export function backoffDelay(baseMs: number, failures: number, maxMs: number): number {
  const n = Math.max(0, Math.min(failures, 10));
  return Math.min(maxMs, baseMs * 2 ** n);
}

/** `run` trả true khi thành công, false hoặc ném lỗi khi thất bại. */
export function createPoller(run: () => Promise<boolean>, options: PollerOptions): Poller {
  const maxMs = options.maxMs ?? 60_000;
  const visible = options.visible ?? (() => true);
  const clock = options.clock ?? Date.now;
  let running = false;
  let again = false;
  let failures = 0;
  let dueAt = 0;

  async function go(): Promise<void> {
    if (running) {
      again = true;
      return;
    }
    if (!visible()) return;
    running = true;
    let ok = false;
    try {
      ok = await run();
    } catch {
      ok = false;
    } finally {
      running = false;
    }
    failures = ok ? 0 : failures + 1;
    const base = typeof options.baseMs === "function" ? options.baseMs() : options.baseMs;
    dueAt = clock() + backoffDelay(base, failures, maxMs);
    if (again) {
      again = false;
      void go();
    }
  }

  return {
    now: () => void go(),
    tick(at) {
      if (!running && at >= dueAt) void go();
    },
  };
}
