# T-d5db63da: GUI: tooltip nhân vật luôn ghi "0 giây trước" cho mọi hoạt động

Lần code: 1. File do aico tạo, cập nhật mỗi lần code.

## Đầu việc

| Id | Việc | Vai trò | Được sửa | Chờ | Kết quả |
| --- | --- | --- | --- | --- | --- |
| W1 | src/time.ts: hàm thuần relativeTime(atIso, nowMs) + test vitest + README | coder | `src/time.ts`, `src/time.test.ts`, `README.md` | - | xong (claude) |
| W2 | agent-tooltip.ts: dùng relativeTime, tách recentLines thuần, tự cập nhật mỗi giây; test tái hiện ticket và dữ liệu đổi giữa chừng | coder | `src/agent-tooltip.ts`, `src/agent-tooltip.test.ts` | W1 | xong (codex) |
| W3 | main.ts: fmtAgo dùng relativeTime; test frame truyền now epoch cho tooltip | coder | `src/main.ts`, `src/main.test.ts` | W1 | xong (cursor) |

## Kế hoạch

Mình đã đọc xong code liên quan (tooltip, main, activity, scene, actors, tickets, usage). Dưới đây là kế hoạch.

# Kế hoạch T-d5db63da: tooltip nhân vật luôn ghi "0 giây trước"

## Hiện trạng và nguyên nhân (đọc code trên `main`)

- `src/agent-tooltip.ts:25` `ago(at, now)` tính `Math.max(0, Math.floor((now - Date.parse(at)) / 1000))`. Khi `at` ở quá khứ thì kết quả đúng. Khi `now < at` thì bị kẹp về 0, nên mọi dòng hiện "0 giây trước" mà không có dấu hiệu gì là lỗi.
- Chuỗi chỉ ra "0 giây" cho **cả 5 dòng** (cách nhau tới 25 giây) khi `now ≤ at` với mọi dòng. Nếu `now` hỏng kiểu NaN thì ra "NaN ngày trước", không phải "0 giây". Như vậy chỉ còn hai khả năng:
  1. **`now` không phải giờ epoch**: biến `now` trong tooltip khởi tạo bằng `0` (`agent-tooltip.ts:48`), hoặc nơi gọi truyền nhầm `t` của `requestAnimationFrame` (số ms từ lúc tải trang). Trên `main`, `frame()` truyền `Date.now()` (`src/main.ts`, cuối hàm `frame`). `show()` không chạy được trước `update()` đầu tiên vì lúc đó `figures` rỗng. Vậy code `main` hiện tại không rơi vào trường hợp này, nhưng **bản đang chạy trên office.aico.io.vn có thể khác `main`**.
  2. **`at` nằm ở tương lai so với trình duyệt**: aico ghi giờ local (UTC+7) nhưng gắn `Z`. Khi đó cả 5 dòng bị `Math.max(0, …)` che. Ticket nói đồng hồ các máy khớp nhau, nhưng không nói lúc lấy `/workers` thì giờ thật là 12:05Z hay 12:05 giờ Việt Nam.
- Các chỗ khác đã kiểm, **không** đổi `at`:
  - `readAgentActivity`/`parseActivity` (`src/activity.ts`) giữ nguyên chuỗi `at`.
  - `syncActors` gán lại `a.agent = agent` mỗi frame (`src/scene/actors.ts`), nên `figure.agent` không phải bản cũ.
  - `drawScene` đưa thẳng `actor.agent` vào `SceneFigure`.
  - Demo (`withDemoActivity`) sinh `recent` cách nhau 3 giây (`begin + st*3000`), nên demo không tái hiện được lỗi.
- Có logic cùng loại lặp ở nơi khác:
  - `fmtAgo` trong `src/main.ts` (dòng "Lần cuối" trên thẻ phòng) cũng dùng `Math.max(0, …)` và `Math.round`, khác cách làm tròn của tooltip.
  - `waitedLabel` (`src/tickets.ts`) có định dạng "chờ N …" riêng, đã ghi chú rõ "tương lai coi như vừa xong" và đã có test. Hàm này giữ nguyên.
  - `bubbleFor` dùng `at` để xét stale, không hiện chuỗi thời gian.

