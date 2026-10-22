// Ticket hỏng phải bị từ chối (null hoặc bỏ phần tử, warn một lần); nút chỉ bật khi lý do/artifact cho phép.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decisionAction, demoWorkers, escalationAction, fetchEscalationReason, fetchTickets, needAction, type Ticket } from "./api";
import {
  type NeedAction,
  type NeedKind,
  NEED_LABEL,
  actionAvailability,
  actionError,
  actionsFor,
  applyDemoAction,
  buildDecisionRequest,
  buildEscalationRequest,
  canSubmit,
  commentRequired,
  createReasonCache,
  demoNeedTickets,
  demoTickets,
  irreversible,
  latestEscalationReason,
  latestScreenshots,
  mergeRequest,
  needKind,
  needsConfirmation,
  needsYou,
  parseTickets,
  previewLink,
  reasonKey,
  waitedLabel,
} from "./tickets";

const CONFIG = { baseUrl: "http://aico.local:8000/", token: "tok" };
const PUSH_REASON = "đẩy code lên Git lỗi: remote từ chối";
const MR = { kind: "merge_request", ref: "!7", url: "https://git.example.com/p/merge_requests/7" };
const PREVIEW = { kind: "preview", ref: null, url: "https://preview.example.com/7" };

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

const escalated = (list: Ticket[]) => list.filter((t) => needKind(t.status) === "escalated");

