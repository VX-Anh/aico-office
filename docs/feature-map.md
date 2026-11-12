# Feature map (bản đồ tính năng UI)

Dành cho agent coder/tester/reviewer làm ticket UI: mỗi khu vực nằm ở file nào, tới bằng cách nào,
bám vào selector nào, cần dữ liệu gì, sửa xong phải kiểm gì và chụp ra sao. Chỉ ghi điều có trong
code; selector đã được grep trong `src/` và `index.html`. Sửa UI làm đổi selector, phím tắt, tham số
URL hay kịch bản demo thì cập nhật file này trong cùng thay đổi.

## Chạy và dữ liệu

- `npm run dev` rồi mở `http://localhost:5173/`. Ứng dụng một trang, **không có route hay hash**;
  mọi khu vực nằm trên cùng một màn hình.
- **Chế độ demo** (mặc định khi `localStorage` chưa có khoá `aico-office.api`): dữ liệu giả, không
  gọi mạng. `#conn` ghi "Chế độ demo (dữ liệu giả)" và có class `demo`. Kiểm UI luôn dùng demo, không
  cần token. Không đọc hay in giá trị khoá `aico-office.api` (chứa token).
- Kết nối thật: nút ⚙ → nhập địa chỉ + token → "Kết nối". Gọi `GET /workers` (3 giây/lần),
  `GET /tickets` (15 giây/lần; demo 3 giây), `GET /tickets/{id}/events`, `POST /tickets/{id}/decisions`,
  `POST /tickets/{id}/escalation` (`src/api.ts`, `src/tickets.ts`, `src/poller.ts`).
- Tham số URL (`src/main.ts`): `?hour=11` hoặc `?hour=21:30` cố định ánh sáng ngày/đêm;
  `?feed=open` hoặc `?feed=collapsed` đặt sẵn khung Hoạt động.
- Khoá `localStorage` khác: `aico-office.sidebar.hiddenRooms` (phòng đang ẩn trên thanh bên). Xoá
  trước khi chụp nếu cần trạng thái sạch.

### Kịch bản demo 48 giây

Pha tính theo đồng hồ thật: `s = (Date.now() % 48000) / 1000` (`demoWorkers` trong `src/api.ts`,
`src/scene/demo-events.ts`). Muốn chụp một trạng thái thì chờ tới đúng khoảng `s`.

| `s` (giây) | claude (3 chỗ) | codex (2 chỗ) | cursor (2 chỗ) |
| --- | --- | --- | --- |
| 0–8 | rảnh, 0 agent | rảnh, có `last_error` (dấu `!`) | hết hạn mức |
| 8–16 | 1 agent | như trên | hết hạn mức |
| 16–24 | 3/3 agent | như trên | hết hạn mức |
| 24–28 | 3/3 | như trên | mất kết nối |
| 28–32 | 3/3 | 1 agent | mất kết nối |
| 32–36 | 4 agent (vượt chỗ, `+1`) | 1 agent, 5h gần 100% | mất kết nối |
| 36–40 | 4 agent | hết hạn mức (tới hết chu kỳ) | rảnh |
| 40–48 | 0 agent, usage cũ 20 phút kèm lỗi | hết hạn mức | 1 agent |

- Id agent demo đổi mỗi chu kỳ (`claude-<chu kỳ>-<k>`); `ticket_id` thì cố định dạng `T-demo<i><k>`.
- Thẻ "Cần bạn" demo luôn có 4 thẻ: `T-demo00` (duyệt kế hoạch), `T-demo-review` (duyệt merge, có
  ảnh review, MR, xem trước), `T-demo-push` và `T-demo-merge` (escalated; `T-demo-merge` có một ảnh
  cố ý lỗi). Thao tác trên thẻ demo chỉ đổi dữ liệu trong bộ nhớ; bấm "Demo" hoặc tải lại để nạp lại.
- Banner sự kiện trên cảnh: MR mở từ `s ≥ 12`, ticket claude `done` từ `s ≥ 24`, ticket codex
  `escalated` trong `28 ≤ s < 40`.

