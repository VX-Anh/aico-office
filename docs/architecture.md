# Kiến trúc

Bản đồ do Tech Lead cập nhật (lần gần nhất: T-8ea8f203). Agent đọc file này
trước khi làm để biết các phần đã có; sửa kiến trúc thì cập nhật sơ đồ.

```mermaid
flowchart TD
  subgraph Data
    API["src/api.ts<br/>gọi aico /workers, /tickets, /tickets/{id}/events,<br/>POST /escalation + /decisions qua needAction;<br/>dữ liệu demo; current @deprecated giữ cho aico cũ"]
    USG["src/usage.ts<br/>parseUsage, usageWindows, usageLevel,<br/>shortCountdown, isStale (thuần)"]
    TK["src/tickets.ts<br/>parseTickets, needKind, needsYou, createReasonCache,<br/>latestEscalationReason, mergeRequest, previewLink,<br/>actionsFor, commentRequired, irreversible,<br/>needsConfirmation(kind, action): merge/approved cần xác nhận,<br/>build*Request, actionError, waitedLabel,<br/>demoNeedTickets, applyDemoAction(list,id,kind,action) (thuần)"]
    ACTV["src/activity.ts<br/>readAgentActivity, screenFor, bubbleFor,<br/>taskProgress, resolveBubbles, withDemoActivity (thuần)"]
    LATEST["src/latest.ts<br/>createLatestGate: bỏ kết quả poll cũ (thuần)"]
    ATT["src/attention.ts<br/>tabTitle, isShortcut (phím P), nextAttention (thuần)"]
  end
  API --> TK
  ACTV -->|isIso| USG
  MAIN["src/main.ts<br/>vòng lặp animation, polling worker + ticket,<br/>nguồn ticket thật/demo (NeedSource), bộ đếm, phím P, toast"]
  API --> MAIN
  USG --> MAIN
  ACTV --> MAIN
  ATT --> MAIN
  LATEST --> MAIN
  MAIN -->|refresh mỗi POLL_MS, setSource, focus, tick| COL["src/needs-column.ts (+ .css)<br/>cột Cần bạn: thẻ plan/merge/escalated, ghi chú,<br/>xác nhận trong thẻ theo needsConfirmation<br/>(Duyệt merge: 'Merge PR vào main'), khoá nút khi gửi"]
  COL --> TK
  COL --> LATEST
  COL -->|NeedSource.act| API
  COL --> NEEDS[["#needs cạnh canvas"]]
  MAIN -->|ticket mới cần người| TOAST["src/toasts.ts (+ .css)<br/>toast + nút Xử lý → focus thẻ"]
  MAIN -->|drawScene → SceneFigure[], sceneSize, resetActors, USAGE| IDX["src/scene/index.ts<br/>ghép cảnh, màn hình bàn theo screenFor,<br/>trả SceneFigure[]"]
  IDX -->|screenFor, readAgentActivity| ACTV
  MAIN -->|figures mỗi frame| OVL["src/overlay.ts<br/>bong bóng hoạt động, tiến độ task"]
  OVL --> ACTV
  OVL -->|BUBBLE| PAL
  MAIN -->|figures mỗi frame| TIP["src/agent-tooltip.ts (+ .css)<br/>hitFigure (thuần), tooltip DOM"]
  TIP --> ACTV

  IDX --> LAYOUT["layout.ts<br/>bố cục phòng, bàn, cửa, chỗ ngồi, usageBoard (thuần)"]
  IDX -->|parseUsage| USG
  IDX --> BOARD["usage-board.ts<br/>thanh hạn mức 5H/WK, %, ?"]
  BOARD --> USG
  BOARD --> PAL
  BOARD --> FONT
  BOARD --> PIX
  IDX --> ACT["actors.ts<br/>agent đi vào/ra, actorPose<br/>bất biến: seated ⇔ cuối path = ghế hiện tại"]
  ACT --> LAYOUT
  ACT --> PATH["pathing.ts<br/>đường đi, vị trí theo thời gian (thuần)"]
  ACT -->|agentLook| CHAR
  IDX --> TILES["tiles.ts<br/>sàn, tường, cửa"]
  IDX --> FURN["furniture.ts<br/>bàn, ghế, sofa, biển tên, màn hình theo việc"]
  FURN -->|shortCountdown| USG
  FURN -->|SCREEN| PAL
  IDX --> CHAR["characters.ts<br/>chọn tư thế, chồng lớp thân→tóc→phụ kiện"]

  ART[("art/characters/*.pixel.json")] -->|import.meta.glob| CHAR
  CHAR --> PB["pixelbolt.ts<br/>đọc công thức, từ chối frame hỏng"]
  CHAR -->|tư thế thiếu/hỏng| LEG["legacy-characters.ts"]
  CHAR --> PAL["palette.ts<br/>màu provider, vai trò, USAGE, SCREEN, BUBBLE"]
  PB --> PIX["pixel.ts<br/>drawGrid, cached bitmap"]
  LEG --> PIX
  CHAR --> PIX
  CHAR --> FONT["font.ts<br/>chữ pixel 3x5"]
  TILES --> PIX
  FURN --> PIX
  FURN --> FONT
  PIX --> CANVAS[["canvas #office"]]

  subgraph Tests["npm test (vitest, môi trường node) — cổng cùng npm run build"]
    T_TK["tickets.test.ts<br/>bảng kind x action → needsConfirmation,<br/>nút, request, lỗi, demo, dữ liệu đổi giữa chừng"]
    T_COL["needs-column.test.ts (mới, DOM giả)<br/>Duyệt merge chờ xác nhận; mất/xuất hiện lại,<br/>đổi số lượng, đổi loại, offline, đổi nguồn"]
    T_MAIN["main.test.ts<br/>ghép nối Cần bạn, nguồn demo/thật, lỗi tải"]
    T_LATEST["latest.test.ts / attention.test.ts"]
    T_ACT["actors.test.ts / pathing.test.ts / layout.test.ts"]
    T_PB["pixelbolt.test.ts / characters.test.ts"]
    T_OTHER["usage.test.ts / activity.test.ts / agent-tooltip.test.ts / font.test.ts"]
  end
  T_TK -.-> TK
  T_COL -.-> COL
  T_MAIN -.-> MAIN
  T_LATEST -.-> LATEST
  T_LATEST -.-> ATT
  T_ACT -.-> ACT
  T_PB -.-> PB
  T_OTHER -.-> ACTV
```
