import type { ProcessNodeId } from '@/config/process/identifiers'
import { toProcessNodeId } from '@/config/process/identifiers'
import type { TopologyDeviceStatus } from '@/config/process/types'
import type { GasV3TopologyVariantId } from './gas-v3-topology-variant-manifest'

export interface GasV3TopologyRuntimeBinding {
  readonly penId: string
  readonly nodeId: ProcessNodeId
}

/** 将同一正式业务节点在一份输入文件中的多个视觉图元展开为不可变绑定项。 */
function bind(nodeId: string, penIds: readonly string[]): readonly GasV3TopologyRuntimeBinding[] {
  const processNodeId = toProcessNodeId(nodeId)
  return penIds.map((penId) => Object.freeze({ penId, nodeId: processNodeId }))
}

/**
 * 每份拓扑文件的图元编号完全独立，状态绑定也必须按版本隔离。
 * 这里只迁移现有正式燃气整图已确认的设备语义；镜像、企业应用、交换机和泛称服务器仍保持未绑定。
 */
export const GAS_V3_TOPOLOGY_RUNTIME_BINDINGS_BY_VARIANT_ID: ReadonlyMap<
  GasV3TopologyVariantId,
  readonly GasV3TopologyRuntimeBinding[]
> = new Map([
  ['architecture', Object.freeze([
    ...bind('enterprise-firewall', ['551a4c0f']),
    ...bind('dmz-industrial-firewall', ['20d61a7d']),
    ...bind('historian-data-server', ['27b095b']),
    ...bind('plant-engineering-station', ['aab866f']),
    ...bind('operator-station', ['7e7431e']),
    ...bind('system.gas-turbine-control', ['6fab81']),
    ...bind('asset.gas-turbine', ['2914be6f']),
    ...bind('system.gas-hrsg-control', ['b464ddd']),
    ...bind('asset.gas-hrsg', ['e1c5b75']),
    ...bind('system.gas-steam-turbine-control', ['a55fd3']),
    ...bind('asset.gas-steam-turbine', ['2f90ef43']),
    ...bind('system.gas-generator-control', ['d2d584']),
    ...bind('asset.gas-generator', ['b4ff8ef']),
    ...bind('fuel-gas-pressure-valve', ['5fe02726']),
  ])],
  ['network', Object.freeze([
    ...bind('enterprise-firewall', ['85e8b44']),
    ...bind('dmz-industrial-firewall', ['19b421ad']),
    ...bind('historian-data-server', ['f08823b']),
    ...bind('plant-engineering-station', ['e80b72', '3216388', '225d98f6', 'af6daa7']),
    ...bind('operator-station', ['7294f4b9', '6d96fffd', 'a59a4c1', '3788e4e']),
    ...bind('system.gas-turbine-control', ['161c5dc']),
    ...bind('system.gas-hrsg-control', ['4373e5de']),
    ...bind('system.gas-steam-turbine-control', ['851ac7b']),
    ...bind('system.gas-generator-control', ['2df72e66']),
    ...bind('fuel-gas-pressure-valve', ['46972bab']),
  ])],
  // 业务单层输入没有设备图片，按技能约束不新增圆点或角标，因此仅保留中央状态快照、不创建视觉绑定。
  ['business', Object.freeze([])],
  ['key-process', Object.freeze([
    ...bind('system.gas-turbine-control', ['808ce1']),
    ...bind('asset.gas-turbine', ['89bbc09']),
    ...bind('system.gas-hrsg-control', ['fda2e86']),
    ...bind('asset.gas-hrsg', ['2ccb9bc']),
    ...bind('system.gas-steam-turbine-control', ['5cc1b2bd']),
    ...bind('asset.gas-steam-turbine', ['428f679']),
    ...bind('system.gas-generator-control', ['ca0550f']),
    ...bind('asset.gas-generator', ['ef84ff0']),
    ...bind('fuel-gas-pressure-valve', ['39f3246c']),
  ])],
  // 2026-09-07 纠正文件：沿用燃气网络层已确认的业务映射，显式登记本文件的新图元编号。
  // 燃机、余热锅炉及调压控制恢复到各自中央状态节点；多台工作站仍同步同一已登记业务状态。
  ['network-business', Object.freeze([
    ...bind('enterprise-firewall', ['13b84357']),
    ...bind('dmz-industrial-firewall', ['2a17843f']),
    ...bind('historian-data-server', ['6974b354']),
    ...bind('plant-engineering-station', ['69b370e9', '68d2510', 'fcd4c1', 'd971830']),
    ...bind('operator-station', ['c2b04d2', '503af85f', '4d7640b9', '7d762fc']),
    ...bind('system.gas-turbine-control', ['1cff0ae6']),
    ...bind('system.gas-hrsg-control', ['4ffe660d']),
    ...bind('system.gas-steam-turbine-control', ['4026b99']),
    ...bind('system.gas-generator-control', ['3ea7f2e1']),
    ...bind('fuel-gas-pressure-valve', ['064d5de']),
  ])],
  ['network-key-process', Object.freeze([
    ...bind('enterprise-firewall', ['195812b']),
    ...bind('dmz-industrial-firewall', ['3afc0cd0']),
    ...bind('historian-data-server', ['015d99c']),
    ...bind('plant-engineering-station', ['494401c0', '25f3d3', 'd4832d', '7c951d2']),
    ...bind('operator-station', ['b4c7c53', '5c3b9e10', '933f520', 'aaf2ff6']),
    ...bind('system.gas-turbine-control', ['3a2b0d2']),
    ...bind('asset.gas-turbine', ['11c1d85']),
    ...bind('system.gas-hrsg-control', ['5fcf89d3']),
    ...bind('asset.gas-hrsg', ['e1700c']),
    ...bind('system.gas-steam-turbine-control', ['c12e50d']),
    ...bind('asset.gas-steam-turbine', ['95d696']),
    ...bind('system.gas-generator-control', ['6646a093']),
    ...bind('asset.gas-generator', ['038d860']),
    ...bind('fuel-gas-pressure-valve', ['a96940']),
  ])],
  ['business-key-process', Object.freeze([
    ...bind('system.gas-turbine-control', ['33721dd']),
    ...bind('asset.gas-turbine', ['48257df']),
    ...bind('system.gas-hrsg-control', ['4ef5ad7a']),
    ...bind('asset.gas-hrsg', ['b57087d']),
    ...bind('system.gas-steam-turbine-control', ['8be8ae0']),
    ...bind('asset.gas-steam-turbine', ['a0a83b9']),
    ...bind('system.gas-generator-control', ['ced7f5f']),
    ...bind('asset.gas-generator', ['fca8c37']),
    ...bind('fuel-gas-pressure-valve', ['f256a61']),
  ])],
  ['network-business-key-process', Object.freeze([
    ...bind('enterprise-firewall', ['9b794e1']),
    ...bind('dmz-industrial-firewall', ['567de6f7']),
    ...bind('historian-data-server', ['442e9a24']),
    ...bind('plant-engineering-station', ['7b5d6e17', 'f90c16e', '1ef83a1', '77916030']),
    ...bind('operator-station', ['64a4077', '716def7b', '83f2b7', '55b71536']),
    ...bind('system.gas-turbine-control', ['365d2986']),
    ...bind('asset.gas-turbine', ['868df1f']),
    ...bind('system.gas-hrsg-control', ['1b4e10a']),
    ...bind('asset.gas-hrsg', ['de9e321']),
    ...bind('system.gas-steam-turbine-control', ['4c65e23f']),
    ...bind('asset.gas-steam-turbine', ['0c51f9f']),
    ...bind('system.gas-generator-control', ['0f354e']),
    ...bind('asset.gas-generator', ['29b5edb2']),
    ...bind('fuel-gas-pressure-valve', ['65be935d']),
  ])],
  ['process-detail-gas-turbine', Object.freeze([
    // 关键环节中的燃机、压缩机和脱硝图元沿用现场设备层状态，不复用上层控制系统节点。
    ...bind('asset.gas-turbine', ['14d76d6', '35d969bb']),
    ...bind('asset.gas-hrsg', ['621bf39b']),
  ])],
])