## Kích thước phải kiểm

- **Desktop**: 1440×900 (rộng hơn 1279px để thấy đủ thanh trên). Kiểm thêm 1000–1279px nếu sửa
  thanh trên (ẩn `.usage-reset`, thu `.conn`).
- **Mobile**: 384×824, DPR 3,75 (Samsung S23 Ultra), có cảm ứng. Dưới 900px (`max-width: 899px`) bố
  cục đổi sang "màn hẹp": thanh bên thành ngăn kéo đóng sẵn, khung Hoạt động thu gọn sẵn, ngăn chi
  tiết nằm trên khung Hoạt động, thanh trên rút gọn.
- Mọi thay đổi bố cục: không tràn ngang trang, chữ không bị cắt mất nghĩa, panel không đè lên nhau,
  canvas vẫn còn vùng nhìn thấy (`src/ui/viewport.ts` tính vùng trống từ kích thước thật của panel).

## Cách chụp kiểm

Repo chưa có harness chụp ảnh (không có Playwright trong `package.json`); dùng công cụ trình duyệt
của agent (Chrome DevTools/CDP hoặc Playwright cài ngoài repo) trỏ vào dev server.

1. `npm run dev`, mở `http://localhost:5173/?hour=11` (thêm `&feed=open` nếu cần). Xác nhận
   `#conn.demo` trước khi chụp.
2. Đặt viewport: desktop 1440×900 DPR 1; mobile 384×824, `deviceScaleFactor` 3,75, bật touch.
3. Chờ pha demo cần chụp (bảng trên), thao tác tới khu vực (các mục dưới), rồi chụp cả trang.
   Chụp cả trước và sau thao tác khi sửa hành vi.
4. Sửa màu/ánh sáng cảnh thì chụp thêm `?hour=21:30`. Sửa chuyển động thì kiểm thêm
   `prefers-reduced-motion: reduce`.
5. Đặt tên ảnh `<rộng>x<cao>-hour-<giờ>[-<khu vực>].png` (cùng kiểu với `public/demo-shots/`) và ghi
   vào tóm tắt: URL, viewport, giây demo, thao tác đã làm.

## Selector ổn định (`data-*`)

Kiểm UI bám vào các thuộc tính dưới đây thay vì chữ hay thứ tự. Giá trị lấy thẳng từ dữ liệu (tên
phòng, id agent, mã ticket, tên hành động gửi lên aico), không dịch, không đổi theo ngôn ngữ giao
diện. Tên phòng, id có ký tự lạ thì bọc bằng `CSS.escape` hoặc dùng dấu nháy trong selector.

| Chỗ | Selector | Giá trị | File |
| --- | --- | --- | --- |
| Thẻ hạn mức | `.usage-card[data-room]` | tên phòng (`claude`, `codex`, `cursor`) | `src/ui/topbar.ts` |
| Khối phòng trên thanh bên | `.room[data-room]` | tên phòng | `src/ui/sidebar.ts` |
| Chip phòng | `.room-chip[data-room]` | tên phòng | `src/ui/sidebar.ts` |
| Dòng agent | `.agent-row[data-agent]`, `[data-ticket]` | `<phòng>/<id agent>`; mã ticket đang giữ (không có ticket thì không có thuộc tính) | `src/ui/sidebar.ts` |
| Tab Agent đang xem ai | `#drawer-agent-panel[data-agent]` | `<phòng>/<id agent>`; chưa chọn ai thì không có | `src/ui/drawer.ts` |
| Mục trong tab Agent | `.drawer-section[data-section]` | `tasks`, `recent`, `stats` | `src/ui/drawer.ts` |
| Thẻ cần bạn | `.need-card[data-ticket][data-kind]` | mã ticket (`data-ticket-id` cũ vẫn còn, cùng giá trị); `plan`, `merge`, `escalated` | `src/needs-column.ts` |
| Tiêu đề, ô ghi chú trong thẻ | `[data-field="title"]`, `[data-field="comment"]` | cố định | `src/needs-column.ts` |
| Nút thao tác | `.need-actions [data-action]` | plan: `approved`, `revise`, `rejected`; merge: `approved`, `changes_requested`, `rejected`; escalated: `retry_push`, `merge`, `close`, `fail` | `src/needs-column.ts` |
| Khối xác nhận | `.need-confirm[data-confirming]`, bên trong `[data-action="confirm"]`, `[data-action="cancel"]` | `data-confirming` là hành động đang chờ xác nhận, chỉ có khi khối đang hiện | `src/needs-column.ts` |
| Liên kết trong thẻ | `.need-links [data-link]` | `mr`, `preview` (liên kết không có URL thì `hidden`) | `src/needs-column.ts` |
| Ảnh thu nhỏ | `.need-shots [data-shot]` | chỉ số từ `0` theo thứ tự hiển thị; ảnh lỗi thành liên kết vẫn giữ `data-shot` | `src/needs-column.ts` |
| Toast | `.toast[data-ticket][data-kind]`, nút `[data-action="open"]`, `[data-action="dismiss"]` | mã ticket (có cả `data-ticket-id`); loại như thẻ cần bạn | `src/toasts.ts` |
| Dòng feed | `.feed-line[data-key]`, `[data-ticket]`, `[data-agent]`, `[data-room]` | xem ghi chú dưới | `src/ui/feed.ts` |

