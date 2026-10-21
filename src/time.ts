// Chuỗi thời gian tương đối "N giây/phút/giờ/ngày trước" dùng chung cho tooltip và thẻ phòng.
// Hàm thuần: nhận now từ nơi gọi (giờ epoch), không đọc giờ thật, không DOM.

// Lệch nhỏ là do đồng hồ máy; lệch lớn thường là now sai (0, t của rAF) hoặc aico ghi sai múi giờ.
const FUTURE_WARN_MS = 5 * 60 * 1000;

let warnedFuture = false;

// Tooltip render lại mỗi giây: chỉ warn lần đầu để không ngập console.
function warnFutureOnce(atIso: string, nowMs: number): void {
  if (warnedFuture) return;
  warnedFuture = true;
  console.warn(`[time] at ${atIso} ở tương lai ${Math.round((Date.parse(atIso) - nowMs) / 1000)} giây so với now, kiểm đồng hồ/múi giờ`);
}

export function relativeTime(atIso: string | null | undefined, nowMs: number): string {
  if (typeof atIso !== "string" || !Number.isFinite(nowMs)) return "chưa rõ";
  const at = Date.parse(atIso);
  if (!Number.isFinite(at)) return "chưa rõ";
  const diff = nowMs - at;
  // Tương lai không kẹp thành "0 giây": kẹp như vậy từng che lỗi now sai.
  if (diff < 0) {
    if (-diff > FUTURE_WARN_MS) warnFutureOnce(atIso, nowMs);
    return "vừa xong";
  }
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} giây trước`;
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}
