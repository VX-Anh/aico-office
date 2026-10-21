export interface AttentionEntry {
  id: string;
  kind: string;
  label: string;
}

export interface ToastState {
  toasts: AttentionEntry[];
  known: Set<string>;
  dismissed: Set<string>;
  primed: boolean;
}

export function tabTitle(n: number): string {
  return n > 0 ? `(${n}) AICO Office` : "AICO Office";
}

export function nextAttention(ids: readonly string[], currentId: string | null): string | null {
  if (ids.length === 0) return null;
  const index = currentId === null ? -1 : ids.indexOf(currentId);
  return ids[(index + 1) % ids.length];
}

export function isShortcut(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  editable: boolean;
}): boolean {
  return (e.key === "p" || e.key === "P")
    && !e.ctrlKey && !e.metaKey && !e.altKey && !e.editable;
}

function toastKey(entry: AttentionEntry): string {
  return `${entry.id}|${entry.kind}`;
}

export function resetToasts(): ToastState {
  return { toasts: [], known: new Set(), dismissed: new Set(), primed: false };
}

export function reconcileToasts(
  state: ToastState, entries: readonly AttentionEntry[], max = 3,
): ToastState {
  const current = new Map<string, AttentionEntry>();
  for (const entry of entries) {
    const key = toastKey(entry);
    if (!current.has(key)) current.set(key, { ...entry });
  }
  const known = new Set(current.keys());
  const dismissed = new Set([...state.dismissed].filter(key => known.has(key)));
  if (!state.primed) return { toasts: [], known, dismissed, primed: true };

  // Đầu vào đã xếp mới nhất trước; toast mới đứng trước những toast còn giữ.
  const added = [...current].filter(([key]) => !state.known.has(key) && !dismissed.has(key))
    .map(([, entry]) => entry);
  const retained = state.toasts.flatMap(entry => {
    const key = toastKey(entry);
    const latest = current.get(key);
    return latest && !dismissed.has(key) ? [latest] : [];
  });
  const limit = Number.isNaN(max) ? 0 : Math.max(0, Math.floor(max));
  return { toasts: [...added, ...retained].slice(0, limit), known, dismissed, primed: true };
}

export function dismissToast(state: ToastState, key: string): ToastState {
  const dismissed = new Set(state.dismissed);
  if (state.known.has(key)) dismissed.add(key);
  return {
    ...state,
    toasts: state.toasts.filter(entry => toastKey(entry) !== key),
    known: new Set(state.known),
    dismissed,
  };
}
