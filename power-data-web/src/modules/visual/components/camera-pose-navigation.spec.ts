import { describe, expect, it } from 'vitest'
import { toSceneId } from '@/config/scene-topology/identifiers'
import { getCameraPoseNavigationButtons } from '@/modules/visual/components/camera-pose-navigation'

describe('燃气与燃煤命名镜头按钮映射', () => {
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

  it('未登记场景不复用燃气或燃煤按钮', () => {
    expect(getCameraPoseNavigationButtons(toSceneId('wind-power'))).toEqual([])
    expect(getCameraPoseNavigationButtons(undefined)).toEqual([])
  })

  it('十二个镜头步骤均提供独立且非空的临时说明', () => {
    const descriptions = [
      ...getCameraPoseNavigationButtons(toSceneId('gas-power')),
      ...getCameraPoseNavigationButtons(toSceneId('coal-power')),
    ].map(({ description }) => description)

    expect(descriptions).toHaveLength(12)
    expect(descriptions.every((description) => description.trim().length > 0)).toBe(true)
    expect(new Set(descriptions).size).toBe(12)
  })
})
