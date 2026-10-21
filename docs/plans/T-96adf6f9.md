# T-96adf6f9: GUI: bong bóng hoạt động trên nhân vật, màn hình bàn theo việc, tiến độ task (dữ liệu activity của /workers)

Lần code: 3. File do aico tạo, cập nhật mỗi lần code.

## Đầu việc

| Id | Việc | Vai trò | Được sửa | Chờ | Kết quả |
| --- | --- | --- | --- | --- | --- |
| W1 | src/activity.ts: đọc phòng thủ activity/recent/tasks/stats, screenFor, bubbleFor, taskProgress, resolveBubbles, dữ liệu demo + test | coder | `src/activity.ts`, `src/activity.test.ts`, `src/usage.ts` | - | chưa chạy |
| W2 | Màn hình trên bàn theo việc: code/terminal/browser/search/read có hoạt ảnh, màu SCREEN và BUBBLE trong palette | coder | `src/scene/furniture.ts`, `src/scene/palette.ts` | - | chưa chạy |
| W3 | src/overlay.ts: canvas chữ phủ trên cảnh, vẽ bong bóng hoạt động và thanh tiến độ task | coder | `src/overlay.ts` | W1, W2 | chưa chạy |
| W4 | src/agent-tooltip.ts: tooltip DOM khi rê chuột hoặc chạm nhân vật (ticket, vai trò, 5 hoạt động, task, stats) | coder | `src/agent-tooltip.ts`, `src/agent-tooltip.css`, `src/agent-tooltip.test.ts` | W1 | chưa chạy |
| W5 | Ghép nối: drawScene trả SceneFigure[] và chọn màn hình theo screenFor; main.ts gắn overlay, tooltip, demo activity; README | coder | `src/scene/index.ts`, `src/main.ts`, `README.md` | W1, W2, W3, W4 | chưa chạy |
| FIX | Sửa theo góp ý: [review bởi codex] | coder | `**` | - | xong |

## Kế hoạch

Mình đã đọc xong AGENTS.md, sơ đồ kiến trúc, tài liệu Habblaud và phần code liên quan (main, api, scene/index, furniture, actors, layout, palette, usage, index.html, style.css). Thư mục `docs/plans/` không đọc trực tiếp được nên mình bỏ qua. Kế hoạch như sau.

# Kế hoạch T-96adf6f9: bong bóng hoạt động, màn hình theo việc, tiến độ task

## Hiện trạng và những điểm cần quyết

- **Dữ liệu agent:** `fetchWorkers` ép kiểu JSON và trả nguyên, còn `roomAgents` trả `w.agents` y như nhận được. Vì vậy các trường mới (`activity`, `recent`, `tasks`, `tasks_done`, `stats`) **đã đi tới tận scene** mà không cần sửa `src/api.ts`. `src/activity.ts` đọc chúng qua `unknown`, không sửa kiểu `WorkerAgent`.
- **Demo:** dữ liệu demo nằm trong `api.ts`, và literal kiểu `WorkerAgent` sẽ bị TypeScript chặn nếu thêm trường lạ. Cách làm: thêm hàm `withDemoActivity(workers, now)` trong `activity.ts`, rồi `main.ts` gọi nó sau `demoWorkers()`. Như vậy không đụng `api.ts`.
- **Lớp phủ:** `index.html` và `style.css` thuộc phần "bố cục trang" mà T-626ddd48 đang sửa. Vì vậy canvas phủ được **tạo bằng JS** và chèn ngay sau `#office` trong `.stage`, style đặt inline. Tooltip dùng file CSS riêng, mới tạo. Không sửa `index.html` hay `style.css`.
- **"Bảng tên nhân vật":** hiện chưa có bảng tên theo từng nhân vật, chỉ có biển tên phòng. Mình quyết định vẽ thanh tiến độ `3/7` ở lớp phủ, ngay dưới chân nhân vật (dưới ghế). Bong bóng nằm trên đầu nên hai thứ không chồng nhau.
- **`isIso`** trong `src/usage.ts` đang là hàm riêng. Mình sẽ export nó để dùng lại, không chép lại.
- **Vị trí nhân vật:** `drawScene` sẽ **trả về** danh sách nhân vật có vị trí (đổi từ `void`, không làm hỏng nơi gọi cũ). Lớp phủ và tooltip dùng danh sách này, không đọc thẳng trạng thái bên trong `actors.ts`. `actors.ts`, `layout.ts`, `pathing.ts` **không đổi**.

