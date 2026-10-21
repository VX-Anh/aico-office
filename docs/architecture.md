# Kiến trúc

Bản đồ do Tech Lead cập nhật (lần gần nhất: T-96adf6f9). Agent đọc file này
trước khi làm để biết các phần đã có; sửa kiến trúc thì cập nhật sơ đồ.

```mermaid
flowchart TD
  subgraph Data
    API["src/api.ts<br/>gọi aico /workers, /tickets, /tickets/{id}/events,<br/>POST /tickets/{id}/escalation; dữ liệu demo (có usage)<br/>agents[] đi qua nguyên vẹn (activity, recent, tasks, stats)"]
    USG["src/usage.ts<br/>parseUsage (từ chối usage hỏng → null), isIso,<br/>usageWindows, usageLevel, shortCountdown, isStale (thuần)"]
    TK["src/tickets.ts<br/>parseTickets, escalatedOnly, latestEscalationReason,<br/>mergeRequest, actionAvailability, needsConfirm,<br/>buildEscalationRequest, escalationError, demoTickets (thuần)"]
    ACTV["src/activity.ts<br/>readAgentActivity (đọc phòng thủ activity/recent/tasks/stats),<br/>screenFor, bubbleFor (stale 60s, error, cắt 28), taskProgress,<br/>resolveBubbles, withDemoActivity (thuần)"]
  end
  API --> TK
  ACTV -->|isIso| USG
  MAIN["src/main.ts<br/>vòng lặp animation, polling (worker + ticket cùng chu kỳ),<br/>thẻ trạng thái, chú thích, nguồn ticket thật/demo,<br/>demo + withDemoActivity"]
  API --> MAIN
  USG --> MAIN
  ACTV --> MAIN
  MAIN -->|refresh mỗi POLL_MS, nguồn list/act| PANEL["src/escalation-panel.ts<br/>panel HTML phủ góc phải canvas, thu gọn được;<br/>ghi chú + Đẩy lại/Merge/Đóng/Đánh dấu lỗi,<br/>xác nhận trong panel, khoá nút khi gửi"]
  PANEL --> TK
  PANEL --> OVERLAY[["#escalations trong .stage<br/>(phủ trên canvas)"]]
  MAIN -->|drawScene → SceneFigure[], sceneSize, resetActors, USAGE| IDX["src/scene/index.ts<br/>ghép cảnh, màn hình bàn theo screenFor,<br/>trả SceneFigure[] (vị trí đầu/chân, working)"]
  IDX -->|screenFor, readAgentActivity| ACTV
  MAIN -->|figures mỗi frame| OVL["src/overlay.ts<br/>canvas chữ phủ (pointer-events:none, DPR):<br/>bong bóng icon+text, error viền đỏ, stale mờ,<br/>chồng nhau thu về icon; thanh tiến độ done/total"]
  OVL --> ACTV
  OVL -->|BUBBLE| PAL
  OVL --> TXT[["canvas .activity-overlay<br/>phủ trên #office, dưới #escalations"]]
  MAIN -->|figures mỗi frame| TIP["src/agent-tooltip.ts (+ .css)<br/>hitFigure (thuần), tooltip DOM cạnh con trỏ;<br/>chạm để mở/đóng; ticket, vai trò, 5 recent, task, stats"]
  TIP --> ACTV

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
  IDX --> FURN["furniture.ts<br/>bàn, ghế, sofa, biển tên, biển đếm ngược;<br/>màn hình code/terminal/browser/search/read/cursor/off"]
  FURN -->|shortCountdown| USG
  FURN -->|SCREEN| PAL
  IDX -->|drawWalker, drawSeatedBack,<br/>drawSofaSitter, drawSleeper, residentLook| CHAR["characters.ts<br/>chọn tư thế, chồng lớp thân→tóc→phụ kiện,<br/>thay khoá màu theo Look"]

  ART[("art/characters/*.pixel.json<br/>body, hair/style0-3, acc/role")] -->|import.meta.glob lúc build| CHAR
  CHAR -->|công thức + bộ màu| PB["pixelbolt.ts<br/>đọc palette, frames grid/from, animations<br/>từ chối frame hỏng → fallback"]
  CHAR -->|tư thế thiếu hoặc hỏng| LEG["legacy-characters.ts<br/>sprite lưới ký tự cũ"]
  CHAR --> PAL["palette.ts<br/>màu provider, vai trò + accent, da, tóc, USAGE,<br/>SCREEN, BUBBLE"]
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
    T_ACTV["activity.test.ts<br/>thiếu trường, sai kiểu, kind lạ → other, screenFor,<br/>bubbleFor stale/error/cắt chữ, taskProgress,<br/>resolveBubbles, dữ liệu đổi giữa chừng, demo"]
    T_TIP["agent-tooltip.test.ts<br/>hitFigure trúng/trượt/chồng nhau"]
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
  T_ACTV -.-> ACTV
  T_TIP -.-> TIP
```
