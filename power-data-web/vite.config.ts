import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 统一开发与生产构建配置。
 * 路径别名只服务源码引用，避免业务模块通过相对路径跨越分层边界。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 仅拆分当前仍使用的 Vue、路由和状态管理运行时，图表运行时随旧模块一并移除。
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 基于模块路径拆包，避免与构建工具版本相关的对象配置类型产生耦合。
          if (id.includes('node_modules/vue/') || id.includes('node_modules/vue-router/') || id.includes('node_modules/pinia/')) {
            return 'framework-runtime'
          }
          return undefined
        },
      },
    },
  },
})