## Hợp đồng chung (các đầu việc code theo đúng chỗ này)

`src/activity.ts`, hàm thuần, không đọc giờ thật:

```ts
export type ActivityKind = "think"|"respond"|"read"|"search"|"edit"|"write"|"run"|"test"|"git"|"web"|"plan"|"delegate"|"mcp"|"remote"|"error"|"other";
export interface Activity { kind: ActivityKind; icon: string; text: string; detail: string|null; tool: string|null; at: string; error: boolean }
export interface AgentTask { id: string; title: string; status: "pending"|"in_progress"|"completed" }
export interface AgentStats { tool_calls: number|null; tokens_in: number|null; tokens_out: number|null }
export interface AgentActivity { activity: Activity|null; recent: Activity[]|null; tasks: AgentTask[]|null; tasksDone: number|null; stats: AgentStats|null }
export type ScreenMode = "code"|"terminal"|"browser"|"search"|"read"|"idle";
export interface Bubble { icon: string; text: string; error: boolean; stale: boolean; at: number }

export function readAgentActivity(agent: unknown, who?: string): AgentActivity;
export function screenFor(kind: ActivityKind | null | undefined): ScreenMode;
export function bubbleFor(agent: unknown, now: number): Bubble | null;
export function taskProgress(agent: unknown): { done: number; total: number } | null;
export function truncate(text: string, max?: number): string;  // mặc định 28, đếm theo code point, thêm "…"
export function resolveBubbles(items: { key: string; x: number; y: number; w: number; h: number; at: number }[]): Set<string>; // key bị thu về chỉ icon
export function withDemoActivity<T>(workers: T[], now: number): T[];
export const STALE_MS = 60_000;
```

Quy tắc đọc phòng thủ, theo AGENTS.md và cùng kiểu `usage.ts` (`reject` có warn một lần):

- **Thiếu trường hay `null`:** trả null cho trường đó, không warn.
- **`activity` sai kiểu** (không phải object, `text`/`icon` không phải chuỗi, `at` không phải ISO): trả `activity: null` và warn một lần. Không chuẩn hoá thành bong bóng rỗng.
- **`kind`** là chuỗi lạ thì thành `"other"`; không phải chuỗi thì từ chối cả activity.
- **`icon`** rỗng thì lấy icon mặc định theo kind. `error` lấy là `true` khi `error === true` hoặc `kind === "error"`.
- **`recent`, `tasks`:** nếu không phải mảng thì null. Phần tử hỏng thì bỏ riêng phần tử đó (warn một lần). `recent` giữ tối đa 20 phần tử cuối.
- **`tasks_done`:** chỉ nhận số nguyên trong khoảng `[0, total]`, ngoài khoảng đó thì null.
- **`stats`:** phải là object, nếu không thì null. Từng trường con phải là số hữu hạn không âm, nếu không thì null.
- Không bao giờ ném lỗi ra ngoài, để vòng vẽ không bị đứng.

Logic còn lại:

- **`screenFor`:**
  - `edit`, `write` → `code`
  - `run`, `test`, `git`, `remote` → `terminal`
  - `web`, `mcp` → `browser`
  - `search` → `search`
  - `read`, `plan` → `read`
  - còn lại, kể cả null → `idle`
- **`bubbleFor`:** trả null nếu không có activity.
  - `stale` khi `now - at > 60 s` (đúng 60 s thì chưa tính stale). Nếu `at` ở tương lai (lệch đồng hồ) thì không stale.
  - Text được cắt bằng `truncate`, mặc định 28 ký tự.
- **`taskProgress`:** trả null khi không có tasks hoặc tasks rỗng. `total` là số task. `done` lấy `tasks_done` nếu hợp lệ, không thì đếm số task `completed`.
- **`resolveBubbles`:** sắp bong bóng theo `at` giảm dần. Cái mới nhất hiện đủ. Mỗi cái sau thu về chỉ icon nếu khung của nó chồng lên một bong bóng đầy đủ đã đặt. Nếu `at` bằng nhau thì sắp theo `key` để kết quả ổn định.