**Việc agent W1/W2 phải làm để chốt nguyên nhân:** mở JS bundle đang phục vụ trên office.aico.io.vn (chỉ đọc), tìm lời gọi `.update(` của tooltip và xem tham số thứ ba. Đồng thời so `at` thô của `/workers` với `Date.now()` trên console tại cùng thời điểm. Kết luận ghi vào tóm tắt. Nếu không truy cập được thì ghi "chưa xác nhận trên production" kèm lý do. Cách sửa bên dưới xử lý được cả hai khả năng: `now` luôn là epoch và có test; `at` ở tương lai thì hiện "vừa xong", lệch lớn thì `warnOnce` để lộ ra chứ không lặng lẽ thành 0.

## Các bước

### W1: hàm thuần `relativeTime` (coder)
- Tạo `src/time.ts` (không đọc giờ thật, không DOM): `relativeTime(atIso: string | null | undefined, nowMs: number): string`.
  - `at` hỏng/thiếu hoặc `nowMs` không hữu hạn: trả `"chưa rõ"`.
  - `at > now`: trả `"vừa xong"`. Nếu lệch hơn 5 phút thì thêm `warnOnce` (tiền tố `[time]`) để thấy lỗi đồng hồ/múi giờ của aico.
  - 0–59 giây: `"N giây trước"`; dưới 1 giờ: `"N phút trước"`; dưới 1 ngày: `"N giờ trước"`; còn lại `"N ngày trước"`. Tất cả dùng `Math.floor`.
- `src/time.test.ts` có các trường hợp:
  - biên 0, 1, 59, 60, 3599, 3600, 86399, 86400 giây;
  - tương lai 1 giây và 3 giờ ("vừa xong", warn đúng một lần);
  - `at` là `"abc"`, `""`, `null`;
  - `nowMs` là `NaN` hoặc `0` với `at` năm 2026: trả "vừa xong", không ra số âm. Ghi chú trong test rằng đây chính là dấu hiệu lỗi.
- README: thêm `src/time.ts`, `src/time.test.ts` vào bảng "Cấu trúc".

### W2: tooltip (coder, phụ thuộc W1)
- `src/agent-tooltip.ts`:
  - Bỏ `ago`, dùng `relativeTime`.
  - Tách hàm thuần `recentLines(agent: unknown, key: string, nowMs: number): string[]`, gồm sắp mới nhất trước, lấy 5 dòng, và dòng "chưa có" khi rỗng. `render` gọi hàm này.
  - `now` khởi tạo là `NaN` thay vì `0`, để chưa có `update` thì hiện "chưa rõ" chứ không ra "vừa xong".
  - Giữ cơ chế render lại mỗi khi `now - renderedAt >= 1000` hoặc đồng hồ lùi. Như vậy tooltip tự cập nhật mỗi giây khi đang mở. Không đổi CSS và cấu trúc DOM.
- `src/agent-tooltip.test.ts`: test `recentLines` với đúng dữ liệu trong ticket (4 `at` từ 12:05:01.803Z tới 12:05:26.114Z, `now` = 12:05:30Z) ra `4 giây`, `17 giây`, `27 giây`, `28 giây` (khác nhau, đúng thứ tự). Thêm test với `withDemoActivity(demoWorkers(now), now)`: các dòng của một agent đã chạy trên 9 giây phải khác nhau.
- Test tooltip với DOM giả (theo mẫu `src/main.test.ts`): mở tooltip qua `pointermove`, gọi `update` với `now` tăng dần và kiểm tra chữ đổi theo từng giây.

### W3: các chỗ khác hiện thời gian tương đối (coder, phụ thuộc W1, chạy song song với W2)
- `src/main.ts`: `fmtAgo` giữ nhánh `"chưa chạy"` khi chưa có `iso`, còn lại gọi `relativeTime`. Chuỗi trên thẻ phòng có thể đổi nhẹ vì chuyển từ làm tròn sang `floor`, ghi rõ điều này trong tóm tắt. `fmtElapsed` (thời lượng, không phải "trước") giữ nguyên.
- `src/main.test.ts`: kiểm `frame` truyền cho tooltip `now` là giờ epoch (bằng `Date.now()` giả), không phải `t` của rAF. Kiểm thẻ "Lần cuối" với `last_run_at` ở tương lai ra "vừa xong".
- Không sửa `tickets.ts`. Ghi trong tóm tắt rằng `waitedLabel` đã xử lý tương lai và có định dạng riêng.

