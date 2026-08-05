import { describe, expect, it } from 'vitest'
import { toProcessNodeId, toRouteId, toTopologyKey } from '@/config/process/identifiers'
import type { TopologyDefinition } from '@/config/process/types'
import { createTopologyPanelPresentation } from '@/modules/visual/components/topology-panel-presentation'

/** 夹具使用非燃气名称，证明面板标题、图例和状态完全来自拓扑配置。 */
function createTopology(overrides: Partial<TopologyDefinition> = {}): TopologyDefinition {
  return {
    topologyKey: toTopologyKey('topology.wind.overview'),
    title: '风电场控制拓扑',
    configVersion: '2026.08.04.1' as never,
    nodes: [
      { nodeId: toProcessNodeId('wind-controller'), title: '风机控制器', x: 30, y: 40, iconKey: 'plc', deviceStatus: 'normal', metricKeys: [] },
      { nodeId: toProcessNodeId('wind-inverter'), title: '变流器', x: 70, y: 40, iconKey: 'plc', deviceStatus: 'alarm', metricKeys: [] },
    ],
    edges: [
      { edgeId: toRouteId('route.wind-control'), fromNodeId: toProcessNodeId('wind-controller'), toNodeId: toProcessNodeId('wind-inverter'), title: '控制链路', evidenceStatus: 'verified', sceneRouteIds: [] },
      { edgeId: toRouteId('route.wind-telemetry'), fromNodeId: toProcessNodeId('wind-inverter'), toNodeId: toProcessNodeId('wind-controller'), title: '遥测链路', evidenceStatus: 'pending-confirmation', sceneRouteIds: [] },
    ],
    ...overrides,
  }
}

describe('拓扑面板展示模型', () => {
  it('从当前拓扑配置读取标题、已声明图例和设备状态，不依赖燃气固定文本', () => {
    const presentation = createTopologyPanelPresentation(createTopology())

    expect(presentation.title).toBe('风电场控制拓扑')
    expect(presentation.legends.map((legend) => legend.label)).toEqual(['已确认', '待确认'])
    expect(presentation.statusSummary).toContain('正常 1')
    expect(presentation.statusSummary).toContain('告警 1')
    expect(presentation.statusSummary).not.toContain('燃气')
  })

  it('空拓扑保留配置标题并显示不猜测结构的明确状态', () => {
    const presentation = createTopologyPanelPresentation(createTopology({ title: '配电网概览', nodes: [], edges: [] }))

    expect(presentation).toMatchObject({ title: '配电网概览', legends: [], isEmpty: true })
    expect(presentation.statusSummary).toContain('不会根据页面名称')
  })

  it('运行时节点状态快照只覆盖已声明节点，缺失快照值回退到拓扑配置基线', () => {
    const topology = createTopology()
    const presentation = createTopologyPanelPresentation(topology, new Map([
      [toProcessNodeId('wind-controller'), 'fault' as const],
    ]))

    expect(presentation.statusSummary).toContain('正常 0')
    expect(presentation.statusSummary).toContain('告警 1')
    expect(presentation.statusSummary).toContain('故障 1')
  })

  it('任意拓扑均按固定顺序呈现四态和已声明的四类连线证据，不复制场景专用组件', () => {
    const presentation = createTopologyPanelPresentation(createTopology({
      title: '微电网自治控制拓扑',
      nodes: [
        { nodeId: toProcessNodeId('microgrid-normal'), title: '正常节点', x: 10, y: 10, iconKey: 'plc', deviceStatus: 'normal', metricKeys: [] },
        { nodeId: toProcessNodeId('microgrid-alarm'), title: '告警节点', x: 30, y: 30, iconKey: 'plc', deviceStatus: 'alarm', metricKeys: [] },
        { nodeId: toProcessNodeId('microgrid-fault'), title: '故障节点', x: 50, y: 50, iconKey: 'plc', deviceStatus: 'fault', metricKeys: [] },
        { nodeId: toProcessNodeId('microgrid-offline'), title: '离线节点', x: 70, y: 70, iconKey: 'plc', deviceStatus: 'offline', metricKeys: [] },
      ],
      edges: [
        { edgeId: toRouteId('route.microgrid-verified'), fromNodeId: toProcessNodeId('microgrid-normal'), toNodeId: toProcessNodeId('microgrid-alarm'), title: '已确认链路', evidenceStatus: 'verified', sceneRouteIds: [] },
        { edgeId: toRouteId('route.microgrid-pending'), fromNodeId: toProcessNodeId('microgrid-alarm'), toNodeId: toProcessNodeId('microgrid-fault'), title: '待确认链路', evidenceStatus: 'pending-confirmation', sceneRouteIds: [] },
        { edgeId: toRouteId('route.microgrid-conceptual'), fromNodeId: toProcessNodeId('microgrid-fault'), toNodeId: toProcessNodeId('microgrid-offline'), title: '概念链路', evidenceStatus: 'conceptual', sceneRouteIds: [] },
        { edgeId: toRouteId('route.microgrid-unclassified'), fromNodeId: toProcessNodeId('microgrid-offline'), toNodeId: toProcessNodeId('microgrid-normal'), title: '未分类链路', evidenceStatus: 'unclassified', sceneRouteIds: [] },
      ],
    }))

    expect(presentation.title).toBe('微电网自治控制拓扑')
    expect(presentation.legends.map((legend) => legend.label)).toEqual(['已确认', '待确认', '概念连接', '未分类关系'])
    expect(presentation.statusSummary).toContain('正常 1，告警 1，故障 1，离线 1')
  })

  it('空白配置标题只降级为通用标题，不回退到任一业务场景名称', () => {
    const presentation = createTopologyPanelPresentation(createTopology({ title: '   ', nodes: [], edges: [] }))

    expect(presentation.title).toBe('未命名拓扑')
    expect(presentation.title).not.toContain('燃气')
    expect(presentation.title).not.toContain('风电')
  })
})
