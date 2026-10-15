
import { describe, expect, it } from 'vitest'
import { toSceneId } from '@/config/scene-topology/identifiers'
import { getCameraPoseNavigationButtons } from '@/modules/visual/components/camera-pose-navigation'

describe('燃气、燃煤、风电与光伏命名镜头按钮映射', () => {
  it('按接口说明为燃气场景返回六个固定镜头点', () => {
    const buttons = getCameraPoseNavigationButtons(toSceneId('gas-power'))

    expect(buttons).toHaveLength(6)
    expect(buttons.map(({ cameraPoseId }) => cameraPoseId)).toEqual([
      'gas-power.camera.gas-inlet',
      'gas-power.camera.gas-turbine',
      'gas-power.camera.hrsg',
      'gas-power.camera.steam-turbine',
      'gas-power.camera.generator',
      'gas-power.camera.grid-output',
    ])
  })

  it('按接口说明为燃煤场景返回六个固定镜头点', () => {
    const buttons = getCameraPoseNavigationButtons(toSceneId('coal-power'))

    expect(buttons).toHaveLength(6)
    expect(buttons.map(({ cameraPoseId }) => cameraPoseId)).toEqual([
      'coal-power.camera.coal-conveying',
      'coal-power.camera.coal-mill',
      'coal-power.camera.boiler',
      'coal-power.camera.steam-turbine',
      'coal-power.camera.generator',
      'coal-power.camera.grid-output',
    ])
  })

  it('按接口说明为风电场景返回四个固定镜头点', () => {
    const buttons = getCameraPoseNavigationButtons(toSceneId('wind-power'))

    expect(buttons).toHaveLength(4)
    expect(buttons.map(({ cameraPoseId }) => cameraPoseId)).toEqual([
      'wind-power.camera.wind-generation',
      'wind-power.camera.step-up-transmission',
      'wind-power.camera.energy-storage',
      'wind-power.camera.grid-output',
    ])
    expect(buttons.map(({ label }) => label)).toEqual([
      '风能转化电能',
      '电能升压传输',
      '储能箱存储',
      '并网输出',
    ])
  })

  it('按接口说明为光伏场景返回四个固定镜头点', () => {
    const buttons = getCameraPoseNavigationButtons(toSceneId('solar-power'))

    expect(buttons).toHaveLength(4)
    expect(buttons.map(({ cameraPoseId }) => cameraPoseId)).toEqual([
      'solar-power.camera.solar-array',
      'solar-power.camera.combiner-inverter',
      'solar-power.camera.energy-storage',
      'solar-power.camera.grid-output',
    ])
    expect(buttons.map(({ label }) => label)).toEqual([
      '太阳能转换直流电',
      '汇流并转交流电',
      '储能箱存储',
      '并网输出',
    ])
  })

  it('按接口说明为升压站返回四个固定镜头点', () => {
    const buttons = getCameraPoseNavigationButtons(toSceneId('step-up-substation'))

    expect(buttons).toHaveLength(4)
    expect(buttons.map(({ cameraPoseId }) => cameraPoseId)).toEqual([
      'step-up-substation.camera.input',
      'step-up-substation.camera.step-up-transmission',
      'step-up-substation.camera.step-up-monline',
      'step-up-substation.camera.output',
    ])
    expect(buttons.map(({ label }) => label)).toEqual([
      '35KV进线',
      '变压器',
      '母线',
      '220KV出线',
    ])
  })

  it('按接口说明为降压站返回四个固定镜头点', () => {
    const buttons = getCameraPoseNavigationButtons(toSceneId('step-down-substation'))

    expect(buttons).toHaveLength(4)
    expect(buttons.map(({ cameraPoseId }) => cameraPoseId)).toEqual([
      'step-down-substation.camera.input',
      'step-down-substation.camera.step-down-transmission',
      'step-down-substation.camera.step-down-monline',
      'step-down-substation.camera.output',
    ])
    expect(buttons.map(({ label }) => label)).toEqual([
      '220KV进线',
      '变压器',
      '母线',
      '35KV出线',
    ])
  })

  it('按接口说明为配电站返回三个固定镜头点', () => {
    const buttons = getCameraPoseNavigationButtons(toSceneId('distribution'))

    expect(buttons).toHaveLength(3)
    expect(buttons.map(({ cameraPoseId }) => cameraPoseId)).toEqual([
      'distribution.camera.input',
      'distribution.camera.transmission',
      'distribution.camera.output',
    ])
    expect(buttons.map(({ label }) => label)).toEqual([
      '中压电进线',
      '变压器降压',
      '出线供电',
    ])
  })

  it('未登记场景不复用其他业务场景按钮', () => {
    expect(getCameraPoseNavigationButtons(toSceneId('substation'))).toEqual([])
    expect(getCameraPoseNavigationButtons(undefined)).toEqual([])
  })

  it('二十个镜头步骤均提供独立且非空的临时说明', () => {
    const descriptions = [
      ...getCameraPoseNavigationButtons(toSceneId('gas-power')),
      ...getCameraPoseNavigationButtons(toSceneId('coal-power')),
      ...getCameraPoseNavigationButtons(toSceneId('wind-power')),
      ...getCameraPoseNavigationButtons(toSceneId('solar-power')),
      ...getCameraPoseNavigationButtons(toSceneId('step-up-substation')),
      ...getCameraPoseNavigationButtons(toSceneId('step-down-substation')),
      ...getCameraPoseNavigationButtons(toSceneId('distribution')),
    ].map(({ description }) => description)

    expect(descriptions).toHaveLength(31)
    expect(descriptions.every((description) => description.trim().length > 0)).toBe(true)
    expect(new Set(descriptions).size).toBe(31)
  })
})