- `<phòng>/<id agent>`: demo là `claude/claude-<chu kỳ>-<k>`; id demo vẫn đổi mỗi chu kỳ 48 giây
  (dữ liệu demo, không phải selector). Muốn bám chắc trong demo thì dùng
  `.agent-row[data-ticket="T-demo<i><k>"]` hoặc `.room[data-room="claude"] .agent-row`.
- `.agent-row[data-key]` vẫn còn (JSON `[phòng, id, started_at]`, khoá nội bộ để chọn agent); đừng
  bám vào nó khi kiểm.
- `.feed-line[data-key]`: dòng agent là JSON `[phòng, id agent, at, chữ]` (đoán trước được từ dữ
  liệu); dòng ticket là `ticket:<n>` và dòng hết hạn mức là `limit:<n>`, `n` đếm trong phiên nên chỉ
  ổn định từ lúc dòng xuất hiện tới khi tải lại. Dòng ticket bám `[data-ticket]` (không có
  `data-agent`, `data-room`); dòng agent có `data-agent`, `data-room`, và `data-ticket` nếu agent
  đang giữ ticket; dòng hết hạn mức chỉ có `data-room`. `data-content` là chữ ký nội bộ, không bám.
- Ví dụ: `.need-card[data-ticket="T-demo-review"] .need-actions [data-action="approved"]`,
  `.need-card[data-ticket="T-demo-review"] .need-shots [data-shot="0"]`,
  `.usage-card[data-room="codex"] .usage-row[data-level="crit"]`.
- Test kiểm các thuộc tính này: mục "selector ổn định" trong `src/ui/topbar.test.ts`,
  `src/ui/sidebar.test.ts`, `src/ui/drawer.test.ts`, `src/ui/feed.test.ts`,
  `src/needs-column.test.ts`, `src/toasts.test.ts`. Đổi tên hay bỏ thuộc tính thì sửa cả test và
  bảng này.

### Còn thiếu

| Chỗ | Hiện phải bám vào | Thiếu |
| --- | --- | --- |
| Nhân vật, phòng, biển tên, banner trên canvas | toạ độ pixel trên `#office` | không có DOM; chỉ kiểm bằng ảnh |

## Khu vực

### 1. Cảnh văn phòng (canvas)

- **File**: `src/scene/index.ts` (vẽ), `src/scene/layout.ts`, `src/scene/actors.ts`,
  `src/scene/lighting.ts`, `src/scene/outdoor.ts`, `src/overlay.ts` (lớp chữ: bong bóng hoạt động,
  biển tên phòng, banner), `src/ui/viewport.ts` (đặt cảnh vào vùng trống).