Hình học (do W5 dựng, W3/W4 dùng): `export interface SceneFigure { key: string; agent: WorkerAgent; room: string; working: boolean; x: number; headY: number; footY: number; seated: boolean }`, toạ độ theo pixel gốc của cảnh. `working` là `true` khi phòng ở trạng thái `working` và nhân vật ở pha `seated` hoặc `in`. Nhân vật đang đi ra (`out`) thì không có bong bóng.

Màu (W2 thêm vào `palette.ts`):
- `SCREEN = { terminalBg, terminalLine, browserFrame, browserBar, searchGlass, paper, paperLine, … }`
- `BUBBLE = { bg, border, error, text, staleAlpha, bar, barTrack, barText }`

## Các bước

1. **W1 – `src/activity.ts` và test (coder).** Viết theo hợp đồng trên, export `isIso` trong `usage.ts`.
   - Demo: chu kỳ 48 giây trùng kịch bản cũ. Mỗi agent demo có activity chạy vòng qua các kind `read → search → edit → run → test → web → plan → error`, đổi khoảng 4 giây một lần, lệch pha theo `id`. Có một đoạn `at` cũ 90 giây để thấy stale.
   - Agent demo có `recent` (5–8 mục), `tasks` 7 mục hoàn thành dần theo thời gian, và `stats` tăng dần.
   - Hai agent ở bàn cạnh nhau phải có lúc cùng hiện bong bóng, để thấy trường hợp chồng nhau.
2. **W2 – Màn hình trên bàn (coder, song song với W1).**
   - `furniture.ts`: mở rộng `Screen` thành `"code" | "terminal" | "browser" | "search" | "read" | "cursor" | "off"`, rồi vẽ trong vùng kính 8×5 px của `drawMonitor`, có hoạt ảnh theo `t`:
     - `code`: giữ dòng màu nhấp nháy như hiện tại.
     - `terminal`: nền tối, dòng xanh cuộn lên, con trỏ `_` nhấp nháy.
     - `browser`: thanh tiêu đề sáng, khối nội dung, thanh cuộn chạy.
     - `search`: kính lúp lắc qua lại trên các dòng.
     - `read`: trang giấy sáng với các dòng chữ, lật trang theo nhịp chậm.
   - `palette.ts`: thêm `SCREEN` và `BUBBLE`. Mã màu không rải trong `furniture.ts`.
3. **W3 – `src/overlay.ts`, lớp chữ (coder, phụ thuộc W1 và W2).**
   - `createOverlay(canvas: HTMLCanvasElement): { draw(figures: SceneFigure[], sceneW: number, now: number): void }`.
   - Tự tạo `<canvas class="activity-overlay">` và chèn sau `canvas`. Style inline: `position:absolute`, `pointer-events:none`, khớp `offsetLeft/Top + clientLeft/Top` và `clientWidth/Height` của `#office`. Không đặt `z-index`, để `#escalations` (z-index 1) vẫn nằm trên.
   - Kích thước bộ nhớ: `clientWidth × devicePixelRatio`, có cập nhật khi đổi kích thước. Tỉ lệ `s = clientWidth / sceneW`.
   - Mỗi frame: xoá canvas. Với mỗi figure có `working`, gọi `bubbleFor`, đo chữ bằng `measureText` với font hệ thống (không dùng font 3×5), rồi gọi `resolveBubbles` và vẽ:
     - bong bóng bo góc có đuôi chỉ xuống `(x, headY)`;
     - `error` thì viền `BUBBLE.error`;
     - `stale` hoặc bị thu gọn thì chỉ vẽ icon; `stale` vẽ thêm `globalAlpha = BUBBLE.staleAlpha`;
     - bong bóng bị kẹp trong biên canvas.
   - Có `taskProgress` thì vẽ thanh nhỏ kèm chữ `3/7` dưới `footY`.
