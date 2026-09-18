import { describe, expect, it } from 'vitest'
import { toProcessNodeId } from './identifiers'
import { createLocalProcessConfigLoader, localProcessConfigDataset } from './local-process-config'

/** 本地燃气拓扑与正式发布清单共享“无外部状态时显示正常”的基线语义。 */
describe('本地工艺拓扑状态基线', () => {
  it('燃气总览所有节点初始为正常，外部状态在运行时另行覆盖', () => {
    const result = createLocalProcessConfigLoader().load('gas-overview')
    const nodes = result.bundle?.topology.nodes ?? []

    // 先锁定真实节点数量，避免空数组的 every（全部满足）产生误报。
    expect(nodes.length).toBeGreaterThan(0)
    expect(nodes.every((node) => node.deviceStatus === 'normal')).toBe(true)
  })

  it('燃气兼容配置使用带场景归属的当前拓扑名称', () => {
    const localNodes = createLocalProcessConfigLoader().load('gas-overview').bundle?.topology.nodes ?? []
    const localTitleByNodeId = new Map(localNodes.map((node) => [node.nodeId, node.title]))

    /**
     * 使用稳定 nodeId（节点标识）执行常数时间对照，不按数组位置或中文名称反查。
     * 对外发布清单的同组断言位于联合清单契约中，两侧共同锁定前缀和关键设备名称。
     */
    expect(localNodes).toHaveLength(23)
    expect(localNodes.every((node) => node.title.startsWith('燃气-'))).toBe(true)
    expect(localTitleByNodeId.get(toProcessNodeId('historian-data-server'))).toBe('燃气-历史服务器')
    expect(localTitleByNodeId.get(toProcessNodeId('asset.gas-generator'))).toBe('燃气-发电机')
    expect(localTitleByNodeId.get(toProcessNodeId('asset.gas-steam-turbine'))).toBe('燃气-蒸汽轮机')
  })

  it('光伏总览通过独立运行时键登记两个稳定业务节点', () => {
    const result = createLocalProcessConfigLoader().load('solar-overview')
    const mapping = localProcessConfigDataset.sceneMappings.find((item) => item.processId === 'solar-power-generation')

    expect(result.bundle?.page).toMatchObject({
      runtimeMode: 'webgl',
      runtimeKey: 'solar-plant-release',
      topologyKey: 'topology.solar-power.overview',
    })
    expect(mapping?.mappedNodeIds).toEqual([
      'system.solar-inverter-control',
      'asset.solar-inverter',
    ])
  })
})
