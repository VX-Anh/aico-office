// Logic thuần của thanh bên Phòng: chuẩn hoá chuỗi để tìm, khớp agent, thời gian chạy, thanh chỗ,
// đọc/ghi lựa chọn lọc phòng. Không DOM, không đọc giờ thật (`now` do nơi gọi truyền vào).

export interface AgentSearchFields {
  roleLabel?: string | null;
  role?: string | null;
  id?: string | null;
  ticket?: string | null;
  activity?: string | null;
  room?: string | null;
}

export interface SlotFill { ratio: number; over: boolean; label: string }

// Chỉ cần getItem/setItem: test truyền storage giả, trình duyệt truyền localStorage.
export type HiddenRoomsStorage = Pick<Storage, "getItem" | "setItem">;

export const HIDDEN_ROOMS_KEY = "aico-office.sidebar.hiddenRooms";

// Người dùng hay gõ không dấu: "thiet ke" phải khớp "Thiết kế". đ không tách được bằng NFD nên đổi tay.
export function normalizeText(s: unknown): string {
  if (typeof s !== "string") return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

export function agentMatches(query: string, fields: AgentSearchFields): boolean {
  const q = normalizeText(query);
  if (q === "") return true;
  const values = [fields.roleLabel, fields.role, fields.id, fields.ticket, fields.activity, fields.room];
  return values.some((v) => normalizeText(v).includes(q));
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

// Tương lai trả null chứ không kẹp về 0:00: kẹp từng che lỗi now sai (cùng quy ước time.ts).
export function formatElapsed(startedAt: string | null | undefined, now: number): string | null {
  if (typeof startedAt !== "string" || !Number.isFinite(now)) return null;
  const at = Date.parse(startedAt);
  if (!Number.isFinite(at)) return null;
  const diff = now - at;
  if (diff < 0) return null;
  const total = Math.floor(diff / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

export function slotFill(count: number, slots: number): SlotFill {
  const c = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  const n = Number.isFinite(slots) && slots > 0 ? Math.floor(slots) : 0;
  // slots 0 mà vẫn có agent là vượt: thanh đầy để thấy ngay, không chia cho 0.
  const ratio = n === 0 ? (c > 0 ? 1 : 0) : Math.min(1, c / n);
  return { ratio, over: c > n, label: `${c}/${n} chỗ` };
}

const warnedRaw = new Set<string>();

// update() chạy mỗi giây nhưng chỉ đọc lúc tạo thanh; vẫn warn một lần theo nội dung để không ngập console.
function warnOnce(raw: string, reason: string): void {
  if (warnedRaw.has(raw)) return;
  warnedRaw.add(raw);
  console.warn(`[sidebar] bỏ lựa chọn lọc phòng đã lưu: ${reason}`);
}

// Lỗi đọc hoặc dữ liệu hỏng thì coi như chưa lọc gì, không giữ một phần dữ liệu hỏng.
export function loadHiddenRooms(storage: HiddenRoomsStorage | null | undefined): Set<string> {
  if (!storage) return new Set();
  let raw: string | null;
  try {
    raw = storage.getItem(HIDDEN_ROOMS_KEY);
  } catch {
    return new Set();
  }
  if (raw === null) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnOnce(raw, "JSON hỏng");
    return new Set();
  }
  if (!Array.isArray(parsed) || !parsed.every((v): v is string => typeof v === "string")) {
    warnOnce(raw, "không phải mảng chuỗi");
    return new Set();
  }
  return new Set(parsed);
}

// Đầy bộ nhớ hoặc chế độ riêng tư thì setItem ném: trả false để nơi gọi chỉ giữ trong phiên.
export function saveHiddenRooms(storage: HiddenRoomsStorage | null | undefined, rooms: ReadonlySet<string>): boolean {
  if (!storage) return false;
  try {
    storage.setItem(HIDDEN_ROOMS_KEY, JSON.stringify([...rooms]));
    return true;
  } catch {
    return false;
  }
}
