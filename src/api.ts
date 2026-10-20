// Đọc trạng thái worker từ aico: GET /workers (Bearer API token).
// Không có cấu hình thì chạy chế độ demo với dữ liệu giả để xem giao diện.

export type WorkerState = "idle" | "working" | "limited" | "offline";

export interface WorkerLimit {
  message: string;
  resets_at: string | null;
  detected_at: string;
}

export type AgentMode = "read" | "write" | "review";

// Một agent con đang chạy trong phòng (mỗi agent làm một việc cho một ticket).
export interface WorkerAgent {
  id: string;
  role: string | null;
  ticket_id: string | null;
  mode: AgentMode | string;
  started_at: string;
}

// Mỗi phần tử của GET /workers là một phòng (một provider), chứa tối đa `slots` agent con song song.
export interface WorkerStatus {
  name: string;
  kind?: string;
  state: WorkerState;
  roles: string[];
  slots?: number;
  agents?: WorkerAgent[];
  /** @deprecated giữ tương thích, aico sẽ bỏ: dùng `agents` */
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

// Agent con và số chỗ của phòng. aico bản cũ chỉ có `current` thì dựng lại từ đó.
export function roomAgents(w: WorkerStatus): { agents: WorkerAgent[]; slots: number } {
  const agents =
    w.agents ?? (w.current ? [{ id: `${w.name}-current`, ...w.current }] : []);
  return { agents, slots: Math.max(1, w.slots ?? 0, agents.length) };
}

const DEMO_ROLES: { role: string; mode: AgentMode }[] = [
  { role: "tech_lead", mode: "read" },
  { role: "coder", mode: "write" },
  { role: "reviewer", mode: "review" },
  { role: "designer", mode: "write" },
];

// Dữ liệu giả: mỗi phòng đổi trạng thái theo chu kỳ 6 giây để thấy đủ các animation.
// Trong một chu kỳ "working": 2 giây đầu 1 agent con, 2 giây giữa 2 agent, 2 giây cuối agent đầu xong.
export function demoWorkers(now: number): WorkerStatus[] {
  const names = ["claude", "codex", "cursor"];
  const slots = [3, 2, 2];
  const states: WorkerState[] = ["working", "idle", "working", "limited", "idle", "offline"];
  const cycle = Math.floor(now / 6000);
  const cycleStart = cycle * 6000;
  const phase = Math.floor((now - cycleStart) / 2000); // 0, 1, 2
  return names.map((name, i) => {
    const state = states[(cycle + i * 2) % states.length];
    const resets = new Date(now + (47 - i * 13) * 60_000).toISOString();
    const agents: WorkerAgent[] = [];
    if (state === "working") {
      for (let k = 0; k < 2; k++) {
        const running = k === 0 ? phase < 2 : phase > 0;
        if (!running) continue;
        const { role, mode } = DEMO_ROLES[(i * 2 + k + cycle) % DEMO_ROLES.length];
        agents.push({
          id: `${name}-${k}`,
          role,
          ticket_id: `T-demo${i}${k}`,
          mode,
          started_at: new Date(cycleStart + k * 2000).toISOString(),
        });
      }
    }
    return {
      name,
      kind: name,
      state,
      roles: i === 0 ? ["tech_lead", "coder", "reviewer"] : ["coder", "reviewer", "designer"],
      slots: slots[i],
      agents,
      current: agents[0] ?? null,
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
