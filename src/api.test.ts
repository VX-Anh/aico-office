import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultBaseUrl, demoWorkers, fetchTicketSnapshot, fetchTickets, roomAgents, type Ticket, type WorkerStatus } from "./api";

const CONFIG = { baseUrl: "http://aico.local:8000", token: "tok" };

function ticket(id: string, status: string): Ticket {
  return { id, title: id, status, project: null, updated_at: status === "done" ? "2026-10-21T09:00:00Z" : null, artifacts: [] };
}

function stubFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("defaultBaseUrl", () => {
  it.each([
    ["https://office.aico.io.vn/", "https://office.aico.io.vn/api"],
    ["https://office.aico.io.vn/x?y=1", "https://office.aico.io.vn/api"],
    ["http://office.aico.io.vn:8000/x#settings", "http://office.aico.io.vn:8000/api"],
    ["https://office.aico.io.vn/preview-other", "https://office.aico.io.vn/api"],
  ])("dùng origin của %s", (url, expected) => {
    expect(defaultBaseUrl(new URL(url))).toBe(expected);
  });

  it.each([
    "http://localhost:5173",
    "http://LOCALHOST:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
    "http://app.localhost",
    "https://nested.app.localhost/",
    "file:///tmp/index.html",
    "ftp://office.aico.io.vn/",
    "https://office.aico.io.vn/preview",
    "https://office.aico.io.vn/preview/T-1/?y=1",
  ])("không điền sẵn cho %s", (url) => {
    expect(defaultBaseUrl(new URL(url))).toBeNull();
  });

  it("chấp nhận location vắng và hostname IPv6 không có ngoặc", () => {
    expect(defaultBaseUrl(null)).toBeNull();
    expect(defaultBaseUrl(undefined)).toBeNull();
    expect(defaultBaseUrl({ protocol: "http:", hostname: "::1", origin: "http://[::1]", pathname: "/" })).toBeNull();
  });

  it("chỉ dùng location truyền vào", () => {
    vi.stubGlobal("location", new URL("http://localhost:5173/"));
    expect(defaultBaseUrl(new URL("https://office.aico.io.vn/"))).toBe("https://office.aico.io.vn/api");
    vi.stubGlobal("location", new URL("https://office.aico.io.vn/"));
    expect(defaultBaseUrl(undefined)).toBeNull();
  });
});

describe("snapshot ticket đầy đủ", () => {
  it("giữ done trong cùng một GET /tickets", async () => {
    const calls = stubFetch([
      ticket("T-1", "awaiting_plan_approval"),
      ticket("T-2", "done"),
      ticket("T-3", "escalated"),
    ]);
    const all = await fetchTicketSnapshot(CONFIG);
    expect(all.map((item) => item.status)).toEqual(["awaiting_plan_approval", "done", "escalated"]);
    expect(calls).toEqual(["http://aico.local:8000/tickets"]);
  });

  it("fetchTickets vẫn chỉ trả ticket cần người", async () => {
    stubFetch([ticket("T-1", "done"), ticket("T-2", "awaiting_merge_approval"), ticket("T-3", "in_progress")]);
    const ids = (await fetchTickets(CONFIG)).map((item) => item.id);
    expect(ids).toEqual(["T-2"]);
  });

  it("danh sách hỏng ném lỗi để nơi gọi giữ snapshot cũ", async () => {
    stubFetch({ items: [] });
    await expect(fetchTicketSnapshot(CONFIG)).rejects.toThrow("aico trả danh sách ticket hỏng");
  });
});

// Chu kỳ 48 giây cũ. Chỉ role/mode của agent đổi khi danh sách vai trò dài thêm.
const DEMO_CYCLE = 48_000;
const OLD_ROLES = ["tech_lead", "coder", "reviewer", "designer"];

function expectedRoom(name: string, s: number): { state: string; count: number; slots: number; roles: string[] } {
  const slots = name === "claude" ? 3 : 2;
  const roles = name === "claude" ? ["tech_lead", "coder", "reviewer"] : ["coder", "reviewer", "designer"];
  if (name === "claude") {
    const count = s < 8 ? 0 : s < 16 ? 1 : s < 32 ? 3 : s < 40 ? 4 : 0;
    return { state: count > 0 ? "working" : "idle", count, slots, roles };
  }
  if (name === "codex") {
    if (s >= 36) return { state: "limited", count: 0, slots, roles };
    if (s >= 28) return { state: "working", count: 1, slots, roles };
    return { state: "idle", count: 0, slots, roles };
  }
  return { state: s < 24 ? "limited" : s < 36 ? "offline" : "idle", count: s >= 40 ? 1 : 0, slots, roles };
}

