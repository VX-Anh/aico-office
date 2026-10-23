import { describe, expect, it } from "vitest";
import { paletteOf, ROLE_STYLES, roleStyle } from "./palette";

interface RawAcc {
  palette?: Record<string, string>;
}

const ACC = import.meta.glob<RawAcc>("../../art/characters/acc/*.pixel.json", { eager: true, import: "default" });

const FALLBACK_SHIRT = "#8a8f98";
const FALLBACK_DARK = "#62666d";

// Độ sáng cảm nhận (luma Rec. 601), đủ để so áo sẫm với áo sáng.
function luma(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff);
}

describe("roleStyle", () => {
  it("vai trò mới có nhãn, phụ kiện và màu phụ kiện riêng", () => {
    const want: Record<string, string> = { ba: "BA", tester: "Tester", researcher: "Researcher" };
    for (const [role, label] of Object.entries(want)) {
      const s = roleStyle(role);
      expect(s.label).toBe(label);
      expect(s.accessory).not.toBe("");
      expect(s.accent).not.toBe("");
      expect(s.shirt).not.toBe(FALLBACK_SHIRT);
    }
  });

  it("giữ thứ tự: 4 vai trò cũ rồi ba, tester, researcher", () => {
    expect(Object.keys(ROLE_STYLES)).toEqual(["tech_lead", "coder", "reviewer", "designer", "ba", "tester", "researcher"]);
  });

  it("role lạ, rỗng hoặc sai hoa thường rơi về áo xám không phụ kiện", () => {
    const cases: [string | null | undefined, string][] = [
      ["foo", "foo"],
      [null, "?"],
      [undefined, "?"],
      ["", "?"],
      ["BA", "BA"],
    ];
    for (const [role, label] of cases) {
      expect(roleStyle(role)).toEqual({ label, shirt: FALLBACK_SHIRT, shirtDark: FALLBACK_DARK, accessory: "", accent: "" });
    }
  });

  it("màu áo vai trò, provider và fallback không trùng nhau", () => {
    const providers = ["claude", "codex", "cursor"].map((name) => paletteOf({ name } as Parameters<typeof paletteOf>[0]).shirt);
    const all = [...Object.values(ROLE_STYLES).map((s) => s.shirt), ...providers, FALLBACK_SHIRT].map((c) => c.toLowerCase());
    expect(all).toHaveLength(11);
    expect(new Set(all).size).toBe(all.length);
  });

  it("áo sẫm tối hơn áo sáng cùng mức như các vai trò cũ", () => {
    for (const [role, s] of Object.entries(ROLE_STYLES)) {
      const ratio = luma(s.shirtDark) / luma(s.shirt);
      expect(ratio, role).toBeGreaterThanOrEqual(0.7);
      expect(ratio, role).toBeLessThanOrEqual(0.85);
    }
  });

  it("khoá 'a' của từng công thức phụ kiện bằng accent của vai trò", () => {
    for (const [role, s] of Object.entries(ROLE_STYLES)) {
      const recipe = ACC[`../../art/characters/acc/${role}.pixel.json`];
      expect(recipe, `thiếu acc/${role}.pixel.json`).toBeDefined();
      expect(recipe?.palette?.a?.toLowerCase(), role).toBe(s.accent.toLowerCase());
    }
  });
});