- **Tới**: hiện ngay khi mở trang.
- **Selector**: `#stage`, `#office` (canvas chính), `.activity-overlay` (canvas chữ, `aria-hidden`).
  Nội dung bên trong: không có DOM (xem "Còn thiếu" ở trên).
- **Dữ liệu**: demo đủ mọi trạng thái phòng theo bảng 48 giây.
- **Kiểm khi sửa**: cảnh nằm gọn trong vùng trống, không bị panel che nhân vật đang chọn; chữ có
  dấu tiếng Việt sắc nét; ngày (`?hour=11`) và đêm (`?hour=21:30`); mobile: cảnh vẫn thấy khi ngăn
  chi tiết mở; chọn agent thì cảnh dời để nhân vật đó nằm trong vùng nhìn.
- **Chụp**: cả trang ở `s` 16–24 (claude đủ 3 agent) và 36–40 (codex hết hạn mức).

### 2. Chọn agent trên canvas và tooltip

- **File**: `src/agent-tooltip.ts`, `src/agent-tooltip.css`, xử lý `pointerdown` trong `src/main.ts`.
- **Tới**: rê chuột (desktop) hoặc chạm (mobile) vào nhân vật đang làm → tooltip; bấm/chạm nhân vật
  → mở ngăn chi tiết tab Agent.
- **Selector**: `.agent-tooltip` (ẩn bằng `hidden`), bên trong `.agent-tooltip-title`,
  `.agent-tooltip-heading`, `.agent-tooltip-cache`. Vị trí nhân vật: không có DOM; muốn mở tab Agent
  chắc chắn thì bấm `.agent-row[data-agent]` trên thanh bên.
- **Dữ liệu**: demo, cần `s` có agent (8–40 cho claude).
- **Kiểm khi sửa**: tooltip không tràn màn hình (rộng tối đa 340px, mobile trừ lề 16px); biến mất
  khi agent rời bàn; trên cảm ứng chạm ra ngoài thì đóng.

### 3. Thanh trên

- **File**: `src/ui/topbar.ts`, `src/ui/topbar.css`, `src/ui/format.ts`, `src/usage.ts`; khung trong
  `index.html`.
- **Tới**: luôn hiện.
- **Selector**: `#topbar`; kết nối `#conn` (class `demo` / `ok` / `bad` / `stale`); ô số
  `#agents-count`, `.tile-working`, `#needs-count` (class `hot` khi có việc; `disabled` khi 0); số
  trong ô `.tile-value`; lỗi tải ticket `#tickets-error`; thẻ hạn mức `.usage-cards` >
  `.usage-card[data-room][data-state]` > `.usage-row[data-level]`, `.usage-pct`, `.usage-reset`,
  `.usage-plan`, `.usage-compact`; nút `#demo`.
- **Dữ liệu**: demo. Ba mức màu hạn mức thấy ở codex `s` 0–36; "Gói Pro" ở cursor (không có ở pha
  mất kết nối 24–36); usage cũ ở claude `s` 40–48.
- **Kiểm khi sửa**: desktop đủ nhãn và giờ reset; 900–1279px ẩn `.usage-reset`; mobile ẩn tên, ẩn
  `#agents-count`, thẻ hạn mức chỉ còn chữ cái + `.usage-compact`, không tràn ngang ở 384px; bấm
  `#needs-count` mở tab Cần bạn và tới thẻ đầu.

### 4. Cài đặt kết nối và nút Demo

- **File**: `src/ui/topbar.ts` (popover), `src/main.ts` (submit, đổi nguồn), `src/api.ts`
  (`loadConfig`, `saveConfig`, `defaultBaseUrl`).
- **Tới**: bấm `.settings-toggle` (⚙). Esc hoặc bấm ra ngoài để đóng.
- **Selector**: `.settings-toggle` (`aria-expanded`), `.settings-popover`, `#settings`,
  `#settings input[name="baseUrl"]`, `#settings input[name="token"]`, `#settings button[type="submit"]`,
  `#demo` (chữ "Demo" hoặc "Thoát demo").
- **Dữ liệu**: demo đủ để kiểm giao diện. Kiểm kết nối thật cần aico chạy và token; không ghi token
  vào ảnh, log hay tóm tắt.
