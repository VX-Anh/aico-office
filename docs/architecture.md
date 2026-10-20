# Kiến trúc

Ứng dụng web tĩnh (Vite + TypeScript, không thư viện runtime) vẽ văn phòng pixel trên một canvas. Dữ liệu lấy từ `GET /workers` của aico hoặc kịch bản demo.

```mermaid
flowchart TD
  subgraph Data
    API["src/api.ts<br/>gọi aico /workers, dữ liệu demo"]
  end
  MAIN["src/main.ts<br/>vòng lặp animation, polling, thẻ trạng thái, chú thích"]
  API --> MAIN
  MAIN -->|drawScene, sceneSize, resetActors| IDX["src/scene/index.ts<br/>ghép cảnh"]

  IDX --> LAYOUT["layout.ts<br/>bố cục phòng, bàn, cửa, chỗ ngồi"]
  IDX --> ACT["actors.ts<br/>agent đi vào/ra, actorPose"]
  ACT --> LAYOUT
  ACT --> PATH["pathing.ts<br/>đường đi, vị trí theo thời gian"]
  ACT -->|agentLook| CHAR
  IDX --> TILES["tiles.ts<br/>sàn, tường, cửa"]
  IDX --> FURN["furniture.ts<br/>bàn, ghế, sofa, biển tên"]
  IDX -->|drawWalker, drawSeatedBack,<br/>drawSofaSitter, drawSleeper, drawZ, residentLook| CHAR["characters.ts<br/>chọn tư thế, chồng lớp thân→tóc→phụ kiện,<br/>thay khoá màu theo Look"]

  ART[("art/characters/**/*.pixel.json<br/>body, hair/style0-3, acc/role")] -->|import.meta.glob eager lúc build| CHAR
  CHAR -->|công thức + bộ màu| PB["pixelbolt.ts<br/>đọc palette, frames grid/from, animations"]
  CHAR -->|tư thế thiếu trong công thức| LEG["legacy-characters.ts<br/>sprite lưới ký tự cũ"]
  CHAR --> PAL["palette.ts<br/>màu provider, vai trò + accent, da, tóc"]
  LEG --> PAL
  IDX -->|paletteOf, LAMP| PAL
  TILES --> PAL
  FURN --> PAL
  PB --> PIX["pixel.ts<br/>drawGrid, cached bitmap, shade"]
  LEG --> PIX
  CHAR --> PIX
  CHAR --> FONT["font.ts<br/>chữ pixel (Z)"]
  TILES --> PIX
  FURN --> PIX
  FURN --> FONT
  PIX -->|canvas offscreen| CANVAS[["canvas #office<br/>image-rendering: pixelated"]]
```

## Sprite nhân vật

`characters.ts` nạp mọi công thức trong `art/characters/` lúc build, khoá theo đường dẫn tương đối (`body`, `hair/style0`, `acc/coder`). Frame dạng `ops` của Pixelbolt được gộp thành lưới 16×22 trước khi đưa cho `pixelbolt.ts`.

Mỗi lần vẽ một tư thế (`walk_down`, `walk_up`, `walk_left`, `walk_right`, `sit_back`, `sit_side`, `lie`):

1. Nếu `body` có animation đó: vẽ chồng `body` → `hair/style{look.style}` → `acc/{look.role}` (lớp nào thiếu animation thì bỏ qua) với bộ màu dựng từ `Look`:
   `h`/`H` tóc, `s`/`S` da, `t`/`T` áo, `o` viền, `a` là `accent` của vai trò.
2. Nếu thiếu `walk_left` nhưng có `walk_right`: lật ngang `walk_right`.
3. Còn lại: dùng `legacySprite` trong `legacy-characters.ts`.

Sofa quay trái lật ngang sprite `sit_side`. Bitmap được cache hai tầng: từng lớp trong `pixelbolt.ts` (công thức, animation, frame, bộ màu) và sprite đã ghép trong `characters.ts` (tư thế, frame, kiểu tóc, màu tóc, áo, vai trò, lật).
