import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import { router } from '@/router'
import { installRouteGuards } from '@/router/guards'
import { useAppStore } from '@/stores/app.store'
import '@/styles/index.css'

/**
 * 创建全局依赖并在挂载前完成路由守卫注册。
 * 主题仅保存为可序列化状态，DOM 属性由此处单向同步，避免状态仓库持有浏览器对象。
 */
const app = createApp(App)
const pinia = createPinia()
const appStore = useAppStore(pinia)

watch(
  () => appStore.theme,
  (theme) => {
    document.documentElement.dataset.theme = theme
  },
  { immediate: true },
)

installRouteGuards(router, pinia)
app.use(pinia)
app.use(router)
app.mount('#app')
