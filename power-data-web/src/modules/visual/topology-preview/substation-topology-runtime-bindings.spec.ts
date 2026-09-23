import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'
import { STEP_UP_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS } from './step-up-substation-topology-runtime-bindings'
import { STEP_UP_SUBSTATION_TOPOLOGY_VARIANTS } from './step-up-substation-topology-variant-manifest'
import { STEP_DOWN_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS } from './step-down-substation-topology-runtime-bindings'
import { STEP_DOWN_SUBSTATION_TOPOLOGY_VARIANTS } from './step-down-substation-topology-variant-manifest'
import { CONVERTER_STATION_TOPOLOGY_RUNTIME_BINDINGS } from './converter-station-topology-runtime-bindings'
import { CONVERTER_STATION_TOPOLOGY_VARIANTS } from './converter-station-topology-variant-manifest'
import { SWITCHING_STATION_TOPOLOGY_RUNTIME_BINDINGS } from './switching-station-topology-runtime-bindings'
import { SWITCHING_STATION_TOPOLOGY_VARIANTS } from './switching-station-topology-variant-manifest'

interface ScenarioFixture {
  readonly label: string
  readonly directory: string
  readonly measurementNodeId: string
  readonly measurementSceneNodeId: string
  readonly protectionNodeId: string
  readonly protectionSceneNodeId: string
  readonly variants: readonly { readonly id: string; readonly topologyPath: string }[]
  readonly bindings: readonly SubstationTopologyRuntimeBinding[]
}

const scenarioFixtures: readonly ScenarioFixture[] = [
  {
    label: '升压站', directory: 'step-up-substation-json-preview',
    measurementNodeId: 'system.step-up-measurement-control', measurementSceneNodeId: 'unit.step-up-measurement.control',
    protectionNodeId: 'system.step-up-protection-control', protectionSceneNodeId: 'unit.step-up-protection.control',
    variants: STEP_UP_SUBSTATION_TOPOLOGY_VARIANTS, bindings: STEP_UP_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS,
  },
  {
    label: '降压站', directory: 'step-down-substation-json-preview',
    measurementNodeId: 'system.step-down-measurement-control', measurementSceneNodeId: 'unit.step-down-measurement.control',
    protectionNodeId: 'system.step-down-protection-control', protectionSceneNodeId: 'unit.step-down-protection.control',
    variants: STEP_DOWN_SUBSTATION_TOPOLOGY_VARIANTS, bindings: STEP_DOWN_SUBSTATION_TOPOLOGY_RUNTIME_BINDINGS,
  },
  {
    label: '换流站', directory: 'converter-station-json-preview',
    measurementNodeId: 'system.converter-measurement-control', measurementSceneNodeId: 'unit.converter-measurement.control',
    protectionNodeId: 'system.converter-protection-control', protectionSceneNodeId: 'unit.converter-protection.control',
    variants: CONVERTER_STATION_TOPOLOGY_VARIANTS, bindings: CONVERTER_STATION_TOPOLOGY_RUNTIME_BINDINGS,
  },
  {
    label: '开关站', directory: 'switching-station-json-preview',
    measurementNodeId: 'system.switching-measurement-control', measurementSceneNodeId: 'unit.switching-measurement.control',
    protectionNodeId: 'system.switching-protection-control', protectionSceneNodeId: 'unit.switching-protection.control',
    variants: SWITCHING_STATION_TOPOLOGY_VARIANTS, bindings: SWITCHING_STATION_TOPOLOGY_RUNTIME_BINDINGS,
  },
]

/** 所有筛选输入均回查源文件，验证测控和保护装置的精确映射语义。 */
describe.each(scenarioFixtures)('$label 测控/保护装置映射', (fixture) => {
  it('保护装置映射到三维保护控制，继电保护系统不误绑', () => {
    let measurementPenCount = 0
    let protectionPenCount = 0
    let relaySystemPenCount = 0
    const sourcePenIds = new Set<string>()
    const sourceLabelsByPenId = new Map<string, Set<string>>()
    const bindingByPenId = new Map(fixture.bindings.map((binding) => [binding.penId, binding]))
    for (const variant of fixture.variants) {
      const data = JSON.parse(readFileSync(resolve(
        process.cwd(), 'public/topology', fixture.directory, variant.topologyPath,
      ), 'utf8')) as { pens: Array<{ id?: string; image?: string; text?: string }> }
      for (const pen of data.pens) {
        if (pen.id) {
          sourcePenIds.add(pen.id)
          if (pen.text) {
            const labels = sourceLabelsByPenId.get(pen.id)
            if (labels) labels.add(pen.text)
            else sourceLabelsByPenId.set(pen.id, new Set([pen.text]))
          }
        }
      }
      const targetPens = data.pens.filter((pen) => typeof pen.text === 'string' && /测控装置|保护装置|继电保护系统/.test(pen.text))
      for (const pen of targetPens) {
        const binding = pen.id ? bindingByPenId.get(pen.id) : undefined
        const isMeasurement = pen.text?.includes('测控装置')
        const isProtectionDevice = pen.text?.includes('保护装置')
        const isRelaySystem = pen.text?.includes('继电保护系统')
        if (isMeasurement) {
          measurementPenCount += 1
          expect(binding, `${variant.id}/${pen.id} 必须登记测控装置映射`).toBeDefined()
          expect(binding?.nodeId).toBe(fixture.measurementNodeId)
          expect(binding?.sceneNodeId).toBe(fixture.measurementSceneNodeId)
        } else if (isProtectionDevice) {
          protectionPenCount += 1
          expect(binding, `${variant.id}/${pen.id} 必须登记保护装置映射`).toBeDefined()
          expect(binding?.nodeId).toBe(fixture.protectionNodeId)
          expect(binding?.sceneNodeId).toBe(fixture.protectionSceneNodeId)
        } else if (isRelaySystem) {
          relaySystemPenCount += 1
          expect(binding?.sceneNodeId, `${variant.id}/${pen.id} 继电保护系统不能误绑三维保护装置节点`).not.toBe(fixture.protectionSceneNodeId)
        }
      }
    }
    // 某些单层组合本身不展示设备节点，但四站完整变体必须覆盖两类业务节点。
    expect(measurementPenCount, '所有筛选变体至少应登记测控装置图元').toBeGreaterThan(0)
    expect(protectionPenCount, '所有筛选变体至少应登记保护装置图元').toBeGreaterThan(0)
    expect(relaySystemPenCount, '测试必须覆盖继电保护系统图元以阻止误绑回归').toBeGreaterThan(0)
    for (const binding of fixture.bindings) {
      expect(sourcePenIds.has(binding.penId), `${binding.penId} 必须存在于已登记的拓扑源文件`).toBe(true)
      const labels = [...(sourceLabelsByPenId.get(binding.penId) ?? [])].join('\n')
      if (binding.sceneNodeId === fixture.protectionSceneNodeId) {
        expect(labels, `${binding.penId} 必须是“保护装置”图元`).toContain('保护装置')
        expect(labels, `${binding.penId} 不得是“继电保护系统”图元`).not.toContain('继电保护系统')
      }
      if (binding.sceneNodeId === fixture.measurementSceneNodeId) {
        expect(labels, `${binding.penId} 必须是“测控装置”图元`).toContain('测控装置')
      }
    }
  })
})
