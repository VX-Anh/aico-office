import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultBaseUrl, fetchTicketSnapshot, fetchTickets, type Ticket } from "./api";

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