- **Kiểm khi sửa**: popover nằm trên ngăn chi tiết; mobile popover trải ngang màn hình dưới thanh
  trên; Esc trong popover chỉ đóng popover, không đóng ngăn chi tiết; để trống token giữ token đã lưu;
  đổi nguồn xoá lựa chọn, feed và toast.

### 5. Thanh bên (phòng và agent)

- **File**: `src/ui/sidebar.ts`, `src/ui/sidebar-model.ts`, `src/ui/sidebar.css`, `src/ui/avatar.ts`.
- **Tới**: desktop luôn mở; phím `[` hoặc `.sidebar-toggle` để thu/mở. Mobile đóng sẵn thành nút
  tròn: bấm `.sidebar-toggle` để mở ngăn kéo; bấm `.sidebar-scrim`, Esc hoặc chọn agent để đóng.
  Phím `/` mở và focus ô tìm; Esc trong ô tìm xoá chữ.
- **Selector**: `#sidebar` (class `collapsed`, `narrow`), `.sidebar-toggle`, `.sidebar-input`,
  `.sidebar-chips` > `.room-chip[data-room][aria-pressed]`, `.sidebar-filtering`, `.sidebar-rooms` >
  `.room[data-room][data-state]` (`.room-name`, `.room-count`, `.room-state`, `.room-alert`, `.room-slots`,
  `.room-empty`), `.agent-row[data-agent][data-ticket]` (class `selected`, `need`, `offline`; bên trong
  `.agent-role`, `.agent-ticket`, `.agent-activity`, `.agent-elapsed`, `.status-dot[data-state]`),
  `.sidebar-empty`, `.sidebar-legend`, `.sidebar-scrim`.
- **Dữ liệu**: demo. `+1` vượt chỗ ở `s` 32–40; `.room-alert` của codex ở `s` 0–28; dòng `need` khi
  agent giữ ticket `T-demo00`.
- **Kiểm khi sửa**: bấm `.agent-row` mở tab Agent và đánh dấu `selected`; tìm không khớp hiện
  "Không tìm thấy"; ẩn phòng bằng chip còn nguyên sau khi tải lại; cuộn và focus không nhảy khi poll;
  mobile: ngăn kéo rộng tối đa 86vw, có nền mờ, chọn agent thì tự đóng.

### 6. Ngăn chi tiết: khung và tab

- **File**: `src/ui/drawer.ts`, `src/ui/drawer.css`, `src/ui/selection.ts` (`drawerView`),
  `src/main.ts` (`publish`, `closeDrawer`).
- **Tới**: tự mở tab "Cần bạn" khi có thẻ cần người (demo luôn có, kể cả mobile); mở tab Agent khi
  chọn agent. Đóng bằng `.drawer-close` hoặc Esc. Đã đóng thì không tự mở lại cho tới khi số thẻ đi
  từ 0 lên.
- **Selector**: `#drawer` (`hidden`, `data-tab="agent"|"needs"`), tab `#drawer-agent-panel-tab` và
  `#drawer-needs-panel-tab` (`aria-selected`), nội dung `#drawer-agent-panel`, `#drawer-needs-panel`,
  `.drawer-close`.
- **Dữ liệu**: demo.
- **Kiểm khi sửa**: desktop ngăn nằm bên phải dưới thanh trên; mobile ngăn nằm ngay trên khung Hoạt
  động (cao 55dvh, lùi lên khi khung Hoạt động mở), không che hết cảnh; chuyển tab giữ ghi chú đang
  gõ trong thẻ.

### 7. Tab Agent

- **File**: `src/ui/drawer.ts`, `src/ui/drawer-model.ts`, `src/ui/format.ts`, `src/activity.ts`.
- **Tới**: bấm `.agent-row` trên thanh bên, bấm nhân vật trên canvas, hoặc bấm dòng feed của agent
  còn đang chạy.
