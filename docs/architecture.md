# Kiến trúc

Bản đồ do Tech Lead cập nhật (lần gần nhất: T-87b2140f). Agent đọc file này
trước khi làm để biết các phần đã có; sửa kiến trúc thì cập nhật sơ đồ.

```mermaid
flowchart TD
  subgraph Data
    API["src/api.ts<br/>gọi aico /workers, /tickets, /tickets/{id}/events,<br/>POST /tickets/{id}/escalation; dữ liệu demo (có usage)"]
    USG["src/usage.ts<br/>parseUsage (từ chối usage hỏng → null),<br/>usageWindows, usageLevel, shortCountdown, isStale (thuần)"]
    TK["src/tickets.ts<br/>parseTickets, escalatedOnly, latestEscalationReason,<br/>mergeRequest, actionAvailability, needsConfirm,<br/>buildEscalationRequest, escalationError, demoTickets (thuần)"]
  end
  API --> TK
  MAIN["src/main.ts<br/>vòng lặp animation, polling (worker + ticket cùng chu kỳ),<br/>thẻ trạng thái, chú thích, nguồn ticket thật/demo"]
  API --> MAIN
  USG --> MAIN
  MAIN -->|refresh mỗi POLL_MS, nguồn list/act| PANEL["src/escalation-panel.ts<br/>panel HTML phủ góc phải canvas, thu gọn được;<br/>ghi chú + Đẩy lại/Merge/Đóng/Đánh dấu lỗi,<br/>xác nhận trong panel, khoá nút khi gửi"]
  PANEL --> TK
  PANEL --> OVERLAY[["#escalations trong .stage<br/>(phủ trên canvas)"]]
  MAIN -->|drawScene, sceneSize, resetActors, USAGE| IDX["src/scene/index.ts<br/>ghép cảnh"]

  IDX --> LAYOUT["layout.ts<br/>bố cục phòng, bàn, cửa, chỗ ngồi, usageBoard (thuần)"]
  IDX -->|parseUsage| USG
  IDX --> BOARD["usage-board.ts<br/>thanh hạn mức 5H/WK, %, ? + gói"]
  BOARD --> USG
  BOARD --> PAL
  BOARD --> FONT
  BOARD --> PIX
  IDX --> ACT["actors.ts<br/>agent đi vào/ra, rebase/turn, actorPose<br/>bất biến: seated ⇔ cuối path = ghế hiện tại"]
  ACT --> LAYOUT
  ACT --> PATH["pathing.ts<br/>đường đi, vị trí theo thời gian (thuần)"]
  ACT -->|agentLook| CHAR
  IDX --> TILES["tiles.ts<br/>sàn, tường, cửa"]
  IDX --> FURN["furniture.ts<br/>bàn, ghế, sofa, biển tên, biển đếm ngược"]
  FURN -->|shortCountdown| USG
  IDX -->|drawWalker, drawSeatedBack,<br/>drawSofaSitter, drawSleeper, residentLook| CHAR["characters.ts<br/>chọn tư thế, chồng lớp thân→tóc→phụ kiện,<br/>thay khoá màu theo Look"]

  ART[("art/characters/*.pixel.json<br/>body, hair/style0-3, acc/role")] -->|import.meta.glob lúc build| CHAR
  CHAR -->|công thức + bộ màu| PB["pixelbolt.ts<br/>đọc palette, frames grid/from, animations<br/>từ chối frame hỏng → fallback"]
  CHAR -->|tư thế thiếu hoặc hỏng| LEG["legacy-characters.ts<br/>sprite lưới ký tự cũ"]
  CHAR --> PAL["palette.ts<br/>màu provider, vai trò + accent, da, tóc, USAGE"]
  PB --> PIX["pixel.ts<br/>drawGrid, cached bitmap, shade"]
  LEG --> PIX
  CHAR --> PIX
  CHAR --> FONT["font.ts<br/>chữ pixel 3x5 (có % và ?)"]
  TILES --> PIX
  FURN --> PIX
  FURN --> FONT
  PIX -->|canvas offscreen| CANVAS[["canvas #office<br/>image-rendering: pixelated"]]

  subgraph Tests["npm test (vitest) — cổng cùng npm run build, chạy trong CI"]
    T_PATH["pathing.test.ts / layout.test.ts<br/>usageBoard không chồng đồ vật"]
    T_ACT["actors.test.ts<br/>kịch bản dữ liệu đổi giữa chừng"]
    T_PB["pixelbolt.test.ts / characters.test.ts<br/>công thức hỏng + mọi file art/"]
    T_USG["usage.test.ts<br/>ngưỡng màu, đếm ngược, usage hỏng, số liệu cũ"]
    T_FONT["font.test.ts<br/>glyph % và ?"]
    T_TK["tickets.test.ts<br/>lọc escalated, lý do mới nhất, nút bật/tắt,<br/>dựng request, lỗi 409/501, dữ liệu đổi giữa chừng"]
  end
  T_PATH -.-> PATH
  T_PATH -.-> LAYOUT
  T_ACT -.-> ACT
  T_PB -.-> PB
  T_PB -.-> CHAR
  T_PB -.-> ART
  T_USG -.-> USG
  T_FONT -.-> FONT
  T_TK -.-> TK
```
