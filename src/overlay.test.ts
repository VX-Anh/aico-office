import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomSign } from "./scene/layout";
import { BANNER, LAMP } from "./scene/palette";
import { BANNER_MS, type RoomBanner } from "./scene/room-events";
import { createOverlay } from "./overlay";

interface Call { op: string; color: string; x?: number; y?: number; w?: number; h?: number; text?: string }

function sign(partial: Partial<RoomSign> = {}): RoomSign {
  return {
    key: "claude", anchor: { x: 80, y: 8 }, band: { x: 20, y: 4, w: 140, h: 28 },
    name: "claude", state: "working", agents: 1, slots: 3, overflow: 0, error: false,
    ...partial,
  };
}

function banner(partial: Partial<RoomBanner> = {}): RoomBanner {
  return {
    key: "k", provider: "claude", ticket: "T-1", kind: "mr",
    startedAt: 0, expiresAt: BANNER_MS, ...partial,
  };
}

function harness(width = 640, height = 360) {
  const calls: Call[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    font: "",
    textBaseline: "alphabetic",
    textAlign: "left",
    lineWidth: 1,
    setTransform() {},
    clearRect() {},
    beginPath() {},
    roundRect() {},
    fill() { calls.push({ op: "shape", color: String(ctx.fillStyle) }); },
    stroke() {},
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ op: "rect", color: String(ctx.fillStyle), x, y, w, h });
    },
    fillText(text: string, x: number, y: number) {
      calls.push({ op: "text", color: String(ctx.fillStyle), text: String(text), x, y });
    },
    measureText(text: string) { return { width: [...String(text)].length * 7 }; },
    save() {},
    restore() {},
    moveTo() {},
    lineTo() {},
  };
  const canvas = {
    clientWidth: width,
    clientHeight: height,
    offsetLeft: 4,
    offsetTop: 6,
    clientLeft: 0,
    clientTop: 0,
    insertAdjacentElement() {},
  };
  vi.stubGlobal("window", { devicePixelRatio: 2 });
  vi.stubGlobal("document", {
    createElement: () => ({
      className: "", style: {} as Record<string, string>, width: 0, height: 0,
      setAttribute() {}, getContext: () => ctx,
    }),
  });
  return { canvas, calls, overlay: createOverlay(canvas as unknown as HTMLCanvasElement) };
}

function texts(calls: Call[]): string[] {
  return calls.filter((call) => call.op === "text").map((call) => call.text ?? "");
}