4. **W4 – `src/agent-tooltip.ts` và `src/agent-tooltip.css`, tooltip (coder, phụ thuộc W1).**
   - `createAgentTooltip(canvas): { update(figures: SceneFigure[], sceneW: number, now: number): void }`.
   - `hitFigure(figures, x, y)` là hàm thuần, export để test. Vùng chạm khoảng 16×22 quanh nhân vật, khi chồng nhau thì ưu tiên nhân vật ở gần (y lớn hơn).
   - Sự kiện:
     - `pointermove`/`pointerleave` trên `#office` khi chuột.
     - Cảm ứng: `pointerdown` có `pointerType === "touch"` thì mở. `pointerdown` trên `document` ngoài nhân vật thì đóng.
   - Tooltip là một `div` gắn vào `body`, `position: fixed`, đặt cạnh con trỏ (+12 px), tự lật khi chạm mép viewport. Nội dung dựng lại tối đa 1 lần mỗi giây hoặc khi đổi nhân vật, không dựng lại mỗi frame.
   - Nội dung: ticket, vai trò (`roleStyle().label`), 5 mục `recent` mới nhất (icon, text, "x giây/phút trước"), danh sách task kèm trạng thái, stats (lần gọi tool, token vào/ra, có thể rút gọn kiểu `12K`). Trường thiếu thì ghi "chưa có". Chữ chỉ đặt bằng `textContent`, không dùng `innerHTML`, vì dữ liệu lấy từ API.
   - Nhân vật biến mất khỏi danh sách figures (agent xong việc hoặc phòng offline) thì tooltip tự đóng.
5. **W5 – Ghép nối (coder, phụ thuộc W1–W4).**
   - `scene/index.ts`:
     - `drawRoomFurniture` chọn màn hình: phòng tắt (limited/offline) thì `off`; nhân vật đang ngồi thì `screenFor(readAgentActivity(agent).activity?.kind)`, nếu kết quả là `idle` thì dùng `code` (giữ hành vi cũ cho aico bản cũ); không ai ngồi thì `cursor`.
     - `drawScene` trả `SceneFigure[]`, dựng từ `crew` và `actorPose`: nhân vật đang ngồi lấy `x = desk.seat.x`, `headY` gần `desk.y + 12`; nhân vật đang đi lấy `pose.y - 22`.
     - Export kiểu `SceneFigure`.
   - `main.ts`:
     - Demo dùng `workers = withDemoActivity(demoWorkers(now), now)` ở cả `frame` và `pollWorkers`.
     - Trong `frame`: `const figures = drawScene(...)`, rồi `overlay.draw(figures, size.width, Date.now())` và `tooltip.update(...)`.
     - Không sửa phần panel hay ticket.
   - `README.md`: cập nhật bảng "Cấu trúc" (`activity.ts`, `activity.test.ts`, `overlay.ts`, `agent-tooltip.ts/.css`) và thêm một đoạn ở mục "Dữ liệu" mô tả các trường mới.

## File cần sửa

| File | Đầu việc |
| --- | --- |
| `src/activity.ts` (mới), `src/activity.test.ts` (mới), `src/usage.ts` (chỉ export `isIso`) | W1 |
| `src/scene/furniture.ts`, `src/scene/palette.ts` | W2 |
| `src/overlay.ts` (mới) | W3 |
| `src/agent-tooltip.ts`, `src/agent-tooltip.css`, `src/agent-tooltip.test.ts` (đều mới) | W4 |
| `src/scene/index.ts`, `src/main.ts`, `README.md` | W5 |

Không đụng: `src/api.ts`, `src/tickets.ts`, `src/escalation-panel.ts`, `index.html`, `src/style.css`, `actors.ts`, `layout.ts`, `pathing.ts`.

## Cách kiểm tra

