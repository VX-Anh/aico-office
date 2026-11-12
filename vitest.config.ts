import { defineConfig } from "vitest/config";

// Test chạy trên Node: chỉ kiểm hàm thuần và bộ đọc công thức, không cần canvas.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // repo-rules.test.ts đọc chữ của CSS qua ?raw; mặc định vitest thay mọi file CSS bằng chuỗi rỗng.
    css: true,
  },
});
