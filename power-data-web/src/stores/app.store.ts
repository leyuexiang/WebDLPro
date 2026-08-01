import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ThemeMode = 'light' | 'dark'

/**
 * 仅管理跨布局的可序列化界面状态。
 * 组件展开状态可被导航复用；浏览器监听器、图表和网页图形资源不允许存入这里。
 */
export const useAppStore = defineStore('app', () => {
  const theme = ref<ThemeMode>('light')
  const isNavigationCollapsed = ref(false)

  /** 在两套令牌主题之间切换，不直接写入 DOM。 */
  function toggleTheme(): void {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
  }

  /** 仅改变可序列化导航状态，实际样式由布局组件根据状态响应式渲染。 */
  function toggleNavigation(): void {
    isNavigationCollapsed.value = !isNavigationCollapsed.value
  }

  return {
    theme,
    isNavigationCollapsed,
    toggleTheme,
    toggleNavigation,
  }
})
