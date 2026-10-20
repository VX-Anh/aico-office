# AICO Office

Văn phòng pixel cho [AI Company OS](https://github.com/VX-Anh/ai-company): mỗi agent (Claude Code, Codex, Cursor) ngồi một bàn, animation theo trạng thái, kèm thẻ hạn mức và thống kê.

Repo này cũng là **repo pilot** của aico: tính năng mới được tạo thành issue (nhãn `ai-company`) để chính các agent làm qua luồng plan → code → review → merge.

## Trạng thái

| Trạng thái | Trong văn phòng | Nguồn |
| --- | --- | --- |
| Đang rảnh | Ngồi thở, chớp mắt, màn hình con trỏ nhấp nháy | worker không có việc |
| Đang làm | Gõ phím, code chạy trên màn hình, đèn vàng nhấp nháy | worker đang chạy CLI cho một ticket |
| Hết hạn mức | Gục đầu ngủ, chữ Z bay lên, đếm ngược giờ mở lại | lần chạy gần nhất báo hết hạn mức subscription |
| Mất kết nối | Ghế trống | aico không gọi được worker |

Dấu `!` đỏ trên đầu: lần chạy gần nhất bị lỗi (không phải hết hạn mức).

## Chạy

```bash
npm install
npm run dev        # http://localhost:5173
```

Không nhập gì thì chạy **chế độ demo** với dữ liệu giả. Để xem agent thật, nhập địa chỉ aico (mặc định `http://localhost:8000`) và API token (`deploy/secrets/aico_api_token` của aico). Token lưu trong localStorage của trình duyệt.

aico phải cho phép origin của trang này (`AICO_CORS_ORIGINS`, mặc định đã có `http://localhost:5173`).

## Dữ liệu

`GET /workers` của aico trả mỗi worker: `state`, `roles`, `current` (ticket, vai trò, giờ bắt đầu), `runs_today`, `tokens_today`, tổng lượt và token, `last_error`, `limit` (`message`, `resets_at`).

Hạn mức: các CLI không công bố phần hạn mức còn lại, nên GUI chỉ biết khi một lần chạy báo hết hạn mức (và giờ mở lại nếu thông báo có ghi). Số lượt và token là do worker tự đếm.

## Cấu trúc

```text
src/api.ts     gọi aico, kiểu dữ liệu, dữ liệu demo
src/scene.ts   vẽ văn phòng và nhân vật pixel trên canvas
src/main.ts    vòng lặp animation, polling, thẻ trạng thái
```

## Kế hoạch

- Bản desktop (Tauri) sau khi bản web ổn định.