- `npm ci && npm run build && npm test` đều phải qua.
- **Test vitest (W1, `activity.test.ts`):**
  - Agent không có trường mới (aico cũ) thì mọi trường null, `bubbleFor` và `taskProgress` trả null.
  - `activity` là chuỗi hoặc mảng, `at` không phải ISO, `text` là số: từ chối và warn đúng một lần qua nhiều lần gọi.
  - `kind` là `"foo"` thì thành `other`; `kind` là số thì bị từ chối.
  - `recent` có phần tử hỏng thì phần tử đó bị bỏ; `recent` có 25 mục thì còn 20.
  - `screenFor`: mọi kind và null.
  - `bubbleFor`: stale ở biên 60 s / 60,001 s; `at` ở tương lai; error theo cờ và theo kind; cắt chữ đúng ở 28 (chuỗi tiếng Việt có dấu tổ hợp và emoji).
  - `taskProgress`: rỗng, `tasks_done` hợp lệ, vượt total, âm, không phải số nguyên.
  - `resolveBubbles`: không chồng nhau thì không thu; chồng nhau thì cái cũ hơn thu; ba cái chồng nhau; `at` bằng nhau thì kết quả ổn định.
  - `withDemoActivity` trong một chu kỳ có đủ các kind, có ít nhất một error và một stale, tasks tăng dần.
- **Test vitest (W4):** `hitFigure` khi trúng, trượt và khi hai nhân vật chồng nhau.
- **Kịch bản "dữ liệu đổi giữa chừng"** (test thuần trong W1/W4 và xem bằng demo):
  1. Activity có rồi mất (null), rồi xuất hiện lại: bong bóng ẩn rồi hiện lại, không lỗi, không kẹt trạng thái stale cũ.
  2. Kind đổi liên tục giữa các poll: màn hình đổi ngay theo kind mới, không chớp sai màn hình.
  3. Activity đổi từ stale sang mới (`at` mới): bong bóng hiện đủ lại.
  4. Số agent trong phòng đổi khi đang hiện bong bóng hoặc tooltip: agent rời đi thì bong bóng biến mất ngay khi chuyển sang pha `out`, tooltip đóng; agent mới đi vào thì có bong bóng trong lúc đi.
  5. Số task đổi: 3/7 thành 3/9 thành 9/9; tasks bị xoá (null) thì thanh tiến độ biến mất.
  6. Phòng chuyển sang `limited` hoặc `offline` giữa chừng: không còn bong bóng hay thanh tiến độ, màn hình `off`. Online lại thì hiện lại.
  7. Đổi nguồn demo ↔ thật: lớp phủ xoá sạch, tooltip đóng.
  8. Hai bong bóng chồng nhau và cái cũ hơn được cập nhật thành mới hơn: thứ tự ưu tiên đảo lại.
  9. Dữ liệu hỏng xen giữa các poll tốt: frame vẫn chạy, chỉ warn một lần.
- **Xem tay bằng `npm run dev` (chế độ demo):**
  - Bong bóng sắc nét ở mọi mức zoom và trên HiDPI, đuôi chỉ đúng đầu nhân vật.
  - Thấy đủ viền đỏ khi error, bong bóng chỉ icon và mờ khi stale, cái cũ thu về khi chồng nhau.
  - Đủ 5 loại màn hình có hoạt ảnh.
  - Thanh `x/7` tăng dần.
  - Tooltip theo chuột, không che thẻ phòng, panel ticket vẫn nằm trên lớp phủ.
  - Trên thiết bị cảm ứng (dùng giả lập của DevTools): chạm để mở, chạm chỗ khác để đóng.

