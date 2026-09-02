import { readFile } from 'node:fs/promises'
import type { Meta2dData } from '@meta2d/core'
import { describe, expect, it } from 'vitest'
import {
  createCoalTopologyRuntimeBindingIndex,
  COAL_TOPOLOGY_RUNTIME_BINDINGS,
} from './coal-topology-runtime-bindings'
import { toProcessNodeId } from '@/config/process/identifiers'
import { toSceneNodeId } from '@/config/scene-topology/identifiers'

const topologyUrl = new URL('../../../../public/topology/coal-json-preview/topology.json', import.meta.url)

describe('新版燃煤拓扑运行时绑定', () => {
  it('只绑定当前图纸中具有唯一 Unity 模型的五个现场设备图元', async () => {
    const data = JSON.parse(await readFile(topologyUrl, 'utf8')) as Meta2dData
    const imagePenIds = new Set(data.pens.filter((pen) => pen.image).map((pen) => pen.id))
    const bindingPenIds = COAL_TOPOLOGY_RUNTIME_BINDINGS.map((binding) => binding.penId)

    expect(new Set(bindingPenIds).size).toBe(bindingPenIds.length)
    expect(bindingPenIds.every((penId) => imagePenIds.has(penId))).toBe(true)

    const index = createCoalTopologyRuntimeBindingIndex()
    const feederNodeId = toProcessNodeId('asset.coal-mill-actuator')
    const boilerNodeId = toProcessNodeId('system.boiler-dcs')
    const steamTurbineNodeId = toProcessNodeId('system.steam-turbine-dcs')
    const generatorNodeId = toProcessNodeId('system.generator-excitation-controller')
    const precipitatorNodeId = toProcessNodeId('system.coal-handling-ash-plc')
    const feederSceneNodeId = toSceneNodeId('node.coal-feeder')
    const boilerSceneNodeId = toSceneNodeId('node.coal-boiler')
    const steamTurbineSceneNodeId = toSceneNodeId('node.coal-steam-turbine')
    const generatorSceneNodeId = toSceneNodeId('node.coal-generator')
    const precipitatorSceneNodeId = toSceneNodeId('node.coal-precipitator')

    expect(index.nodeIdByPenId.get('efdfac7')).toBe(feederNodeId)
    expect(index.nodeIdByPenId.get('369a5871')).toBe(boilerNodeId)
    expect(index.nodeIdByPenId.get('ed5e92c')).toBe(steamTurbineNodeId)
    expect(index.nodeIdByPenId.get('17723a9e')).toBe(generatorNodeId)
    expect(index.nodeIdByPenId.get('8c7f158')).toBe(precipitatorNodeId)

    expect(index.sceneNodeIdByPenId.get('efdfac7')).toBe(feederSceneNodeId)
    expect(index.sceneNodeIdByPenId.get('369a5871')).toBe(boilerSceneNodeId)
    expect(index.sceneNodeIdByPenId.get('ed5e92c')).toBe(steamTurbineSceneNodeId)
    expect(index.sceneNodeIdByPenId.get('17723a9e')).toBe(generatorSceneNodeId)
    expect(index.sceneNodeIdByPenId.get('8c7f158')).toBe(precipitatorSceneNodeId)
    expect(new Set(index.sceneNodeIdByPenId.values())).toEqual(new Set([
      feederSceneNodeId,
      boilerSceneNodeId,
      steamTurbineSceneNodeId,
      generatorSceneNodeId,
      precipitatorSceneNodeId,
    ]))

    // 正反索引均保持严格一对一，Unity 点击只会选中一个现场设备图元。
    expect(index.penIdsByNodeId.get(feederNodeId)).toEqual(['efdfac7'])
    expect(index.penIdsByNodeId.get(boilerNodeId)).toEqual(['369a5871'])
    expect(index.penIdsByNodeId.get(steamTurbineNodeId)).toEqual(['ed5e92c'])
    expect(index.penIdsByNodeId.get(generatorNodeId)).toEqual(['17723a9e'])
    expect(index.penIdsByNodeId.get(precipitatorNodeId)).toEqual(['8c7f158'])
    expect(index.nodeIdByPenId.size).toBe(5)
    expect(index.sceneNodeIdByPenId.size).toBe(5)
    expect(index.penIdsByNodeId.size).toBe(5)
  })
})

