# AICO Office

Văn phòng pixel nhìn từ trên xuống (góc 3/4 kiểu game RPG) cho [AI Company OS](https://github.com/VX-Anh/ai-company): mỗi provider (Claude Code, Codex, Cursor) là một **phòng làm việc** có `slots` bàn; mỗi agent con đang chạy (tech_lead, coder, reviewer, designer) ngồi một bàn. Bên dưới là **phòng nghỉ** chung nối với các phòng bằng ô cửa. Canvas phủ cả màn hình; thanh trên, thanh bên, ngăn chi tiết và feed nổi trên cảnh như kính, không che phòng.

Repo này cũng là **repo pilot** của aico: tính năng mới được tạo thành issue (nhãn `ai-company`) để chính các agent làm qua luồng plan → code → review → merge.

## Trạng thái

| Trạng thái phòng | Trong văn phòng | Nguồn |
| --- | --- | --- |
| Đang rảnh | Ghế trống, màn hình con trỏ nhấp nháy, đèn xanh; nhân vật thường trực của phòng ngồi sofa phòng nghỉ uống cà phê | phòng không có agent con nào chạy |
| Đang làm | Mỗi agent con ngồi một bàn, quay lưng gõ phím, code chạy trên màn hình, đèn vàng nhấp nháy. Agent mới đi bộ từ phòng nghỉ qua cửa tới bàn trống; agent xong đi về phòng nghỉ rồi mờ dần | phòng đang chạy CLI cho một hoặc nhiều ticket |
| Hết hạn mức | Bàn trống, màn hình tắt; nhân vật của phòng nằm ngủ trên sofa phòng nghỉ, chữ Z bay lên; biển dưới đồng hồ phòng đếm ngược giờ mở lại (ví dụ `47M`, `1H05`) | lần chạy gần nhất báo hết hạn mức subscription (chung cả phòng) |
| Mất kết nối | Phòng tắt đèn, biển tên xám, không có ai (kể cả trong phòng nghỉ) | aico không gọi được worker |

Agent con phân biệt theo vai trò (chú thích ở cuối thanh bên): tech_lead áo xanh dương + cà vạt, coder áo xanh lá + tai nghe, reviewer áo tím + kính, designer áo hồng + mũ nồi; vai trò lạ áo xám. Kiểu tóc và màu tóc của agent con chọn theo `id` nên ổn định giữa các lần vẽ; nhân vật thường trực mang tóc và áo màu provider. Màu code trên màn hình theo `mode` (read xanh lá, write xanh dương, review tím). Chỗ ngồi giữ ổn định theo `id` agent.

Lần vẽ đầu (mở trang, đổi nguồn dữ liệu, phòng online lại) agent đang chạy được đặt thẳng vào ghế, không đi bộ.

Biển tên phòng ghi thêm `+N` khi số agent con vượt `slots`. Dấu `!` đỏ cạnh biển tên: lần chạy gần nhất bị lỗi (không phải hết hạn mức).

Thanh hạn mức pixel nằm trên tường phòng (cạnh đồng hồ, không che bàn hay nhân vật). Mỗi cửa sổ một hàng, tối đa hai: cửa sổ ngắn `5H` và tuần `WK`, kèm phần trăm. Màu theo mức đã dùng: xanh dưới 60%, vàng từ 60% tới dưới 80%, đỏ từ 80%. Phòng không công bố hạn mức hiện `?` thay cho thanh.

Thanh trên ghi hạn mức từng phòng: ô chữ cái provider, hai dòng cửa sổ (phần trăm, mức màu, giờ reset kiểu `1H05` / `47M`). Phòng không công bố cửa sổ (Cursor) thì ghi gói; không có cả gói thì `?`.

Bố cục: thanh trên 64px (logo, trạng thái kết nối, ô số agent / đang làm / cần bạn, hạn mức, nút cài đặt và Demo); thanh bên trái khoảng 304px (từng phòng rồi agent con, bấm để mở ngăn và căn cảnh vào nhân vật, thu gọn bằng phím **[**); ngăn chi tiết bên phải khoảng 380px (tab Agent và tab Cần bạn, đóng bằng nút X hoặc **Esc**); feed hoạt động dưới đáy (cao khoảng 200px, thu gọn bằng phím **]**). Cảnh được co theo hệ số pixel nguyên vào vùng trống giữa các panel. Màn hẹp hơn 900px: thanh bên thành ngăn kéo, ngăn chi tiết thành tấm từ dưới lên, feed một dòng.

## Chạy

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # vitest: hàm thuần, kịch bản actors, mọi file art/
```

Không nhập gì thì chạy **chế độ demo** với dữ liệu giả (kịch bản 48 giây: phòng có 0/1/2 agent, agent đi vào/ra, codex lên 100% rồi `limited`, phòng mất kết nối). Để xem agent thật, nhập địa chỉ aico (mặc định `http://localhost:8000`) và API token (`deploy/secrets/aico_api_token` của aico). Token lưu trong localStorage của trình duyệt.

aico phải cho phép origin của trang này (`AICO_CORS_ORIGINS`, mặc định đã có `http://localhost:5173`).

## Dữ liệu

`GET /workers` của aico trả mỗi phòng: `state`, `roles`, `slots` (số agent con tối đa chạy song song), `agents` (danh sách agent con đang chạy: `id`, `role`, `ticket_id`, `mode`, `started_at`), `runs_today`, `tokens_today`, tổng lượt và token, `last_error`, `limit` (`message`, `resets_at`), và `usage`.

Mỗi agent có thể có thêm `activity` (`kind`, `icon`, `text`, `detail`, `tool`, `at`, `error`), `recent` (tối đa 20 hoạt động), `tasks` (`id`, `title`, `status`), `tasks_done` và `stats` (`tool_calls`, `tokens_in`, `tokens_cached`, `tokens_out`). Các trường đều có thể thiếu ở aico cũ; dữ liệu sai kiểu bị từ chối để cảnh tiếp tục chạy. Agent đang làm có bong bóng hoạt động (quá 60 giây thì chỉ còn icon mờ), lỗi có viền đỏ; màn hình bàn đổi theo loại việc, thiếu activity thì giữ màn hình code. Thanh tiến độ task nằm dưới chân; rê chuột hoặc chạm nhân vật để xem ticket, vai trò, hoạt động gần nhất, task và thống kê. Demo có hoạt động đổi vòng, lỗi, stale và task tăng dần.

Trong khối Số liệu của ngăn chi tiết và tooltip, `tokens_in` đã gồm token đọc từ cache (`tokens_cached`). Khi có cache, token hiển thị gọn theo nghìn/triệu: “Token vào: 1,12 triệu (92% từ cache)”, “Token mới: 87 nghìn” và “Token ra: …”. Token mới bằng đầu vào trừ cache, tối thiểu 0; tỉ lệ cache kẹp trong 0–100%, xanh từ 70%, vàng từ 40% đến dưới 70%, đỏ dưới 40%. Đầu vào bằng 0 không hiện phần trăm. Thiếu/null hoặc cache sai kiểu thì giữ cách hiển thị cũ, không có hậu tố và dòng Token mới; sai kiểu cảnh báo một lần. Poll cập nhật số liệu đang mở, tooltip làm mới mỗi giây; lỗi poll giữ snapshot cuối đến khi hồi phục. Demo có agent cache 70–95% và một agent thiếu trường cache.

`current` (agent đầu tiên) đã deprecated; GUI chỉ dùng khi aico bản cũ chưa trả `agents`.

`usage` có thể `null` (worker chưa đọc xong hoặc aico bản cũ). Khi có, gồm `checked_at` (lúc đọc), `source` (nguồn số liệu), `plan` (gói), `windows` (mỗi cửa sổ: `name`, `window_minutes`, `used_percent`, `resets_at`), `note` và `error`. `plan`, `note` và `error` có thể vắng.

- Claude: cửa sổ `session` (5 giờ) và `week (...)`.
- Codex: cửa sổ `5h` và `week`, có `plan`.
- Cursor: `windows` rỗng, có `plan` (ví dụ `Pro`) và `note`.

Hạn mức: Claude và Codex công bố phần đã dùng theo từng cửa sổ. Các CLI không công bố hạn mức (Cursor) để `windows` rỗng; GUI hiện `?` kèm gói nếu có. Khi một cửa sổ chạm 100%, `state` là `limited` và `limit.resets_at` là giờ mở lại. Số lượt và token là do worker tự đếm.

Ngăn chi tiết, tab “Cần bạn”, liệt kê ticket chờ duyệt kế hoạch, chờ duyệt merge và `escalated`. Có liên kết MR/xem trước, ghi chú và các thao tác theo trạng thái; thao tác không thể hoàn tác cần xác nhận. Danh sách làm mới mỗi 3 giây, giữ ghi chú khi poll và giữ thẻ cũ khi tải lỗi; dấu `!` cạnh bộ đếm báo lỗi tải ticket. Demo có đủ ba loại ticket, thao tác chỉ đổi dữ liệu trong bộ nhớ; bấm Demo để nạp lại.

Ô số trên thanh trên đếm agent đang chạy, agent đang làm và ticket cần người; tiêu đề tab hiện số ticket. Bấm ô cần bạn, phím **P** hoặc nút “Xử lý” trên toast (khi không nhập chữ) để mở tab Cần bạn rồi tới thẻ. Ticket mới cần người hiện toast. Bấm agent trên thanh bên hoặc trên canvas thì mở tab Agent. Agent biến mất, hoặc phòng offline/hết hạn mức, thì đóng tab Agent và không tự mở lại. Đổi nguồn xoá lựa chọn, feed, cờ đóng ngăn và toast.

## Cấu trúc

```text
src/api.ts                 gọi aico, kiểu dữ liệu, dữ liệu demo
src/activity.ts            đọc activity/recent/tasks/stats phòng thủ, chọn màn hình, bong bóng và demo (thuần)
src/activity.test.ts       test activity, stale, task, chồng bong bóng và dữ liệu đổi giữa chừng
src/overlay.ts             canvas chữ phủ: bong bóng hoạt động và tiến độ task
src/agent-tooltip.ts       tooltip chuột/chạm: ticket, vai trò, hoạt động, task, stats
src/agent-tooltip.css      kiểu hiển thị tooltip nhân vật
src/agent-tooltip.test.ts  test vùng chạm và nhân vật chồng nhau
src/usage.ts               đọc usage phòng thủ, mức màu, đếm ngược, số liệu cũ (hàm thuần)
src/usage.test.ts          test ngưỡng màu, đếm ngược, usage hỏng, số liệu cũ
src/tickets.ts             logic ticket thuần, lý do, nút thao tác, request và demo
src/tickets.test.ts        test dữ liệu ticket, thao tác, request, lỗi và demo
src/needs-column.ts        cột Cần bạn: duyệt kế hoạch/merge, escalated, ghi chú và xác nhận
src/needs-column.test.ts   test DOM giả: xác nhận, poll, lỗi và đổi nguồn
src/needs-column.css       kiểu hiển thị cột Cần bạn
src/attention.ts           bộ đếm tiêu đề tab, phím P và trạng thái toast (thuần)
src/attention.test.ts      test tiêu đề, phím tắt và vòng đời toast
src/toasts.ts              toast ticket mới cần người, mở thẻ và đóng thông báo
src/toasts.css             kiểu hiển thị toast
src/latest.ts              chọn kết quả poll mới nhất khi request chồng nhau (hàm thuần)
src/latest.test.ts         test API chậm hơn chu kỳ poll, thao tác, đổi nguồn
src/time.ts                chuỗi "N giây/phút/giờ/ngày trước", tương lai → vừa xong (hàm thuần)
src/time.test.ts           test biên giây/phút/giờ/ngày, tương lai, at hỏng, now NaN/0
src/ui/tokens.css          biến màu, kính, font Pixelify Sans, kích thước panel
src/ui/viewport.ts         vùng trống (computeInsets) và căn cảnh (fitScene), hàm thuần
src/ui/viewport.test.ts    test panel mở/đóng, màn hẹp, màn nhỏ, hệ số pixel
src/ui/feed-model.ts       gom feed từ recent và ticket cần người, khử trùng (thuần)
src/ui/feed-model.test.ts  test thứ tự, giới hạn dòng, ticket đổi loại, không lặp recent
src/ui/selection.ts        khoá agent, resolveSelection, drawerView (thuần)
src/ui/selection.test.ts   test agent biến mất, started_at đổi, tab Cần bạn
src/ui/format.ts           số, thời gian tương đối, giờ, chữ provider, thẻ hạn mức, trạng thái agent
src/ui/format.test.ts      test usageTile, providerLetter, clock, fmtNumber/fmtAgo
src/ui/topbar.ts           thanh trên: ô số, hạn mức, popover cài đặt, nút Demo
src/ui/topbar.css          kiểu thanh trên
src/ui/sidebar.ts          thanh bên: phòng → agent, phím [
src/ui/sidebar.css         kiểu thanh bên và ngăn kéo màn hẹp
src/ui/avatar.ts           avatar nhỏ từ sprite nhân vật
src/ui/drawer.ts           ngăn chi tiết: tab Agent / Cần bạn, Esc
src/ui/drawer.css          kiểu ngăn chi tiết và tấm từ dưới lên
src/ui/drawer.test.ts      test DOM số liệu cache, fallback, màu và cập nhật khi đang mở
src/ui/feed.ts             feed hoạt động, phím ]
src/ui/feed.css            kiểu feed
src/main.ts                vòng lặp, poll, vùng trống, chọn agent, feed, phím P [ ] Esc
src/main.test.ts           test ghép nối Cần bạn, stats tới UI, vòng đời agent, đổi nguồn, lỗi và hồi phục poll
src/scene/index.ts         ghép cảnh, màn hình theo việc; drawScene trả SceneFigure[], sceneSize
src/scene/layout.ts        bố cục phòng, bàn, cửa, phòng nghỉ; giữ chỗ ngồi theo id (hàm thuần)
src/scene/pathing.ts       đường đi ngang/dọc qua cửa, vị trí theo thời gian (hàm thuần)
src/scene/actors.ts        nhân vật đi vào/ra theo thay đổi của agents[]
src/scene/tiles.ts         sàn gỗ, sàn phòng nghỉ, tường, vách, ô cửa
src/scene/furniture.ts     bàn, máy tính, ghế, kệ sách, đồng hồ, sofa, bàn trà, quầy bếp, biển tên
src/scene/usage-board.ts   thanh hạn mức pixel trên tường (5H/WK, phần trăm, ?)
src/scene/characters.ts    sprite nhân vật từ công thức Pixelbolt: chọn tư thế, chồng lớp thân → tóc → phụ kiện, thay màu theo agent
src/scene/pixelbolt.ts     bộ đọc công thức Pixelbolt tối giản (palette, frames grid/from, animations), cache bitmap
src/scene/legacy-characters.ts  sprite lưới ký tự cũ, dùng khi công thức thiếu tư thế
src/scene/palette.ts       màu provider, vai trò (áo, màu phụ kiện) và bảng màu chung
src/scene/font.ts          chữ pixel 3x5
src/scene/font.test.ts     test glyph % và ?
src/scene/pixel.ts         hàm vẽ pixel, lưới ký tự, cache bitmap
src/scene/pathing.test.ts  test pathBetween, positionAt, alongRoute, reverseFrom
src/scene/layout.test.ts   test computeLayout, assignSeats (giữ ghế theo id, overflow)
src/scene/actors.test.ts   kịch bản dữ liệu đổi khi nhân vật đang đi (bất biến seated)
src/scene/pixelbolt.test.ts   bộ đọc công thức: từ chối frame hỏng để fallback chạy
src/scene/characters.test.ts  gộp ops của frame; kiểm mọi file art/characters (thay pixel_validate)
vitest.config.ts           cấu hình vitest (môi trường Node, chỉ src/**/*.test.ts)
art/characters/body.pixel.json      thân nhân vật (đủ 7 tư thế)
art/characters/hair/styleN.pixel.json  lớp tóc theo kiểu: 0 ngắn, 1 mái, 2 dài, 3 búi
art/characters/acc/<role>.pixel.json   lớp phụ kiện theo vai trò (tech_lead, coder, reviewer, designer)
public/assets/habblaud/             ảnh từ Habblaud (MIT): tranh, poster, logo, minh hoạ; phục vụ ở /assets/habblaud/
public/assets/CREDITS.md            nguồn và giấy phép của mọi tài sản bên ngoài
docs/references/habblaud.md         ghi chép tham khảo dự án Habblaud (văn phòng pixel cho agent) và đề xuất áp dụng
```

Sơ đồ module: [docs/architecture.md](docs/architecture.md).

## Thêm sprite mới

Sprite nhân vật là công thức Pixelbolt (`.pixel.json`) trong `art/characters/`, được nạp lúc build bằng `import.meta.glob` (không cần sửa code khi thêm file vào đúng chỗ).

- **Định dạng**: mọi frame 16×22; chỉ dùng op `grid` (`rows` là chuỗi, `.` hoặc dấu cách là trong suốt), có thể dùng `from` để kế thừa frame và `palette`. Frame có thể ghi `rows` trực tiếp hoặc dạng `ops: [{ op: "grid", x, y, rows }]` như Pixelbolt xuất ra (lưới nhỏ được đặt tại x, y). Không dùng symbols, tilemap, text, compile, scene.
- **Tên animation**: `walk_down`, `walk_up`, `walk_left`, `walk_right` (2–4 frame), `sit_back` (2 frame gõ phím), `sit_side` (quay phải; frame 0 cầm cốc, frame 1 nâng cốc), `lie` (1–2 frame). Lớp tóc và phụ kiện dùng cùng tên; thiếu animation nào thì tư thế đó không có lớp ấy.
- **Mốc đặt**: đầu trong vùng x 2–13, y 2–11; thân từ y 12; khi đi chân chạm hàng 21, giữa thân ở x 8; `sit_back` mép dưới vai ở hàng 16.
- **Khoá màu được thay theo agent**: `h`/`H` tóc/tóc sẫm (theo `id`, nhân vật thường trực theo provider), `s`/`S` da, `t`/`T` áo (theo vai trò hoặc provider), `a` phụ kiện (`accent` trong `ROLE_STYLES` của `palette.ts`), `o` viền. Màu cố định khác (mắt, quần, giày, cốc…) khai báo bằng khoá riêng trong `palette` của công thức.
- **Kiểu tóc mới**: thêm `hair/style4.pixel.json` rồi tăng số kiểu (`% 4`) trong `agentLook`/`residentLook` và chỗ chọn lớp tóc trong `characters.ts`.
- **Vai trò mới**: thêm mục vào `ROLE_STYLES` (áo, `accent`) và file `acc/<role>.pixel.json`.
- **Thiếu tư thế**: nếu `body.pixel.json` thiếu animation nào thì tư thế đó vẽ bằng sprite cũ trong `legacy-characters.ts`; thiếu `walk_left` thì lật ngang `walk_right`. Công thức hỏng (op lạ, kích thước lệch) chỉ `console.warn` một lần.
- Tự kiểm bằng `pixel_validate`/`pixel_inspect`; không có tool thì `npm test` (`characters.test.ts` kiểm mọi file trong `art/characters/`). Sau đó `npm run dev` xem chế độ demo.

## Kế hoạch

- Bản desktop (Tauri) sau khi bản web ổn định.
