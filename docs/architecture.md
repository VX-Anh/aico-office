# Kiến trúc

Bản đồ do Tech Lead cập nhật (lần gần nhất: T-0a0a01eb). Agent đọc file này
trước khi làm để biết các phần đã có; sửa kiến trúc thì cập nhật sơ đồ.

```mermaid
flowchart TD
  SOURCE["art/brand/logo-ax-source-black.png<br/>Nguồn chính, chỉ đọc"]
  RAW["art/brand/logo-ax-source-alpha-raw.png<br/>Chỉ tham khảo"]
  EXPORT["scripts/export-brand.py<br/>Pillow ngoài build/runtime"]
  LOGOS["public/brand/logo-ax-{512,192,64,32,16}.png<br/>Logo trong suốt giữ nguyên"]
  ICONS["public/brand/favicon-16.png, favicon-32.png<br/>Nền #0e1016, bo nhẹ<br/>apple-touch-icon.png 180: nền kín, không bo"]
  SOURCE -->|extract, crop, resize như trước| EXPORT
  EXPORT -->|nhánh logo cũ| LOGOS
  LOGOS -->|logo-ax-512.png làm nguồn icon| EXPORT
  EXPORT -->|logo khoảng 80%, ghép nền| ICONS

  BASE["Vite BASE_URL<br/>/ hoặc /preview/T-0a0a01eb/"]
  HTML["index.html<br/>settings, canvas, vùng UI<br/>khai báo icon"]
  TAB["Tab trình duyệt / màn hình chính"]
  BASE -->|%BASE_URL%| HTML
  ICONS -->|PNG| HTML
  HTML --> TAB

  API["src/api.ts<br/>workers, tickets, actions, demo 48 giây"]
  TK["src/tickets.ts"]
  LATEST["src/latest.ts"]
  ATT["src/attention.ts"]
  ACTV["src/activity.ts"]
  USG["src/usage.ts"]
  TIME["src/time.ts"]
  CONFIG["window.location + localStorage aico-office.api"]
  MAIN["src/main.ts<br/>poll, animation, selection, cập nhật UI"]
  API --> TK
  API --> MAIN
  LATEST --> MAIN
  ATT --> MAIN
  CONFIG --> MAIN
  MAIN -->|giá trị form| HTML
  HTML -->|submit| MAIN
  ACTV --> USG

  SHOTS["art/demo-shots/ + public/demo-shots/"]
  COL["src/needs-column.ts + CSS"]
  VIEWER["src/shot-viewer.ts + CSS"]
  SHOTS -->|assetBase theo BASE_URL| TK
  MAIN -->|demo assetBase| TK
  API --> COL
  LATEST --> COL
  COL --> TK
  COL --> VIEWER
  COL -->|actions| API
  COL -->|snapshot, NeedItem| MAIN

  subgraph UI["Khung UI hiện có"]
    TOP["ui/topbar.ts + CSS<br/>AX trong suốt, cao 20px"]
    VP["ui/viewport.ts"]
    FM["ui/feed-model.ts"]
    SEL["ui/selection.ts"]
    FMT["ui/format.ts"]
    TOK["ui/tokens.css"]
    SIDE["ui/sidebar.ts + CSS"]
    SIDEM["ui/sidebar-model.ts"]
    HIDDEN["localStorage hiddenRooms"]
    AV["ui/avatar.ts"]
    DRW["ui/drawer.ts + CSS"]
    DRWM["ui/drawer-model.ts"]
    FEED["ui/feed.ts + CSS"]
    NEEDS["#needs trong drawer"]
    TOAST["src/toasts.ts + CSS"]
  end
  BASE -->|import.meta.env.BASE_URL| TOP
  LOGOS -->|logo-ax-64.png| TOP
  HTML -->|settings form| TOP
  MAIN --> TOP
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
  EVENTS["scene/room-events.ts"]
  DEMO --> MAIN
  MAIN -->|snapshot| EVENTS
  EVENTS -->|banner| MAIN

  subgraph SCENE["Cảnh pixel hiện có"]
    IDX["scene/index.ts"]
    LAYOUT["scene/layout.ts: thuần"]
    ACT["scene/actors.ts"]
    PATH["scene/pathing.ts: thuần"]
    OUT["scene/outdoor.ts"]
    CACHE["Cache nền tĩnh"]
    TILES["scene/tiles.ts"]
    FURN["scene/furniture.ts"]
    BOARD["scene/usage-board.ts"]
    CHAR["scene/characters.ts"]
    PB["scene/pixelbolt.ts"]
    LEG["scene/legacy-characters.ts"]
    ART["art/characters/*.pixel.json"]
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

  CANVAS["canvas #office"]
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

  TEST["Vitest hiện có<br/>API, UI, scene, công thức art"]
  TEST -.-> API
  TEST -.-> MAIN
  TEST -.-> TOP
  TEST -.-> ACT
  TEST -.-> SIDE
  TEST -.-> DRW
  TEST -.-> FEED
  TEST -.-> ART
  CHECK["Kiểm build/test, root/subpath, demo<br/>kích thước, alpha, nền, favicon tab sáng"]
  CHECK -.-> ICONS
  CHECK -.-> LOGOS
  CHECK -.-> HTML
  CHECK -.-> TOP
  CHECK --> EVIDENCE["Bằng chứng gắn ticket<br/>không lưu art/brand-review/"]
  README["README.md<br/>Cấu trúc, tái xuất và kết quả kiểm tra"]
  README -.-> EXPORT
  README -.-> LOGOS
  README -.-> ICONS
```