## Tiêu chí nghiệm thu: dữ liệu đổi giữa chừng (test trong W2)
Tooltip đang mở trên một agent:
- **Số lượng đổi**: poll mới thêm 1 hoạt động (4 thành 5 dòng). Dòng mới lên đầu với "vừa xong" hoặc "0 giây trước", các dòng cũ tăng đúng số giây. Khi `recent` vượt 5 dòng thì chỉ hiện 5 dòng mới nhất.
- **Mất rồi xuất hiện lại**: `recent` thành `null` thì hiện "chưa có". Lượt sau có lại thì hiện lại đúng N giây, không giữ chuỗi cũ. Agent rời bàn rồi quay lại (đổi `started_at`) thì tooltip đóng như hiện nay.
- **Offline / lỗi poll**: `workers` giữ bản cũ thì chuỗi vẫn tăng theo `now`, không đứng yên. Phòng chuyển `offline` hoặc `limited` thì tooltip đóng (figures bị lọc theo `working`).
- **Đồng hồ**: `at` ở tương lai 2 giây thì "vừa xong", tới khi `now` vượt `at` mới thành "N giây". Đồng hồ lùi (`now < renderedAt`) thì render lại ngay. `at` hỏng trong một phần tử thì phần tử đó bị bỏ (đã có trong `parseActivity`), các dòng khác vẫn đúng.
- **Demo/thật**: đổi nguồn khi đang mở thì tooltip đóng (hành vi cũ), giờ của nguồn mới đúng.

## Kiểm tra
- `npm run build` và `npm test` đều phải qua. Ghi lệnh và kết quả vào tóm tắt.
- `npm run dev` ở chế độ demo: rê chuột lên agent claude sau giây 20 của chu kỳ, các dòng cách nhau 3 giây và tự tăng mỗi giây. Nếu không mở được trình duyệt thì ghi rõ là chưa xem.
- Tóm tắt ghi nguyên nhân gốc đã xác nhận (bundle production hay `at` tương lai) hoặc lý do chưa xác nhận được. Nếu lỗi do aico ghi `at` sai múi giờ thì ghi là cần sửa phía aico (ngoài repo này).

```json
{"items": [
  {"id": "W1", "title": "src/time.ts: hàm thuần relativeTime(atIso, nowMs) + test vitest + README", "role": "coder", "owns": ["src/time.ts", "src/time.test.ts", "README.md"], "depends_on": [], "acceptance": "relativeTime thuần (không đọc giờ thật, không DOM): 0-59 giây 'N giây trước', <1h 'N phút trước', <1 ngày 'N giờ trước', còn lại 'N ngày trước' (floor); at ở tương lai -> 'vừa xong' (lệch >5 phút thì warnOnce một lần); at hỏng/thiếu hoặc nowMs không hữu hạn -> 'chưa rõ'; không bao giờ ra số âm. time.test.ts phủ biên 0/1/59/60/3599/3600/86399/86400 giây, tương lai 1 giây và 3 giờ (warn đúng 1 lần), at 'abc'/''/null, nowMs NaN và nowMs=0. README bảng Cấu trúc có src/time.ts và src/time.test.ts. npm run build và npm test qua."},
  {"id": "W2", "title": "agent-tooltip.ts: dùng relativeTime, tách recentLines thuần, tự cập nhật mỗi giây; test tái hiện ticket và dữ liệu đổi giữa chừng", "role": "coder", "owns": ["src/agent-tooltip.ts", "src/agent-tooltip.test.ts"], "depends_on": ["W1"], "acceptance": "Bỏ ago(); recentLines(agent, key, nowMs) thuần: sắp mới nhất trước, tối đa 5 dòng, 'chưa có' khi rỗng; now khởi tạo NaN (chưa có update thì hiện 'chưa rõ'). Không đổi CSS/DOM khác. Test: dữ liệu ticket (12:05:01.803Z, 12:05:03.511Z, 12:05:13.332Z, 12:05:26.114Z; now 12:05:30Z) ra 4/17/27/28 giây theo thứ tự mới trước; withDemoActivity cho chuỗi khác nhau. Test DOM giả: tooltip mở tự đổi chữ mỗi giây; kịch bản đổi giữa chừng: thêm hoạt động (4->5 dòng, dòng mới 'vừa xong'/'0 giây trước', dòng cũ tăng đúng), vượt 5 chỉ giữ 5 mới nhất; recent null -> 'chưa có' rồi xuất hiện lại đúng giây; agent rời rồi quay lại (đổi started_at) -> đóng; workers cũ khi poll lỗi -> chuỗi vẫn tăng; phòng offline/limited -> đóng; at tương lai 2 giây -> 'vừa xong' rồi thành 'N giây'; đồng hồ lùi -> render lại; đổi nguồn -> đóng. Tóm tắt ghi nguyên nhân gốc đã xác nhận (bundle production truyền now sai hay at aico ở tương lai) hoặc lý do chưa xác nhận. npm run build và npm test qua."},
  {"id": "W3", "title": "main.ts: fmtAgo dùng relativeTime; test frame truyền now epoch cho tooltip", "role": "coder", "owns": ["src/main.ts", "src/main.test.ts"], "depends_on": ["W1"], "acceptance": "fmtAgo giữ 'chưa chạy' khi thiếu iso, còn lại dùng relativeTime (last_run_at tương lai -> 'vừa xong', không còn Math.max che lỗi); fmtElapsed giữ nguyên; không đổi giao diện khác. main.test.ts: frame truyền cho tooltip.update giá trị Date.now() (giả lập), không phải t của requestAnimationFrame; thẻ 'Lần cuối' với last_run_at tương lai ra 'vừa xong', 90 giây trước ra '1 phút trước'. Tóm tắt ghi waitedLabel (tickets.ts) giữ nguyên vì đã xử lý tương lai và có định dạng riêng. npm run build và npm test qua."}
]}
```

