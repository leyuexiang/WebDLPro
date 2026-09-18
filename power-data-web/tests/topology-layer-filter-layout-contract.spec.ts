import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const basePath = `${process.cwd()}/src/modules/visual/topology-preview`

/** 公共组件锁定所有当前及后续拓扑的右侧单列筛选轨默认外观。 */
describe('公共拓扑筛选轨布局', () => {
  const railSource = readFileSync(`${basePath}/TopologyLayerFilterRail.vue`, 'utf8')

  it('筛选器固定在右侧且完整文字逐字向下排列', () => {
    expect(railSource).toContain('position: absolute;')
    expect(railSource).toContain('inset-inline-end: 8px;')
    expect(railSource).toContain('inline-size: 15px;')
    expect(railSource).toContain('>筛选框</span>')
    expect(railSource).toContain('{{ option.label }}')
    expect(railSource).toContain('overflow-wrap: anywhere;')
    expect(railSource).not.toContain('option.label.slice(0, 1)')
  })

  it.each(['GasV3TopologyLayerFilter.vue', 'CoalTopologyLayerFilter.vue'])('%s 只保留业务类型包装', (filter) => {
    const filterSource = readFileSync(`${basePath}/${filter}`, 'utf8')
    expect(filterSource).toContain("import TopologyLayerFilterRail from './TopologyLayerFilterRail.vue'")
    expect(filterSource).toContain('<TopologyLayerFilterRail')
    expect(filterSource).not.toContain('<style')
  })
})

/** 正式燃气第三版和燃煤入口都必须把完整高度交给画布，防止公共筛选轨再次进入布局流。 */
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

  it('第三层隐藏并禁用筛选，退出后恢复第二层筛选', () => {
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