/** 读取目标文件的绑定清单；找不到版本属于开发配置错误，不能回退到另一文件的图元编号。 */
export function getGasV3TopologyRuntimeBindings(
  variantId: GasV3TopologyVariantId,
): readonly GasV3TopologyRuntimeBinding[] {
  const bindings = GAS_V3_TOPOLOGY_RUNTIME_BINDINGS_BY_VARIANT_ID.get(variantId)
  if (!bindings) throw new Error(`燃气拓扑版本缺少运行时绑定：${variantId}`)
  return bindings
}

/** 单次构建正反索引，状态、二维选择和三维反向选择均按当前文件稳定编号常数时间读取。 */
export function createGasV3TopologyRuntimeBindingIndex(
  variantId: GasV3TopologyVariantId = 'network-business-key-process',
): {
  readonly nodeIdByPenId: ReadonlyMap<string, ProcessNodeId>
  readonly penIdsByNodeId: ReadonlyMap<ProcessNodeId, readonly string[]>
} {
  const nodeIdByPenId = new Map<string, ProcessNodeId>()
  const mutablePenIdsByNodeId = new Map<ProcessNodeId, string[]>()
  for (const binding of getGasV3TopologyRuntimeBindings(variantId)) {
    nodeIdByPenId.set(binding.penId, binding.nodeId)
    const penIds = mutablePenIdsByNodeId.get(binding.nodeId)
    if (penIds) penIds.push(binding.penId)
    else mutablePenIdsByNodeId.set(binding.nodeId, [binding.penId])
  }

  const penIdsByNodeId = new Map<ProcessNodeId, readonly string[]>()
  for (const [nodeId, penIds] of mutablePenIdsByNodeId) penIdsByNodeId.set(nodeId, Object.freeze(penIds))
  return { nodeIdByPenId, penIdsByNodeId }
}

/** 默认整图绑定导出仅用于兼容现有检查；运行时切层必须按版本读取绑定。 */
export const GAS_V3_TOPOLOGY_RUNTIME_BINDINGS = getGasV3TopologyRuntimeBindings('network-business-key-process')

/** 四态中文标签直接绑定平台状态协议，提示层和状态图片共用同一份定义。 */
export const GAS_V3_TOPOLOGY_STATUS_PRESENTATION: Readonly<Record<TopologyDeviceStatus, {
  readonly label: string
}>> = Object.freeze({
  normal: { label: '正常' },
  alarm: { label: '告警' },
  fault: { label: '故障' },
  offline: { label: '离线' },
})
