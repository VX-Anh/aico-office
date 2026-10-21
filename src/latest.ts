// Polling không chờ lượt trước: khi API chậm hơn chu kỳ, các request chồng nhau. Chỉ bỏ kết quả
// khi một kết quả mới hơn đã được áp dụng, nếu không thì API chậm sẽ làm mọi kết quả bị bỏ.

export interface RequestTicket {
  readonly generation: number;
  readonly seq: number;
}

export interface LatestGate {
  /** Gọi lúc bắt đầu request. */
  start(): RequestTicket;
  /** True nếu được áp dụng kết quả (thành công hoặc lỗi); khi true thì ghi nhận là đã áp dụng. */
  accept(ticket: RequestTicket): boolean;
  /** Bỏ mọi request đã bắt đầu trước lúc này (vd dữ liệu đổi sau một thao tác). */
  invalidate(): void;
  /** Đổi nguồn: bỏ mọi request cũ, kể cả request bắt đầu sau invalidate. */
  reset(): void;
}

export function createLatestGate(): LatestGate {
  let generation = 0;
  let next = 0;
  let applied = -1;
  let floor = 0;
  return {
    start() { return { generation, seq: next++ }; },
    accept(ticket) {
      if (ticket.generation !== generation || ticket.seq < floor || ticket.seq <= applied) return false;
      applied = ticket.seq;
      return true;
    },
    invalidate() { floor = next; },
    reset() {
      generation++;
      floor = next;
      applied = next - 1;
    },
  };
}
