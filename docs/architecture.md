# Kiến trúc

Bản đồ do Tech Lead cập nhật (lần gần nhất: T-422fe82f). Agent đọc file này
trước khi làm để biết các phần đã có; sửa kiến trúc thì cập nhật sơ đồ.

```mermaid
flowchart TD
  subgraph Data
    API["src/api.ts<br/>gọi aico /workers, dữ liệu demo"]
  end
  MAIN["src/main.ts<br/>vòng lặp animation, polling, thẻ trạng thái, chú thích"]
  API --> MAIN
  MAIN -->|drawScene, sceneSize, resetActors| IDX["src/scene/index.ts<br/>ghép cảnh"]

  IDX --> LAYOUT["layout.ts<br/>bố cục phòng, bàn, cửa, chỗ ngồi (thuần)"]
  IDX --> ACT["actors.ts<br/>agent đi vào/ra, rebase/turn, actorPose<br/>bất biến: seated ⇔ cuối path = ghế hiện tại"]
  ACT --> LAYOUT
  ACT --> PATH["pathing.ts<br/>đường đi, vị trí theo thời gian (thuần)"]
  ACT -->|agentLook| CHAR
  IDX --> TILES["tiles.ts<br/>sàn, tường, cửa"]
  IDX --> FURN["furniture.ts<br/>bàn, ghế, sofa, biển tên"]
  IDX -->|drawWalker, drawSeatedBack,<br/>drawSofaSitter, drawSleeper, residentLook| CHAR["characters.ts<br/>chọn tư thế, chồng lớp thân→tóc→phụ kiện,<br/>thay khoá màu theo Look"]

  ART[("art/characters/*.pixel.json<br/>body, hair/style0-3, acc/role")] -->|import.meta.glob lúc build| CHAR
  CHAR -->|công thức + bộ màu| PB["pixelbolt.ts<br/>đọc palette, frames grid/from, animations<br/>từ chối frame hỏng → fallback"]
  CHAR -->|tư thế thiếu hoặc hỏng| LEG["legacy-characters.ts<br/>sprite lưới ký tự cũ"]
  CHAR --> PAL["palette.ts<br/>màu provider, vai trò + accent, da, tóc"]
  PB --> PIX["pixel.ts<br/>drawGrid, cached bitmap, shade"]
  LEG --> PIX
  CHAR --> PIX
  CHAR --> FONT["font.ts<br/>chữ pixel (Z)"]
  TILES --> PIX
  FURN --> PIX
  FURN --> FONT
  PIX -->|canvas offscreen| CANVAS[["canvas #office<br/>image-rendering: pixelated"]]

  subgraph Tests["npm test (vitest) — cổng cùng npm run build"]
    T_PATH["pathing.test.ts / layout.test.ts"]
    T_ACT["actors.test.ts<br/>kịch bản dữ liệu đổi giữa chừng"]
    T_PB["pixelbolt.test.ts / characters.test.ts<br/>công thức hỏng + mọi file art/"]
  end
  T_PATH -.-> PATH
  T_PATH -.-> LAYOUT
  T_ACT -.-> ACT
  T_PB -.-> PB
  T_PB -.-> CHAR
  T_PB -.-> ART
```
