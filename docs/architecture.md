# Kiến trúc

Bản đồ do Tech Lead cập nhật (lần gần nhất: T-18f08263). Agent đọc file này
trước khi làm để biết các phần đã có; sửa kiến trúc thì cập nhật sơ đồ.

```mermaid
flowchart TD
  subgraph Data
    API["src/api.ts<br/>gọi aico /workers, /tickets, events,<br/>needAction; demo 48s nhiều agent, lỗi phòng"]
    USG["src/usage.ts<br/>parseUsage, usageLevel, shortCountdown, isStale (thuần)"]
    TK["src/tickets.ts<br/>needKind, needsYou, actionsFor, needsConfirmation,<br/>mergeRequest, previewLink, demoNeedTickets (thuần)"]
    ACTV["src/activity.ts<br/>readAgentActivity, screenFor, bubbleFor,<br/>taskProgress, withDemoActivity (thuần)"]
    TIME["src/time.ts<br/>relativeTime (thuần)"]
    LATEST["src/latest.ts<br/>createLatestGate (thuần)"]
    ATT["src/attention.ts<br/>tabTitle, isShortcut P, toast state (thuần)"]
  end
  API --> TK
  ACTV -->|isIso| USG

  subgraph UIPure["src/ui hàm thuần (có test)"]
    VP["viewport.ts<br/>computeInsets → --free-*,<br/>fitScene: k nguyên, căn vùng trống / theo agent"]
    FM["feed-model.ts<br/>reduceFeed: recent mới + ticket cần người,<br/>khử trùng, thứ tự, giới hạn"]
    SEL["selection.ts<br/>agentKey, resolveSelection, drawerView"]
    FMT["format.ts<br/>usageTile, providerLetter, clock,<br/>agentStatus, fmtNumber, fmtAgo"]
  end
  FM --> ACTV
  FMT --> USG
  FMT --> ACTV

  subgraph UIDom["src/ui panel DOM (+ .css, dùng tokens.css)"]
    TOK["tokens.css<br/>màu trạng thái, mức, kính, font Pixelify Sans"]
    TOP["topbar.ts<br/>ô số agent/đang làm/cần bạn,<br/>thẻ hạn mức C/X/U, cài đặt popover, Demo"]
    SIDE["sidebar.ts + avatar.ts<br/>phòng → agent con, chấm trạng thái, phím ["]
    DRW["drawer.ts<br/>tab Agent (Đang làm/Gần đây/Task/Số liệu)<br/>tab Cần bạn chứa #needs; X/Esc; sheet khi hẹp"]
    FEED["feed.ts<br/>dòng giờ · agent · icon text, phím ]"]
  end
  TOP --> FMT
  SIDE --> FMT
  SIDE -->|agentLook, drawWalker| CHAR
  DRW --> TIME
  DRW --> TK
  DRW --> ACTV

  MAIN["src/main.ts<br/>vòng lặp animation, polling worker + ticket,<br/>relayout → insets → fitScene, chọn agent,<br/>phím P [ ] Esc, nguồn demo/thật"]
  API --> MAIN
  LATEST --> MAIN
  ATT --> MAIN
  MAIN --> VP
  MAIN --> FM
  MAIN --> SEL
  MAIN -->|update mỗi giây| TOP
  MAIN -->|update, onSelect| SIDE
  MAIN -->|render view + agent| DRW
  MAIN -->|lines| FEED
  MAIN -->|refresh, setSource, focus, tick| COL["src/needs-column.ts (+ .css)<br/>thẻ plan/merge/escalated, ghi chú, xác nhận"]
  COL --> TK
  COL --> LATEST
  COL -->|NeedSource.act| API
  COL --> NEEDS[["#needs trong #drawer (tab Cần bạn)"]]
  DRW --> NEEDS
  MAIN -->|ticket mới cần người| TOAST["src/toasts.ts (+ .css)<br/>toast nền đặc, viền trái màu mức, Xử lý"]
  MAIN -->|drawScene, sceneSize, resetActors| IDX["src/scene/index.ts<br/>ghép cảnh, trả SceneFigure[]"]
  IDX --> ACTV
  MAIN -->|figures mỗi frame| OVL["src/overlay.ts<br/>bong bóng, tiến độ task"]
  OVL --> ACTV
  MAIN -->|figures, hitFigure chọn agent| TIP["src/agent-tooltip.ts (+ .css)<br/>tooltip xem nhanh"]
  TIP --> ACTV

  IDX --> LAYOUT["layout.ts (thuần)"]
  IDX --> BOARD["usage-board.ts"]
  BOARD --> USG
  IDX --> ACT["actors.ts<br/>bất biến: seated ⇔ cuối path = ghế hiện tại"]
  ACT --> LAYOUT
  ACT --> PATH["pathing.ts (thuần)"]
  IDX --> TILES["tiles.ts"]
  IDX --> FURN["furniture.ts"]
  IDX --> CHAR["characters.ts"]
  ART[("art/characters/*.pixel.json")] -->|import.meta.glob| CHAR
  CHAR --> PB["pixelbolt.ts"]
  CHAR --> LEG["legacy-characters.ts"]
  CHAR --> PAL["palette.ts"]
  PB --> PIX["pixel.ts"]
  TILES --> PIX
  FURN --> PIX
  PIX --> CANVAS[["canvas #office trong #stage toàn màn,<br/>đặt theo vùng trống"]]

  subgraph Tests["npm test (vitest) cùng npm run build"]
    T_UI["ui/viewport, feed-model, selection, format .test.ts"]
    T_MAIN["main.test.ts<br/>ghép nối, chọn agent biến mất, đổi nguồn"]
    T_COL["needs-column.test.ts / tickets.test.ts"]
    T_OTHER["actors/pathing/layout/pixelbolt/characters/<br/>usage/activity/agent-tooltip/latest/attention/font"]
  end
  T_UI -.-> UIPure
  T_MAIN -.-> MAIN
  T_COL -.-> COL
  T_OTHER -.-> ACT
```