- **Selector**: trong `#drawer-agent-panel[data-agent]`: `.drawer-hero` (`.drawer-role`, `.drawer-agent-id`,
  `.drawer-room-name`, `.drawer-room-state`, `.drawer-ticket-id`), `.drawer-mission`
  (`.drawer-mission-title`, `.drawer-link`), `.drawer-status` (class `tone-*`; `.drawer-status-link`
  khi cần người), `.drawer-now` (class `is-error`), `.drawer-section[data-section="tasks"]`
  (`.drawer-progress`, `.drawer-checklist`), `[data-section="recent"]` (`.drawer-timeline`),
  `[data-section="stats"]` (`.drawer-stats`, `.drawer-cache`). Chưa chọn ai:
  `.drawer-muted` "Chọn một agent để xem chi tiết."
- **Dữ liệu**: demo; chọn agent trong `s` 8–40. Agent biến mất (hết pha) thì tab tự đóng, nên thao
  tác và chụp trong cùng một pha.
- **Kiểm khi sửa**: mã agent và mã ticket dài bị cắt bằng dấu ba chấm, không đẩy vỡ khung; số liệu
  token và phần trăm cache đúng màu; bấm `.drawer-status-link` nhảy sang thẻ trong tab Cần bạn;
  mobile không cuộn ngang.

### 8. Tab Cần bạn (thẻ duyệt)

- **File**: `src/needs-column.ts`, `src/needs-column.css`, `src/tickets.ts`, `src/attention.ts`.
- **Tới**: bấm `#needs-count`, phím `P` (đi lần lượt các thẻ), nút "Xử lý" trên toast, tab
  `#drawer-needs-panel-tab`, hoặc dòng feed của ticket.
- **Selector**: `#needs` (class `needs-column`), `.needs-error`, `.needs-list`,
  `.need-card[data-ticket][data-kind="plan"|"merge"|"escalated"]` (class `flash` khi được nhảy
  tới; `aria-busy`), `.need-head`, `.need-kind`, `.need-waited`, `[data-field="title"]`,
  `.need-reason`, `.need-links [data-link="mr"|"preview"]`, `.need-shots [data-shot]`,
  `textarea[data-field="comment"]`, `.need-actions [data-action]`, `.need-confirm[data-confirming]`
  với `[data-action="confirm"|"cancel"]`, `.need-message`. Giá trị `data-action` theo từng loại thẻ:
  bảng "Selector ổn định".
- **Dữ liệu**: demo có đủ ba loại. Thao tác thật cần token và gửi `POST` tới aico: **không bấm duyệt,
  merge, từ chối trên kết nối thật khi chỉ kiểm giao diện**.
- **Kiểm khi sửa**: thao tác không hoàn tác (từ chối, merge, đóng, đánh dấu lỗi, duyệt merge) hiện
  `.need-confirm` trước khi gửi; thiếu ghi chú bắt buộc thì hiện `.need-message` và focus ô ghi chú;
  poll không xoá ghi chú đang gõ; lỗi tải giữ thẻ cũ và bật `#tickets-error`; mobile: nút không tràn,
  hàng ảnh cuộn ngang.

### 9. Xem ảnh review

- **File**: `src/shot-viewer.ts`, `src/shot-viewer.css`, `latestScreenshots` trong `src/tickets.ts`.
- **Tới**: trong thẻ `T-demo-review`, bấm một ảnh trong `.need-shots` (`[data-shot="0"]` là ảnh đầu). ←/→ chuyển ảnh, Esc hoặc bấm
  nền để đóng.
- **Selector**: `.shot-viewer` (`role="dialog"`, `hidden`), `.shot-viewer-stage`, `.shot-viewer-img`,
  `.shot-viewer-name`, `.shot-viewer-pos`, `.shot-viewer-prev`, `.shot-viewer-next`,
  `.shot-viewer-close`.
- **Dữ liệu**: demo: `T-demo-review` có 3 ảnh của lần review mới nhất; `T-demo-merge` có ảnh lỗi
  (thành liên kết mở tab mới).
