// Luật tất định rút từ nhận xét review lặp lại (Phòng R&D, giả thuyết P1). Mỗi luật ứng với một lớp
// lỗi Reviewer từng trả về; ticket nguồn ghi ở từng luật. Test chỉ đọc chữ của file nguồn, không
// chạy DOM. Khi luật báo sai: sửa code cho khớp; chỉ thêm ngoại lệ khi có lý do ghi ngay bên cạnh.
import { describe, expect, it } from "vitest";

const TS_ALL = import.meta.glob<string>("./**/*.ts", { eager: true, query: "?raw", import: "default" });
const CSS = import.meta.glob<string>("./**/*.css", { eager: true, query: "?raw", import: "default" });
const HTML = Object.values(import.meta.glob<string>("../index.html", { eager: true, query: "?raw", import: "default" }))[0];
const README = Object.values(import.meta.glob<string>("../README.md", { eager: true, query: "?raw", import: "default" }))[0];
// Chỉ cần tên file, không cần nội dung.
const ROOT_FILES = Object.keys(import.meta.glob(["../scripts/*", "../vitest.config.ts", "../index.html"]));

/** Đường dẫn tính từ gốc repo: "./ui/feed.ts" → "src/ui/feed.ts", "../index.html" → "index.html". */
const repoPath = (key: string): string => (key.startsWith("../") ? key.slice(3) : `src/${key.slice(2)}`);

const SOURCES = Object.entries(TS_ALL)
  .filter(([key]) => !key.endsWith(".test.ts"))
  .map(([key, text]) => ({ file: repoPath(key), text }));
const STYLES = Object.entries(CSS).map(([key, text]) => ({ file: repoPath(key), text }));

// ---------------------------------------------------------------------------------------------
// Bộ dò (hàm thuần, có test riêng ở cuối file bằng chính các lỗi từng bị review trả về)
// ---------------------------------------------------------------------------------------------

