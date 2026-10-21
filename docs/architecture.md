# Kiến trúc

Bản đồ do Tech Lead cập nhật (lần gần nhất: T-626ddd48). Agent đọc file này
trước khi làm để biết các phần đã có; sửa kiến trúc thì cập nhật sơ đồ.

```mermaid
flowchart TD
  subgraph Data
    API["src/api.ts<br/>gọi aico /workers, /tickets, /tickets/{id}/events,<br/>POST /tickets/{id}/escalation, /tickets/{id}/decisions (needAction);<br/>dữ liệu demo worker (có usage)"]
    USG["src/usage.ts<br/>parseUsage (từ chối usage hỏng → null),<br/>usageWindows, usageLevel, shortCountdown, isStale (thuần)"]
    TK["src/tickets.ts<br/>parseTickets, needsYou/needKind (plan, merge, escalated),<br/>actionsFor, commentRequired, irreversible, previewLink,<br/>buildDecisionRequest/buildEscalationRequest, actionError,<br/>latestEscalationReason, reason cache, demoNeedTickets (thuần)"]
    ATT["src/attention.ts<br/>tabTitle, nextAttention (phím P), isShortcut,<br/>reconcileToasts/dismissToast: gộp, tối đa 3, huỷ khi rời trạng thái (thuần)"]
  end
  API --> TK
  MAIN["src/main.ts<br/>vòng lặp animation, polling worker + ticket cùng POLL_MS,<br/>thanh trên: Đang làm X, Cần bạn N, tiêu đề tab, phím P;<br/>thẻ phòng, chú thích, nguồn ticket thật/demo"]
  API --> MAIN
  USG --> MAIN
  ATT --> MAIN
  MAIN -->|refresh, nguồn list/act, focus id| COL["src/needs-column.ts (+ .css)<br/>cột Cần bạn cạnh canvas, ẩn khi rỗng;<br/>thẻ theo id|kind: duyệt kế hoạch / duyệt merge / escalated,<br/>ghi chú bắt buộc, xác nhận trong thẻ, khoá khi gửi"]
  COL -->|onItems| MAIN
  COL --> TK
  MAIN -->|update entries, reset| TOAST["src/toasts.ts (+ .css)<br/>toast góc dưới phải canvas, nút Xử lý/đóng"]
  TOAST --> ATT
  TOAST -->|onOpen id| MAIN
  COL --> ASIDE[["aside#needs trong .workspace (grid, cột phải;<br/>< 900px xuống dưới canvas)"]]
  TOAST --> STACK[["#toasts trong .stage"]]
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
  PIX -->|canvas offscreen| CANVAS[["canvas #office trong .stage<br/>image-rendering: pixelated, không bị panel đè"]]

  subgraph Tests["npm test (vitest) — cổng cùng npm run build, chạy trong CI"]
    T_PATH["pathing.test.ts / layout.test.ts<br/>usageBoard không chồng đồ vật"]
    T_ACT["actors.test.ts<br/>kịch bản dữ liệu đổi giữa chừng"]
    T_PB["pixelbolt.test.ts / characters.test.ts<br/>công thức hỏng + mọi file art/"]
    T_USG["usage.test.ts<br/>ngưỡng màu, đếm ngược, usage hỏng, số liệu cũ"]
    T_FONT["font.test.ts<br/>glyph % và ?"]
    T_TK["tickets.test.ts<br/>phân loại cần người, hành động theo trạng thái,<br/>ghi chú bắt buộc, request decisions/escalation, lỗi 4xx/5xx,<br/>dữ liệu đổi giữa chừng"]
    T_ATT["attention.test.ts<br/>tiêu đề tab, ticket kế tiếp (P), phím tắt,<br/>gộp/huỷ toast khi ticket rời trạng thái"]
    T_LAT["latest.test.ts<br/>poll chồng nhau, đổi nguồn"]
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
  T_ATT -.-> ATT
```