```json
{"items": [
  {"id": "W1", "title": "src/activity.ts: đọc phòng thủ activity/recent/tasks/stats, screenFor, bubbleFor, taskProgress, resolveBubbles, dữ liệu demo + test", "role": "coder", "owns": ["src/activity.ts", "src/activity.test.ts", "src/usage.ts"], "depends_on": [], "acceptance": "Đúng hợp đồng API trong kế hoạch; chỉ export thêm isIso trong usage.ts, không đổi hành vi. Agent thiếu trường (aico cũ) thì mọi trường null, không warn; sai kiểu thì trả null và warn một lần; kind lạ thì thành other; recent/tasks bỏ phần tử hỏng, recent giữ tối đa 20. bubbleFor: stale khi quá 60 s (đúng 60 s chưa tính, at ở tương lai không stale), error theo cờ hoặc kind, text cắt 28 code point có dấu …. taskProgress đúng với tasks_done hợp lệ hoặc không hợp lệ. resolveBubbles: cái mới hơn hiện đủ, cái cũ chồng lên thì thu về icon, at bằng nhau thì kết quả ổn định. withDemoActivity trong chu kỳ 48 s có đủ các kind, ít nhất 1 error, 1 stale, tasks tăng dần, có lúc hai bong bóng bàn cạnh nhau cùng hiện. Test có kịch bản dữ liệu đổi giữa chừng: activity mất rồi xuất hiện lại, từ stale sang mới, số task đổi (3/7 → 3/9 → 9/9 → null), dữ liệu hỏng xen giữa dữ liệu tốt. npm run build và npm test qua."},
  {"id": "W2", "title": "Màn hình trên bàn theo việc: code/terminal/browser/search/read có hoạt ảnh, màu SCREEN và BUBBLE trong palette", "role": "coder", "owns": ["src/scene/furniture.ts", "src/scene/palette.ts"], "depends_on": [], "acceptance": "Screen mở rộng thành code|terminal|browser|search|read|cursor|off, vẽ pixel trong vùng kính 8×5 của drawMonitor, có hoạt ảnh nhẹ theo t (terminal dòng xanh chạy lên trên nền tối, browser có khung trang, search có kính lúp di chuyển, read là trang giấy có dòng chữ). code, cursor, off giữ nguyên như cũ. Mọi màu mới nằm trong palette.ts (SCREEN, và BUBBLE với bg/border/error/text/staleAlpha/bar/barTrack/barText), không rải mã màu trong furniture.ts. Chữ ký drawDesk giữ tương thích. npm run build và npm test qua."},
  {"id": "W3", "title": "src/overlay.ts: canvas chữ phủ trên cảnh, vẽ bong bóng hoạt động và thanh tiến độ task", "role": "coder", "owns": ["src/overlay.ts"], "depends_on": ["W1", "W2"], "acceptance": "createOverlay(canvas) tự tạo canvas phủ khớp vùng nội dung của #office (style inline, pointer-events:none, không z-index để nằm dưới #escalations), độ phân giải theo devicePixelRatio, cập nhật khi đổi kích thước. Không sửa index.html hay style.css. draw(figures, sceneW, now) xoá rồi vẽ lại mỗi frame. Chỉ figure working mới có bong bóng; bong bóng có icon + text 28 ký tự, font hệ thống (không dùng font pixel), đuôi chỉ xuống đầu. Error thì viền đỏ; stale thì chỉ icon và mờ; chồng nhau thì theo resolveBubbles; bong bóng kẹp trong biên. Có tasks thì vẽ thanh 'done/total' dưới chân nhân vật. Màu lấy từ BUBBLE trong palette. Figure biến mất (agent đi ra, phòng limited/offline, đổi nguồn) thì frame sau không còn gì của nó. npm run build qua."},
  {"id": "W4", "title": "src/agent-tooltip.ts: tooltip DOM khi rê chuột hoặc chạm nhân vật (ticket, vai trò, 5 hoạt động, task, stats)", "role": "coder", "owns": ["src/agent-tooltip.ts", "src/agent-tooltip.css", "src/agent-tooltip.test.ts"], "depends_on": ["W1"], "acceptance": "createAgentTooltip(canvas).update(figures, sceneW, now); hitFigure là hàm thuần, có test (trúng, trượt, hai nhân vật chồng nhau thì chọn y lớn hơn). Chuột: pointermove hiện tooltip cạnh con trỏ, tự lật ở mép viewport, pointerleave thì ẩn. Cảm ứng: chạm nhân vật thì mở, chạm chỗ khác thì đóng. Nội dung: ticket, vai trò, 5 recent mới nhất (icon, text, thời gian trước), task kèm trạng thái, stats (lần gọi tool, token vào/ra); trường thiếu ghi 'chưa có'; chỉ dùng textContent. Không dựng DOM lại mỗi frame (tối đa 1 lần/giây hoặc khi đổi nhân vật). Nhân vật biến mất khỏi figures hoặc đổi nguồn thì tooltip đóng. CSS riêng trong agent-tooltip.css, không sửa style.css. npm run build và npm test qua."},
  {"id": "W5", "title": "Ghép nối: drawScene trả SceneFigure[] và chọn màn hình theo screenFor; main.ts gắn overlay, tooltip, demo activity; README", "role": "coder", "owns": ["src/scene/index.ts", "src/main.ts", "README.md"], "depends_on": ["W1", "W2", "W3", "W4"], "acceptance": "drawScene trả SceneFigure[] (key, agent, room, working, x, headY, footY, seated) dựng từ crew và actorPose; working chỉ khi phòng working và pha seated/in. Màn hình bàn: phòng limited/offline thì off; có người ngồi thì screenFor(kind), riêng idle hoặc thiếu activity thì giữ code như cũ; bàn trống thì cursor. main.ts: demo dùng withDemoActivity(demoWorkers(now), now) ở cả frame và poll; mỗi frame gọi overlay.draw và tooltip.update; không đụng panel, tickets, api.ts, index.html, style.css, actors/layout/pathing. README cập nhật bảng Cấu trúc và mục Dữ liệu. npm run build và npm test qua. Xem tay trong demo đủ các kịch bản: activity mất rồi xuất hiện lại, kind đổi nhanh, stale rồi mới, số agent đổi khi đang hiện bong bóng hoặc tooltip, số task đổi, phòng sang limited/offline rồi online lại, đổi nguồn demo↔thật, hai bong bóng chồng nhau đảo thứ tự."}
]}
```

