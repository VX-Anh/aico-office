# AICO Office

Văn phòng pixel nhìn từ trên xuống (góc 3/4 kiểu game RPG) cho [AI Company OS](https://github.com/VX-Anh/ai-company): mỗi provider (Claude Code, Codex, Cursor) là một **phòng làm việc** có `slots` bàn; mỗi agent con đang chạy (tech_lead, coder, reviewer, designer) ngồi một bàn. Bên dưới là **phòng nghỉ** chung nối với các phòng bằng ô cửa. Kèm thẻ hạn mức và thống kê theo phòng.

Repo này cũng là **repo pilot** của aico: tính năng mới được tạo thành issue (nhãn `ai-company`) để chính các agent làm qua luồng plan → code → review → merge.

## Trạng thái

| Trạng thái phòng | Trong văn phòng | Nguồn |
| --- | --- | --- |
| Đang rảnh | Ghế trống, màn hình con trỏ nhấp nháy, đèn xanh; nhân vật thường trực của phòng ngồi sofa phòng nghỉ uống cà phê | phòng không có agent con nào chạy |
| Đang làm | Mỗi agent con ngồi một bàn, quay lưng gõ phím, code chạy trên màn hình, đèn vàng nhấp nháy. Agent mới đi bộ từ phòng nghỉ qua cửa tới bàn trống; agent xong đi về phòng nghỉ rồi mờ dần | phòng đang chạy CLI cho một hoặc nhiều ticket |
| Hết hạn mức | Bàn trống, màn hình tắt; nhân vật của phòng nằm ngủ trên sofa phòng nghỉ, chữ Z bay lên; biển dưới đồng hồ phòng đếm ngược giờ mở lại (ví dụ `47M`, `1H05`) | lần chạy gần nhất báo hết hạn mức subscription (chung cả phòng) |
| Mất kết nối | Phòng tắt đèn, biển tên xám, không có ai (kể cả trong phòng nghỉ) | aico không gọi được worker |

Agent con phân biệt theo vai trò (xem chú thích dưới canvas): tech_lead áo xanh dương + cà vạt, coder áo xanh lá + tai nghe, reviewer áo tím + kính, designer áo hồng + mũ nồi; vai trò lạ áo xám. Kiểu tóc và màu tóc của agent con chọn theo `id` nên ổn định giữa các lần vẽ; nhân vật thường trực mang tóc và áo màu provider. Màu code trên màn hình theo `mode` (read xanh lá, write xanh dương, review tím). Chỗ ngồi giữ ổn định theo `id` agent.

Lần vẽ đầu (mở trang, đổi nguồn dữ liệu, phòng online lại) agent đang chạy được đặt thẳng vào ghế, không đi bộ.

Biển tên phòng ghi thêm `+N` khi số agent con vượt `slots`. Dấu `!` đỏ cạnh biển tên: lần chạy gần nhất bị lỗi (không phải hết hạn mức).

## Chạy

```bash
npm install
npm run dev        # http://localhost:5173
```

Không nhập gì thì chạy **chế độ demo** với dữ liệu giả (kịch bản 48 giây: phòng có 0/1/2 agent, agent đi vào/ra, phòng hết hạn mức, phòng mất kết nối). Để xem agent thật, nhập địa chỉ aico (mặc định `http://localhost:8000`) và API token (`deploy/secrets/aico_api_token` của aico). Token lưu trong localStorage của trình duyệt.

aico phải cho phép origin của trang này (`AICO_CORS_ORIGINS`, mặc định đã có `http://localhost:5173`).

## Dữ liệu

`GET /workers` của aico trả mỗi phòng: `state`, `roles`, `slots` (số agent con tối đa chạy song song), `agents` (danh sách agent con đang chạy: `id`, `role`, `ticket_id`, `mode`, `started_at`), `runs_today`, `tokens_today`, tổng lượt và token, `last_error`, `limit` (`message`, `resets_at`).

`current` (agent đầu tiên) đã deprecated; GUI chỉ dùng khi aico bản cũ chưa trả `agents`.

Hạn mức: các CLI không công bố phần hạn mức còn lại, nên GUI chỉ biết khi một lần chạy báo hết hạn mức (và giờ mở lại nếu thông báo có ghi). Số lượt và token là do worker tự đếm.

## Cấu trúc

```text
src/api.ts                 gọi aico, kiểu dữ liệu, dữ liệu demo
src/main.ts                vòng lặp animation, polling, thẻ trạng thái
src/scene/index.ts         ghép cảnh: drawScene, sceneSize
src/scene/layout.ts        bố cục phòng, bàn, cửa, phòng nghỉ; giữ chỗ ngồi theo id (hàm thuần)
src/scene/pathing.ts       đường đi ngang/dọc qua cửa, vị trí theo thời gian (hàm thuần)
src/scene/actors.ts        nhân vật đi vào/ra theo thay đổi của agents[]
src/scene/tiles.ts         sàn gỗ, sàn phòng nghỉ, tường, vách, ô cửa
src/scene/furniture.ts     bàn, máy tính, ghế, kệ sách, đồng hồ, sofa, bàn trà, quầy bếp, biển tên
src/scene/characters.ts    sprite nhân vật từ công thức Pixelbolt: chọn tư thế, chồng lớp thân → tóc → phụ kiện, thay màu theo agent
src/scene/pixelbolt.ts     bộ đọc công thức Pixelbolt tối giản (palette, frames grid/from, animations), cache bitmap
src/scene/legacy-characters.ts  sprite lưới ký tự cũ, dùng khi công thức thiếu tư thế
src/scene/palette.ts       màu provider, vai trò (áo, màu phụ kiện) và bảng màu chung
src/scene/font.ts          chữ pixel 3x5
src/scene/pixel.ts         hàm vẽ pixel, lưới ký tự, cache bitmap
art/characters/body.pixel.json      thân nhân vật (đủ 7 tư thế)
art/characters/hair/styleN.pixel.json  lớp tóc theo kiểu: 0 ngắn, 1 mái, 2 dài, 3 búi
art/characters/acc/<role>.pixel.json   lớp phụ kiện theo vai trò (tech_lead, coder, reviewer, designer)
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
- Tự kiểm bằng `pixel_validate`/`pixel_inspect`, rồi `npm run dev` xem chế độ demo.

## Kế hoạch

- Bản desktop (Tauri) sau khi bản web ổn định.
