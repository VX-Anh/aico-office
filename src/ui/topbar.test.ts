import { afterEach, describe, expect, it, vi } from "vitest";
import { createTopbar, settingsFocus } from "./topbar";

class TopbarNode {
  children: TopbarNode[] = [];
  className = "";
  id = "";
  name = "";
  value = "";
  textContent = "";
  hidden = false;
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
  append(...nodes: TopbarNode[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: TopbarNode[]) { this.children = nodes; }
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
  return { topbar, inputs, gear: root.querySelector(".settings-toggle")! };
}

afterEach(() => { vi.unstubAllGlobals(); });

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
