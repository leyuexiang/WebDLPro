import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import { router } from '@/router'
import '@/styles/index.css'

/**
 * 仅注册嵌入式可视化壳当前仍需使用的依赖。
 *
 * Pinia（状态管理）暂时保留：现有燃气工艺面板仍通过工艺上下文存储状态。
 * 已移除旧门户主题同步与路由守卫注册，防止嵌入页继续加载权限、主题和门户配置职责。
 */
const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.mount('#app')
