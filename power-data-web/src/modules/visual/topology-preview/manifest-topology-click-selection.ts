import type { LockState, Pen } from '@meta2d/core'
import type { ProcessNodeId } from '@/config/process/identifiers'

const DISABLED_PEN_LOCK = 10 as LockState

/** 可选中图元仍可能没有业务节点编号；三维映射缺失不改变二维命中结果。 */
export type ManifestTopologyClickSelection =
  | { readonly kind: 'select'; readonly pen: Pen; readonly nodeId?: ProcessNodeId }
  | { readonly kind: 'clear' }

/**
 * 按图元只读锁定状态区分节点点击和空白/连线点击，再独立查找业务节点映射。
 * 选择策略标为 Disable（禁用）的背景和连线按空白点击处理；其他已开放命中的图元即使没有 nodeId，
 * 仍作为拓扑选择返回给统一事件链路，由三维聚焦协调器处理缺少三维绑定的情况。
 */
export function resolveManifestTopologyClickSelection(
  pen: Pen | undefined,
  nodeIdByPenId: ReadonlyMap<string, ProcessNodeId>,
): ManifestTopologyClickSelection {
  if (!pen?.id || pen.name === 'line' || pen.locked === DISABLED_PEN_LOCK) return { kind: 'clear' }

  const nodeId = nodeIdByPenId.get(pen.id)
  return nodeId ? { kind: 'select', pen, nodeId } : { kind: 'select', pen }
}
