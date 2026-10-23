import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerStatus } from "../api";
import { createTopbar, settingsFocus } from "./topbar";

class TopbarNode {
  children: TopbarNode[] = [];
  className = "";
  id = "";
  name = "";
  value = "";
  textContent = "";
  hidden = false;
  disabled = false;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  parent: TopbarNode | null = null;
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  classList = {
    add: (...names: string[]) => { this.className += ` ${names.join(" ")}`; },
    toggle: (name: string, enabled: boolean) => {
      const names = this.className.split(/\s+/).filter(item => item && item !== name);
      if (enabled) names.push(name);
      this.className = names.join(" ");
    },
  };
  constructor(readonly tagName = "div") {}
  append(...nodes: TopbarNode[]) {
    for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); }
  }
  replaceChildren(...nodes: TopbarNode[]) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this);
    this.parent = null;
  }
  insertBefore(node: TopbarNode, before: TopbarNode | null) {
    node.remove();
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, node);
    node.parent = this;
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
  click() { this.listeners.get("click")?.(); }
  focus() { Object.assign(document, { activeElement: this }); }
  querySelector(selector: string): TopbarNode | null {
    const matches = (node: TopbarNode) => selector.startsWith("#") ? node.id === selector.slice(1)
      : selector.startsWith(".") ? node.className.split(/\s+/).includes(selector.slice(1))
      : selector === "input" ? node.tagName === "input"
      : selector === `input[name="${node.name}"]` && node.tagName === "input";
    for (const child of this.children) {
      if (matches(child)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

function setup(names = ["baseUrl", "token"]) {
  const root = new TopbarNode();
  const form = new TopbarNode("form");
  form.id = "settings";
  const inputs = names.map(name => Object.assign(new TopbarNode("input"), { name }));
  form.append(...inputs);
  root.append(form);
  vi.stubGlobal("HTMLButtonElement", TopbarNode);
  vi.stubGlobal("document", {
    activeElement: null,
    createElement: (tag: string) => new TopbarNode(tag),
    getElementById: () => null,
    addEventListener() {},
  });
  const topbar = createTopbar(root as unknown as HTMLElement);
  return { root, topbar, inputs, gear: root.querySelector(".settings-toggle")! };
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("settingsFocus", () => {
  it.each([
    ["https://office.aico.io.vn/api", "", "token"],
    ["", "", "baseUrl"],
    ["", "secret", "baseUrl"],
    [" \t\n", "", "baseUrl"],
    ["https://office.aico.io.vn/api", "secret", "baseUrl"],
    [" https://office.aico.io.vn/api ", "", "token"],
    ["https://office.aico.io.vn/api", " ", "baseUrl"],
  ])("địa chỉ %j, token %j → %s", (baseUrl, token, target) => {
    expect(settingsFocus(baseUrl, token)).toBe(target);
  });
});

describe("lớp hiển thị khi mở cài đặt", () => {
  it("topbar có class settings-open khi popover mở để nổi trên ngăn phải", () => {
    const { root, topbar, gear } = setup();
    expect(root.className.split(/\s+/)).not.toContain("settings-open");
    gear.click();
    expect(root.className.split(/\s+/)).toContain("settings-open");
    topbar.setSettingsOpen(false);
    expect(root.className.split(/\s+/)).not.toContain("settings-open");
  });
});

describe("focus khi mở cài đặt", () => {
  it("đọc lại giá trị khi mở lại sau khi xoá địa chỉ hoặc nhập token", () => {
    const { topbar, inputs: [baseUrl, token], gear } = setup();
    for (const [address, secret, target] of [
      ["https://office.aico.io.vn/api", "", token],
      ["", "", baseUrl],
      [" \t", "", baseUrl],
      ["https://office.aico.io.vn/api", "", token],
      ["https://office.aico.io.vn/api", "secret", baseUrl],
    ] as const) {
      baseUrl.value = address;
      token.value = secret;
      gear.click();
      expect(document.activeElement).toBe(target);
      topbar.setSettingsOpen(false);
    }
  });

  it.each([["token"], ["baseUrl"], ["other"], []])("thiếu input: %j thì focus input đầu", (...names) => {
    const { topbar, inputs } = setup(names);
    topbar.setSettingsOpen(true);
    expect(document.activeElement).toBe(inputs[0] ?? null);
  });
});

function worker(ids: string[], state: WorkerStatus["state"] = "working", percent = 25): WorkerStatus {
  return {
    name: "codex", state, roles: ["coder"], slots: 3,
    agents: ids.map(id => ({ id, role: "coder", ticket_id: id, mode: "write", started_at: "2026-01-01T00:00:00Z" })),
    usage: { checked_at: "2026-01-01T00:00:00Z", windows: [{ name: "5h", window_minutes: 300, used_percent: percent, resets_at: "2026-01-01T05:00:00Z" }] },
  };
}

describe("logo AX tĩnh", () => {
  it.each(["/", "/preview/T-de61a515/"])("ảnh và dữ liệu đổi tại base %s", base => {
    vi.stubEnv("BASE_URL", base);
    const { root, topbar, gear } = setup();
    const logo = root.querySelector(".brand-logo")!;
    expect(logo.tagName).toBe("img");
    expect(logo.getAttribute("alt")).toBe("");
    expect(logo.getAttribute("src")).toBe(`${base}brand/logo-ax-64.png`);
    const needs = root.querySelector("#needs-count")!;
    const demo = root.querySelector("#demo")!;
    const form = root.querySelector("#settings")!;
    const cases: [WorkerStatus[], number, number, number, WorkerStatus["state"] | null][] = [
      [[worker(["a"])], 0, 1, 1, "working"],
      [[worker(["a", "b", "c"])], 1, 3, 2, "working"],
      [[worker(["b"])], 0, 1, 1, "working"],
      [[worker([], "idle")], 0, 0, 0, "idle"],
      [[worker(["a"])], 2, 1, 1, "working"],
      [[worker(["a"], "offline", 75)], 0, 0, 0, "offline"],
      [[worker(["a"], "working", 50)], 1, 1, 1, "working"],
      [[worker(["a"], "limited", 100)], 0, 1, 0, "limited"],
      [[], 0, 0, 0, null],
      [[worker(["a"])], 0, 1, 1, "working"],
    ];
    for (const [workers, needCount, total, busy, state] of cases) {
      topbar.update(workers, needCount, Date.parse("2026-01-01T00:00:00Z"), new Set(["c"]));
      expect(root.querySelector(".brand-logo")).toBe(logo);
      expect(logo.getAttribute("src")).toBe(`${base}brand/logo-ax-64.png`);
      expect(logo.getAttribute("alt")).toBe("");
      expect(root.querySelector(".tile-agents")!.querySelector(".tile-value")!.textContent).toBe(String(total));
      expect(root.querySelector(".tile-working")!.querySelector(".tile-value")!.textContent).toBe(String(busy));
      expect(needs.querySelector(".tile-value")!.textContent).toBe(String(needCount));
      expect(needs.getAttribute("aria-label")).toBe(`Cần bạn: ${needCount}`);
      expect(needs.disabled).toBe(needCount === 0);
      const card = root.querySelector(".usage-card");
      expect(card?.dataset.state ?? null).toBe(state);
      if (card) {
        expect(card.getAttribute("title")).toContain({
          working: "đang làm", idle: "rảnh", offline: "mất kết nối", limited: "hết hạn mức",
        }[state!]);
        expect(card.querySelector(".usage-pct")!.textContent).toBe(`${(workers[0].usage as { windows: { used_percent: number }[] }).windows[0].used_percent}%`);
      }
      expect(root.querySelector("#demo")).toBe(demo);
      expect(root.querySelector("#settings")).toBe(form);
      gear.click();
      expect(gear.getAttribute("aria-expanded")).toBe("true");
      demo.click();
      expect(gear.getAttribute("aria-expanded")).toBe("false");
      gear.click();
      form.listeners.get("submit")?.();
      expect(gear.getAttribute("aria-expanded")).toBe("false");
    }
  });
});