describe("parseTickets", () => {
  it("giữ ticket đúng, lọc escalated", () => {
    const raw = [ticket("T-1"), ticket("T-2", { status: "done" }), ticket("T-3", { artifacts: [MR] })];
    const parsed = parseTickets(raw, who())!;
    expect(parsed).toEqual(raw);
    expect(escalated(parsed).map((t) => t.id)).toEqual(["T-1", "T-3"]);
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

describe("actionAvailability và needsConfirmation của escalated", () => {
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
    expect(needsConfirmation("escalated", "retry_push")).toBe(false);
    expect(needsConfirmation("escalated", "merge")).toBe(true);
    expect(needsConfirmation("escalated", "close")).toBe(true);
    expect(needsConfirmation("escalated", "fail")).toBe(true);
  });
});

describe("needKind, NEED_LABEL và needsYou", () => {
  it("3 trạng thái cần người, còn lại null", () => {
    expect(needKind("awaiting_plan_approval")).toBe("plan");
    expect(needKind("awaiting_merge_approval")).toBe("merge");
    expect(needKind("escalated")).toBe("escalated");
    for (const status of ["done", "in_progress", "planning", "rejected", "closed", "failed", "", "ESCALATED", "toString", "__proto__"]) {
      expect(needKind(status)).toBeNull();
    }
  });

  it("nhãn tiếng Việt cho từng loại", () => {
    expect(NEED_LABEL).toEqual({ plan: "duyệt kế hoạch", merge: "duyệt merge", escalated: "escalated" });
  });

  it("lọc 3 loại, mới nhất trước", () => {
    const list = parseTickets([
      ticket("T-a", { updated_at: "2026-10-21T08:00:00Z" }),
      ticket("T-b", { status: "done", updated_at: "2026-10-21T12:00:00Z" }),
      ticket("T-c", { status: "awaiting_plan_approval", updated_at: "2026-10-21T10:00:00Z" }),
      ticket("T-d", { status: "awaiting_merge_approval", updated_at: "2026-10-21T09:00:00+07:00" }),
    ], who())!;
    // 09:00+07:00 = 02:00Z nên cũ nhất
    expect(needsYou(list).map((t) => t.id)).toEqual(["T-c", "T-a", "T-d"]);
  });

  it("updated_at null hoặc hỏng xếp cuối, theo id; bằng giờ xếp theo id", () => {
    const list = parseTickets([
      ticket("T-z", { updated_at: null }),
      ticket("T-y", { updated_at: "không phải giờ" }),
      ticket("T-2", { status: "awaiting_plan_approval" }),
      ticket("T-1", { status: "awaiting_merge_approval" }),
      ticket("T-x", { updated_at: "2026-10-21T07:00:00Z" }),
    ], who())!;
    expect(needsYou(list).map((t) => t.id)).toEqual(["T-1", "T-2", "T-x", "T-y", "T-z"]);
  });

  it("thứ tự không phụ thuộc thứ tự aico trả; không sửa mảng gốc", () => {
    const raw = [
      ticket("T-3", { updated_at: null }),
      ticket("T-1"),
      ticket("T-2"),
      ticket("T-4", { updated_at: "2026-10-21T09:00:00Z" }),
    ];
    const a = parseTickets(raw, who())!;
    const b = parseTickets([...raw].reverse(), who())!;
    const ids = a.map((t) => t.id);
    expect(needsYou(a).map((t) => t.id)).toEqual(["T-4", "T-1", "T-2", "T-3"]);
    expect(needsYou(b).map((t) => t.id)).toEqual(["T-4", "T-1", "T-2", "T-3"]);
    expect(a.map((t) => t.id)).toEqual(ids);
    expect(needsYou([])).toEqual([]);
  });
});

describe("actionsFor, commentRequired, canSubmit, irreversible", () => {
  const plain = parseTickets([ticket("T-1")], who())![0];
  const withMr = parseTickets([ticket("T-2", { artifacts: [MR] })], who())![0];
  const flat = (list: { action: NeedAction; enabled: boolean }[]) => list.map((a) => `${a.action}:${a.enabled ? 1 : 0}`);

  it("duyệt kế hoạch: 3 nút luôn bật, kể cả không có MR hay lý do", () => {
    expect(flat(actionsFor("plan", null, plain))).toEqual(["approved:1", "revise:1", "rejected:1"]);
  });

  it("duyệt merge: 3 nút luôn bật", () => {
    expect(flat(actionsFor("merge", null, plain))).toEqual(["approved:1", "changes_requested:1", "rejected:1"]);
    expect(flat(actionsFor("merge", PUSH_REASON, withMr))).toEqual(["approved:1", "changes_requested:1", "rejected:1"]);
  });

  it("escalated: dùng lại actionAvailability (Đẩy lại theo lý do, Merge theo MR)", () => {
    expect(flat(actionsFor("escalated", null, plain))).toEqual(["retry_push:0", "merge:0", "close:1", "fail:1"]);
    expect(flat(actionsFor("escalated", PUSH_REASON, plain))).toEqual(["retry_push:1", "merge:0", "close:1", "fail:1"]);
    expect(flat(actionsFor("escalated", "reviewer từ chối", withMr))).toEqual(["retry_push:0", "merge:1", "close:1", "fail:1"]);
    expect(flat(actionsFor("escalated", PUSH_REASON, withMr))).toEqual(["retry_push:1", "merge:1", "close:1", "fail:1"]);
  });

  it("ghi chú bắt buộc với revise, changes_requested, rejected", () => {
    const required = ["revise", "changes_requested", "rejected"];
    for (const action of ["approved", "revise", "changes_requested", "rejected", "retry_push", "merge", "close", "fail"] as NeedAction[]) {
      expect(commentRequired(action)).toBe(required.includes(action));
    }
  });

  it("canSubmit: ghi chú trống hoặc chỉ khoảng trắng thì chặn hành động bắt buộc ghi chú", () => {
    for (const action of ["revise", "changes_requested", "rejected"] as NeedAction[]) {
      expect(canSubmit(action, "")).toBe(false);
      expect(canSubmit(action, "   \n\t")).toBe(false);
      expect(canSubmit(action, " thiếu test ")).toBe(true);
    }
    for (const action of ["approved", "retry_push", "merge", "close", "fail"] as NeedAction[]) {
      expect(canSubmit(action, "")).toBe(true);
      expect(canSubmit(action, "  ")).toBe(true);
    }
  });

  it("irreversible: rejected, close, fail, merge", () => {
    const yes = ["rejected", "close", "fail", "merge"];
    for (const action of ["approved", "revise", "changes_requested", "rejected", "retry_push", "merge", "close", "fail"] as NeedAction[]) {
      expect(irreversible(action)).toBe(yes.includes(action));
    }
  });
});

describe("needsConfirmation", () => {
  // Ghi tay đủ 3 loại x 8 hành động, không sinh từ hàm đang kiểm.
  const table: [NeedKind, NeedAction, boolean][] = [
    ["plan", "approved", false],
    ["plan", "revise", false],
    ["plan", "changes_requested", false],
    ["plan", "rejected", true],
    ["plan", "retry_push", false],
    ["plan", "merge", false],
    ["plan", "close", false],
    ["plan", "fail", false],
    ["merge", "approved", true],
    ["merge", "revise", false],
    ["merge", "changes_requested", false],
    ["merge", "rejected", true],
    ["merge", "retry_push", false],
    ["merge", "merge", false],
    ["merge", "close", false],
    ["merge", "fail", false],
    ["escalated", "approved", false],
    ["escalated", "revise", false],
    ["escalated", "changes_requested", false],
    ["escalated", "rejected", false],
    ["escalated", "retry_push", false],
    ["escalated", "merge", true],
    ["escalated", "close", true],
    ["escalated", "fail", true],
  ];

  for (const [kind, action, yes] of table) {
    it(`${kind}/${action}: ${yes ? "hỏi xác nhận" : "không hỏi"}`, () => {
      expect(needsConfirmation(kind, action)).toBe(yes);
    });
  }

  it("bảng đủ 24 cặp, không trùng", () => {
    expect(new Set(table.map(([k, a]) => `${k}/${a}`)).size).toBe(24);
  });

  it("cặp hợp lệ khác merge/approved giữ đúng như irreversible", () => {
    const valid: [NeedKind, NeedAction][] = [
      ["plan", "approved"], ["plan", "revise"], ["plan", "rejected"],
      ["merge", "changes_requested"], ["merge", "rejected"],
      ["escalated", "retry_push"], ["escalated", "merge"], ["escalated", "close"], ["escalated", "fail"],
    ];
    for (const [kind, action] of valid) {
      expect(needsConfirmation(kind, action)).toBe(irreversible(action));
    }
    // merge/approved là chỗ duy nhất khác irreversible
    expect(irreversible("approved")).toBe(false);
    expect(needsConfirmation("merge", "approved")).toBe(true);
  });

  it("ticket đổi loại plan → merge → escalated: cùng hành động hỏi xác nhận theo loại hiện tại", () => {
    expect(["plan", "merge", "escalated"].map((k) => needsConfirmation(k as NeedKind, "approved"))).toEqual([false, true, false]);
    expect(["plan", "merge", "escalated"].map((k) => needsConfirmation(k as NeedKind, "merge"))).toEqual([false, false, true]);
  });
});

describe("buildDecisionRequest", () => {
  it("bỏ / cuối base, encode id, body {decision, actor: owner, comment}", () => {
    const req = buildDecisionRequest(CONFIG, "T-1/ä b", "changes_requested", "thiếu test");
    expect(req.url).toBe("http://aico.local:8000/tickets/T-1%2F%C3%A4%20b/decisions");
    expect(req.init.method).toBe("POST");
    expect(req.init.headers).toEqual({ Authorization: "Bearer tok", "Content-Type": "application/json" });
    expect(JSON.parse(req.init.body)).toEqual({ decision: "changes_requested", actor: "owner", comment: "thiếu test" });
  });

  it("base không có / cuối, ghi chú rỗng vẫn gửi nguyên", () => {
    const req = buildDecisionRequest({ baseUrl: "https://aico", token: "t" }, "T-2", "approved", "");
    expect(req.url).toBe("https://aico/tickets/T-2/decisions");
    expect(JSON.parse(req.init.body)).toEqual({ decision: "approved", actor: "owner", comment: "" });
  });
});

describe("previewLink", () => {
  const t = (artifacts: unknown[]) => parseTickets([ticket("T-1", { artifacts })], who())![0];
  it("lấy url xem trước hợp lệ cuối cùng", () => {
    expect(previewLink(t([PREVIEW]))).toBe(PREVIEW.url);
    expect(previewLink(t([PREVIEW, { kind: "preview", ref: null, url: "http://p.local/2" }]))).toBe("http://p.local/2");
    expect(previewLink(t([PREVIEW, { kind: "preview", ref: null, url: "javascript:alert(1)" }]))).toBe(PREVIEW.url);
  });
  it("chỉ http/https; không có preview, url null hoặc hỏng thì null", () => {
    expect(previewLink(t([{ kind: "preview", ref: null, url: "javascript:alert(1)" }]))).toBeNull();
    expect(previewLink(t([{ kind: "preview", ref: null, url: "data:text/html,x" }]))).toBeNull();
    expect(previewLink(t([{ kind: "preview", ref: "p", url: null }]))).toBeNull();
    expect(previewLink(t([{ kind: "preview", ref: null, url: "không phải url" }]))).toBeNull();
    expect(previewLink(t([MR]))).toBeNull();
    expect(previewLink(t([]))).toBeNull();
  });
});

describe("latestScreenshots", () => {
  const t = (artifacts: unknown[]) => parseTickets([ticket("T-1", { artifacts })], who())![0];
  const SHOT_BASE = "https://preview.aico.io.vn/preview/img-T-1-";
  const shot = (ref: string | null, url: string | null = ref && `${SHOT_BASE}${ref}`) => ({ kind: "screenshot", ref, url });
  const labels = (artifacts: unknown[]) => latestScreenshots(t(artifacts)).map((s) => s.label);

  it("chỉ lấy bộ mới nhất, sắp theo tên file, label bỏ .png", () => {
    const list = latestScreenshots(
      t([
        shot("20261022-075400/390x844-hour-11.png"),
        shot("20261021-080000/1440x900-hour-11.png"),
        shot("20261022-075400/1440x900-hour-21.png"),
        shot("20261022-075400/1440x900-hour-11.png"),
        MR,
      ]),
    );
    expect(list).toEqual([
      { url: `${SHOT_BASE}20261022-075400/1440x900-hour-11.png`, label: "1440x900-hour-11" },
      { url: `${SHOT_BASE}20261022-075400/1440x900-hour-21.png`, label: "1440x900-hour-21" },
      { url: `${SHOT_BASE}20261022-075400/390x844-hour-11.png`, label: "390x844-hour-11" },
    ]);
  });

  it("thứ tự không phụ thuộc thứ tự artifact; so theo mã ký tự, không theo locale", () => {
    const files = ["b.png", "A.png", "a.png", "_x.png", "10.png", "9.png"];
    const sorted = ["10", "9", "A", "_x", "a", "b"];
    expect(labels(files.map((f) => shot(`20261022-075400/${f}`)))).toEqual(sorted);
    expect(labels([...files].reverse().map((f) => shot(`20261022-075400/${f}`)))).toEqual(sorted);
  });

  it("trùng tên file trong cùng bộ thì giữ cái sau", () => {
    const ref = "20261022-075400/a.png";
    expect(latestScreenshots(t([shot(ref, "https://x/1.png"), shot(ref, "https://x/2.png")]))).toEqual([
      { url: "https://x/2.png", label: "a" },
    ]);
  });

  it("url xấu, javascript:, data:, tương đối thì bỏ ảnh đó", () => {
    const ok = shot("20261022-075400/ok.png");
    for (const url of ["javascript:alert(1)", "data:image/png;base64,AAAA", "demo-shots/a.png", "/a.png", "không phải url", "ftp://x/a.png", ""]) {
      expect(labels([ok, shot("20261022-075400/bad.png", url)])).toEqual(["ok"]);
    }
    expect(labels([shot("20261022-075400/http.png", "http://p.local/a.png")])).toEqual(["http"]);
  });

  it("thiếu ref hoặc url thì bỏ", () => {
    const ok = shot("20261022-075400/ok.png");
    expect(labels([ok, shot(null, "https://x/a.png"), shot("20261022-075400/a.png", null)])).toEqual(["ok"]);
    expect(labels([ok, { kind: "screenshot" }, { kind: "screenshot", url: "https://x/b.png" }])).toEqual(["ok"]);
  });

  it("ref sai dạng thì bỏ, kể cả khi thời điểm trông mới hơn", () => {
    const ok = shot("20261022-075400/ok.png");
    for (const ref of [
      "20261022-075400/a.jpg",
      "20261022-075400/a.PNG",
      "20261022-075400/.png/x",
      "2026102-075400/a.png",
      "20261023-0754/a.png",
      "20261023-075400/sub/a.png",
      "20261023-075400/a b.png",
      "20261023-075400/../a.png",
      " 20261023-075400/a.png",
      "20261023-075400/a.png ",
      "20261023-075400a.png",
      "/a.png",
    ]) {
      expect(labels([ok, shot(ref)])).toEqual(["ok"]);
    }
  });

  it("chỉ kind screenshot", () => {
    expect(labels([{ kind: "preview", ref: "20261022-075400/a.png", url: "https://x/a.png" }])).toEqual([]);
    expect(labels([{ kind: "Screenshot", ref: "20261022-075400/a.png", url: "https://x/a.png" }])).toEqual([]);
  });

  it("bộ mới nhất toàn url hỏng thì lùi về bộ hợp lệ gần nhất", () => {
    expect(
      labels([
        shot("20261020-080000/old.png"),
        shot("20261021-080000/mid.png"),
        shot("20261022-075400/new-a.png", "javascript:alert(1)"),
        shot("20261022-075400/new-b.png", null),
      ]),
    ).toEqual(["mid"]);
  });

  it("tối đa 16 ảnh: 20 ảnh thì lấy 16 ảnh đầu theo tên", () => {
    const names = Array.from({ length: 20 }, (_, i) => `s${String(i).padStart(2, "0")}`);
    const list = labels([...names].reverse().map((n) => shot(`20261022-075400/${n}.png`)));
    expect(list).toEqual(names.slice(0, 16));
  });

  it("ticket không có screenshot thì []", () => {
    expect(latestScreenshots(t([]))).toEqual([]);
    expect(latestScreenshots(t([MR, PREVIEW]))).toEqual([]);
  });

  it("hàm thuần: không warn, không đổi ticket", () => {
    const tk = t([shot("20261022-075400/b.png"), shot("20261022-075400/a.png")]);
    const copy = JSON.parse(JSON.stringify(tk));
    latestScreenshots(tk);
    expect(tk).toEqual(copy);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("waitedLabel", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  it("giây, phút, giờ, ngày", () => {
    expect(waitedLabel("2026-10-21T11:59:15Z", now)).toBe("chờ 45 giây");
    expect(waitedLabel("2026-10-21T11:55:00Z", now)).toBe("chờ 5 phút");
    expect(waitedLabel("2026-10-21T10:00:00Z", now)).toBe("chờ 2 giờ");
    expect(waitedLabel("2026-10-21T09:35:00Z", now)).toBe("chờ 2 giờ 25 phút");
    expect(waitedLabel("2026-10-18T11:00:00Z", now)).toBe("chờ 3 ngày");
  });
  it("giờ tương lai coi như vừa xong; null hoặc hỏng thì chưa rõ", () => {
    expect(waitedLabel("2026-10-21T12:05:00Z", now)).toBe("chờ 0 giây");
    expect(waitedLabel(null, now)).toBe("chưa rõ");
    expect(waitedLabel("", now)).toBe("chưa rõ");
    expect(waitedLabel("hôm qua", now)).toBe("chưa rõ");
    expect(waitedLabel("2026-10-21T11:00:00Z", NaN)).toBe("chưa rõ");
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

describe("actionError", () => {
  it("mọi mã ≥ 400 có detail chuỗi thì trả detail", () => {
    for (const status of [400, 404, 409, 422, 500, 501, 502]) {
      expect(actionError(status, { detail: "ticket không còn chờ duyệt" })).toBe("ticket không còn chờ duyệt");
    }
  });

  it("422 của FastAPI: detail mảng {msg} thì nối các msg", () => {
    const body = { detail: [{ loc: ["body", "comment"], msg: "comment bắt buộc", type: "missing" }, { msg: "decision sai" }] };
    expect(actionError(422, body)).toBe("comment bắt buộc; decision sai");
    expect(actionError(422, { detail: [{ msg: "  " }, { loc: [] }, "x", { msg: 5 }] })).toBe("aico trả 422");
    expect(actionError(422, { detail: [] })).toBe("aico trả 422");
  });

  it("detail rỗng, sai kiểu, body rỗng hoặc không phải JSON object", () => {
    expect(actionError(409, { detail: "  " })).toBe("aico trả 409");
    expect(actionError(409, { detail: 5 })).toBe("aico trả 409");
    expect(actionError(409, { detail: { msg: "x" } })).toBe("aico trả 409");
    expect(actionError(501, null)).toBe("aico trả 501");
    expect(actionError(500, "lỗi")).toBe("aico trả 500");
    expect(actionError(500, [{ detail: "x" }])).toBe("aico trả 500");
  });

  it("401 luôn báo sai token; mã < 400 không đọc detail", () => {
    expect(actionError(401, { detail: "bad token" })).toBe("Sai API token");
    expect(actionError(401, null)).toBe("Sai API token");
    expect(actionError(302, { detail: "x" })).toBe("aico trả 302");
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
  it("fetchTickets: GET /tickets kèm Bearer, giữ 3 loại cần người, mới nhất trước", async () => {
    const calls = stubFetch(json([
      ticket("T-1"),
      ticket("T-2", { status: "done" }),
      ticket("T-3", { status: "awaiting_plan_approval", updated_at: "2026-10-21T09:00:00Z" }),
      ticket("T-4", { status: "awaiting_merge_approval", updated_at: "2026-10-21T08:30:00Z" }),
    ]));
    expect((await fetchTickets(CONFIG)).map((t) => t.id)).toEqual(["T-3", "T-4", "T-1"]);
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

  it("fetchEscalationReason: /events hỏng cấu trúc ném lỗi (để không cache null); không có lý do thì null", async () => {
    stubFetch(json({ events: [] }), json([event("done", "x")]), json({}, 500));
    await expect(fetchEscalationReason(CONFIG, "T-hỏng")).rejects.toThrow("aico trả danh sách event hỏng");
    await expect(fetchEscalationReason(CONFIG, "T-hỏng")).resolves.toBeNull();
    await expect(fetchEscalationReason(CONFIG, "T-hỏng")).rejects.toThrow("aico trả 500");
  });

  it("decisionAction: POST /decisions đúng body; 422 ném msg; 500 ném detail", async () => {
    const calls = stubFetch(
      json({ ok: true }),
      json({ detail: [{ msg: "comment bắt buộc" }] }, 422),
      json({ detail: "lỗi nội bộ" }, 500),
    );
    await expect(decisionAction(CONFIG, "T-1", "approved", "")).resolves.toBeUndefined();
    expect(calls[0][0]).toBe("http://aico.local:8000/tickets/T-1/decisions");
    expect(calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ decision: "approved", actor: "owner", comment: "" });
    await expect(decisionAction(CONFIG, "T-1", "revise", "")).rejects.toThrow("comment bắt buộc");
    await expect(decisionAction(CONFIG, "T-1", "rejected", "không")).rejects.toThrow("lỗi nội bộ");
  });

  it("needAction: escalated gọi /escalation, plan và merge gọi /decisions", async () => {
    const calls = stubFetch(json({}), json({}), json({}));
    await needAction(CONFIG, "escalated", "T-1", "merge", "ok");
    await needAction(CONFIG, "plan", "T-2", "revise", "sửa bước 2");
    await needAction(CONFIG, "merge", "T-3", "changes_requested", "thiếu test");
    expect(calls.map(([url]) => url)).toEqual([
      "http://aico.local:8000/tickets/T-1/escalation",
      "http://aico.local:8000/tickets/T-2/decisions",
      "http://aico.local:8000/tickets/T-3/decisions",
    ]);
    expect(calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { action: "merge", actor: "owner", comment: "ok" },
      { decision: "revise", actor: "owner", comment: "sửa bước 2" },
      { decision: "changes_requested", actor: "owner", comment: "thiếu test" },
    ]);
  });

  it("needAction: hành động không thuộc loại thì ném lỗi, không gọi API", async () => {
    const calls = stubFetch();
    const wrong: [NeedKind, NeedAction][] = [
      ["escalated", "approved"],
      ["plan", "merge"],
      ["plan", "changes_requested"],
      ["merge", "revise"],
      ["merge", "close"],
    ];
    for (const [kind, action] of wrong) {
      await expect(needAction(CONFIG, kind, "T-1", action, "x")).rejects.toThrow(/không dùng được/);
    }
    expect(calls).toHaveLength(0);
  });

  it("needAction: lỗi mạng ném lỗi gốc", async () => {
    stubFetch();
    await expect(needAction(CONFIG, "plan", "T-1", "approved", "")).rejects.toThrow("Failed to fetch");
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

// Promise điều khiển được từ test để dựng các request chồng nhau.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createReasonCache", () => {
  const T1 = () => parseTickets([ticket("T-1")], who())![0];
  const reasons = async (cache: ReturnType<typeof createReasonCache>, list: Ticket[]) =>
    (await cache.resolve(list)).map((r) => r.reason);

  it("lỗi mạng lần đầu: lượt đó null, lượt sau cùng id + updated_at hỏi lại rồi mới cache", async () => {
    const load = vi.fn<(id: string) => Promise<string | null>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(PUSH_REASON);
    const cache = createReasonCache(load);
    expect(await reasons(cache, [T1()])).toEqual([null]);
    expect(await reasons(cache, [T1()])).toEqual([PUSH_REASON]);
    expect(await reasons(cache, [T1()])).toEqual([PUSH_REASON]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("HTTP 500 và /events hỏng cấu trúc qua fetchEscalationReason: không cache, hồi phục khi aico lành", async () => {
    const calls = stubFetch(json({}, 500), json({ events: [] }), json([event("escalated", PUSH_REASON)]));
    const cache = createReasonCache((id) => fetchEscalationReason(CONFIG, id));
    const t = T1();
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const reason = (await reasons(cache, [t]))[0];
      seen.push(actionAvailability(reason, t).retry_push);
    }
    expect(seen).toEqual([false, false, true, true]);
    expect(calls).toHaveLength(3);
  });

  it("thành công mà không có lý do (null hợp lệ) thì cache, không hỏi lại", async () => {
    const load = vi.fn(async () => null);
    const cache = createReasonCache(load);
    await reasons(cache, [T1()]);
    expect(await reasons(cache, [T1()])).toEqual([null]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("hai lượt poll chồng nhau dùng chung một request; request lỗi thì cả hai null và lượt sau hỏi lại", async () => {
    const first = deferred<string | null>();
    const load = vi.fn<(id: string) => Promise<string | null>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(PUSH_REASON);
    const cache = createReasonCache(load);
    const a = reasons(cache, [T1()]);
    const b = reasons(cache, [T1()]);
    first.reject(new Error("aico trả 502"));
    expect(await Promise.all([a, b])).toEqual([[null], [null]]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await reasons(cache, [T1()])).toEqual([PUSH_REASON]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("request cũ lỗi muộn không xoá kết quả của request mới cùng khoá", async () => {
    const old = deferred<string | null>();
    const load = vi.fn<(id: string) => Promise<string | null>>()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(PUSH_REASON);
    const cache = createReasonCache(load);
    const stale = reasons(cache, [T1()]);
    // ticket rời danh sách rồi quay lại khi request đầu chưa về: khoá được hỏi lại bằng request mới
    await reasons(cache, []);
    expect(await reasons(cache, [T1()])).toEqual([PUSH_REASON]);
    old.reject(new Error("Failed to fetch"));
    expect(await stale).toEqual([null]);
    expect(await reasons(cache, [T1()])).toEqual([PUSH_REASON]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("updated_at đổi hoặc ticket mất rồi quay lại thì hỏi lại; lỗi của khoá này không ảnh hưởng ticket khác", async () => {
    const load = vi.fn(async (id: string) => {
      if (id === "T-2") throw new Error("aico trả 500");
      return PUSH_REASON;
    });
    const cache = createReasonCache(load);
    const t2 = parseTickets([ticket("T-2")], who())![0];
    expect(await reasons(cache, [T1(), t2])).toEqual([PUSH_REASON, null]);
    expect(await reasons(cache, [T1(), t2])).toEqual([PUSH_REASON, null]);
    expect(load.mock.calls.map(([id]) => id)).toEqual(["T-1", "T-2", "T-2"]);
    const moved = parseTickets([ticket("T-1", { updated_at: "2026-10-21T09:00:00Z" })], who())![0];
    await reasons(cache, [moved]);
    await reasons(cache, []);
    await reasons(cache, [moved]);
    expect(load.mock.calls.map(([id]) => id)).toEqual(["T-1", "T-2", "T-2", "T-1", "T-1"]);
  });
});

describe("demo", () => {
  it("2 ticket escalated: một lỗi đẩy code không MR, một có MR", () => {
    const [push, merge] = demoTickets();
    expect(parseTickets(demoTickets(), who())).toHaveLength(2);
    expect(escalated(demoTickets())).toHaveLength(2);
    expect(actionAvailability(push.reason, push)).toEqual({ retry_push: true, merge: false, close: true, fail: true });
    expect(actionAvailability(merge.reason, merge)).toEqual({ retry_push: false, merge: true, close: true, fail: true });
    expect(mergeRequest(merge).url).toMatch(/^https:/);
    expect(warn).not.toHaveBeenCalled();
  });

  it("demoNeedTickets: đủ 3 loại, merge có MR và xem trước, đọc lại qua parseTickets không lỗi", () => {
    const list = demoNeedTickets();
    expect(parseTickets(list, who())).toHaveLength(list.length);
    const kinds = list.map((t) => needKind(t.status));
    expect(new Set(kinds)).toEqual(new Set(["plan", "merge", "escalated"]));
    const merge = list.find((t) => t.status === "awaiting_merge_approval")!;
    expect(mergeRequest(merge).url).toMatch(/^https:/);
    expect(previewLink(merge)).toMatch(/^https:/);
    expect(new Set(list.map((t) => t.id)).size).toBe(list.length);
    expect(warn).not.toHaveBeenCalled();
  });

  it("demoNeedTickets: review có 2 bộ ảnh, chỉ hiện đúng 3 ảnh bộ mới; merge có 2 ảnh", () => {
    const list = demoNeedTickets();
    const review = list.find((t) => t.id === "T-demo-review")!;
    expect(review.artifacts.filter((a) => a.kind === "screenshot")).toHaveLength(4);
    expect(latestScreenshots(review)).toEqual(
      ["1440x900-hour-11", "1440x900-hour-21", "390x844-hour-11"].map((label) => ({
        url: `https://example.com/aico-office/demo-shots/20261022-075400/${label}.png`,
        label,
      })),
    );
    const merge = list.find((t) => t.id === "T-demo-merge")!;
    expect(latestScreenshots(merge)).toHaveLength(2);
    expect(mergeRequest(merge).url).toMatch(/^https:/);
    expect(demoTickets()[1].artifacts.some((a) => a.kind === "screenshot")).toBe(false);
  });

  it("demoNeedTickets(now, assetBase): url ảnh theo assetBase, vẫn qua safeUrl", () => {
    for (const base of ["http://localhost:5173/", "https://vx-anh.github.io/aico-office/"]) {
      const review = demoNeedTickets(0, base).find((t) => t.id === "T-demo-review")!;
      const shots = latestScreenshots(review);
      expect(shots).toHaveLength(3);
      for (const s of shots) expect(s.url.startsWith(`${base}demo-shots/20261022-075400/`)).toBe(true);
    }
  });

  it("demoNeedTickets(now): giờ cập nhật lùi từ now, đều đã qua", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    const list = demoNeedTickets(now);
    for (const t of list) {
      const ms = Date.parse(t.updated_at!);
      expect(ms).toBeLessThan(now);
      expect(now - ms).toBeLessThan(3_600_000);
    }
    expect(needsYou(list)[0].status).toBe("awaiting_plan_approval");
  });

  const results: [NeedKind, NeedAction, string][] = [
    ["plan", "approved", "in_progress"],
    ["plan", "revise", "planning"],
    ["plan", "rejected", "rejected"],
    ["merge", "approved", "done"],
    ["merge", "changes_requested", "in_progress"],
    ["merge", "rejected", "rejected"],
    ["escalated", "retry_push", "in_progress"],
    ["escalated", "merge", "done"],
    ["escalated", "close", "closed"],
    ["escalated", "fail", "failed"],
  ];
  for (const [kind, action, status] of results) {
    it(`${kind}/${action} → ${status}, ticket rời danh sách cần người, ticket khác giữ nguyên`, () => {
      const before = demoNeedTickets();
      const target = before.find((t) => needKind(t.status) === kind)!;
      const after = applyDemoAction(before, target.id, kind, action);
      const changed = after.find((t) => t.id === target.id)!;
      expect(changed.status).toBe(status);
      expect(changed.reason).toBe(target.reason);
      expect(needKind(changed.status)).toBeNull();
      after.forEach((t, i) => {
        if (t.id !== target.id) expect(t).toBe(before[i]);
      });
      expect(target.status).not.toBe(status);
      expect(needsYou(after).map((t) => t.id)).not.toContain(target.id);
      expect(needsYou(after)).toHaveLength(before.length - 1);
    });
  }

  it("ticket đã đổi loại hoặc hành động không thuộc loại thì không đổi gì", () => {
    const list = demoNeedTickets();
    const plan = list.find((t) => t.status === "awaiting_plan_approval")!;
    expect(applyDemoAction(list, plan.id, "merge", "approved")).toEqual(list);
    expect(applyDemoAction(list, plan.id, "plan", "changes_requested")).toEqual(list);
    expect(applyDemoAction(list, plan.id, "plan", "close")).toEqual(list);
    expect(applyDemoAction(list, plan.id, "escalated", "close")).toEqual(list);
  });

  it("id không có thì không đổi gì", () => {
    expect(applyDemoAction(demoNeedTickets(), "T-không-có", "escalated", "close")).toEqual(demoNeedTickets());
  });

  it("ticket escalated cũ (demoTickets) đổi qua dạng 4 tham số", () => {
    const before = demoTickets();
    const after = applyDemoAction(before, before[0].id, "escalated", "merge");
    expect(after[0].status).toBe("done");
    expect(after[1]).toBe(before[1]);
  });

  it("demoWorkers giữ nguyên: 3 phòng", () => {
    expect(demoWorkers(48_000_000).map((w) => w.name)).toEqual(["claude", "codex", "cursor"]);
  });
});

describe("demo đủ trạng thái trong chu kỳ 48 giây", () => {
  const CYCLE = 48_000;
  const T0 = 1_000 * CYCLE;
  const LIMIT = "You've hit your session limit";
  const ROOM_ERROR = "CLI thoát giữa chừng (mã 1)";
  const at = (s: number, cycle = 0) => demoWorkers(T0 + cycle * CYCLE + s * 1000);
  const room = (s: number, name: string, cycle = 0) => at(s, cycle).find((w) => w.name === name)!;

  it("claude: 0 → 1 → 3/3 trong 16–32 giây → +1 → 0, đúng cả hai phía biên", () => {
    const count = (s: number) => room(s, "claude").agents!.length;
    expect([count(0), count(7.999)]).toEqual([0, 0]);
    expect(room(0, "claude").state).toBe("idle");
    expect([count(8), count(15.999)]).toEqual([1, 1]);
    expect(room(8, "claude").state).toBe("working");
    expect([count(16), count(31.999)]).toEqual([3, 3]);
    expect(room(20, "claude").slots).toBe(3);
    expect(room(20, "claude").state).toBe("working");
    expect([count(32), count(39.999)]).toEqual([4, 4]);
    expect(room(36, "claude").slots).toBe(3);
    expect(room(36, "claude").state).toBe("working");
    expect([count(40), count(47.999)]).toEqual([0, 0]);
    expect(room(44, "claude").state).toBe("idle");
  });

  it("claude: id giữ nguyên trong pha, agent sau không có sớm, chu kỳ sau là id khác", () => {
    const ids = (s: number, cycle = 0) => room(s, "claude", cycle).agents!.map((a) => a.id);
    const early = ids(20);
    expect(early).toHaveLength(3);
    expect(ids(31)).toEqual(early);
    expect(ids(12)).toEqual([early[0]]);
    expect(ids(4)).toEqual([]);
    const full = ids(36);
    expect(full.slice(0, 3)).toEqual(early);
    expect(full).toHaveLength(4);
    expect(new Set(full).size).toBe(4);
    expect(ids(39).slice(0, 3)).toEqual(early);
    expect(ids(41)).toEqual([]);
    expect(ids(20, 1)[0]).not.toBe(early[0]);
    expect(room(36, "claude").agents!.map((a) => a.ticket_id)).toEqual(["T-demo00", "T-demo01", "T-demo02", "T-demo03"]);
  });

  it("cursor: limited → offline → idle, agent chỉ trong pha idle 40–48 giây", () => {
    expect(room(0, "cursor").state).toBe("limited");
    expect(room(23.999, "cursor").agents).toEqual([]);
    expect(room(24, "cursor").state).toBe("offline");
    expect(room(35.999, "cursor").agents).toEqual([]);
    expect(room(30, "cursor").usage).toBeNull();
    expect(room(36, "cursor").state).toBe("idle");
    expect(room(39.999, "cursor").agents).toEqual([]);
    expect(room(40, "cursor").state).toBe("idle");
    expect(room(40, "cursor").agents).toHaveLength(1);
    expect(room(47.999, "cursor").agents).toHaveLength(1);
    expect(room(40, "cursor").agents![0].id).toBe(room(47, "cursor").agents![0].id);
    expect(room(44, "cursor").agents![0].ticket_id).toBe("T-demo20");
    expect(room(0, "cursor", 1).state).toBe("limited");
    expect(room(0, "cursor", 1).agents).toEqual([]);
    expect(room(44, "cursor", 1).agents![0].id).not.toBe(room(44, "cursor").agents![0].id);
  });

  it("codex: last_error khác hạn mức trong 0–28 giây; đang làm thì hết; limited thì đúng câu hạn mức", () => {
    for (const s of [0, 14, 27.999]) {
      const w = room(s, "codex");
      expect(w.state).toBe("idle");
      expect(w.agents).toEqual([]);
      expect(w.last_error).toBe(ROOM_ERROR);
      expect(w.last_error).not.toBe(LIMIT);
      expect(w.limit).toBeNull();
    }
    for (const s of [28, 35.999]) {
      const w = room(s, "codex");
      expect(w.state).toBe("working");
      expect(w.agents).toHaveLength(1);
      expect(w.last_error).toBeNull();
      expect(w.limit).toBeNull();
    }
    for (const s of [36, 47.999]) {
      const w = room(s, "codex");
      expect(w.state).toBe("limited");
      expect(w.agents).toEqual([]);
      expect(w.last_error).toBe(LIMIT);
      expect(w.limit?.message).toBe(LIMIT);
    }
    expect(room(10, "claude").last_error).toBeNull();
    expect(room(44, "claude").last_error).toBeNull();
    expect(room(10, "cursor").last_error).toBe(LIMIT);
    expect(room(44, "cursor").last_error).toBeNull();
    expect(room(10, "codex", 1).last_error).toBe(ROOM_ERROR);
    expect(room(40, "codex", 1).last_error).toBe(LIMIT);
  });

  it("demoNeedTickets: đúng 4 ticket, 3 loại, một ticket trùng ticket_id của agent demo", () => {
    const list = demoNeedTickets();
    expect(list).toHaveLength(4);
    expect(new Set(list.map((t) => needKind(t.status)))).toEqual(new Set(["plan", "merge", "escalated"]));
    const agentTickets = new Set<string>();
    for (let s = 0; s < 48; s += 1) {
      for (const w of at(s)) for (const a of w.agents ?? []) if (a.ticket_id) agentTickets.add(a.ticket_id);
    }
    const shared = list.filter((t) => agentTickets.has(t.id));
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.every((t) => needKind(t.status) !== null)).toBe(true);
    expect(list.some((t) => t.id === "T-demo00" && t.status === "awaiting_plan_approval")).toBe(true);
    expect(agentTickets.has("T-demo00")).toBe(true);
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
      if (parsed) shown = escalated(parsed).map((t) => t.id);
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

describe("cần người: dữ liệu đổi giữa chừng", () => {
  // Mỗi lượt poll: parse → needsYou → tóm tắt "id:loại:nút bật" như cột sẽ hiện.
  const view = (raw: unknown, name: string, reasons: Record<string, string | null> = {}) => {
    const parsed = parseTickets(raw, name);
    if (!parsed) return null;
    return needsYou(parsed).map((t) => {
      const kind = needKind(t.status)!;
      const on = actionsFor(kind, reasons[t.id] ?? null, t).filter((a) => a.enabled).map((a) => a.action);
      return `${t.id}:${kind}:${on.join(",")}`;
    });
  };

  it("ticket mất rồi xuất hiện lại: đọc lại như mới theo trạng thái hiện tại", () => {
    const name = who();
    const polls = [
      [ticket("T-1", { status: "awaiting_plan_approval" }), ticket("T-2")],
      [ticket("T-1", { status: "planning" }), ticket("T-2")],
      [ticket("T-2")],
      [ticket("T-1", { status: "awaiting_plan_approval", updated_at: "2026-10-21T09:00:00Z" }), ticket("T-2")],
    ].map((raw) => view(raw, name));
    expect(polls).toEqual([
      ["T-1:plan:approved,revise,rejected", "T-2:escalated:close,fail"],
      ["T-2:escalated:close,fail"],
      ["T-2:escalated:close,fail"],
      ["T-1:plan:approved,revise,rejected", "T-2:escalated:close,fail"],
    ]);
  });

  it("đổi loại plan → merge → escalated: nút đổi theo loại, hành động cũ không còn hợp lệ", () => {
    const name = who();
    const statuses = ["awaiting_plan_approval", "awaiting_merge_approval", "escalated"];
    const polls = statuses.map((status) => view([ticket("T-1", { status, artifacts: [MR] })], name));
    expect(polls).toEqual([
      ["T-1:plan:approved,revise,rejected"],
      ["T-1:merge:approved,changes_requested,rejected"],
      ["T-1:escalated:merge,close,fail"],
    ]);
    // thẻ plan cũ bấm Yêu cầu sửa sau khi ticket đã sang merge: demo không đổi gì
    const planId = demoNeedTickets().find((t) => t.status === "awaiting_plan_approval")!.id;
    const list = demoNeedTickets().map((t) => (t.id === planId ? { ...t, status: "awaiting_merge_approval" } : t));
    expect(applyDemoAction(list, planId, "plan", "revise")).toEqual(list);
    expect(applyDemoAction(list, planId, "merge", "approved").find((t) => t.id === planId)!.status).toBe("done");
  });

  it("số ticket 0 → 3 → 1 → 0", () => {
    const name = who();
    const polls = [
      [ticket("T-1", { status: "done" })],
      [
        ticket("T-1", { status: "awaiting_plan_approval", updated_at: "2026-10-21T08:00:00Z" }),
        ticket("T-2", { status: "awaiting_merge_approval", updated_at: "2026-10-21T09:00:00Z" }),
        ticket("T-3", { updated_at: "2026-10-21T10:00:00Z" }),
      ],
      [ticket("T-1", { status: "in_progress" }), ticket("T-2", { status: "awaiting_merge_approval" }), ticket("T-3", { status: "closed" })],
      [],
    ].map((raw) => view(raw, name)?.map((v) => v.split(":")[0]));
    expect(polls).toEqual([[], ["T-3", "T-2", "T-1"], ["T-2"], []]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("MR và xem trước xuất hiện rồi mất: link hiện rồi ẩn; Merge của escalated bật rồi tắt", () => {
    const name = who();
    const seen = [[], [MR, PREVIEW], [MR], []].map((artifacts) => {
      const [m, e] = parseTickets([
        ticket("T-m", { status: "awaiting_merge_approval", artifacts }),
        ticket("T-e", { artifacts }),
      ], name)!;
      return [mergeRequest(m).url !== null, previewLink(m) !== null, actionsFor("escalated", null, e)[1].enabled];
    });
    expect(seen).toEqual([
      [false, false, false],
      [true, true, true],
      [true, false, true],
      [false, false, false],
    ]);
  });

  it("updated_at đổi: thời gian chờ tính lại, lý do tải lại và Đẩy lại đổi theo", async () => {
    const now = Date.parse("2026-10-21T10:30:00Z");
    const byTime: Record<string, string> = {
      "2026-10-21T08:00:00Z": PUSH_REASON,
      "2026-10-21T09:00:00Z": "reviewer từ chối",
      "2026-10-21T10:00:00Z": PUSH_REASON,
    };
    let current = "";
    const load = vi.fn(async () => byTime[current]);
    const cache = createReasonCache(load);
    const seen = [];
    for (const updated_at of [...Object.keys(byTime), "2026-10-21T10:00:00Z"]) {
      current = updated_at;
      const [{ ticket: t, reason }] = await cache.resolve(needsYou(parseTickets([ticket("T-1", { updated_at })], who())!));
      seen.push([waitedLabel(t.updated_at, now), actionsFor("escalated", reason, t)[0].enabled]);
    }
    expect(seen).toEqual([
      ["chờ 2 giờ 30 phút", true],
      ["chờ 1 giờ 30 phút", false],
      ["chờ 30 phút", true],
      ["chờ 30 phút", true],
    ]);
    // lần cuối cùng updated_at nên dùng lại cache, không hỏi /events
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("dữ liệu hỏng rồi lành lại: null để giữ danh sách cũ, phần tử hỏng bị bỏ, warn một lần", () => {
    const name = who();
    const good = [ticket("T-1", { status: "awaiting_plan_approval" }), ticket("T-2", { status: "awaiting_merge_approval", artifacts: [MR] })];
    let shown: string[] = [];
    const seen = [
      good,
      { detail: "lỗi" },
      [ticket("T-1", { status: "awaiting_plan_approval" }), { id: 5 }, ticket("T-2", { status: 7 })],
      "html lỗi",
      good,
    ].map((raw) => {
      const v = view(raw, name);
      if (v) shown = v.map((x) => x.split(":")[0]);
      return [v === null, shown.join(",")];
    });
    expect(seen).toEqual([
      [false, "T-1,T-2"],
      [true, "T-1,T-2"],
      [false, "T-1"],
      [true, "T-1"],
      [false, "T-1,T-2"],
    ]);
    // "phải là mảng" một lần, phần tử id sai một lần, T-2 status sai một lần
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
