# Kiến trúc

Bản đồ do Tech Lead cập nhật (lần gần nhất: T-de61a515). Agent đọc file này
trước khi làm để biết các phần đã có; sửa kiến trúc thì cập nhật sơ đồ.

```mermaid
flowchart TD
  SOURCE["art/brand/logo-ax-source-black.png<br/>Nguồn chính, chỉ đọc"]
  RAW["art/brand/logo-ax-source-alpha-raw.png<br/>Chỉ tham khảo"]
  EXPORT["scripts/export-brand.py<br/>Python + Pillow ngoài runtime<br/>mask, khử nền đen ở mép, crop, resize"]
  BRAND["public/brand/<br/>PNG 512, 192, 64, 32, 16<br/>apple-touch-icon 180"]
  BASE["Vite BASE_URL<br/>/ hoặc /preview/T-de61a515/"]
  HTML["index.html<br/>settings, canvas, vùng UI<br/>favicon và apple-touch-icon"]
  TAB["Tab trình duyệt / màn hình chính"]
  SOURCE --> EXPORT --> BRAND
  BASE -->|%BASE_URL%| HTML
  BRAND -->|icon PNG| HTML --> TAB

  API["src/api.ts<br/>workers, snapshot tickets, actions<br/>demoWorkers 48 giây, 6 vai trò demo"]
  TK["src/tickets.ts<br/>parse, needsYou, actions, MR, preview, screenshots"]
  LATEST["src/latest.ts<br/>chặn snapshot cũ"]
  ATT["src/attention.ts<br/>tiêu đề tab, phím tắt, toast"]
  ACTV["src/activity.ts"]
  USG["src/usage.ts"]
  TIME["src/time.ts"]
  API --> TK
  ACTV --> USG

  MAIN["src/main.ts<br/>poll, nguồn, thời gian, animation<br/>selection và cập nhật UI"]
  API --> MAIN
  LATEST --> MAIN
  ATT --> MAIN
  CONFIG["window.location + localStorage aico-office.api"]
  CONFIG --> MAIN
  MAIN -->|giá trị form| HTML
  HTML -->|submit| MAIN

  SHOTS["art/demo-shots/ + public/demo-shots/"]
  SHOTS -->|assetBase theo BASE_URL| TK
  MAIN -->|demo assetBase| TK
  COL["src/needs-column.ts + CSS<br/>snapshot gate, lọc items, ảnh review"]
  VIEWER["src/shot-viewer.ts + CSS<br/>lightbox, bàn phím"]
  API --> COL
  LATEST --> COL
  COL --> TK
  COL --> VIEWER
  COL -->|actions| API
  COL -->|snapshot và NeedItem| MAIN

  subgraph UI["Khung UI"]
    TOP["src/ui/topbar.ts + topbar.css<br/>ảnh AX tĩnh, alt rỗng, cao 20px<br/>bộ đếm, hạn mức, Cài đặt, Demo"]
    VP["ui/viewport.ts<br/>computeInsets, fitScene, feedBox"]
    FM["ui/feed-model.ts"]
    SEL["ui/selection.ts"]
    FMT["ui/format.ts"]
    TOK["ui/tokens.css"]
    SIDE["ui/sidebar.ts + CSS"]
    SIDEM["ui/sidebar-model.ts<br/>lọc nhãn và role"]
    HIDDEN["localStorage hiddenRooms"]
    AV["ui/avatar.ts<br/>khoá id và role, fallback"]
    DRW["ui/drawer.ts + CSS"]
    DRWM["ui/drawer-model.ts"]
    FEED["ui/feed.ts + CSS"]
    NEEDS["#needs trong drawer"]
    TOAST["src/toasts.ts + CSS"]
  end

  BASE -->|import.meta.env.BASE_URL| TOP
  BRAND -->|logo-ax-64.png| TOP
  HTML -->|settings form| TOP
  MAIN -->|workers, bộ đếm, thời gian| TOP
  TOP -->|submit, Demo| MAIN
  TOP --> FMT
  MAIN --> VP
  VP --> MAIN
  MAIN --> FM
  MAIN --> SEL
  MAIN --> SIDE
  SIDE -->|onSelect| MAIN
  SIDE --> SIDEM
  SIDE <--> HIDDEN
  SIDE --> AV
  SIDE --> FMT
  SIDE --> ACTV
  MAIN --> DRW
  DRW -->|onTicket| MAIN
  DRW --> DRWM
  DRW --> AV
  DRW --> FMT
  DRW --> TK
  DRWM --> ACTV
  DRWM --> TIME
  DRWM --> FMT
  DRWM --> TK
  DRW --> NEEDS
  COL --> NEEDS
  MAIN --> FEED
  FEED -->|onAgent, onTicket| MAIN
  FEED --> AV
  FEED --> FMT
  FM --> ACTV
  FMT --> USG
  FMT --> ACTV
  MAIN --> TOAST
  TOAST -->|onOpen| MAIN
  TOK -.-> TOP
  TOK -.-> SIDE
  TOK -.-> DRW
  TOK -.-> FEED
  TOK -.-> COL
  TOK -.-> VIEWER

  DEMO["scene/demo-events.ts"]
  EVENTS["scene/room-events.ts<br/>MR, done, escalated, TTL"]
  DEMO --> MAIN
  MAIN -->|snapshot| EVENTS
  EVENTS -->|banner| MAIN

  subgraph SCENE["Cảnh pixel hiện có"]
    IDX["scene/index.ts<br/>ghép cảnh, SceneFigure"]
    LAYOUT["scene/layout.ts<br/>thuần"]
    ACT["scene/actors.ts<br/>seated đúng ghế, look theo role"]
    PATH["scene/pathing.ts<br/>thuần"]
    OUT["scene/outdoor.ts"]
    CACHE["Cache nền tĩnh"]
    TILES["scene/tiles.ts"]
    FURN["scene/furniture.ts"]
    BOARD["scene/usage-board.ts"]
    CHAR["scene/characters.ts"]
    PB["scene/pixelbolt.ts"]
    LEG["scene/legacy-characters.ts"]
    ART["art/characters/*.pixel.json<br/>thân, tóc, phụ kiện 7 vai trò"]
    PAL["scene/palette.ts"]
    PIX["scene/pixel.ts"]
    LIGHT["scene/lighting.ts"]
  end
  MAIN -->|workers, thời gian, reduced motion| IDX
  IDX --> LAYOUT
  IDX --> ACT
  ACT --> LAYOUT
  ACT --> PATH
  ACT --> CHAR
  IDX --> OUT
  IDX --> CACHE
  CACHE --> OUT
  CACHE --> TILES
  IDX --> FURN
  IDX --> BOARD
  BOARD --> USG
  IDX --> ACTV
  IDX --> CHAR
  IDX --> LIGHT
  AV --> CHAR
  ART --> CHAR
  CHAR --> PB
  CHAR --> LEG
  CHAR --> PAL
  LEG --> PAL
  OUT --> PAL
  LIGHT --> PAL
  FURN --> PAL
  SIDE --> PAL
  AV --> PAL
  FEED --> PAL
  DRW --> PAL
  TILES --> PIX
  OUT --> PIX
  FURN --> PIX
  PB --> PIX
  LEG --> PIX
  CANVAS["canvas #office<br/>cache nền, phần động, lightmap"]
  CACHE --> CANVAS
  IDX --> CANVAS
  LIGHT --> CANVAS

  OVL["src/overlay.ts"]
  TIP["src/agent-tooltip.ts + CSS"]
  SCREEN["Lớp chữ trên cảnh"]
  MAIN --> OVL
  MAIN --> TIP
  OVL --> ACTV
  OVL --> PAL
  TIP --> ACTV
  TIP --> FMT
  TIP --> PAL
  OVL --> SCREEN
  CANVAS --> SCREEN

  TEST["Vitest hiện có + topbar.test.ts<br/>BASE_URL, ảnh tĩnh qua dữ liệu đổi<br/>giữ các test scene, role, UI và API"]
  TEST -.-> TOP
  TEST -.-> API
  TEST -.-> MAIN
  TEST -.-> ACT
  TEST -.-> SIDE
  TEST -.-> DRW
  TEST -.-> FEED
  TEST -.-> ART
  CHECK["Kiểm build root/subpath và demo<br/>alpha, kích thước, responsive, icon"]
  CHECK -.-> BRAND
  CHECK -.-> HTML
  CHECK -.-> TOP
  CHECK --> EVIDENCE["art/brand-review/<br/>ảnh bằng chứng"]
  README["README.md<br/>Cấu trúc và hướng dẫn tái xuất"]
  README -.-> EXPORT
  README -.-> BRAND
```
