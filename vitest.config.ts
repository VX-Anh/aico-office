import { defineConfig } from "vitest/config";

// Test chạy trên Node: chỉ kiểm hàm thuần và bộ đọc công thức, không cần canvas.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
