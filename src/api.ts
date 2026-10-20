// Đọc trạng thái worker từ aico: GET /workers (Bearer API token).
// Không có cấu hình thì chạy chế độ demo với dữ liệu giả để xem giao diện.

export type WorkerState = "idle" | "working" | "limited" | "offline";

export interface WorkerLimit {
  message: string;
  resets_at: string | null;
  detected_at: string;
}

export interface WorkerStatus {
  name: string;
  kind?: string;
  state: WorkerState;
  roles: string[];
  current?: { ticket_id: string | null; role: string | null; mode: string; started_at: string } | null;
  runs_ok?: number;
  runs_failed?: number;
  runs_today?: number;
  tokens_today?: number;
  input_tokens?: number;
  output_tokens?: number;
  last_run_at?: string | null;
  last_duration_seconds?: number | null;
  last_error?: string | null;
  limit?: WorkerLimit | null;
  error?: string;
}

export interface ApiConfig {
  baseUrl: string;
  token: string;
}

const STORAGE_KEY = "aico-office.api";

export function loadConfig(): ApiConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ApiConfig) : null;
  } catch {
    return null;
  }
}

export function saveConfig(config: ApiConfig | null): void {
  try {
    if (config) localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // trình duyệt chặn localStorage: chỉ dùng trong phiên này
  }
}

export async function fetchWorkers(config: ApiConfig): Promise<WorkerStatus[]> {
  const resp = await fetch(`${config.baseUrl.replace(/\/$/, "")}/workers`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  if (resp.status === 401) throw new Error("Sai API token");
  if (!resp.ok) throw new Error(`aico trả ${resp.status}`);
  return (await resp.json()) as WorkerStatus[];
}

// Dữ liệu giả: mỗi agent đổi trạng thái theo chu kỳ để thấy đủ các animation.
export function demoWorkers(now: number): WorkerStatus[] {
  const names = ["claude", "codex", "cursor"];
  const states: WorkerState[] = ["working", "idle", "working", "limited", "idle", "offline"];
  return names.map((name, i) => {
    const state = states[(Math.floor(now / 6000) + i * 2) % states.length];
    const resets = new Date(now + (47 - i * 13) * 60_000).toISOString();
    return {
      name,
      kind: name,
      state,
      roles: i === 0 ? ["tech_lead"] : [],
      current:
        state === "working"
          ? { ticket_id: `T-demo${i}`, role: "tech_lead", mode: "read", started_at: new Date(now - 20_000).toISOString() }
          : null,
      runs_ok: 12 + i * 3,
      runs_failed: i,
      runs_today: 5 + i,
      tokens_today: 120_000 + i * 45_000,
      input_tokens: 900_000 + i * 100_000,
      output_tokens: 40_000 + i * 9_000,
      last_run_at: new Date(now - 90_000).toISOString(),
      last_duration_seconds: 30 + i * 12,
      last_error: state === "limited" ? "You've hit your session limit" : null,
      limit: state === "limited" ? { message: "You've hit your session limit", resets_at: resets, detected_at: new Date(now).toISOString() } : null,
    };
  });
}