/** Class và id xuất hiện trong selector của CSS (bỏ chú thích, at-rule, selector thuộc tính). */
export function cssSelectors(css: string): { classes: Set<string>; ids: Set<string> } {
  const classes = new Set<string>();
  const ids = new Set<string>();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of text.matchAll(/([^{}]+)\{/g)) {
    const prelude = block[1].trim();
    if (prelude.startsWith("@")) continue;
    // Phần sau dấu ";" cuối là selector lồng hoặc selector đứng sau một khai báo; bỏ [attr="..."].
    const selector = prelude.slice(prelude.lastIndexOf(";") + 1).replace(/\[[^\]]*\]/g, "");
    for (const m of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(m[1]);
    for (const m of selector.matchAll(/#(-?[_a-zA-Z][\w-]*)/g)) ids.add(m[1]);
  }
  return { classes, ids };
}

const STRING = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

/**
 * Mọi "từ" nằm trong chuỗi của mã TS (tách theo ký tự không thuộc tên class) và các tiền tố của
 * class ghép bằng template (`tone-${x}` → "tone-"). Rộng có chủ ý: chỉ dùng để hỏi "tên class này
 * có được mã nhắc tới ở đâu không".
 */
export function stringTokens(ts: string): { tokens: Set<string>; prefixes: Set<string> } {
  const tokens = new Set<string>();
  const prefixes = new Set<string>();
  for (const m of ts.matchAll(STRING)) {
    const body = m[1] ?? m[2] ?? m[3];
    for (const p of body.matchAll(/([\w-]+-)\$\{/g)) prefixes.add(p[1]);
    for (const t of body.replace(/\$\{[^}]*\}/g, " ").split(/[^\w-]+/)) if (t) tokens.add(t);
  }
  return { tokens, prefixes };
}

/** Class mã TS gắn lên DOM bằng chuỗi cố định: el("tag", "a b"), className = "a b", classList.add/toggle("a"). */
export function domClasses(ts: string): Set<string> {
  const out = new Set<string>();
  const set = /(?:\bel\(\s*"[\w-]+"\s*,\s*|\.className\s*=\s*|\.classList\.(?:add|toggle)\(\s*)"([^"]*)"/g;
  for (const m of ts.matchAll(set)) for (const c of m[1].split(/\s+/)) if (c) out.add(c);
  return out;
}

/** Id mã TS tra trong trang: querySelector("#id ..."), getElementById("id"). */
export function queriedIds(ts: string): Set<string> {
  const out = new Set<string>();
  for (const m of ts.matchAll(/querySelector(?:All)?(?:<[^>]+>)?\(\s*["'`]([^"'`]+)["'`]/g))
    for (const id of m[1].matchAll(/#(-?[_a-zA-Z][\w-]*)/g)) out.add(id[1]);
  for (const m of ts.matchAll(/getElementById\(\s*["'`]([^"'`]+)["'`]/g)) out.add(m[1]);
  return out;
}

/** Id có thật: trong index.html hoặc do mã gán (`.id = "x"`). */
export function declaredIds(html: string, ts: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) out.add(m[1]);
  for (const m of ts.matchAll(/\.id\s*=\s*["'`]([\w-]+)["'`]/g)) out.add(m[1]);
  return out;
}

/** Các mã màu hex viết thẳng thành chuỗi ("#abc", "#aabbcc", "#aabbccdd"). */
export function hexLiterals(ts: string): string[] {
  // "#feed" cũng là bốn chữ số hex hợp lệ: bỏ chuỗi là selector của querySelector.
  return [...ts.matchAll(/(?<!querySelector(?:All)?(?:<[^>]*>)?\(\s*)["'`](#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))["'`]/g)].map((m) => m[1]);
}

/** Mã màu hex trong giá trị khai báo CSS (bỏ chú thích; không tính selector #id). */
export function cssHexColors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  for (const decl of text.matchAll(/:\s*([^;{}]+)[;}]/g))
    for (const m of decl[1].matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g)) out.push(m[0]);
  return out;
}

/** Cột đường dẫn của khối ```text ngay dưới "## Cấu trúc" trong README. */
export function structurePaths(readme: string): string[] {
  const section = readme.split(/^## Cấu trúc\s*$/m)[1] ?? "";
  const block = section.split("```")[1] ?? "";
  return block
    .split("\n")
    .slice(1) // dòng đầu là nhãn ngôn ngữ của khối
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

// ---------------------------------------------------------------------------------------------
// Luật 1: CSS và mã dựng DOM phải dùng cùng tên class/id
// Nguồn: T-01489c4d (DOM `.room-chip-letter`, CSS `.room-letter`; DOM `.room-line` không có CSS),
// T-96adf6f9 (`#escalations` không có trong index.html; bỏ dòng toggle `has-needs` mà CSS còn cần).
// ---------------------------------------------------------------------------------------------

/** Class mã gắn lên DOM nhưng cố ý không có luật CSS riêng. Thêm dòng phải kèm lý do. */
const CLASS_WITHOUT_CSS: Record<string, string> = {
  "needs-list": "móc cho test và docs/feature-map.md; bố cục do #needs đặt",
  "activity-overlay": "canvas phủ đặt kiểu bằng style trong overlay.ts; móc trong docs/feature-map.md",
  "agent-activity": "móc cho test và docs/feature-map.md; kiểu chữ kế thừa từ .agent-text",
  "room-chip-letter": "móc cho test; kiểu lấy từ .room-letter gắn cùng phần tử",
  "room-chip-name": "móc cho test; kiểu qua .room-chip > :last-child",
  "sidebar-search-icon": "kiểu kế thừa từ .sidebar-search",
  "sidebar-input": "móc cho test và docs/feature-map.md; kiểu qua .sidebar-search input",
};

/** Class có trong CSS nhưng mã không nhắc tên bằng chuỗi cố định. Thêm dòng phải kèm lý do. */
const CSS_WITHOUT_CODE: Record<string, string> = {};

describe("luật 1: class và id khớp giữa CSS, index.html và mã dựng DOM", () => {
  const styleClasses = new Map<string, string>();
  const styleIds = new Map<string, string>();
  for (const { file, text } of STYLES) {
    const found = cssSelectors(text);
    for (const c of found.classes) styleClasses.set(c, file);
    for (const id of found.ids) styleIds.set(id, file);
  }
  const allTs = SOURCES.map((s) => s.text).join("\n");
  const code = stringTokens(allTs);
  for (const m of HTML.matchAll(/\bclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) code.tokens.add(c);
  const ids = declaredIds(HTML, allTs);

  it("class trong CSS phải được mã hoặc index.html nhắc tới", () => {
    const orphan = [...styleClasses]
      .filter(([c]) => !code.tokens.has(c) && ![...code.prefixes].some((p) => c.startsWith(p)))
      .filter(([c]) => !(c in CSS_WITHOUT_CODE))
      .map(([c, file]) => `${file}: .${c}`);
    expect(orphan, "CSS có selector cho class mà không mã nào gắn: sai tên class hoặc CSS thừa").toEqual([]);
  });

  it("class mã gắn lên DOM phải có luật CSS", () => {
    const html = new Set([...HTML.matchAll(/\bclass="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
    const unstyled: string[] = [];
    for (const { file, text } of SOURCES)
      for (const c of domClasses(text)) if (!styleClasses.has(c) && !(c in CLASS_WITHOUT_CSS)) unstyled.push(`${file}: ${c}`);
    for (const c of html) if (!styleClasses.has(c) && !(c in CLASS_WITHOUT_CSS)) unstyled.push(`index.html: ${c}`);
    expect(unstyled, "mã gắn class không có trong CSS nào: sai tên class, hoặc thêm vào CLASS_WITHOUT_CSS kèm lý do").toEqual([]);
  });

  it("id dùng trong CSS hoặc querySelector phải có trong index.html hoặc do mã gán", () => {
    const missing: string[] = [];
    for (const [id, file] of styleIds) if (!ids.has(id)) missing.push(`${file}: #${id}`);
    for (const { file, text } of SOURCES) for (const id of queriedIds(text)) if (!ids.has(id)) missing.push(`${file}: #${id}`);
    expect(missing, "id không tồn tại trong trang").toEqual([]);
  });

  it("ngoại lệ không còn cần thì phải gỡ", () => {
    const dom = new Set(SOURCES.flatMap((s) => [...domClasses(s.text)]));
    for (const m of HTML.matchAll(/\bclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) dom.add(c);
    const stale = [
      ...Object.keys(CLASS_WITHOUT_CSS).filter((c) => styleClasses.has(c) || !dom.has(c)),
      ...Object.keys(CSS_WITHOUT_CODE).filter((c) => !styleClasses.has(c)),
    ];
    expect(stale).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Luật 2: bảng "Cấu trúc" trong README liệt kê đúng các file nguồn (AGENTS.md: "Thêm, đổi tên hoặc
// xoá file thì cập nhật bảng Cấu trúc"). Nguồn: T-6834e79b (thiếu bốn file outdoor/lighting mới),
// T-96adf6f9 (xoá dòng của module vẫn tồn tại).
// ---------------------------------------------------------------------------------------------

describe("luật 2: bảng Cấu trúc trong README khớp file thật", () => {
  const listed = structurePaths(README);
  // import.meta.glob không trả về chính file đang gọi nên thêm tay.
  const real = [...Object.keys(TS_ALL), ...Object.keys(CSS), ...ROOT_FILES].map(repoPath).concat("src/repo-rules.test.ts").sort();

  it("đọc được bảng", () => {
    expect(listed.length).toBeGreaterThan(50);
  });

  it("mọi file trong src/, scripts/, index.html, vitest.config.ts đều có dòng trong bảng", () => {
    expect(real.filter((file) => !listed.includes(file)), "file chưa có dòng trong README > Cấu trúc").toEqual([]);
  });

  it("dòng trỏ tới src/ hoặc scripts/ phải là file có thật", () => {
    const concrete = listed.filter((p) => /^(src|scripts)\//.test(p) && !/[<>{}*]/.test(p) && !p.endsWith("/"));
    expect(concrete.filter((p) => !real.includes(p)), "README > Cấu trúc còn dòng của file đã xoá hoặc đổi tên").toEqual([]);
  });

  it("không dòng nào lặp", () => {
    expect(listed.filter((p, i) => listed.indexOf(p) !== i)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Luật 3: màu nằm ở một chỗ (AGENTS.md: "Màu đặt trong src/scene/palette.ts, không rải mã màu khắp
// nơi"; màu giao diện là biến trong src/ui/tokens.css). Nguồn: T-6834e79b (overlay.ts thêm thẳng
// #c8c2b8, #6787a5, #4a4f5a).
// ---------------------------------------------------------------------------------------------

/**
 * Mã màu viết thẳng đã có từ trước khi đặt luật: số lượng tối đa mỗi file. Chỉ được giảm (chuyển
 * dần sang palette.ts thì hạ số ở đây), không được tăng và không thêm file mới.
 */
const LEGACY_HEX: Record<string, number> = {
  "src/scene/furniture.ts": 28, // màu chi tiết đồ đạc (tranh, đồng hồ, máy pha cà phê)
  "src/scene/legacy-characters.ts": 14, // sprite lưới ký tự cũ, chỉ còn là đường dự phòng
  "src/scene/characters.ts": 1, // gối sofa
  "src/scene/pixel.ts": 1, // OUTLINE: hằng viền dùng chung, nằm ở tầng vẽ thấp hơn palette
};

/** Tương tự cho CSS: màu hex ngoài tokens.css. */
const LEGACY_CSS_HEX: Record<string, number> = {};

describe("luật 3: mã màu chỉ ở palette.ts và tokens.css", () => {
  const overBudget = (counts: Map<string, number>, budget: Record<string, number>): string[] =>
    [...counts].filter(([file, n]) => n > (budget[file] ?? 0)).map(([file, n]) => `${file}: ${n} mã màu, cho phép ${budget[file] ?? 0}`);
  const slack = (counts: Map<string, number>, budget: Record<string, number>): string[] =>
    Object.entries(budget).filter(([file, n]) => (counts.get(file) ?? 0) < n).map(([file, n]) => `${file}: còn ${counts.get(file) ?? 0}, hạ mức ${n}`);

  const tsCounts = new Map<string, number>();
  for (const { file, text } of SOURCES) {
    if (file === "src/scene/palette.ts") continue;
    const n = hexLiterals(text).length;
    if (n > 0) tsCounts.set(file, n);
  }
  const cssCounts = new Map<string, number>();
  for (const { file, text } of STYLES) {
    if (file === "src/ui/tokens.css") continue;
    const n = cssHexColors(text).length;
    if (n > 0) cssCounts.set(file, n);
  }

  it("mã TS không thêm mã màu hex ngoài palette.ts", () => {
    expect(overBudget(tsCounts, LEGACY_HEX), "đặt màu vào src/scene/palette.ts rồi dùng tên").toEqual([]);
  });

  it("CSS không thêm mã màu hex ngoài tokens.css", () => {
    expect(overBudget(cssCounts, LEGACY_CSS_HEX), "đặt màu thành biến trong src/ui/tokens.css").toEqual([]);
  });

  it("mức cũ phải hạ theo khi đã dọn bớt", () => {
    expect([...slack(tsCounts, LEGACY_HEX), ...slack(cssCounts, LEGACY_CSS_HEX)]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Test của bộ dò: mỗi ca là một lỗi review từng trả về, để chắc luật bắt được đúng loại đó.
// ---------------------------------------------------------------------------------------------

describe("bộ dò bắt được các lỗi review cũ", () => {
  it("T-01489c4d: DOM dùng room-chip-letter, CSS chọn room-letter", () => {
    const css = cssSelectors(`.room-head { display: grid; } .room-head[aria-pressed="false"] .room-letter { color: gray; }`);
    const dom = domClasses(`const head = el("header", "room-head"); const l = el("span", "room-chip-letter");`);
    expect([...css.classes].filter((c) => !dom.has(c))).toEqual(["room-letter"]);
    expect([...dom].filter((c) => !css.classes.has(c))).toEqual(["room-chip-letter"]);
  });

  it("T-96adf6f9: CSS còn .has-needs nhưng mã bỏ dòng toggle", () => {
    const css = cssSelectors(`@media (min-width: 900.5px) { #workspace.has-needs { grid-template-columns: 1fr 320px; } }`);
    expect(css.classes).toEqual(new Set(["has-needs"]));
    expect(css.ids).toEqual(new Set(["workspace"]));
    expect(stringTokens(`workspace.classList.toggle("has-needs", n > 0);`).tokens.has("has-needs")).toBe(true);
    expect(stringTokens(`render(n);`).tokens.has("has-needs")).toBe(false);
  });

  it("T-96adf6f9: querySelector tới id không có trong index.html", () => {
    const ids = declaredIds(`<div id="stage"></div><aside id="needs"></aside>`, `box.id = "made-in-code";`);
    const asked = queriedIds(
      `document.querySelector<HTMLElement>("#escalations")!; document.getElementById("stage"); root.querySelector("#made-in-code .x");`,
    );
    expect([...asked].filter((id) => !ids.has(id))).toEqual(["escalations"]);
  });

  it("class ghép bằng template được nhận theo tiền tố", () => {
    const found = stringTokens("row.className = `feed-row tone-${tone}`;");
    expect(found.tokens.has("feed-row")).toBe(true);
    expect(found.prefixes).toEqual(new Set(["tone-"]));
  });

  it("T-6834e79b: mã màu viết thẳng trong overlay", () => {
    expect(hexLiterals(`ctx.fillStyle = "#c8c2b8"; stroke("#6787a5"); const id = document.querySelector<HTMLElement>("#feed"); fill(C.paper);`)).toEqual(["#c8c2b8", "#6787a5"]);
    expect(cssHexColors(`#feed { color: #fff; background: var(--glass); } /* #000 */ .a { border: 1px solid #0e1016; }`)).toEqual(["#fff", "#0e1016"]);
  });

  it("T-6834e79b: file mới chưa có dòng trong bảng Cấu trúc", () => {
    const readme = "# X\n\n## Cấu trúc\n\n```text\nsrc/api.ts        gọi aico\nsrc/scene/layout.ts  bố cục\nart/brand/        logo\n```\n\n## Khác\n";
    const listed = structurePaths(readme);
    expect(listed).toEqual(["src/api.ts", "src/scene/layout.ts", "art/brand/"]);
    expect(["src/api.ts", "src/scene/lighting.ts"].filter((f) => !listed.includes(f))).toEqual(["src/scene/lighting.ts"]);
  });
});