```mermaid
flowchart TD
  subgraph Data
    API["src/api.ts<br/>gọi aico /workers, /tickets, /tickets/{id}/events,<br/>POST /tickets/{id}/escalation; dữ liệu demo (có usage)<br/>agents[] đi qua nguyên vẹn (activity, recent, tasks, stats)"]
    USG["src/usage.ts<br/>parseUsage (từ chối usage hỏng → null), isIso,<br/>usageWindows, usageLevel, shortCountdown, isStale (thuần)"]
    TK["src/tickets.ts<br/>parseTickets, escalatedOnly, latestEscalationReason,<br/>mergeRequest, actionAvailability, needsConfirm,<br/>buildEscalationRequest, escalationError, demoTickets (thuần)"]
    ACTV["src/activity.ts<br/>readAgentActivity (đọc phòng thủ activity/recent/tasks/stats),<br/>screenFor, bubbleFor (stale 60s, error, cắt 28), taskProgress,<br/>resolveBubbles, withDemoActivity (thuần)"]
  end
  API --> TK
  ACTV -->|isIso| USG
  MAIN["src/main.ts<br/>vòng lặp animation, polling (worker + ticket cùng chu kỳ),<br/>thẻ trạng thái, chú thích, nguồn ticket thật/demo,<br/>demo + withDemoActivity"]
  API --> MAIN
  USG --> MAIN
  ACTV --> MAIN
  MAIN -->|refresh mỗi POLL_MS, nguồn list/act| PANEL["src/escalation-panel.ts<br/>panel HTML phủ góc phải canvas, thu gọn được;<br/>ghi chú + Đẩy lại/Merge/Đóng/Đánh dấu lỗi,<br/>xác nhận trong panel, khoá nút khi gửi"]
  PANEL --> TK
  PANEL --> OVERLAY[["#escalations trong .stage<br/>(phủ trên canvas)"]]
  MAIN -->|drawScene → SceneFigure[], sceneSize, resetActors, USAGE| IDX["src/scene/index.ts<br/>ghép cảnh, màn hình bàn theo screenFor,<br/>trả SceneFigure[] (vị trí đầu/chân, working)"]
  IDX -->|screenFor, readAgentActivity| ACTV
  MAIN -->|figures mỗi frame| OVL["src/overlay.ts<br/>canvas chữ phủ (pointer-events:none, DPR):<br/>bong bóng icon+text, error viền đỏ, stale mờ,<br/>chồng nhau thu về icon; thanh tiến độ done/total"]
  OVL --> ACTV
  OVL -->|BUBBLE| PAL
  OVL --> TXT[["canvas .activity-overlay<br/>phủ trên #office, dưới #escalations"]]
  MAIN -->|figures mỗi frame| TIP["src/agent-tooltip.ts (+ .css)<br/>hitFigure (thuần), tooltip DOM cạnh con trỏ;<br/>chạm để mở/đóng; ticket, vai trò, 5 recent, task, stats"]
  TIP --> ACTV

  IDX --> LAYOUT["layout.ts<br/>bố cục phòng, bàn, cửa, chỗ ngồi, usageBoard (thuần)"]
  IDX -->|parseUsage| USG
  IDX --> BOARD["usage-board.ts<br/>thanh hạn mức 5H/WK, %, ? + gói"]
  BOARD --> USG
  BOARD --> PAL
  BOARD --> FONT
  BOARD --> PIX
  IDX --> ACT["actors.ts<br/>agent đi vào/ra, rebase/turn, actorPose<br/>bất biến: seated ⇔ cuối path = ghế hiện tại"]
  ACT --> LAYOUT
  ACT --> PATH["pathing.ts<br/>đường đi, vị trí theo thời gian (thuần)"]
  ACT -->|agentLook| CHAR
  IDX --> TILES["tiles.ts<br/>sàn, tường, cửa"]
  IDX --> FURN["furniture.ts<br/>bàn, ghế, sofa, biển tên, biển đếm ngược;<br/>màn hình code/terminal/browser/search/read/cursor/off"]
  FURN -->|shortCountdown| USG
  FURN -->|SCREEN| PAL
  IDX -->|drawWalker, drawSeatedBack,<br/>drawSofaSitter, drawSleeper, residentLook| CHAR["characters.ts<br/>chọn tư thế, chồng lớp thân→tóc→phụ kiện,<br/>thay khoá màu theo Look"]

  ART[("art/characters/*.pixel.json<br/>body, hair/style0-3, acc/role")] -->|import.meta.glob lúc build| CHAR
  CHAR -->|công thức + bộ màu| PB["pixelbolt.ts<br/>đọc palette, frames grid/from, animations<br/>từ chối frame hỏng → fallback"]
  CHAR -->|tư thế thiếu hoặc hỏng| LEG["legacy-characters.ts<br/>sprite lưới ký tự cũ"]
  CHAR --> PAL["palette.ts<br/>màu provider, vai trò + accent, da, tóc, USAGE,<br/>SCREEN, BUBBLE"]
  PB --> PIX["pixel.ts<br/>drawGrid, cached bitmap, shade"]
  LEG --> PIX
  CHAR --> PIX
  CHAR --> FONT["font.ts<br/>chữ pixel 3x5 (có % và ?)"]
  TILES --> PIX
  FURN --> PIX
  FURN --> FONT
  PIX -->|canvas offscreen| CANVAS[["canvas #office<br/>image-rendering: pixelated"]]

  subgraph Tests["npm test (vitest) — cổng cùng npm run build, chạy trong CI"]
    T_PATH["pathing.test.ts / layout.test.ts<br/>usageBoard không chồng đồ vật"]
    T_ACT["actors.test.ts<br/>kịch bản dữ liệu đổi giữa chừng"]
    T_PB["pixelbolt.test.ts / characters.test.ts<br/>công thức hỏng + mọi file art/"]
    T_USG["usage.test.ts<br/>ngưỡng màu, đếm ngược, usage hỏng, số liệu cũ"]
    T_FONT["font.test.ts<br/>glyph % và ?"]
    T_TK["tickets.test.ts<br/>lọc escalated, lý do mới nhất, nút bật/tắt,<br/>dựng request, lỗi 409/501, dữ liệu đổi giữa chừng"]
    T_ACTV["activity.test.ts<br/>thiếu trường, sai kiểu, kind lạ → other, screenFor,<br/>bubbleFor stale/error/cắt chữ, taskProgress,<br/>resolveBubbles, dữ liệu đổi giữa chừng, demo"]
    T_TIP["agent-tooltip.test.ts<br/>hitFigure trúng/trượt/chồng nhau"]
  end
  T_PATH -.-> PATH
  T_PATH -.-> LAYOUT
  T_ACT -.-> ACT
  T_PB -.-> PB
  T_PB -.-> CHAR
  T_PB -.-> ART
  T_USG -.-> USG
  T_FONT -.-> FONT
  T_TK -.-> TK
  T_ACTV -.-> ACTV
  T_TIP -.-> TIP
```
