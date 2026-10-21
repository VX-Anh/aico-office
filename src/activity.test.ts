// Hoạt động agent hỏng phải bị từ chối (null, warn một lần) để không vẽ bong bóng sai,
// còn aico bản cũ thiếu trường thì im lặng trả null.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoWorkers } from "./api";
import {
  bubbleFor,
  readAgentActivity,
  resolveBubbles,
  screenFor,
  STALE_MS,
  taskProgress,
  truncate,
  withDemoActivity,
  type ActivityKind,
} from "./activity";

const NOW = Date.parse("2026-10-20T15:40:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

const ACT = { kind: "edit", icon: "✏️", text: "Sửa src/main.ts", detail: "thêm overlay", tool: "Edit", at: iso(NOW - 5_000), error: false };
const BASE = { role: "coder", ticket_id: "T-1", mode: "write", started_at: iso(NOW - 60_000) };

let seq = 0;
// Mỗi agent một id riêng vì warn chỉ in một lần theo nội dung.
const agent = (extra: Record<string, unknown> = {}) => ({ id: `a${seq++}`, ...BASE, ...extra });
const task = (n: number, status: string) => ({ id: `t${n}`, title: `Việc ${n}`, status });
const tasks = (done: number, total: number) =>
  Array.from({ length: total }, (_, n) => task(n, n < done ? "completed" : n === done ? "in_progress" : "pending"));

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe("readAgentActivity: thiếu trường", () => {
  it("aico bản cũ: mọi trường null, không warn", () => {
    const a = agent();
    expect(readAgentActivity(a)).toEqual({ activity: null, recent: null, tasks: null, tasksDone: null, stats: null });
    expect(bubbleFor(a, NOW)).toBeNull();
    expect(taskProgress(a)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("trường null cũng là chưa có, không warn", () => {
    const a = agent({ activity: null, recent: null, tasks: null, tasks_done: null, stats: null });
    expect(readAgentActivity(a)).toEqual({ activity: null, recent: null, tasks: null, tasksDone: null, stats: null });
    expect(warn).not.toHaveBeenCalled();
  });

  it("agent không phải object: trả rỗng, không ném lỗi", () => {
    for (const bad of [null, undefined, 3, "x", [ACT]]) {
      expect(readAgentActivity(bad).activity).toBeNull();
      expect(bubbleFor(bad, NOW)).toBeNull();
      expect(taskProgress(bad)).toBeNull();
    }
  });

  it("trường tuỳ chọn của activity được vắng: icon theo kind, detail/tool null, error false", () => {
    const a = readAgentActivity(agent({ activity: { kind: "search", text: "Tìm", at: ACT.at } })).activity;
    expect(a).toEqual({ kind: "search", icon: "🔍", text: "Tìm", detail: null, tool: null, at: ACT.at, error: false });
    expect(readAgentActivity(agent({ activity: { ...ACT, icon: "" } })).activity?.icon).toBe("✏️");
    expect(warn).not.toHaveBeenCalled();
  });

  it("stats thiếu trường con thì trường đó null", () => {
    expect(readAgentActivity(agent({ stats: { tool_calls: 4 } })).stats).toEqual({ tool_calls: 4, tokens_in: null, tokens_out: null });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("readAgentActivity: dữ liệu đúng", () => {
  it("giữ nguyên activity, recent, tasks, stats", () => {
    const a = agent({ activity: ACT, recent: [ACT], tasks: tasks(3, 7), tasks_done: 3, stats: { tool_calls: 12, tokens_in: 3400, tokens_out: 0 } });
    const r = readAgentActivity(a);
    expect(r.activity).toEqual(ACT);
    expect(r.recent).toEqual([ACT]);
    expect(r.tasks).toHaveLength(7);
    expect(r.tasksDone).toBe(3);
    expect(r.stats).toEqual({ tool_calls: 12, tokens_in: 3400, tokens_out: 0 });
    expect(warn).not.toHaveBeenCalled();
  });

  it("recent: [] và tasks: [] hợp lệ, không chuẩn hoá thành null", () => {
    const r = readAgentActivity(agent({ recent: [], tasks: [] }));
    expect(r.recent).toEqual([]);
    expect(r.tasks).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("kind lạ thành other, icon mặc định theo other", () => {
    const a = readAgentActivity(agent({ activity: { ...ACT, kind: "foo", icon: undefined } })).activity;
    expect(a?.kind).toBe("other");
    expect(a?.icon).toBe("⚙️");
    expect(warn).not.toHaveBeenCalled();
  });

  it("error theo cờ hoặc theo kind", () => {
    expect(readAgentActivity(agent({ activity: { ...ACT, error: true } })).activity?.error).toBe(true);
    expect(readAgentActivity(agent({ activity: { ...ACT, kind: "error", error: undefined } })).activity?.error).toBe(true);
    expect(readAgentActivity(agent({ activity: { ...ACT, error: null } })).activity?.error).toBe(false);
  });
});

describe("readAgentActivity: sai kiểu", () => {
  const badActivities: [string, unknown][] = [
    ["chuỗi", "đang sửa"],
    ["mảng", [ACT]],
    ["số", 5],
    ["kind là số", { ...ACT, kind: 3 }],
    ["kind thiếu", { ...ACT, kind: undefined }],
    ["text là số", { ...ACT, text: 42 }],
    ["text thiếu", { ...ACT, text: undefined }],
    ["icon là số", { ...ACT, icon: 1 }],
    ["at không phải ISO", { ...ACT, at: "hôm qua" }],
    ["at là số", { ...ACT, at: NOW }],
    ["at ngày không có thật", { ...ACT, at: "2026-02-30T10:00:00Z" }],
    ["at thiếu", { ...ACT, at: undefined }],
    ["error là chuỗi", { ...ACT, error: "true" }],
    ["detail là số", { ...ACT, detail: 1 }],
    ["tool là object", { ...ACT, tool: {} }],
  ];
  for (const [name, bad] of badActivities) {
    it(`activity ${name}: null, warn đúng một lần qua nhiều lần gọi`, () => {
      const a = agent({ activity: bad, tasks: tasks(1, 2) });
      for (let n = 0; n < 3; n++) {
        expect(readAgentActivity(a).activity).toBeNull();
        expect(bubbleFor(a, NOW)).toBeNull();
      }
      // trường khác vẫn đọc được
      expect(taskProgress(a)).toEqual({ done: 1, total: 2 });
      expect(warn).toHaveBeenCalledTimes(1);
    });
  }

  it("recent/tasks không phải mảng: null, warn một lần", () => {
    const a = agent({ recent: { 0: ACT }, tasks: "3/7" });
    for (let n = 0; n < 3; n++) {
      const r = readAgentActivity(a);
      expect(r.recent).toBeNull();
      expect(r.tasks).toBeNull();
    }
    expect(taskProgress(a)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("recent bỏ riêng phần tử hỏng, giữ thứ tự", () => {
    const b = { ...ACT, text: "B" };
    const r = readAgentActivity(agent({ recent: [ACT, null, { ...ACT, at: "x" }, "y", b] }));
    expect(r.recent).toEqual([ACT, b]);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("recent 25 mục thì giữ 20 mục cuối (mới nhất)", () => {
    const items = Array.from({ length: 25 }, (_, n) => ({ ...ACT, text: `#${n}` }));
    const r = readAgentActivity(agent({ recent: items })).recent;
    expect(r).toHaveLength(20);
    expect(r?.[0].text).toBe("#5");
    expect(r?.[19].text).toBe("#24");
  });

  it("recent 25 mục có phần tử hỏng: bỏ hỏng trước rồi mới giữ 20", () => {
    const items: unknown[] = Array.from({ length: 25 }, (_, n) => ({ ...ACT, text: `#${n}` }));
    items[24] = 7;
    const r = readAgentActivity(agent({ recent: items })).recent;
    expect(r).toHaveLength(20);
    expect(r?.[19].text).toBe("#23");
  });

  it("tasks bỏ phần tử hỏng (status lạ, id số, title thiếu)", () => {
    const r = readAgentActivity(agent({ tasks: [task(0, "completed"), task(1, "done"), { id: 2, title: "x", status: "pending" }, { id: "t3", status: "pending" }, task(4, "pending")] }));
    expect(r.tasks?.map((t) => t.id)).toEqual(["t0", "t4"]);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("stats sai kiểu: object hỏng thì null, trường con hỏng thì riêng trường đó null", () => {
    expect(readAgentActivity(agent({ stats: [1, 2, 3] })).stats).toBeNull();
    expect(readAgentActivity(agent({ stats: "nhiều" })).stats).toBeNull();
    expect(readAgentActivity(agent({ stats: { tool_calls: -1, tokens_in: Infinity, tokens_out: "5" } })).stats).toEqual({
      tool_calls: null,
      tokens_in: null,
      tokens_out: null,
    });
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it("tasks_done ngoài khoảng hoặc không phải số nguyên: null, warn", () => {
    for (const bad of [8, -1, 2.5, "3", NaN]) {
      expect(readAgentActivity(agent({ tasks: tasks(3, 7), tasks_done: bad })).tasksDone).toBeNull();
    }
    expect(warn).toHaveBeenCalledTimes(5);
  });
});

describe("screenFor", () => {
  const cases: [ActivityKind | null | undefined, string][] = [
    ["edit", "code"],
    ["write", "code"],
    ["run", "terminal"],
    ["test", "terminal"],
    ["git", "terminal"],
    ["remote", "terminal"],
    ["web", "browser"],
    ["mcp", "browser"],
    ["search", "search"],
    ["read", "read"],
    ["plan", "read"],
    ["think", "idle"],
    ["respond", "idle"],
    ["delegate", "idle"],
    ["error", "idle"],
    ["other", "idle"],
    [null, "idle"],
    [undefined, "idle"],
  ];
  for (const [kind, screen] of cases) {
    it(`${kind} → ${screen}`, () => expect(screenFor(kind)).toBe(screen));
  }
});

describe("truncate", () => {
  it("ngắn hơn hoặc đúng 28 thì giữ nguyên", () => {
    expect(truncate("Sửa src/main.ts")).toBe("Sửa src/main.ts");
    expect(truncate("a".repeat(28))).toBe("a".repeat(28));
  });

  it("dài hơn 28 thì cắt còn 28 code point, kết thúc bằng …", () => {
    const out = truncate("a".repeat(29));
    expect(Array.from(out)).toHaveLength(28);
    expect(out.endsWith("…")).toBe(true);
  });

  it("tiếng Việt dấu tổ hợp (NFD) đếm sau khi ghép, không rơi dấu", () => {
    const nfc = "Đọc tài liệu hướng dẫn về bộ đệm của trình duyệt";
    const out = truncate(nfc.normalize("NFD"));
    expect(out).toBe(truncate(nfc));
    expect(Array.from(out)).toHaveLength(28);
    expect(out.normalize("NFC")).toBe(out);
  });

  it("emoji không bị xé đôi", () => {
    const out = truncate("🧪".repeat(40));
    expect(out).toBe(`${"🧪".repeat(27)}…`);
    const family = "👨‍👩‍👧";
    const out2 = truncate(`${"x".repeat(25)}${family}yyyy`);
    expect(out2).toBe(`${"x".repeat(25)}…`);
  });

  it("max tuỳ chọn", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abcdef", 0)).toBe("");
  });
});

describe("bubbleFor", () => {
  const at = (ago: number) => agent({ activity: { ...ACT, at: iso(NOW - ago) } });

  it("đúng 60 giây chưa stale, 60,001 giây thì stale", () => {
    expect(bubbleFor(at(STALE_MS), NOW)?.stale).toBe(false);
    expect(bubbleFor(at(STALE_MS + 1), NOW)?.stale).toBe(true);
    expect(bubbleFor(at(0), NOW)?.stale).toBe(false);
  });

  it("at ở tương lai (lệch đồng hồ) không stale", () => {
    expect(bubbleFor(at(-5 * 60_000), NOW)?.stale).toBe(false);
  });

  it("trả icon, text, error, at", () => {
    expect(bubbleFor(at(1000), NOW)).toEqual({ icon: "✏️", text: "Sửa src/main.ts", error: false, stale: false, at: NOW - 1000 });
  });

  it("error theo cờ hoặc theo kind", () => {
    expect(bubbleFor(agent({ activity: { ...ACT, error: true } }), NOW)?.error).toBe(true);
    expect(bubbleFor(agent({ activity: { ...ACT, kind: "error" } }), NOW)?.error).toBe(true);
    expect(bubbleFor(agent({ activity: ACT }), NOW)?.error).toBe(false);
  });

  it("text dài thì cắt 28 có …", () => {
    const b = bubbleFor(agent({ activity: { ...ACT, text: "Chạy toàn bộ kịch bản kiểm thử của actors và layout" } }), NOW);
    // chỗ cắt rơi vào khoảng trắng thì bỏ nó, không để "… " lơ lửng
    expect(b?.text).toBe("Chạy toàn bộ kịch bản kiểm…");
    expect(Array.from(b?.text ?? "").length).toBeLessThanOrEqual(28);
  });
});

describe("taskProgress", () => {
  it("không có tasks hoặc tasks rỗng thì null", () => {
    expect(taskProgress(agent())).toBeNull();
    expect(taskProgress(agent({ tasks: [], tasks_done: 0 }))).toBeNull();
  });

  it("tasks_done hợp lệ thì dùng nó", () => {
    expect(taskProgress(agent({ tasks: tasks(3, 7), tasks_done: 3 }))).toEqual({ done: 3, total: 7 });
    // aico đếm khác danh sách (vd task đã xoá): vẫn tin nếu nằm trong 0..total
    expect(taskProgress(agent({ tasks: tasks(3, 7), tasks_done: 5 }))).toEqual({ done: 5, total: 7 });
    expect(taskProgress(agent({ tasks: tasks(7, 7), tasks_done: 7 }))).toEqual({ done: 7, total: 7 });
  });

  it("tasks_done thiếu hoặc không hợp lệ thì đếm task completed", () => {
    for (const td of [undefined, null, 8, -1, 2.5, "3"]) {
      expect(taskProgress(agent({ tasks: tasks(3, 7), tasks_done: td }))).toEqual({ done: 3, total: 7 });
    }
  });

  it("task hỏng bị bỏ khỏi tổng", () => {
    expect(taskProgress(agent({ tasks: [...tasks(2, 3), { id: 9 }] }))).toEqual({ done: 2, total: 3 });
  });
});

describe("resolveBubbles", () => {
  const box = (key: string, x: number, at: number, y = 0) => ({ key, x, y, w: 40, h: 12, at });

  it("không chồng nhau thì không thu cái nào", () => {
    expect(resolveBubbles([box("a", 0, 1), box("b", 40, 2), box("c", 0, 3, 12)]).size).toBe(0);
  });

  it("chồng nhau thì cái cũ hơn thu về icon, bất kể thứ tự đầu vào", () => {
    expect([...resolveBubbles([box("old", 0, 1), box("new", 20, 2)])]).toEqual(["old"]);
    expect([...resolveBubbles([box("new", 20, 2), box("old", 0, 1)])]).toEqual(["old"]);
  });

  it("ba cái: chỉ thu cái chồng lên bong bóng đầy đủ", () => {
    // b mới nhất ở giữa, a và c hai bên đều chạm b
    expect([...resolveBubbles([box("a", 0, 1), box("b", 30, 3), box("c", 60, 2)])].sort()).toEqual(["a", "c"]);
    // a mới nhất; b chồng a nên thu; c chỉ chồng b (đã thu) nên hiện đủ
    expect([...resolveBubbles([box("a", 0, 3), box("b", 30, 2), box("c", 60, 1)])].sort()).toEqual(["b"]);
  });

  it("at bằng nhau thì sắp theo key, kết quả ổn định", () => {
    const items = [box("b", 10, 5), box("a", 0, 5)];
    expect([...resolveBubbles(items)]).toEqual(["b"]);
    expect([...resolveBubbles([...items].reverse())]).toEqual(["b"]);
  });

  it("at không hợp lệ coi như cũ nhất", () => {
    expect([...resolveBubbles([box("nan", 0, NaN), box("ok", 10, 1)])]).toEqual(["nan"]);
  });

  it("cái cũ được cập nhật thành mới hơn thì đảo ưu tiên", () => {
    expect([...resolveBubbles([box("a", 0, 1), box("b", 20, 2)])]).toEqual(["a"]);
    expect([...resolveBubbles([box("a", 0, 3), box("b", 20, 2)])]).toEqual(["b"]);
  });
});

describe("dữ liệu đổi giữa chừng", () => {
  it("activity mất rồi xuất hiện lại: bong bóng ẩn rồi hiện, không kẹt stale cũ", () => {
    const id = `flip${seq++}`;
    const poll = (activity: unknown) => ({ id, ...BASE, activity });
    expect(bubbleFor(poll({ ...ACT, at: iso(NOW - 2 * STALE_MS) }), NOW)?.stale).toBe(true);
    expect(bubbleFor(poll(undefined), NOW)).toBeNull();
    expect(bubbleFor(poll(null), NOW)).toBeNull();
    expect(bubbleFor(poll({ ...ACT, at: iso(NOW) }), NOW)).toMatchObject({ stale: false, text: ACT.text });
    expect(warn).not.toHaveBeenCalled();
  });

  it("từ stale sang mới: bong bóng hiện đủ lại", () => {
    const id = `stale${seq++}`;
    const old = { id, activity: { ...ACT, at: iso(NOW - 90_000) } };
    expect(bubbleFor(old, NOW)?.stale).toBe(true);
    const fresh = { id, activity: { ...ACT, kind: "run", text: "npm test", at: iso(NOW - 1000) } };
    expect(bubbleFor(fresh, NOW)).toMatchObject({ stale: false, text: "npm test" });
  });

  it("kind đổi giữa các poll: màn hình đổi theo kind mới", () => {
    const id = `kind${seq++}`;
    const screens = ["edit", "run", "web", "foo", "search"].map((kind) =>
      screenFor(readAgentActivity({ id, activity: { ...ACT, kind } }).activity?.kind),
    );
    expect(screens).toEqual(["code", "terminal", "browser", "idle", "search"]);
  });

  it("số task đổi: 3/7 → 3/9 → 9/9 → null", () => {
    const id = `tasks${seq++}`;
    expect(taskProgress({ id, tasks: tasks(3, 7), tasks_done: 3 })).toEqual({ done: 3, total: 7 });
    expect(taskProgress({ id, tasks: tasks(3, 9), tasks_done: 3 })).toEqual({ done: 3, total: 9 });
    expect(taskProgress({ id, tasks: tasks(9, 9), tasks_done: 9 })).toEqual({ done: 9, total: 9 });
    expect(taskProgress({ id, tasks: null, tasks_done: 9 })).toBeNull();
    expect(taskProgress({ id })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("tasks_done cũ vượt tổng mới (9/9 → 5 task): đếm lại theo danh sách", () => {
    const id = `shrink${seq++}`;
    expect(taskProgress({ id, tasks: tasks(9, 9), tasks_done: 9 })).toEqual({ done: 9, total: 9 });
    expect(taskProgress({ id, tasks: tasks(2, 5), tasks_done: 9 })).toEqual({ done: 2, total: 5 });
  });

  it("dữ liệu hỏng xen giữa dữ liệu tốt: không ném lỗi, đọc lại được, warn một lần", () => {
    const id = `mix${seq++}`;
    const good = { id, activity: ACT, tasks: tasks(3, 7), tasks_done: 3, stats: { tool_calls: 1 } };
    const bad = { id, activity: "lỗi", tasks: "3/7", tasks_done: "x", stats: 5 };
    for (let n = 0; n < 4; n++) {
      expect(bubbleFor(good, NOW)?.text).toBe(ACT.text);
      expect(taskProgress(good)).toEqual({ done: 3, total: 7 });
      expect(() => readAgentActivity(bad)).not.toThrow();
      expect(bubbleFor(bad, NOW)).toBeNull();
      expect(taskProgress(bad)).toBeNull();
      expect(readAgentActivity(bad)).toEqual({ activity: null, recent: null, tasks: null, tasksDone: null, stats: null });
    }
    // activity, tasks, tasks_done, stats: mỗi lỗi một lần dù đọc lại nhiều lần
    expect(warn).toHaveBeenCalledTimes(4);
  });
});

describe("withDemoActivity", () => {
  const CYCLE = 48_000;
  const START = Math.ceil(NOW / CYCLE) * CYCLE;
  const sample = (s: number) => {
    const now = START + s * 1000;
    return { now, workers: withDemoActivity(demoWorkers(now), now) };
  };

  it("không làm hỏng dữ liệu cũ của phòng và agent", () => {
    const now = START + 20_000;
    const plain = demoWorkers(now);
    const rich = withDemoActivity(plain, now);
    expect(rich.map((w) => w.name)).toEqual(plain.map((w) => w.name));
    expect(rich[0].agents?.map((a) => a.id)).toEqual(plain[0].agents?.map((a) => a.id));
    expect(rich[0].usage).toEqual(plain[0].usage);
  });

  it("trong một chu kỳ có đủ kind, error, stale, tasks tăng dần, hai bong bóng bàn cạnh nhau cùng hiện", () => {
    const kinds = new Set<string>();
    const lastDone = new Map<string, number>();
    let errors = 0;
    let stales = 0;
    let pairs = 0;
    for (let s = 0; s < 48; s += 0.5) {
      const { now, workers } = sample(s);
      for (const w of workers) {
        const fresh: string[] = [];
        for (const a of w.agents ?? []) {
          const r = readAgentActivity(a);
          expect(r.activity).not.toBeNull();
          expect(r.recent?.length).toBeGreaterThan(0);
          expect(r.recent!.length).toBeLessThanOrEqual(8);
          expect(r.stats?.tool_calls).not.toBeNull();
          kinds.add(r.activity!.kind);
          const b = bubbleFor(a, now)!;
          if (b.error) errors++;
          if (b.stale) stales++;
          else if (w.state === "working") fresh.push(a.id);
          const p = taskProgress(a)!;
          expect(p.total).toBe(7);
          expect(p.done).toBeGreaterThanOrEqual(lastDone.get(a.id) ?? 0);
          lastDone.set(a.id, p.done);
        }
        if (fresh.length >= 2) pairs++;
      }
    }
    expect([...kinds].sort()).toEqual(
      ["think", "respond", "read", "search", "edit", "write", "run", "test", "git", "web", "plan", "delegate", "mcp", "remote", "error", "other"].sort(),
    );
    expect(errors).toBeGreaterThan(0);
    expect(stales).toBeGreaterThan(0);
    expect(pairs).toBeGreaterThan(0);
    // có agent đi hết 7 task trong chu kỳ
    expect(Math.max(...lastDone.values())).toBe(7);
    expect(warn).not.toHaveBeenCalled();
  });

  it("phần tử lạ đi qua nguyên vẹn, không ném lỗi", () => {
    const odd = [null, 3, { name: "x" }, { name: "y", agents: [null, { id: "z" }] }];
    const out = withDemoActivity(odd, NOW);
    expect(out.slice(0, 3)).toEqual(odd.slice(0, 3));
    expect(bubbleFor((out[3] as { agents: unknown[] }).agents[1], NOW)).not.toBeNull();
  });

  it("claude 3/3 rồi +1 và cursor cuối chu kỳ đều có activity; agent đầu vẫn stale", () => {
    const three = sample(20);
    const claude = three.workers[0].agents ?? [];
    expect(claude).toHaveLength(3);
    for (const a of claude) {
      expect(readAgentActivity(a).activity).not.toBeNull();
      expect(bubbleFor(a, three.now)?.stale).toBe(false);
    }
    const over = sample(36);
    const crew = over.workers[0].agents ?? [];
    expect(crew).toHaveLength(4);
    expect(bubbleFor(crew[0], over.now)?.stale).toBe(true);
    for (const a of crew.slice(1)) {
      expect(readAgentActivity(a).recent?.length).toBeGreaterThan(0);
      expect(bubbleFor(a, over.now)?.stale).toBe(false);
    }
    const idle = sample(44);
    const cursor = idle.workers[2].agents ?? [];
    expect(idle.workers[2].state).toBe("idle");
    expect(cursor).toHaveLength(1);
    const rich = readAgentActivity(cursor[0]);
    expect(rich.activity).not.toBeNull();
    expect(rich.recent?.length).toBeGreaterThan(0);
    expect(rich.tasks).toHaveLength(7);
    expect(rich.stats?.tool_calls).not.toBeNull();
    expect(sample(30).workers[2].agents).toEqual([]);
    expect(sample(38).workers[2].agents).toEqual([]);
  });

  it("qua biên 40 giây theo cả hai hướng: claude hết agent, cursor bắt đầu có activity", () => {
    const before = sample(39.5);
    const after = sample(40);
    const back = sample(39.5);
    expect(before.workers[0].agents).toHaveLength(4);
    expect(after.workers[0].agents).toEqual([]);
    expect(back.workers[0].agents?.map((a) => a.id)).toEqual(before.workers[0].agents?.map((a) => a.id));
    expect(before.workers[2].agents).toEqual([]);
    expect(after.workers[2].agents).toHaveLength(1);
    expect(readAgentActivity(after.workers[2].agents![0]).activity?.text).toBeTruthy();
    expect(sample(47.5).workers[2].agents).toHaveLength(1);
    expect(sample(0).workers[2].agents).toEqual([]);
  });
});
