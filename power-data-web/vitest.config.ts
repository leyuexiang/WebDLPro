import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

/**
 * 单元测试与构建共用 Vue 转换与路径别名，保证测试导入路径和生产代码完全一致。
 * 浏览器源码测试保留在 src，Node（服务端 JavaScript 运行时）发布命令测试放在 tests，
 * 避免命令行类型声明进入浏览器应用的类型检查范围。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
  },
})
