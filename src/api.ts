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
  /** Hạn mức subscription; null khi worker chưa đọc xong hoặc aico bản cũ. Đọc qua `parseUsage` (src/usage.ts). */
  usage?: unknown;
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
// `slots` giữ đúng như aico trả (agent vượt chỗ hiện `+N`); chỉ suy ra khi aico không trả `slots`.
export function roomAgents(w: WorkerStatus): { agents: WorkerAgent[]; slots: number } {
  const agents =
    w.agents ?? (w.current ? [{ id: `${w.name}-current`, ...w.current }] : []);
  const slots = typeof w.slots === "number" ? Math.max(0, Math.floor(w.slots)) : Math.max(1, agents.length);
  return { agents, slots };
}

const DEMO_ROLES: { role: string; mode: AgentMode }[] = [
  { role: "tech_lead", mode: "read" },
  { role: "coder", mode: "write" },
  { role: "reviewer", mode: "review" },
  { role: "designer", mode: "write" },
];

const DEMO_CYCLE = 48_000;

// Dữ liệu giả: kịch bản 48 giây, mỗi pha ít nhất 8 giây để kịp thấy nhân vật đi vào/ra.
// claude (3 chỗ): 0 → 1 → 2 → 1 → 0 agent con; hạn mức session 20 → 70% (xanh → vàng), tuần 84% (đỏ),
//   40–48 giây số liệu cũ 20 phút kèm lỗi đọc CLI;
// codex (2 chỗ): hạn mức 5h 40 → 100% trong 0–36 giây (đủ ba màu), 1 agent từ giây 28,
//   chạm 100% thì hết hạn mức tới cuối chu kỳ và agent rời bàn;
// cursor (2 chỗ): không công bố hạn mức (gói Pro); hết hạn mức 24 giây (ngủ trên sofa)
//   → mất kết nối 12 giây (tắt đèn, chưa có usage) → rảnh.
export function demoWorkers(now: number): WorkerStatus[] {
  const names = ["claude", "codex", "cursor"];
  const slots = [3, 2, 2];
  const cycle = Math.floor(now / DEMO_CYCLE);
  const cycleStart = cycle * DEMO_CYCLE;
  const s = (now - cycleStart) / 1000;
  const iso = (ms: number) => new Date(ms).toISOString();
  // id ổn định suốt thời gian agent chạy, đổi theo chu kỳ để mỗi vòng là agent mới
  const agent = (i: number, k: number, from: number): WorkerAgent => {
    const { role, mode } = DEMO_ROLES[(cycle + i * 2 + k) % DEMO_ROLES.length];
    return {
      id: `${names[i]}-${cycle}-${k}`,
      role,
      ticket_id: `T-demo${i}${k}`,
      mode,
      started_at: iso(cycleStart + from * 1000),
    };
  };
  const codexLimited = s >= 36;
  const running: WorkerAgent[][] = [
    [...(s >= 8 && s < 40 ? [agent(0, 0, 8)] : []), ...(s >= 16 && s < 32 ? [agent(0, 1, 16)] : [])],
    s >= 28 && !codexLimited ? [agent(1, 0, 28)] : [],
    [],
  ];
  const cursorState: WorkerState = s < 24 ? "limited" : s < 36 ? "offline" : "idle";
  const claudeStale = s >= 40;
  const usages: unknown[] = [
    {
      checked_at: iso(claudeStale ? now - 20 * 60_000 : now),
      source: "claude /usage",
      plan: "max",
      windows: [
        { name: "session", window_minutes: 300, used_percent: 20 + (50 * s) / 48, resets_at: iso(cycleStart + 65 * 60_000) },
        { name: "week (all models)", window_minutes: 10080, used_percent: 84, resets_at: iso(cycleStart + 3 * 86_400_000) },
      ],
      ...(claudeStale ? { error: "không đọc được hạn mức từ CLI" } : {}),
    },
    {
      checked_at: iso(now),
      source: "codex /status",
      plan: "plus",
      windows: [
        { name: "5h", window_minutes: 300, used_percent: 40 + (60 * Math.min(s, 36)) / 36, resets_at: iso(cycleStart + DEMO_CYCLE) },
        { name: "week", window_minutes: 10080, used_percent: 35, resets_at: iso(cycleStart + 5 * 86_400_000) },
      ],
    },
    cursorState === "offline"
      ? null
      : { checked_at: iso(now), source: "cursor-agent", plan: "Pro", windows: [], note: "CLI không công bố hạn mức" },
  ];
  // codex hết hạn mức khi 5h chạm 100%, mở lại cuối chu kỳ; cursor mở lại sau 47 phút
  const resets = [null, iso(cycleStart + DEMO_CYCLE), iso(cycleStart + 47 * 60_000)];
  return names.map((name, i) => {
    const agents = running[i];
    const state: WorkerState =
      i === 2 ? cursorState : i === 1 && codexLimited ? "limited" : agents.length ? "working" : "idle";
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
      last_run_at: iso(now - 90_000),
      last_duration_seconds: 30 + i * 12,
      last_error: state === "limited" ? "You've hit your session limit" : null,
      limit: state === "limited" ? { message: "You've hit your session limit", resets_at: resets[i], detected_at: iso(now) } : null,
      usage: usages[i],
    };
  });
}
