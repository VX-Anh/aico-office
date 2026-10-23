import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerAgent } from "../api";
import { roleStyle } from "../scene/palette";
import { createAvatar } from "./avatar";

// getContext trả null: không vẽ được sprite nên avatar rơi về ô màu áo + chữ đầu nhãn.
class El {
  className = "";
  textContent = "";
  width = 0;
  height = 0;
  style = { background: "" };
  setAttribute(): void {}
  getContext(): null { return null; }
}

beforeEach(() => {
  vi.stubGlobal("document", { createElement: () => new El() });
});
afterEach(() => { vi.unstubAllGlobals(); });

function agent(role: string): WorkerAgent {
  return { id: role, role, ticket_id: "T-1", mode: "read", started_at: "2026-10-22T10:00:00Z" };
}

describe("avatar fallback", () => {
  it.each([
    ["ba", "B"],
    ["tester", "T"],
    ["researcher", "R"],
  ] as const)("vai trò %s có nền màu áo và chữ %s", (role, letter) => {
    const node = createAvatar(agent(role)) as unknown as El;
    expect(node.className).toBe("avatar avatar-fallback");
    expect(node.style.background).toBe(roleStyle(role).shirt);
    expect(node.textContent).toBe(letter);
    // Cache lỗi vẫn trả ô màu, không thử vẽ lại thành canvas.
    const again = createAvatar(agent(role)) as unknown as El;
    expect(again.className).toBe("avatar avatar-fallback");
    expect(again.textContent).toBe(letter);
    expect(again.style.background).toBe(roleStyle(role).shirt);
  });
});