describe("demoWorkers thêm ba và tester", () => {
  // 1000 % 6 = 4 và 1003 % 6 = 1: hai pha chỉ số vai trò khác nhau. 96 giây = hai chu kỳ liền nhau.
  it.each([1_000, 1_003])("chu kỳ %s: mỗi giây trong 96 giây đủ vai trò, số agent/slots/state giữ kịch bản cũ", (n) => {
    const anchor = n * DEMO_CYCLE;
    const pairs = new Set<string>();
    const roles = new Set<string>();
    const cycles = new Set<number>();
    for (let sec = 0; sec < 96; sec++) {
      const now = anchor + sec * 1000;
      const cycle = Math.floor(now / DEMO_CYCLE);
      const s = (now - cycle * DEMO_CYCLE) / 1000;
      cycles.add(cycle);
      const workers = demoWorkers(now);
      expect(workers.map((w) => w.name)).toEqual(["claude", "codex", "cursor"]);
      for (const w of workers) {
        const exp = expectedRoom(w.name, s);
        expect(w.state, `${w.name}@${sec}`).toBe(exp.state);
        expect(w.slots, `${w.name}@${sec}`).toBe(exp.slots);
        expect(w.roles, `${w.name}@${sec}`).toEqual(exp.roles);
        expect(w.agents ?? [], `${w.name}@${sec}`).toHaveLength(exp.count);
        for (const a of w.agents ?? []) {
          roles.add(a.role ?? "");
          pairs.add(`${a.role}/${a.mode}`);
        }
      }
    }
    expect(cycles.size).toBe(2);
    expect([...pairs].filter((p) => p.startsWith("ba/")).sort()).toEqual(["ba/read"]);
    expect([...pairs].filter((p) => p.startsWith("tester/")).sort()).toEqual(["tester/review"]);
    for (const role of OLD_ROLES) expect(roles.has(role)).toBe(true);
    expect(roles.has("researcher")).toBe(false);
  });

  it("nối ba (read) rồi tester (review) sau designer", () => {
    const pair = (sec: number, name: string) =>
      demoWorkers(sec * 1000).find((w) => w.name === name)!.agents!.map((a) => `${a.role}/${a.mode}`);
    // Chu kỳ 0, chỉ số (cycle + i*2 + k) % 6: claude k=0..3 là 4 vai trò cũ, cursor k=0 là chỉ số 4.
    expect(pair(32, "claude")).toEqual(["tech_lead/read", "coder/write", "reviewer/review", "designer/write"]);
    expect(pair(40, "cursor")).toEqual(["ba/read"]);
    expect(pair(48 + 40, "cursor")).toEqual(["tester/review"]);
    expect(pair(28, "codex")).toEqual(["reviewer/review"]);
  });
});

describe("roomAgents", () => {
  it("chỉ current role researcher thì giữ role", () => {
    const { agents, slots } = roomAgents({
      name: "claude",
      state: "working",
      roles: [],
      current: { role: "researcher" },
    } as unknown as WorkerStatus);
    expect(agents.map((a) => a.role)).toEqual(["researcher"]);
    expect(agents[0]?.id).toBe("claude-current");
    expect(slots).toBe(1);
  });

  it("current đầy đủ ở phòng khác vẫn giữ researcher", () => {
    const current = { role: "researcher", ticket_id: "T-9", mode: "review", started_at: "2026-10-21T00:00:00.000Z" };
    const { agents, slots } = roomAgents({ name: "codex", state: "idle", roles: ["coder"], current });
    expect(agents).toEqual([{ id: "codex-current", ...current }]);
    expect(slots).toBe(1);
  });

  it("agents đã mang researcher thì không lấy role từ current", () => {
    const researcher = { id: "r1", role: "researcher", ticket_id: null, mode: "read", started_at: "2026-10-21T00:00:00.000Z" };
    const { agents, slots } = roomAgents({
      name: "cursor",
      state: "offline",
      roles: [],
      slots: 2,
      agents: [researcher],
      current: { role: "coder", ticket_id: "T-1", mode: "write", started_at: "2026-10-21T00:00:00.000Z" },
    });
    expect(agents).toEqual([researcher]);
    expect(slots).toBe(2);
  });

  it("current role null không bị đổi thành chuỗi", () => {
    const current = { role: null, ticket_id: null, mode: "write", started_at: "2026-10-21T00:00:00.000Z" };
    const { agents } = roomAgents({ name: "cursor", state: "idle", roles: [], current });
    expect(agents[0]?.role).toBeNull();
  });
});
