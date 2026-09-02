import type { ProcessNodeId } from '@/config/process/identifiers'
import { toProcessNodeId } from '@/config/process/identifiers'
import type { TopologyDeviceStatus } from '@/config/process/types'

export interface GasTopologyRuntimeBinding {
  readonly penId: string
  readonly nodeId: ProcessNodeId
}

/**
 * 新版燃气图纸中的图片图元与正式场景清单节点之间的显式绑定。
 *
 * 图纸的 penId（图元标识）由组态编辑器生成，正式 nodeId（节点标识）由外层状态协议和
 * Unity（三维引擎）映射共同使用，两者不能按标题、坐标或图片地址自动推断。当前仅登记
 * 与正式燃气节点语义明确对应的图元；没有明确对应关系的企业应用、镜像服务器及辅助设备
 * 继续只负责展示。这里的二维绑定不等于三维映射，三维聚焦仍由正式清单的 sceneNodeId
 *（三维场景节点标识）单独控制。
 */
export const GAS_TOPOLOGY_RUNTIME_BINDINGS = Object.freeze([
  // 企业网络与生产隔离区中语义明确的新版图元。
  { penId: '2b71305', nodeId: toProcessNodeId('enterprise-firewall') },
  { penId: '388a6870', nodeId: toProcessNodeId('dmz-industrial-firewall') },
  // 新图纸将同一历史数据服务节点绘制为七台服务器，全部复用旧版正式业务节点。
  { penId: '45518ad8', nodeId: toProcessNodeId('historian-data-server') },
  { penId: '19742cc7', nodeId: toProcessNodeId('historian-data-server') },
  { penId: '335edd99', nodeId: toProcessNodeId('historian-data-server') },
  { penId: '63cffbbf', nodeId: toProcessNodeId('historian-data-server') },
  { penId: '54cf46d9', nodeId: toProcessNodeId('historian-data-server') },
  { penId: 'f16e288', nodeId: toProcessNodeId('historian-data-server') },
  { penId: '3459bcf4', nodeId: toProcessNodeId('historian-data-server') },
  // 工程师站和操作员站同样按图纸实例逐一登记，避免运行时按文字或坐标推断。
  { penId: '45cf2261', nodeId: toProcessNodeId('plant-engineering-station') },
  { penId: '4e4b985a', nodeId: toProcessNodeId('plant-engineering-station') },
  { penId: 'fd434d7', nodeId: toProcessNodeId('plant-engineering-station') },
  { penId: '5711e3e4', nodeId: toProcessNodeId('plant-engineering-station') },
  { penId: '420c522d', nodeId: toProcessNodeId('plant-engineering-station') },
  { penId: '3fe42fc', nodeId: toProcessNodeId('plant-engineering-station') },
  { penId: '5f3c5f1c', nodeId: toProcessNodeId('plant-engineering-station') },
  { penId: '162b8a', nodeId: toProcessNodeId('operator-station') },
  { penId: '3650f7f5', nodeId: toProcessNodeId('operator-station') },
  { penId: '3fdbe5f9', nodeId: toProcessNodeId('operator-station') },
  { penId: '26eb7936', nodeId: toProcessNodeId('operator-station') },
  { penId: 'ee99dba', nodeId: toProcessNodeId('operator-station') },
  { penId: '43f27ae8', nodeId: toProcessNodeId('operator-station') },
  { penId: 'ea88a62', nodeId: toProcessNodeId('operator-station') },
  // 这三项是项目现有资料已核验的二维—三维对应关系，三维聚焦可安全复用。
  { penId: 'efdfac7', nodeId: toProcessNodeId('inlet-duct') },
  { penId: '75426ac5', nodeId: toProcessNodeId('inlet-duct') },
  { penId: '369a5871', nodeId: toProcessNodeId('hrsg') },
  { penId: '1c78393', nodeId: toProcessNodeId('hrsg') },
  { penId: 'ed5e92c', nodeId: toProcessNodeId('steam-turbine') },
  { penId: '533cd1cf', nodeId: toProcessNodeId('steam-turbine') },
  // 发电机控制相关图元已有正式二维节点；项目当前没有该节点的三维聚焦登记。
  { penId: '17723a9e', nodeId: toProcessNodeId('generator') },
  { penId: '782a7b2e', nodeId: toProcessNodeId('generator') },
  { penId: 'c154b27', nodeId: toProcessNodeId('fuel-gas-pressure-valve') },
] satisfies readonly GasTopologyRuntimeBinding[])

/** 单次构建正反索引，悬浮和点击均保持常数时间，不在新版图片图元中重复扫描。 */
export function createGasTopologyRuntimeBindingIndex(): {
  readonly nodeIdByPenId: ReadonlyMap<string, ProcessNodeId>
  readonly penIdsByNodeId: ReadonlyMap<ProcessNodeId, readonly string[]>
} {
  const nodeIdByPenId = new Map<string, ProcessNodeId>()
  const mutablePenIdsByNodeId = new Map<ProcessNodeId, string[]>()

  for (const binding of GAS_TOPOLOGY_RUNTIME_BINDINGS) {
    nodeIdByPenId.set(binding.penId, binding.nodeId)
    const penIds = mutablePenIdsByNodeId.get(binding.nodeId)
    if (penIds) penIds.push(binding.penId)
    else mutablePenIdsByNodeId.set(binding.nodeId, [binding.penId])
  }

  const penIdsByNodeId = new Map<ProcessNodeId, readonly string[]>()
  for (const [nodeId, penIds] of mutablePenIdsByNodeId) penIdsByNodeId.set(nodeId, Object.freeze(penIds))
  return { nodeIdByPenId, penIdsByNodeId }
}

/** 四态中文标签供悬浮提示复用；画布视觉状态由对应的四组动态图直接表达。 */
export const GAS_TOPOLOGY_STATUS_PRESENTATION: Readonly<Record<TopologyDeviceStatus, {
  readonly label: string
}>> = Object.freeze({
  normal: { label: '正常' },
  alarm: { label: '告警' },
  fault: { label: '故障' },
  offline: { label: '离线' },
})
