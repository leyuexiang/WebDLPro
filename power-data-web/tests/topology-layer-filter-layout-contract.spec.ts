import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COAL_DEFAULT_TOPOLOGY_VARIANT } from '../src/modules/visual/topology-preview/coal-topology-variant-manifest'
import { CONVERTER_STATION_DEFAULT_TOPOLOGY_VARIANT } from '../src/modules/visual/topology-preview/converter-station-topology-variant-manifest'
import {
  BUSINESS_SCENE_TOPOLOGY_SCENE_IDS,
  BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE,
  getBusinessSceneTopologyPreviewProfile,
} from '../src/modules/visual/topology-preview/business-scene-topology'
import { GAS_V3_DEFAULT_TOPOLOGY_VARIANT } from '../src/modules/visual/topology-preview/gas-v3-topology-variant-manifest'
import { SOLAR_DEFAULT_TOPOLOGY_VARIANT } from '../src/modules/visual/topology-preview/solar-topology-variant-manifest'
import { STEP_DOWN_SUBSTATION_DEFAULT_TOPOLOGY_VARIANT } from '../src/modules/visual/topology-preview/step-down-substation-topology-variant-manifest'
import { STEP_UP_SUBSTATION_DEFAULT_TOPOLOGY_VARIANT } from '../src/modules/visual/topology-preview/step-up-substation-topology-variant-manifest'
import { SWITCHING_STATION_DEFAULT_TOPOLOGY_VARIANT } from '../src/modules/visual/topology-preview/switching-station-topology-variant-manifest'
import { WIND_DEFAULT_TOPOLOGY_VARIANT } from '../src/modules/visual/topology-preview/wind-topology-variant-manifest'

const basePath = `${process.cwd()}/src/modules/visual/topology-preview`

/** 汇总所有当前第二层拓扑入口，直接检查默认条目而不是依赖组合名称推断层级内容。 */
const defaultTopologyVariants = [
  ['燃气', GAS_V3_DEFAULT_TOPOLOGY_VARIANT],
  ['燃煤', COAL_DEFAULT_TOPOLOGY_VARIANT],
  ['风电', WIND_DEFAULT_TOPOLOGY_VARIANT],
  ['光伏', SOLAR_DEFAULT_TOPOLOGY_VARIANT],
  ['换流站', CONVERTER_STATION_DEFAULT_TOPOLOGY_VARIANT],
  ['升压站', STEP_UP_SUBSTATION_DEFAULT_TOPOLOGY_VARIANT],
  ['降压站', STEP_DOWN_SUBSTATION_DEFAULT_TOPOLOGY_VARIANT],
  ['开关站', SWITCHING_STATION_DEFAULT_TOPOLOGY_VARIANT],
  ...BUSINESS_SCENE_TOPOLOGY_SCENE_IDS.map((sceneId) => {
    const profile = getBusinessSceneTopologyPreviewProfile(sceneId)
    const variant = BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE[sceneId].find(({ id }) => id === profile.defaultVariantId)
    if (!variant) throw new Error(`${sceneId} 默认拓扑没有对应的组合清单项。`)
    return [sceneId, variant] as const
  }),
]

/** 所有当前第二层实现都移除筛选轨的旧视口避让量，完整使用画布宽度。 */
const fullCanvasFitSources = [
  'GasV3TopologyJsonPreview.vue',
  'GasV3TopologyRuntimeCanvas.vue',
  'CoalTopologyJsonPreview.vue',
  'CoalTopologyRuntimeCanvas.vue',
  'SolarTopologyJsonPreview.vue',
  'ManifestTopologyJsonPreview.vue',
] as const