- **Kiểm khi sửa**: focus nằm trong hộp thoại và trả về ảnh thu nhỏ khi đóng; Esc chỉ đóng hộp
  thoại; một ảnh thì ẩn nút trước/sau; mobile: ảnh vừa khung, nút bấm được bằng ngón tay.

### 10. Khung Hoạt động (feed)

- **File**: `src/ui/feed.ts`, `src/ui/feed-model.ts`, `src/ui/feed.css`.
- **Tới**: desktop mở sẵn ở đáy; mobile thu gọn sẵn. Phím `]`, bấm `.feed-title` hoặc
  `.feed-chevron` để thu/mở; hoặc `?feed=open` / `?feed=collapsed`.
- **Selector**: `#feed` (class `is-collapsed`), `.feed-title`, `.feed-chevron`, `.feed-ticker`
  (dòng mới nhất khi thu gọn), `.feed-new` ("N mới"), `.feed-lines`,
  `.feed-line[data-key]` (thêm `data-ticket`, `data-agent`, `data-room` khi có; class `tone-need`,
  `tone-done`, `tone-error`, `is-gone`, `is-ticket`; ô `.feed-time`, `.feed-name`, `.feed-room`,
  `.feed-ticket`, `.feed-icon`, `.feed-text`), `.feed-empty`.
- **Dữ liệu**: demo; feed rỗng ngay sau khi tải, chờ vài giây cho có dòng (đổi nguồn thì xoá feed).
- **Kiểm khi sửa**: đang ở cuối thì tự cuộn theo dòng mới, đang đọc giữa chừng thì giữ chỗ và hiện
  `.feed-new`; bấm dòng agent mở tab Agent (agent đã đi thì dòng có `is-gone`, bấm không mở gì), bấm
  dòng ticket mở thẻ Cần bạn; mobile: mở cao 45vh, ẩn cột `.feed-room` và `.feed-ticket`, ngăn chi
  tiết lùi lên trên, không đè nhau.

### 11. Toast cần bạn và tiêu đề tab

- **File**: `src/toasts.ts`, `src/toasts.css`, `src/attention.ts`.
- **Tới**: tự hiện khi có ticket cần người **mới xuất hiện sau lượt tải đầu** (tối đa 3). Lượt đầu
  sau khi tải trang hoặc đổi nguồn chỉ ghi nhớ, không hiện toast (`reconcileToasts`).
- **Selector**: `#toasts` (class `toast-stack`), `.toast[data-ticket][data-kind]`, `.toast-actions`
  với `[data-action="open"]` ("Xử lý") và `[data-action="dismiss"]` ("×"). Tiêu đề tab trình duyệt đổi theo số ticket (`tabTitle` trong `src/attention.ts`).
- **Dữ liệu**: **demo không dựng được toast** (4 thẻ demo có từ lượt đầu, thao tác chỉ làm thẻ rời
  danh sách). Kiểm logic bằng `src/attention.test.ts`, DOM bằng `src/toasts.test.ts`; kiểm hình cần kết nối thật có ticket mới
  chuyển sang chờ duyệt, hoặc ghi rõ trong tóm tắt là chưa xem được toast trên trình duyệt.
- **Kiểm khi sửa**: "Xử lý" mở tab Cần bạn đúng thẻ; "×" đóng và poll sau không hiện lại; toast
  không che thanh trên hay nút thao tác; mobile: toast trải hết bề ngang vùng trống.

## Phím tắt (không hoạt động khi đang gõ trong ô nhập)

| Phím | Việc | File |
| --- | --- | --- |
| `[` | thu/mở thanh bên | `src/main.ts` |
| `]` | thu/mở khung Hoạt động | `src/main.ts` |
| `Esc` | đóng ngăn chi tiết (popover, ô tìm, ngăn kéo mobile, hộp ảnh xử lý Esc riêng trước) | `src/main.ts` |
| `/` | focus ô tìm agent | `src/ui/sidebar.ts` |
| `P` | tới thẻ cần bạn kế tiếp | `src/attention.ts`, `src/main.ts` |
| `←` `→` | chuyển ảnh trong hộp xem ảnh | `src/shot-viewer.ts` |
