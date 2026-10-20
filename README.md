# AICO Office

Văn phòng pixel cho [AI Company OS](https://github.com/VX-Anh/ai-company): mỗi provider (Claude Code, Codex, Cursor) là một **phòng** có `slots` chỗ ngồi; mỗi agent con đang chạy (tech_lead, coder, reviewer, designer) ngồi một chỗ, animation theo trạng thái, kèm thẻ hạn mức và thống kê theo phòng.

Repo này cũng là **repo pilot** của aico: tính năng mới được tạo thành issue (nhãn `ai-company`) để chính các agent làm qua luồng plan → code → review → merge.

## Trạng thái

| Trạng thái phòng | Trong văn phòng | Nguồn |
| --- | --- | --- |
| Đang rảnh | Ghế trống, màn hình con trỏ nhấp nháy, đèn xanh | phòng không có agent con nào chạy |
| Đang làm | Mỗi agent con gõ phím ở một chỗ, code chạy trên màn hình, đèn vàng nhấp nháy | phòng đang chạy CLI cho một hoặc nhiều ticket |
| Hết hạn mức | Mọi chỗ tối, agent con gục đầu ngủ, chữ Z bay lên; thẻ đếm ngược giờ mở lại | lần chạy gần nhất báo hết hạn mức subscription (chung cả phòng) |
| Mất kết nối | Phòng tắt đèn, biển tên xám | aico không gọi được worker |

Agent con phân biệt theo vai trò (xem chú thích dưới canvas): tech_lead áo xanh dương + cà vạt, coder áo xanh lá + tai nghe, reviewer áo tím + kính, designer áo hồng + mũ nồi; vai trò lạ áo xám. Tóc giữ màu provider. Màu code trên màn hình theo `mode` (read xanh lá, write xanh dương, review tím).

Biển tên phòng ghi thêm `+N` khi số agent con vượt `slots`. Dấu `!` đỏ cạnh biển tên: lần chạy gần nhất bị lỗi (không phải hết hạn mức).

## Chạy

```bash
npm install
npm run dev        # http://localhost:5173
```

Không nhập gì thì chạy **chế độ demo** với dữ liệu giả. Để xem agent thật, nhập địa chỉ aico (mặc định `http://localhost:8000`) và API token (`deploy/secrets/aico_api_token` của aico). Token lưu trong localStorage của trình duyệt.

aico phải cho phép origin của trang này (`AICO_CORS_ORIGINS`, mặc định đã có `http://localhost:5173`).

## Dữ liệu

`GET /workers` của aico trả mỗi phòng: `state`, `roles`, `slots` (số agent con tối đa chạy song song), `agents` (danh sách agent con đang chạy: `id`, `role`, `ticket_id`, `mode`, `started_at`), `runs_today`, `tokens_today`, tổng lượt và token, `last_error`, `limit` (`message`, `resets_at`).

`current` (agent đầu tiên) đã deprecated; GUI chỉ dùng khi aico bản cũ chưa trả `agents`.

Hạn mức: các CLI không công bố phần hạn mức còn lại, nên GUI chỉ biết khi một lần chạy báo hết hạn mức (và giờ mở lại nếu thông báo có ghi). Số lượt và token là do worker tự đếm.

## Cấu trúc

```text
src/api.ts     gọi aico, kiểu dữ liệu, dữ liệu demo
src/scene.ts   vẽ các phòng, chỗ ngồi và nhân vật pixel trên canvas
src/main.ts    vòng lặp animation, polling, thẻ trạng thái
```

## Kế hoạch

- Bản desktop (Tauri) sau khi bản web ổn định.
