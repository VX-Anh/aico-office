// Toạ độ CSS; không phụ thuộc DOM. Rect ẩn được truyền bằng null.
export interface Size { width: number; height: number }
export interface Rect extends Size { left: number; top: number }
export interface Insets { top: number; right: number; bottom: number; left: number }
export interface Panels { topbar?: Rect | null; sidebar?: Rect | null; drawer?: Rect | null; feed?: Rect | null }
export interface InsetOptions { gap: number; narrow: boolean; minFree: number | Size }
const positive = (n: number) => Number.isFinite(n) ? Math.max(0, n) : 0;
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));

export function computeInsets(view: Size, panels: Panels, opts: InsetOptions): Insets {
  const w = positive(view.width), h = positive(view.height), gap = positive(opts.gap);
  const min = typeof opts.minFree === "number" ? { width: opts.minFree, height: opts.minFree } : opts.minFree;
  const budgetW = Math.max(0, w - positive(min.width)), budgetH = Math.max(0, h - positive(min.height));
  const top = panels.topbar ? clamp(panels.topbar.top + panels.topbar.height + gap, 0, h) : 0;
  const feed = panels.feed ? clamp(h - panels.feed.top + gap, 0, h) : 0;
  let left = !opts.narrow && panels.sidebar ? clamp(panels.sidebar.left + panels.sidebar.width + gap, 0, w) : 0;
  let right = !opts.narrow && panels.drawer ? clamp(w - panels.drawer.left + gap, 0, w) : 0;
  const sheet = opts.narrow && panels.drawer ? Math.min(positive(panels.drawer.height) + gap, h * .55) : 0;
  // Bỏ phần drawer trước, rồi sidebar; màn cực nhỏ còn phải giảm topbar/feed.
  right = Math.min(right, Math.max(0, budgetW - left));
  left = Math.min(left, budgetW - right);
  const baseBottom = Math.min(feed, budgetH);
  const safeTop = Math.min(top, Math.max(0, budgetH - baseBottom));
  const bottom = Math.min(Math.max(feed, sheet), Math.max(0, budgetH - safeTop));
  return { top: safeTop, right, bottom, left };
}

export interface SceneFit { k: number; cssW: number; cssH: number; left: number; top: number; crisp: boolean }
export function fitScene(free: Rect, scene: Size, dpr: number, focus?: { x: number; y: number }): SceneFit {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const w = positive(free.width), h = positive(free.height);
  const sw = positive(scene.width), sh = positive(scene.height);
  if (!sw || !sh) return { k: 1, cssW: 0, cssH: 0, left: free.left + w / 2, top: free.top + h / 2, crisp: false };
  const available = Math.min(w / sw, h / sh);
  const k = Math.max(1, Math.floor(available * ratio));
  const crisp = available * ratio >= 1;
  const scale = crisp ? k / ratio : available;
  const cssW = sw * scale, cssH = sh * scale;
  const place = (start: number, span: number, extent: number, point: number | undefined) => {
    if (point === undefined || !Number.isFinite(point)) return start + (span - extent) / 2;
    return clamp(start + span / 2 - point * scale, Math.min(start, start + span - extent), Math.max(start, start + span - extent));
  };
  return { k, cssW, cssH, left: place(free.left, w, cssW, focus?.x), top: place(free.top, h, cssH, focus?.y), crisp };
}