/** 公共组件默认收起筛选面板并保留贴边按钮，画布使用清单中的组合默认项。 */
describe('公共拓扑默认展示与筛选框', () => {
  const railSource = readFileSync(`${basePath}/TopologyLayerFilterRail.vue`, 'utf8')

  it('面板默认收起并从辅助技术树隔离，筛选面板与按钮共用画布右边界', () => {
    expect(railSource).toContain('const isExpanded = ref(false)')
    expect(railSource).toContain(':aria-hidden="!isExpanded"')
    expect(railSource).toContain(':inert="!isExpanded"')

    const railRule = railSource.match(/\.topology-layer-filter-rail\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(railRule).toContain('visibility: hidden')
    expect(railRule).toContain('pointer-events: none')

    const drawerRule = railSource.match(/\.topology-layer-filter-drawer\s*\{([^}]*)\}/s)?.[1] ?? ''
    const toggleRule = railSource.match(/\.topology-layer-filter-drawer__toggle\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(drawerRule).toContain('right: 0')
    expect(drawerRule).toContain('flex-direction: column')
    expect(drawerRule).toContain('gap: 8px')
    expect(toggleRule).toContain('right: 0')
  })

  it.each(defaultTopologyVariants)('%s 首屏固定加载网络层、业务层和关键环节层组合', (_scene, variant) => {
    expect(variant.id).toBe('network-business-key-process')
    expect(variant.combinationKey).toBe('network+business+key-process')
    expect(variant.layerIds).toEqual(['network', 'business', 'key-process'])
  })

  it.each(fullCanvasFitSources)('%s 不为可收起的筛选框保留右侧空白', (file) => {
    const source = readFileSync(`${basePath}/${file}`, 'utf8')
    expect(source).toContain('meta2d.fitView(true, [0, 0, 0, 0])')
    expect(source).not.toContain('meta2d.fitView(true, [0, 24, 0, 0])')
    expect(source).not.toContain('meta2d.translate(-12 / (meta2d.store.data.scale || 1), 0)')
  })

  it.each(['GasV3TopologyLayerFilter.vue', 'CoalTopologyLayerFilter.vue'])('%s 只保留业务类型包装', (filter) => {
    const filterSource = readFileSync(`${basePath}/${filter}`, 'utf8')
    expect(filterSource).toContain("import TopologyLayerFilterRail from './TopologyLayerFilterRail.vue'")
    expect(filterSource).toContain('<TopologyLayerFilterRail')
    expect(filterSource).not.toContain('<style')
  })
})

/** 正式燃气第三版和燃煤入口都必须把完整高度交给画布，不受公共筛选框显示状态影响。 */
describe.each([
  {
    kind: '燃气第三版',
    runtime: 'GasV3TopologyRuntimeCanvas.vue',
    preview: 'GasV3TopologyJsonPreview.vue',
    filterComponent: 'GasV3TopologyLayerFilter',
  },
  {
    kind: '燃煤',
    runtime: 'CoalTopologyRuntimeCanvas.vue',
    preview: 'CoalTopologyJsonPreview.vue',
    filterComponent: 'CoalTopologyLayerFilter',
  },
  {
    kind: '光伏',
    // 光伏独立预览同时承担正式运行画布职责，仍只创建一个二维组态引擎实例。
    runtime: 'SolarTopologyJsonPreview.vue',
    preview: 'SolarTopologyJsonPreview.vue',
    filterComponent: 'SolarTopologyLayerFilter',
  },
])('$kind拓扑画布布局', ({ runtime, preview, filterComponent }) => {
  it('正式运行与独立预览均把完整高度交给拓扑画布', () => {
    const runtimeSource = readFileSync(`${basePath}/${runtime}`, 'utf8')
    const previewSource = readFileSync(`${basePath}/${preview}`, 'utf8')
    expect(runtimeSource).toContain('grid-template-rows: minmax(0, 1fr);')
    expect(previewSource).toContain('grid-template-rows: minmax(0, 1fr);')
  })

  it('第三层切换仍短路筛选事件，并保留离开前的第二层组合状态', () => {
    // 统一换行符后再做静态契约匹配，避免 Windows 工作区的 CRLF 与 Linux CI 的 LF 造成无意义红测。
    const runtimeSource = readFileSync(`${basePath}/${runtime}`, 'utf8').replace(/\r\n/g, '\n')
    expect(runtimeSource).toContain('const processDetailContextActive = ref(false)')
    expect(runtimeSource).toContain('processDetailContextActive.value = true')
    expect(runtimeSource).toContain('processDetailContextActive.value = false')
    expect(runtimeSource).toContain('if (processDetailContextActive.value) return')
    // 不锁死模板缩进，只要求筛选组件本身携带第三层隐藏条件。
    expect(runtimeSource).toMatch(new RegExp(`<${filterComponent}\\s+v-if="!processDetailContextActive"`))
  })
})