```mermaid
flowchart TD
  subgraph Data
    API["src/api.ts<br/>gọi aico /workers, /tickets, /tickets/{id}/events,<br/>POST /escalation + /decisions qua needAction;<br/>dữ liệu demo; current @deprecated giữ cho aico cũ"]
    USG["src/usage.ts<br/>parseUsage, usageWindows, usageLevel,<br/>shortCountdown, isStale (thuần)"]
    TIME["src/time.ts (mới)<br/>relativeTime(atIso, nowMs): N giây/phút/giờ/ngày trước,<br/>tương lai → vừa xong, hỏng → chưa rõ (thuần)"]
    TK["src/tickets.ts<br/>parseTickets, needKind, needsYou, createReasonCache,<br/>latestEscalationReason, mergeRequest, previewLink,<br/>actionsFor, commentRequired, irreversible,<br/>needsConfirmation(kind, action): merge/approved cần xác nhận,<br/>build*Request, actionError, waitedLabel,<br/>demoNeedTickets, applyDemoAction(list,id,kind,action) (thuần)"]
    ACTV["src/activity.ts<br/>readAgentActivity, screenFor, bubbleFor,<br/>taskProgress, resolveBubbles, withDemoActivity (thuần)"]
    LATEST["src/latest.ts<br/>createLatestGate: bỏ kết quả poll cũ (thuần)"]
    ATT["src/attention.ts<br/>tabTitle, isShortcut (phím P), nextAttention (thuần)"]
  end
  API --> TK
  ACTV -->|isIso| USG
  MAIN["src/main.ts<br/>vòng lặp animation (now = Date.now()), polling worker + ticket,<br/>nguồn ticket thật/demo (NeedSource), bộ đếm, phím P, toast,<br/>thẻ phòng: Lần cuối qua relativeTime"]
  API --> MAIN
  USG --> MAIN
  ACTV --> MAIN
  ATT --> MAIN
  LATEST --> MAIN
  MAIN -->|fmtAgo| TIME
  MAIN -->|refresh mỗi POLL_MS, setSource, focus, tick| COL["src/needs-column.ts (+ .css)<br/>cột Cần bạn: thẻ plan/merge/escalated, ghi chú,<br/>xác nhận trong thẻ theo needsConfirmation<br/>(Duyệt merge: 'Merge PR vào main'), khoá nút khi gửi"]
  COL --> TK
  COL --> LATEST
  COL -->|NeedSource.act| API
  COL --> NEEDS[["#needs cạnh canvas"]]
  MAIN -->|ticket mới cần người| TOAST["src/toasts.ts (+ .css)<br/>toast + nút Xử lý → focus thẻ"]
  MAIN -->|drawScene → SceneFigure[], sceneSize, resetActors, USAGE| IDX["src/scene/index.ts<br/>ghép cảnh, màn hình bàn theo screenFor,<br/>trả SceneFigure[]"]
  IDX -->|screenFor, readAgentActivity| ACTV
  MAIN -->|figures mỗi frame, now epoch| OVL["src/overlay.ts<br/>bong bóng hoạt động, tiến độ task"]
  OVL --> ACTV
  OVL -->|BUBBLE| PAL
  MAIN -->|figures mỗi frame, now epoch| TIP["src/agent-tooltip.ts (+ .css)<br/>hitFigure, recentLines (thuần), tooltip DOM<br/>render lại mỗi giây khi mở"]
  TIP --> ACTV
  TIP -->|relativeTime| TIME

  IDX --> LAYOUT["layout.ts<br/>bố cục phòng, bàn, cửa, chỗ ngồi, usageBoard (thuần)"]
  IDX -->|parseUsage| USG
  IDX --> BOARD["usage-board.ts<br/>thanh hạn mức 5H/WK, %, ?"]
  BOARD --> USG
  BOARD --> PAL
  BOARD --> FONT
  BOARD --> PIX
  IDX --> ACT["actors.ts<br/>agent đi vào/ra, actorPose<br/>bất biến: seated ⇔ cuối path = ghế hiện tại"]
  ACT --> LAYOUT
  ACT --> PATH["pathing.ts<br/>đường đi, vị trí theo thời gian (thuần)"]
  ACT -->|agentLook| CHAR
  IDX --> TILES["tiles.ts<br/>sàn, tường, cửa"]
  IDX --> FURN["furniture.ts<br/>bàn, ghế, sofa, biển tên, màn hình theo việc"]
  FURN -->|shortCountdown| USG
  FURN -->|SCREEN| PAL
  IDX --> CHAR["characters.ts<br/>chọn tư thế, chồng lớp thân→tóc→phụ kiện"]

  ART[("art/characters/*.pixel.json")] -->|import.meta.glob| CHAR
  CHAR --> PB["pixelbolt.ts<br/>đọc công thức, từ chối frame hỏng"]
  CHAR -->|tư thế thiếu/hỏng| LEG["legacy-characters.ts"]
  CHAR --> PAL["palette.ts<br/>màu provider, vai trò, USAGE, SCREEN, BUBBLE"]
  PB --> PIX["pixel.ts<br/>drawGrid, cached bitmap"]
  LEG --> PIX
  CHAR --> PIX
  CHAR --> FONT["font.ts<br/>chữ pixel 3x5"]
  TILES --> PIX
  FURN --> PIX
  FURN --> FONT
  PIX --> CANVAS[["canvas #office"]]

  subgraph Tests["npm test (vitest, môi trường node) — cổng cùng npm run build"]
    T_TIME["time.test.ts (mới)<br/>giây/phút/giờ/ngày, tương lai, at hỏng, now NaN/0"]
    T_TIP["agent-tooltip.test.ts<br/>hitFigure, recentLines dữ liệu ticket + demo,<br/>DOM giả: tự cập nhật mỗi giây, thêm/mất/xuất hiện lại,<br/>offline, at tương lai, đồng hồ lùi, đổi nguồn"]
    T_TK["tickets.test.ts<br/>bảng kind x action → needsConfirmation,<br/>nút, request, lỗi, demo, dữ liệu đổi giữa chừng"]
    T_COL["needs-column.test.ts (DOM giả)<br/>Duyệt merge chờ xác nhận; mất/xuất hiện lại,<br/>đổi số lượng, đổi loại, offline, đổi nguồn"]
    T_MAIN["main.test.ts<br/>ghép nối Cần bạn, nguồn demo/thật, lỗi tải,<br/>tooltip nhận now epoch, Lần cuối tương lai"]
    T_LATEST["latest.test.ts / attention.test.ts"]
    T_ACT["actors.test.ts / pathing.test.ts / layout.test.ts"]
    T_PB["pixelbolt.test.ts / characters.test.ts"]
    T_OTHER["usage.test.ts / activity.test.ts / font.test.ts"]
  end
  T_TIME -.-> TIME
  T_TIP -.-> TIP
  T_TK -.-> TK
  T_COL -.-> COL
  T_MAIN -.-> MAIN
  T_LATEST -.-> LATEST
  T_LATEST -.-> ATT
  T_ACT -.-> ACT
  T_PB -.-> PB
  T_OTHER -.-> ACTV
```
