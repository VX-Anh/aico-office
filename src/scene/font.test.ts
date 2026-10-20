import { describe, expect, it } from "vitest";
import { glyphChars, textWidth } from "./font";

describe("chữ pixel", () => {
  it("đo bề rộng có dấu %", () => {
    expect(textWidth("28%")).toBe(11);
    expect(textWidth("100%")).toBe(15);
  });

  it("giữ % và ? thay vì đổi thành dấu cách", () => {
    expect(glyphChars("%")).toEqual(["%"]);
    expect(glyphChars("?")).toEqual(["?"]);
    expect(glyphChars("? pro")).toEqual(["?", " ", "P", "R", "O"]);
  });

  it("ký tự lạ vẫn thành dấu cách", () => {
    expect(glyphChars("a#")).toEqual(["A", " "]);
    expect(textWidth("#")).toBe(3);
  });
});
