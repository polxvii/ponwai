// defineConfig จาก vitest/config เพื่อให้ key `test` มี type — ของ vite เปล่าไม่รู้จัก
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // TV-28 รัน 1,000 ชุดต่อ assertion ใช้เวลาหลักวินาที default 5s ไม่พอ
    testTimeout: 30_000,
  },
})
