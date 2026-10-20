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
src/scene/characters.ts    sprite nhân vật bằng lưới ký tự (đi 4 hướng, ngồi bàn, ngồi sofa, nằm ngủ)
src/scene/palette.ts       màu provider, vai trò và bảng màu chung
src/scene/font.ts          chữ pixel 3x5
src/scene/pixel.ts         hàm vẽ pixel, lưới ký tự, cache bitmap
```

## Kế hoạch

- Bản desktop (Tauri) sau khi bản web ổn định.
