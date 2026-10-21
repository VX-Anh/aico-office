// Ticket hỏng phải bị từ chối (null hoặc bỏ phần tử, warn một lần); nút chỉ bật khi lý do/artifact cho phép.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoWorkers, escalationAction, fetchEscalationReason, fetchTickets, type Ticket } from "./api";
import {
  actionAvailability,
  applyDemoAction,
  buildEscalationRequest,
  demoTickets,
  escalatedOnly,
  escalationError,
  latestEscalationReason,
  mergeRequest,
  needsConfirm,
  parseTickets,
  reasonKey,
} from "./tickets";

const CONFIG = { baseUrl: "http://aico.local:8000/", token: "tok" };
const PUSH_REASON = "đẩy code lên Git lỗi: remote từ chối";
const MR = { kind: "merge_request", ref: "!7", url: "https://git.example.com/p/merge_requests/7" };

const ticket = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Việc ${id}`,
  status: "escalated",
  project: "aico-office",
  artifacts: [],
  updated_at: "2026-10-21T08:00:00Z",
  ...extra,
});

const event = (to_status: string | null, reason: unknown, created_at?: string) => ({
  to_status,
  data: reason === undefined ? {} : { reason },
  ...(created_at ? { created_at } : {}),
});

let seq = 0;
// Mỗi lần đọc một nguồn riêng vì warn chỉ in một lần theo nội dung.
const who = () => `src${seq++}`;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  vi.unstubAllGlobals();
});

describe("parseTickets và escalatedOnly", () => {
  it("giữ ticket đúng, lọc escalated", () => {
    const raw = [ticket("T-1"), ticket("T-2", { status: "done" }), ticket("T-3", { artifacts: [MR] })];
    const parsed = parseTickets(raw, who())!;
    expect(parsed).toEqual(raw);
    expect(escalatedOnly(parsed).map((t) => t.id)).toEqual(["T-1", "T-3"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("trường tuỳ chọn vắng hoặc null là hợp lệ (aico bản cũ)", () => {
    const parsed = parseTickets([{ id: "T-1", title: "x", status: "escalated" }, ticket("T-2", { artifacts: null, ref: 1 })], who());
    expect(parsed).toEqual([
      { id: "T-1", title: "x", status: "escalated", project: null, artifacts: [], updated_at: null },
      { ...ticket("T-2"), artifacts: [] },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("[] là danh sách rỗng hợp lệ", () => {
    expect(parseTickets([], who())).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  const notArray: [string, unknown][] = [
    ["null", null],
    ["undefined", undefined],
    ["object", { 0: ticket("T-1") }],
    ["chuỗi", "T-1"],
    ["số", 3],
  ];
  for (const [label, raw] of notArray) {
    it(`danh sách là ${label}: null, warn một lần`, () => {
      const name = who();
      expect(parseTickets(raw, name)).toBeNull();
      expect(parseTickets(raw, name)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  }

  const brokenItem: [string, unknown][] = [
    ["phần tử null", null],
    ["phần tử là chuỗi", "T-9"],
    ["phần tử là mảng", [ticket("T-9")]],
    ["thiếu id", { ...ticket("T-9"), id: undefined }],
    ["id rỗng", ticket("")],
    ["id là số", { ...ticket("T-9"), id: 9 }],
    ["thiếu title", { ...ticket("T-9"), title: undefined }],
    ["status là số", ticket("T-9", { status: 3 })],
    ["thiếu status", { ...ticket("T-9"), status: undefined }],
    ["project là số", ticket("T-9", { project: 1 })],
    ["updated_at là object", ticket("T-9", { updated_at: {} })],
  ];
  for (const [label, item] of brokenItem) {
    it(`${label}: bỏ riêng phần tử, warn một lần`, () => {
      const name = who();
      const raw = [ticket("T-1"), item, ticket("T-2")];
      expect(parseTickets(raw, name)?.map((t) => t.id)).toEqual(["T-1", "T-2"]);
      expect(parseTickets(raw, name)?.map((t) => t.id)).toEqual(["T-1", "T-2"]);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  }

  const brokenArtifacts: [string, unknown][] = [
    ["artifacts là object", { 0: MR }],
    ["artifacts là chuỗi", "merge_request"],
    ["artifact null", [null]],
    ["artifact thiếu kind", [{ ...MR, kind: undefined }]],
    ["artifact url là số", [{ ...MR, url: 7 }]],
    ["artifact ref là mảng", [{ ...MR, ref: ["!7"] }]],
  ];
  for (const [label, artifacts] of brokenArtifacts) {
    it(`${label}: vẫn hiện ticket, không đoán MR, warn một lần`, () => {
      const name = who();
      const raw = [ticket("T-1", { artifacts })];
      const parsed = parseTickets(raw, name)!;
      parseTickets(raw, name);
      expect(parsed.map((t) => t.id)).toEqual(["T-1"]);
      expect(mergeRequest(parsed[0]).present).toBe(false);
      expect(actionAvailability(null, parsed[0]).merge).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  }

  it("artifact hỏng bị bỏ, artifact MR đúng bên cạnh vẫn giữ", () => {
    const parsed = parseTickets([ticket("T-1", { artifacts: [{ kind: 1 }, MR] })], who())!;
    expect(parsed[0].artifacts).toEqual([MR]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("latestEscalationReason", () => {
  it("một event escalated", () => {
    expect(latestEscalationReason([event("in_progress", "x"), event("escalated", PUSH_REASON)], who())).toBe(PUSH_REASON);
  });

  it("nhiều lần escalate: lấy lần mới nhất theo created_at, dù thứ tự mảng đảo", () => {
    const events = [
      event("escalated", "lần 2", "2026-10-21T09:00:00Z"),
      event("escalated", "lần 1", "2026-10-21T08:00:00Z"),
      event("in_progress", "không phải escalate", "2026-10-21T10:00:00Z"),
    ];
    expect(latestEscalationReason(events, who())).toBe("lần 2");
  });

  it("thiếu created_at thì cuối mảng là mới nhất", () => {
    const events = [event("escalated", "lần 1", "2026-10-21T09:00:00Z"), event("escalated", "lần 2")];
    expect(latestEscalationReason(events, who())).toBe("lần 2");
  });

  it("cùng giờ thì lấy cái sau trong mảng", () => {
    const t = "2026-10-21T09:00:00Z";
    expect(latestEscalationReason([event("escalated", "a", t), event("escalated", "b", t)], who())).toBe("b");
  });

  it("lần mới nhất không có lý do thì null, không lùi về lý do cũ", () => {
    const events = [event("escalated", PUSH_REASON, "2026-10-21T08:00:00Z"), event("escalated", 5, "2026-10-21T09:00:00Z")];
    expect(latestEscalationReason(events, who())).toBeNull();
  });

  it("data null, reason không phải chuỗi, không có event escalated, rỗng", () => {
    expect(latestEscalationReason([{ to_status: "escalated", data: null }], who())).toBeNull();
    expect(latestEscalationReason([event("escalated", { text: "x" })], who())).toBeNull();
    expect(latestEscalationReason([event("escalated", undefined)], who())).toBeNull();
    expect(latestEscalationReason([event("done", "x"), null, "escalated"], who())).toBeNull();
    expect(latestEscalationReason([], who())).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("events không phải mảng: null, warn một lần", () => {
    const name = who();
    expect(latestEscalationReason({ events: [] }, name)).toBeNull();
    expect(latestEscalationReason({ events: [] }, name)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("mergeRequest", () => {
  const t = (artifacts: unknown[]) => parseTickets([ticket("T-1", { artifacts })], who())![0];

  it("có MR kèm url", () => expect(mergeRequest(t([MR]))).toEqual({ present: true, url: MR.url }));
  it("có MR không kèm url: vẫn bật Merge, không có link", () => {
    expect(mergeRequest(t([{ ...MR, url: null }]))).toEqual({ present: true, url: null });
  });
  it("url javascript:, data:, hỏng bị loại", () => {
    for (const url of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "không phải url", ""]) {
      expect(mergeRequest(t([{ ...MR, url }]))).toEqual({ present: true, url: null });
    }
  });
  it("http được nhận", () => {
    expect(mergeRequest(t([{ ...MR, url: "http://git.local/mr/1" }])).url).toBe("http://git.local/mr/1");
  });
  it("artifact khác không tính là MR", () => {
    expect(mergeRequest(t([{ kind: "branch", ref: "b", url: "https://x" }]))).toEqual({ present: false, url: null });
  });
});

describe("actionAvailability và needsConfirm", () => {
  const plain = parseTickets([ticket("T-1")], who())![0];
  const withMr = parseTickets([ticket("T-2", { artifacts: [MR] })], who())![0];

  it("lý do lỗi đẩy code: Đẩy lại bật", () => {
    expect(actionAvailability(PUSH_REASON, plain)).toEqual({ retry_push: true, merge: false, close: true, fail: true });
    expect(actionAvailability("đẩy code lên Git lỗi", plain).retry_push).toBe(true);
  });

  it("khoảng trắng đầu vẫn nhận", () => {
    expect(actionAvailability("  \n" + PUSH_REASON, plain).retry_push).toBe(true);
  });

  it("lý do khác, tiền tố nằm giữa câu, viết khác, null: Đẩy lại tắt", () => {
    for (const reason of ["reviewer từ chối", `lý do: ${PUSH_REASON}`, "Đẩy code lên Git lỗi", "đẩy code lên git lỗi", "", null]) {
      expect(actionAvailability(reason, plain).retry_push).toBe(false);
    }
  });

  it("có MR: Merge bật; close/fail luôn bật", () => {
    expect(actionAvailability(null, withMr)).toEqual({ retry_push: false, merge: true, close: true, fail: true });
  });

  it("chỉ Đẩy lại gửi ngay, còn lại hỏi xác nhận", () => {
    expect(needsConfirm("retry_push")).toBe(false);
    expect(needsConfirm("merge")).toBe(true);
    expect(needsConfirm("close")).toBe(true);
    expect(needsConfirm("fail")).toBe(true);
  });
});

describe("buildEscalationRequest", () => {
  it("bỏ / cuối base, encode id, body và header đúng", () => {
    const req = buildEscalationRequest(CONFIG, "T-1/ä b", "merge", "owner", "ok rồi");
    expect(req.url).toBe("http://aico.local:8000/tickets/T-1%2F%C3%A4%20b/escalation");
    expect(req.init.method).toBe("POST");
    expect(req.init.headers).toEqual({ Authorization: "Bearer tok", "Content-Type": "application/json" });
    expect(JSON.parse(req.init.body)).toEqual({ action: "merge", actor: "owner", comment: "ok rồi" });
  });

  it("base không có / cuối, ghi chú rỗng vẫn gửi", () => {
    const req = buildEscalationRequest({ baseUrl: "https://aico", token: "t" }, "T-2", "retry_push", "owner", "");
    expect(req.url).toBe("https://aico/tickets/T-2/escalation");
    expect(JSON.parse(req.init.body)).toEqual({ action: "retry_push", actor: "owner", comment: "" });
  });
});

describe("escalationError", () => {
  it("409/501 có detail chuỗi thì trả detail", () => {
    expect(escalationError(409, { detail: "ticket không còn escalated" })).toBe("ticket không còn escalated");
    expect(escalationError(501, { detail: "chưa hỗ trợ merge" })).toBe("chưa hỗ trợ merge");
  });

  it("detail không phải chuỗi, rỗng, body rỗng hoặc hỏng", () => {
    expect(escalationError(409, { detail: [{ msg: "x" }] })).toBe("aico trả 409");
    expect(escalationError(409, { detail: "  " })).toBe("aico trả 409");
    expect(escalationError(501, null)).toBe("aico trả 501");
    expect(escalationError(501, "lỗi")).toBe("aico trả 501");
  });

  it("401 và mã khác", () => {
    expect(escalationError(401, { detail: "bad token" })).toBe("Sai API token");
    expect(escalationError(500, { detail: "trace nội bộ" })).toBe("aico trả 500");
    expect(escalationError(422, { detail: "x" })).toBe("aico trả 422");
  });
});

// fetch giả: trả lần lượt các phản hồi, ghi lại request.
function stubFetch(...responses: Response[]) {
  const calls: [string, RequestInit | undefined][] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const r = responses.shift();
    if (!r) throw new TypeError("Failed to fetch");
    return r;
  });
  return calls;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("gọi API", () => {
  it("fetchTickets: GET /tickets kèm Bearer, chỉ giữ escalated", async () => {
    const calls = stubFetch(json([ticket("T-1"), ticket("T-2", { status: "done" })]));
    expect((await fetchTickets(CONFIG)).map((t) => t.id)).toEqual(["T-1"]);
    expect(calls[0][0]).toBe("http://aico.local:8000/tickets");
    expect(calls[0][1]?.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("fetchTickets: danh sách hỏng ném lỗi để giữ danh sách cũ; 401 báo sai token", async () => {
    stubFetch(json({ items: [] }), json({ detail: "x" }, 401), json({}, 500));
    await expect(fetchTickets(CONFIG)).rejects.toThrow("aico trả danh sách ticket hỏng");
    await expect(fetchTickets(CONFIG)).rejects.toThrow("Sai API token");
    await expect(fetchTickets(CONFIG)).rejects.toThrow("aico trả 500");
  });

  it("fetchEscalationReason: GET /tickets/{id}/events", async () => {
    const calls = stubFetch(json([event("escalated", PUSH_REASON)]));
    expect(await fetchEscalationReason(CONFIG, "T 1")).toBe(PUSH_REASON);
    expect(calls[0][0]).toBe("http://aico.local:8000/tickets/T%201/events");
  });

  it("escalationAction: POST đúng body; 409/501 ném detail; 401 sai token; body không phải JSON", async () => {
    const calls = stubFetch(
      json({ ok: true }),
      json({ detail: "ticket không còn escalated" }, 409),
      json({ detail: "chưa hỗ trợ" }, 501),
      json({ detail: "x" }, 401),
      new Response("Bad Gateway", { status: 502 }),
    );
    await expect(escalationAction(CONFIG, "T-1", "close", "owner", "xong")).resolves.toBeUndefined();
    expect(calls[0][0]).toBe("http://aico.local:8000/tickets/T-1/escalation");
    expect(calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ action: "close", actor: "owner", comment: "xong" });
    await expect(escalationAction(CONFIG, "T-1", "merge", "owner", "")).rejects.toThrow("ticket không còn escalated");
    await expect(escalationAction(CONFIG, "T-1", "merge", "owner", "")).rejects.toThrow("chưa hỗ trợ");
    await expect(escalationAction(CONFIG, "T-1", "fail", "owner", "")).rejects.toThrow("Sai API token");
    await expect(escalationAction(CONFIG, "T-1", "fail", "owner", "")).rejects.toThrow("aico trả 502");
  });
});

describe("demo", () => {
  it("2 ticket: một lỗi đẩy code không MR, một có MR", () => {
    const [push, merge] = demoTickets();
    expect(parseTickets(demoTickets(), who())).toHaveLength(2);
    expect(escalatedOnly(demoTickets())).toHaveLength(2);
    expect(actionAvailability(push.reason, push)).toEqual({ retry_push: true, merge: false, close: true, fail: true });
    expect(actionAvailability(merge.reason, merge)).toEqual({ retry_push: false, merge: true, close: true, fail: true });
    expect(mergeRequest(merge).url).toMatch(/^https:/);
    expect(warn).not.toHaveBeenCalled();
  });

  const results: [Parameters<typeof applyDemoAction>[2], string][] = [
    ["retry_push", "in_progress"],
    ["merge", "done"],
    ["close", "closed"],
    ["fail", "failed"],
  ];
  for (const [action, status] of results) {
    it(`${action} → ${status}, ticket rời danh sách escalated, ticket khác giữ nguyên`, () => {
      const before = demoTickets();
      const after = applyDemoAction(before, before[0].id, action);
      expect(after[0].status).toBe(status);
      expect(after[0].reason).toBe(before[0].reason);
      expect(after[1]).toBe(before[1]);
      expect(before[0].status).toBe("escalated");
      expect(escalatedOnly(after).map((t) => t.id)).toEqual([before[1].id]);
    });
  }

  it("id không có thì không đổi gì", () => {
    expect(applyDemoAction(demoTickets(), "T-không-có", "close")).toEqual(demoTickets());
  });

  it("demoWorkers giữ nguyên: 3 phòng", () => {
    expect(demoWorkers(48_000_000).map((w) => w.name)).toEqual(["claude", "codex", "cursor"]);
  });
});

describe("dữ liệu đổi giữa chừng", () => {
  const view = (raw: unknown, name: string, reasons: Record<string, string | null> = {}) =>
    (parseTickets(raw, name) ?? []).filter((t) => t.status === "escalated").map((t: Ticket) => {
      const a = actionAvailability(reasons[t.id] ?? null, t);
      return `${t.id}:${a.retry_push ? "R" : "-"}${a.merge ? "M" : "-"}`;
    });

  it("MR xuất hiện rồi mất: Merge tắt → bật → tắt", () => {
    const name = who();
    const polls = [[], [MR], []].map((artifacts) => view([ticket("T-1", { artifacts })], name));
    expect(polls).toEqual([["T-1:--"], ["T-1:-M"], ["T-1:--"]]);
  });

  it("updated_at đổi kèm lý do mới: khoá cache đổi, Đẩy lại bật/tắt theo", () => {
    const polls: [string, unknown[]][] = [
      ["2026-10-21T08:00:00Z", [event("escalated", PUSH_REASON, "2026-10-21T08:00:00Z")]],
      ["2026-10-21T09:00:00Z", [event("escalated", PUSH_REASON, "2026-10-21T08:00:00Z"), event("escalated", "reviewer từ chối", "2026-10-21T09:00:00Z")]],
      ["2026-10-21T10:00:00Z", [event("escalated", "reviewer từ chối", "2026-10-21T09:00:00Z"), event("escalated", PUSH_REASON, "2026-10-21T10:00:00Z")]],
    ];
    const keys = new Set<string>();
    const seen = polls.map(([updated_at, events]) => {
      const t = parseTickets([ticket("T-1", { updated_at })], who())![0];
      keys.add(reasonKey(t));
      return actionAvailability(latestEscalationReason(events, who()), t).retry_push;
    });
    expect(seen).toEqual([true, false, true]);
    expect(keys.size).toBe(3);
    // updated_at giữ nguyên thì không cần tải lại lý do
    expect(reasonKey(parseTickets([ticket("T-1", { title: "đổi tên" })], who())![0])).toBe(reasonKey(parseTickets([ticket("T-1")], who())![0]));
  });

  it("số ticket 2 → 0 → 3", () => {
    const name = who();
    const polls = [
      [ticket("T-1"), ticket("T-2")],
      [ticket("T-1", { status: "done" }), ticket("T-2", { status: "closed" })],
      [ticket("T-3"), ticket("T-4", { artifacts: [MR] }), ticket("T-5")],
    ].map((raw) => view(raw, name).length);
    expect(polls).toEqual([2, 0, 3]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("ticket mất rồi xuất hiện lại: đọc lại như mới", () => {
    const name = who();
    const polls = [[ticket("T-1", { artifacts: [MR] }), ticket("T-2")], [ticket("T-2")], [ticket("T-1"), ticket("T-2")]].map((raw) =>
      view(raw, name),
    );
    expect(polls).toEqual([["T-1:-M", "T-2:--"], ["T-2:--"], ["T-1:--", "T-2:--"]]);
  });

  it("dữ liệu hỏng giữa hai lần đọc rồi lành lại: null → nơi gọi giữ danh sách cũ; warn một lần", () => {
    const name = who();
    const good = [ticket("T-1"), ticket("T-2", { artifacts: [MR] })];
    let shown: string[] = [];
    const seen = [good, { detail: "lỗi" }, [ticket("T-1"), { id: 5 }], { detail: "lỗi" }, good].map((raw) => {
      const parsed = parseTickets(raw, name);
      if (parsed) shown = escalatedOnly(parsed).map((t) => t.id);
      return [parsed === null, shown.join(",")];
    });
    expect(seen).toEqual([
      [false, "T-1,T-2"],
      [true, "T-1,T-2"],
      [false, "T-1"],
      [true, "T-1"],
      [false, "T-1,T-2"],
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("lý do hỏng giữa hai lần đọc rồi lành lại", () => {
    const name = who();
    const t = parseTickets([ticket("T-1")], who())![0];
    const seen = [[event("escalated", PUSH_REASON)], { events: [] }, [event("escalated", null)], [event("escalated", PUSH_REASON)]].map(
      (events) => actionAvailability(latestEscalationReason(events, name), t).retry_push,
    );
    expect(seen).toEqual([true, false, false, true]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
