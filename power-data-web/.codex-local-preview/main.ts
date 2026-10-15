import { createApp, defineComponent, h } from 'vue'
import BusinessSceneTopologyJsonPreview from '@/modules/visual/topology-preview/BusinessSceneTopologyJsonPreview.vue'

/** 临时本地查看入口复用正式配电站拓扑组件，绕开独立打包缺少宿主页和 Unity 的限制。 */
const LocalDistributionTopologyPreview = defineComponent({
  name: 'LocalDistributionTopologyPreview',
  setup: () => () => h('main', { style: 'width:100vw;height:100vh' }, [
    h(BusinessSceneTopologyJsonPreview, { sceneId: 'distribution' }),
  ]),
})

createApp(LocalDistributionTopologyPreview).mount('#app')
