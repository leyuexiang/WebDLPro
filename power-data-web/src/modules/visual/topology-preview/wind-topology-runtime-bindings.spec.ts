import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Pen } from '@meta2d/core'
import { describe, expect, it } from 'vitest'
import type { WindTopologyVariantId } from './wind-topology-variant-manifest'
import { getWindTopologyRuntimeBindings } from './wind-topology-runtime-bindings'

/** 风电仅允许五个设备系统进入二维—三维绑定；控制层节点仍由 JSON 绘制但不登记映射。 */
const WIND_SYSTEMS = Object.freeze({
  pitchSystem: Object.freeze({ nodeId: 'asset.wind-pitch-system', sceneNodeId: 'node.wind-pitch-system', title: '变桨系统' }),
  converterSystem: Object.freeze({ nodeId: 'asset.wind-converter-system', sceneNodeId: 'node.wind-converter-system', title: '变流系统' }),
  yawSystem: Object.freeze({ nodeId: 'asset.wind-yaw-system', sceneNodeId: 'node.wind-yaw-system', title: '偏航系统' }),
  drivetrainSystem: Object.freeze({ nodeId: 'asset.wind-drivetrain-system', sceneNodeId: 'node.wind-drivetrain-system', title: '传动系统' }),
  brakeSystem: Object.freeze({ nodeId: 'asset.wind-brake-system', sceneNodeId: 'node.wind-brake-system', title: '刹车系统' }),
})

type WindSystemKey = keyof typeof WIND_SYSTEMS

/** 每个筛选文件只锁定其中真实存在的系统文字，不复用控制层图元编号。 */
const EXPECTED_PEN_IDS_BY_VARIANT: Readonly<Record<WindTopologyVariantId, Partial<Record<WindSystemKey, readonly string[]>>>> = Object.freeze({
  architecture: {
    drivetrainSystem: ['eca11c6'],
    brakeSystem: ['3518b49'],
  },
  network: {
    drivetrainSystem: ['6d463462', '7100f20'],
    brakeSystem: ['4e4e4b', '779c4bd9'],
  },
  business: {},
  'key-process': {
    drivetrainSystem: ['6bd3ecb9', '6ae5e42'],
    brakeSystem: ['7241f93e', '3790242'],
  },
  'network-business': {
    drivetrainSystem: ['ec6a59e', '5d39b66f'],
    brakeSystem: ['4a75cf4', '17d8b5c'],
  },
  'network-key-process': {
    drivetrainSystem: ['4d331569', '82b105'],
    brakeSystem: ['777e94bc', '40eac465'],
  },
  'business-key-process': {
    drivetrainSystem: ['8d7675b', '17cee71'],
    brakeSystem: ['ccca65e', '7e8936'],
  },
  'network-business-key-process': {
    pitchSystem: ['87f441c', 'd4ab511'],
    converterSystem: ['4996538', '5e9d380'],
    yawSystem: ['44940c8', 'a89f0ae'],
    drivetrainSystem: ['52b0990b', '5fbd69f'],
    brakeSystem: ['9331d40', '828058d'],
  },
})

/** 读取相同筛选版本的源 JSON，证明绑定目标确实对应其文件中的指定系统文字。 */
function readVariantPens(variantId: WindTopologyVariantId): readonly Pen[] {
  const topologyPath = resolve(process.cwd(), 'public/topology/wind-json-preview', `variants/${variantId}/topology.json`)
  return (JSON.parse(readFileSync(topologyPath, 'utf8')) as { pens: Pen[] }).pens
}

/** 把期望图元表转换成运行时绑定结构，并按图元编号排序以隔离对象声明顺序。 */
function expectedBindingsForVariant(variantId: WindTopologyVariantId) {
  const pensBySystem = EXPECTED_PEN_IDS_BY_VARIANT[variantId]
  return (Object.keys(pensBySystem) as WindSystemKey[])
    .flatMap((systemKey) => (pensBySystem[systemKey] ?? []).map((penId) => ({
      penId,
      nodeId: WIND_SYSTEMS[systemKey].nodeId,
      sceneNodeId: WIND_SYSTEMS[systemKey].sceneNodeId,
    })))
    .sort((left, right) => left.penId.localeCompare(right.penId))
}

describe('风电 JSON 拓扑设备系统映射', () => {
  it.each(Object.keys(EXPECTED_PEN_IDS_BY_VARIANT) as WindTopologyVariantId[])(
    '%s 只绑定该 JSON 中真实存在的设备系统图元',
    (variantId) => {
      const bindings = getWindTopologyRuntimeBindings(variantId)
      const actual = [...bindings].sort((left, right) => left.penId.localeCompare(right.penId))
      const pensById = new Map(readVariantPens(variantId).map((pen) => [pen.id, pen]))

      expect(actual).toEqual(expectedBindingsForVariant(variantId))
      expect(actual.every((binding) => binding.nodeId.startsWith('asset.wind-') && binding.sceneNodeId.startsWith('node.wind-'))).toBe(true)
      for (const binding of actual) {
        const system = Object.values(WIND_SYSTEMS).find((candidate) => candidate.nodeId === binding.nodeId)
        const pen = pensById.get(binding.penId)
        expect(system).toBeDefined()
        expect(pen?.text?.replace(/\s+/g, '')).toBe(system?.title)
      }
    },
  )

  it('默认组合只登记五个设备系统，不再绑定五个控制层节点', () => {
    const bindings = getWindTopologyRuntimeBindings('network-business-key-process')
    const uniqueNodeIds = new Set(bindings.map((binding) => binding.nodeId))
    const uniqueSceneNodeIds = new Set(bindings.map((binding) => binding.sceneNodeId))

    expect(bindings).toHaveLength(10)
    expect(uniqueNodeIds).toEqual(new Set(Object.values(WIND_SYSTEMS).map((system) => system.nodeId)))
    expect(uniqueSceneNodeIds).toEqual(new Set(Object.values(WIND_SYSTEMS).map((system) => system.sceneNodeId)))
    expect(bindings.some((binding) => binding.nodeId.startsWith('system.wind-') || binding.sceneNodeId.startsWith('unit.wind-'))).toBe(false)
  })
})
