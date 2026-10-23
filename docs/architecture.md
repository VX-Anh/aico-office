# Kiến trúc

Bản đồ do Tech Lead cập nhật (lần gần nhất: T-8d17b253). Agent đọc file này
trước khi làm để biết các phần đã có; sửa kiến trúc thì cập nhật sơ đồ.

```mermaid
flowchart TD
  subgraph Data["Dữ liệu và logic thuần hiện có"]
    API["src/api.ts<br/>workers, snapshot tickets đầy đủ, actions<br/>demoWorkers 48 giây, DEMO_ROLES 6 vai trò<br/>(+ ba read, tester review)<br/>roomAgents: current cũ giữ role<br/>defaultBaseUrl: origin/api trên tên miền thật"]
    TK["src/tickets.ts<br/>parseTickets, needsYou, NEED_LABEL, actions, MR, preview<br/>latestScreenshots, demoNeedTickets kèm ảnh demo"]
    ACTV["src/activity.ts<br/>activity, screenFor, bubbles, progress"]
    USG["src/usage.ts"]
    TIME["src/time.ts"]
    LATEST["src/latest.ts<br/>createLatestGate"]
    ATT["src/attention.ts"]
  end
  API --> TK
  ACTV --> USG

  SHOTS["public/demo-shots/ + art/demo-shots/"]
  SHOTS -.->|url tuyệt đối theo BASE_URL| TK

  COL["src/needs-column.ts + CSS<br/>gate snapshot, lọc items, hàng ảnh"]
  VIEWER["src/shot-viewer.ts + CSS<br/>lightbox ←/→, Esc"]
  API -->|cùng request tickets| COL
  LATEST --> COL
  COL --> TK
  COL -->|mở ảnh| VIEWER
  COL -->|actions| API
  COL -->|snapshot, NeedItem đã lọc| MAIN

  LOC["window.location"]
  LS["localStorage aico-office.api"]
  FORM["#settings trong index.html"]

  MAIN["src/main.ts<br/>poll, nguồn, giờ, reduced motion, vòng animation<br/>chọn agent, showNeeds, update sidebar"]
  API --> MAIN
  LATEST --> MAIN
  ATT --> MAIN
  MAIN -->|demo assetBase| TK
  LS -->|loadConfig| MAIN
  MAIN -->|saveConfig khi submit| LS
  LOC -->|defaultBaseUrl| MAIN
  MAIN -->|value baseUrl| FORM

  subgraph UI["Khung UI"]
    VP["ui/viewport.ts<br/>computeInsets, fitScene, feedBox"]
    FM["ui/feed-model.ts"]
    SEL["ui/selection.ts"]
    FMT["ui/format.ts"]
    TOK["ui/tokens.css"]
    TOP["ui/topbar.ts + CSS"]
    SIDEM["ui/sidebar-model.ts<br/>agentMatches theo nhãn + role id"]
    SIDE["ui/sidebar.ts + CSS<br/>ô tìm, chip lọc, khối phòng, dòng agent<br/>chú thích 7 vai trò từ ROLE_STYLES"]
    LSH[("localStorage hiddenRooms")]
    AV["ui/avatar.ts<br/>khoá id+role, fallback màu áo + chữ đầu nhãn"]
    DRWM["ui/drawer-model.ts"]
    DRW["ui/drawer.ts + CSS"]
    FEED["ui/feed.ts + CSS"]
    NEEDS["#needs trong drawer"]
    TOAST["toasts.ts + CSS"]
  end
  FORM --> TOP
  MAIN --> VP
  MAIN --> FM
  MAIN --> SEL
  MAIN --> TOP
  MAIN -->|workers, needIds, selectedKey, now| SIDE
  SIDE -->|onSelect| MAIN
  MAIN -->|view, agent + needItems| DRW
  DRW -->|onTicket| MAIN
  MAIN -->|lines + workers| FEED
  FEED -->|onAgent, onTicket| MAIN
  MAIN --> TOAST
  TOAST -->|onOpen| MAIN
  TOP -->|submit, Demo| MAIN
  TOP --> FMT
  SIDE --> SIDEM
  SIDE --> FMT
  SIDE --> AV
  SIDE --> ACTV
  SIDE --> PAL
  SIDE <--> LSH
  FEED --> AV
  FEED --> FMT
  FEED --> PAL
  FMT --> USG
  FMT --> ACTV
  FM --> ACTV
  DRW --> DRWM
  DRW --> AV
  DRW --> FMT
  DRW --> PAL
  DRW --> TK
  DRWM --> ACTV
  DRWM --> TIME
  DRWM --> FMT
  DRWM --> TK
  DRW --> NEEDS
  COL --> NEEDS
  TOK -.-> TOP
  TOK -.-> SIDE
  TOK -.-> DRW
  TOK -.-> FEED
  TOK -.-> COL
  TOK -.-> VIEWER

  DEMO["scene/demo-events.ts"]
  EVENTS["scene/room-events.ts<br/>MR mới/done/escalated, TTL 10 giây"]
  DEMO --> MAIN
  MAIN -->|snapshot| EVENTS
  EVENTS -->|banner| MAIN

  IDX["scene/index.ts<br/>ghép cảnh, SceneFigure"]
  MAIN -->|workers, thời gian, reduced motion| IDX
  LAYOUT["scene/layout.ts<br/>thuần"]
  OUT["scene/outdoor.ts"]
  CACHE["Canvas cache nền tĩnh"]
  TILES["scene/tiles.ts"]
  ACT["scene/actors.ts<br/>seated chỉ khi cuối path đúng ghế<br/>look làm mới mỗi sync khi role đổi"]
  PATH["scene/pathing.ts<br/>thuần"]
  FURN["scene/furniture.ts<br/>màn hình màu code theo mode"]
  BOARD["scene/usage-board.ts"]
  CHAR["scene/characters.ts<br/>agentLook, lớp thân → tóc → acc/role"]
  PB["scene/pixelbolt.ts"]
  LEG["scene/legacy-characters.ts<br/>drawAccessory 7 vai trò<br/>ba/tester/researcher: front, side"]
  ART["art/characters/*.pixel.json<br/>acc/: tech_lead, coder, reviewer, designer,<br/>ba, tester, researcher"]
  PAL["scene/palette.ts<br/>ROLE_STYLES 7 vai trò + fallback xám<br/>màu provider, cảnh, ánh sáng, banner"]
  PIX["scene/pixel.ts"]
  LIGHT["scene/lighting.ts"]

  IDX --> LAYOUT
  IDX --> OUT
  IDX --> CACHE
  CACHE --> OUT
  CACHE --> TILES
  IDX --> ACT
  ACT --> LAYOUT
  ACT --> PATH
  ACT -->|agentLook| CHAR
  IDX --> FURN
  IDX --> BOARD
  BOARD --> USG
  IDX --> ACTV
  IDX --> CHAR
  AV --> CHAR
  AV --> PAL
  ART --> CHAR
  CHAR --> PB
  CHAR --> LEG
  CHAR --> PAL
  LEG --> PAL
  OUT --> PAL
  LIGHT --> PAL
  FURN --> PAL
  TILES --> PIX
  OUT --> PIX
  FURN --> PIX
  PB --> PIX
  LEG --> PIX
  IDX --> LIGHT

  CANVAS["canvas #office<br/>nền cache → phần động → lightmap"]
  CACHE --> CANVAS
  IDX -->|đồ đạc, nhân vật, xe| CANVAS
  LIGHT --> CANVAS
  VP --> MAIN

  OVL["src/overlay.ts"]
  TIP["src/agent-tooltip.ts + CSS<br/>vai trò qua roleStyle"]
  MAIN --> OVL
  MAIN --> TIP
  OVL --> ACTV
  OVL --> PAL
  TIP --> ACTV
  TIP --> FMT
  TIP --> PAL
  OVL --> SCREEN["Lớp chữ trên cảnh"]
  CANVAS --> SCREEN

  TEST["Vitest<br/>palette: nhãn 3 vai trò mới, fallback, màu không trùng, khoá a = accent<br/>legacy-characters: canvas giả, phụ kiện front/side, không ở back<br/>art/characters: 7 file acc 16×22<br/>api: demo 96 giây có ba/read, tester/review, kịch bản giữ nguyên<br/>actors: role đổi giữa chừng, mất rồi xuất hiện lại, offline<br/>sidebar: chú thích 7 mục, tìm ba/tester/research, role đổi khi đang lọc<br/>avatar: fallback màu áo + chữ B/T/R<br/>giữ mọi test cũ"]
  TEST -.-> API
  TEST -.-> PAL
  TEST -.-> LEG
  TEST -.-> ART
  TEST -.-> ACT
  TEST -.-> SIDE
  TEST -.-> AV
  TEST -.-> MAIN
  TEST -.-> IDX
  TEST -.-> DRW
  TEST -.-> FEED
```