const agent = {
  id: "a", role: "coder", ticket_id: "T-1", mode: "write", started_at: "2026-10-21T00:00:00.000Z",
  activity: { kind: "read", icon: "📖", text: "Đọc file layout", detail: null, tool: null, at: "2026-10-21T00:00:00.000Z", error: false },
  tasks: [
    { id: "1", title: "A", status: "completed" },
    { id: "2", title: "B", status: "pending" },
    { id: "3", title: "C", status: "pending" },
    { id: "4", title: "D", status: "pending" },
  ],
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("biển phòng và banner", () => {
  it("vẽ provider, chấm trạng thái, số agent và giữ bong bóng cùng tiến độ", () => {
    const { overlay, calls } = harness();
    const now = Date.parse("2026-10-21T00:00:01.000Z");
    overlay.draw([{ key: "claude|a", agent, working: true, x: 40, headY: 80, footY: 120 }], 320, now, {
      signs: [sign({ agents: 2, slots: 3 })],
    });
    expect(texts(calls).some((text) => text.includes("claude") && text.includes("2/3"))).toBe(true);
    expect(calls.some((call) => call.op === "rect" && call.w === 6 && call.color === LAMP.working)).toBe(true);
    expect(texts(calls).some((text) => text.includes("Đọc file layout"))).toBe(true);
    expect(texts(calls).some((text) => text === "1/4")).toBe(true);
  });

  it("overflow, lỗi, offline và số agent đổi 0 → 1 → n → 0", () => {
    const { overlay, calls } = harness();
    const cases: Partial<RoomSign>[] = [
      { agents: 0, slots: 2, overflow: 0, state: "idle" },
      { agents: 1, slots: 2, overflow: 0, state: "working" },
      { agents: 4, slots: 2, overflow: 2, state: "working", error: true },
      { agents: 0, slots: 2, overflow: 0, state: "offline", error: true },
    ];
    const seen: string[] = [];
    for (const partial of cases) {
      calls.length = 0;
      overlay.draw([], 320, 0, { signs: [sign(partial)] });
      seen.push(texts(calls).join("|"));
      if (partial.error && partial.state === "working") {
        expect(texts(calls).some((text) => text.includes("+2") && text.includes("!"))).toBe(true);
        expect(calls.some((call) => call.op === "rect" && call.color === BANNER.escalated)).toBe(true);
      }
      if (partial.state === "offline") {
        expect(texts(calls).some((text) => text.includes("!"))).toBe(false);
        expect(calls.some((call) => call.op === "rect" && call.color === LAMP.offline)).toBe(true);
      }
    }
    expect(seen[0]).toContain("0/2");
    expect(seen[1]).toContain("1/2");
    expect(seen[2]).toContain("4/2");
    expect(seen[3]).toContain("0/2");
  });

  it("đổi điểm neo và resize thì biển dịch", () => {
    const { overlay, calls, canvas } = harness(400);
    overlay.draw([], 200, 0, { signs: [sign({ anchor: { x: 40, y: 8 } })] });
    const first = calls.find((call) => call.op === "text")?.x ?? 0;
    calls.length = 0;
    overlay.draw([], 200, 0, { signs: [sign({ anchor: { x: 160, y: 8 } })] });
    const moved = calls.find((call) => call.op === "text")?.x ?? 0;
    expect(moved).toBeGreaterThan(first);
    canvas.clientWidth = 800;
    calls.length = 0;
    overlay.draw([], 200, 0, { signs: [sign({ anchor: { x: 160, y: 8 } })] });
    const wide = calls.find((call) => call.op === "text")?.x ?? 0;
    expect(wide).toBeGreaterThan(moved);
  });

  it("banner MR, done, escalated khoảng 10 giây; reduced motion bỏ confetti", () => {
    const { overlay, calls } = harness();
    const signs = [sign(), sign({ key: "codex", name: "codex", anchor: { x: 220, y: 8 }, band: { x: 160, y: 4, w: 140, h: 28 } })];
    overlay.draw([], 320, 1_000, {
      signs,
      banners: [
        banner({ kind: "mr", ticket: "T-9", startedAt: 0, expiresAt: BANNER_MS }),
        banner({ kind: "escalated", provider: "codex", ticket: "T-3", startedAt: 0, expiresAt: BANNER_MS }),
      ],
    });
    expect(texts(calls)).toContain("MR mở: T-9");
    expect(texts(calls)).toContain("Leo thang: T-3");
    expect(calls.some((call) => call.op === "shape" && call.color === BANNER.mr)).toBe(true);
    expect(calls.some((call) => call.op === "shape" && call.color === BANNER.escalated)).toBe(true);
    expect(texts(calls).some((text) => text.includes("claude"))).toBe(true);

    calls.length = 0;
    overlay.draw([], 320, 500, {
      signs, reducedMotion: false,
      banners: [banner({ kind: "done", ticket: "T-9", startedAt: 0, expiresAt: BANNER_MS })],
    });
    expect(texts(calls)).toContain("Đã merge T-9");
    const confetti = () => calls.filter((call) => call.op === "rect" && call.w === 2 && call.h === 2);
    expect(confetti()).toHaveLength(8);
    const xs = confetti().map((call) => call.x);
    calls.length = 0;
    overlay.draw([], 320, 500 + 160, {
      signs, reducedMotion: false,
      banners: [banner({ kind: "done", ticket: "T-9", startedAt: 0, expiresAt: BANNER_MS })],
    });
    expect(confetti().map((call) => call.x)).not.toEqual(xs);
    calls.length = 0;
    overlay.draw([], 320, 9_000, {
      signs, reducedMotion: true,
      banners: [banner({ kind: "done", ticket: "T-9", startedAt: 0, expiresAt: BANNER_MS })],
    });
    expect(texts(calls)).toContain("Đã merge T-9");
    expect(confetti()).toHaveLength(0);
    calls.length = 0;
    overlay.draw([], 320, BANNER_MS, {
      signs, reducedMotion: true,
      banners: [banner({ kind: "done", ticket: "T-9", startedAt: 0, expiresAt: BANNER_MS })],
    });
    expect(texts(calls).some((text) => text.includes("Đã merge"))).toBe(false);
    calls.length = 0;
    overlay.draw([], 320, 1_000, {
      signs: [sign()],
      banners: [banner({ provider: "không-có", ticket: "T-z" })],
    });
    expect(texts(calls).some((text) => text.includes("T-z"))).toBe(false);
  });
});
