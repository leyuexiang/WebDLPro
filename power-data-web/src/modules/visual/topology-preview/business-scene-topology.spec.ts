import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUSINESS_SCENE_TOPOLOGY_SCENE_IDS,
  BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE,
  flattenBusinessSceneTopologyPens,
  getBusinessSceneTopologyPreviewProfile,
  resolveBusinessSceneTopologySceneId,
} from './business-scene-topology'
import type { Pen } from '@meta2d/core'
import { TOPOLOGY_SHARED_ASSET_ALIASES, getTopologySharedPublicAssetUrl } from './topology-shared-assets'

/** 用户提交的源文件哈希与图元数作为独立基准，防止输入文件漏项或变体串线。 */
const SOURCE_CONTRACT = {
  microgrid: [
    ['architecture', 49, '63f35445d6d7eee546f9ff796363dfedbc540a8b2cfd97828cd95667c7bb872a'],
    ['network', 45, '5789834dc6c782cb370d94c703bf362c89824b6bcbb6cb4c077fe30a7b71b919'],
    ['business', 30, 'a055e8ff4c9c2fb00c97145664f69766ff99512f9bd656c13e826099c8a4658d'],
    ['key-process', 28, '0fec248981e4101b049c9fd2aaa359f1ce0b3ae5bf6eeb914b0a79f20871256d'],
    ['network-key-process', 58, 'debffa4a234a9135f12d3981e9d294b94cc62a63cc6fcbaac670c2f4d15cbf3f'],
    ['network-business', 60, 'ef5803a9a47b00f0d38d7cd70518427705e4cfeb8d135fc27bf57e32614b6e73'],
    ['business-key-process', 49, '99c4a92e3ae73cf36280299460c16d37ac9b91b294b83037009ee3775846fef3'],
    ['network-business-key-process', 79, '8e5056ebb00da3095ce9f8709c048bd4fa5f9e995c93b928d96932cbb911c67a'],
  ],
  distribution: [
    ['architecture', 56, '31cb4d7b991c4389809844cf20c2511b0f2b59147c4be6355b3ab334131a6e73'],
    ['network', 76, '29196857f55bddb2f47f0f5f0c7915651fd58c413018909affe2e05e880319d4'],
    ['business', 26, 'f93d4808d1e05b710076474888c58037f3b8d234fa97cec5bb70ad0252452088'],
    ['key-process', 43, '97ce2aa379a4c21824d34ee291061934208b3948c7f05752b37a7dcdd39fe0b6'],
    ['network-key-process', 76, 'f2bfddad4c6d03193d4041eb25fcfeec26e64b394a19fb6753d477e72bb157bd'],
    ['network-business', 87, 'ea111ca170273108a8e886ed6a5f7336d8d3ef923f86df61f2312dbf05813772'],
    ['business-key-process', 55, 'b3794b4684842ddd6a6a98b5e1550e2f779849c6ab13f8e8a038110154bd0db4'],
    ['network-business-key-process', 98, 'd4e0850f65569f1b09015a17bfb232562c6c32367ad423ed5239bcd292c730cd'],
  ],
  consumption: [
    ['architecture', 38, 'f0c1477c06a84cda9ad24894b1aae9e146eea1b808876273fca9e16d2069992b'],
    ['network', 44, 'dace4dda8ac02062afc2651958bcb5ec46706d0c5cd9f8e0eff49d1e19f82470'],
    ['business', 23, '5f575ae28464e5d191ec000ac0a18b2dd669f882864f4ccf3fee4a569bc4a839'],
    ['key-process', 26, '6619c9c62039e72485b701ed53a2092cead39d3e1d82d0644d4610b4107335c7'],
    ['network-key-process', 50, '583e4881a6f29da66b57aabbf244a45b5527f7bcf2c3659669a1f1ecbccb8589'],
    ['network-business', 51, '5ff080b707b35a859aea0ccc595d4045c970b8840ebaa11a448662dfcc48e6c9'],
    ['business-key-process', 32, 'a396e48c91b42235db242bce38c1c730cdfd434acb9b3b355857e89e9de4f3f1'],
    ['network-business-key-process', 57, '4fd1d494b3c659b60c63a9ee5107ed8098f37e7f3812b39b98aee7ec5d027394'],
  ],
} as const

describe('新业务场景拓扑数据契约', () => {
  it('正式面板只按三个稳定总览拓扑键选择对应业务场景画布', () => {
    expect(resolveBusinessSceneTopologySceneId('topology.microgrid.overview')).toBe('microgrid')
    expect(resolveBusinessSceneTopologySceneId('topology.distribution.overview')).toBe('distribution')
    expect(resolveBusinessSceneTopologySceneId('topology.consumption.overview')).toBe('consumption')
    expect(resolveBusinessSceneTopologySceneId('topology.unknown.overview')).toBeUndefined()
  })

  it('为三个场景登记源文件提供的 24 个独立版本，且每场景只有一个明确默认版本', () => {
    expect(BUSINESS_SCENE_TOPOLOGY_SCENE_IDS).toEqual(['microgrid', 'distribution', 'consumption'])

    for (const sceneId of BUSINESS_SCENE_TOPOLOGY_SCENE_IDS) {
      const variants = BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE[sceneId]
      const source = SOURCE_CONTRACT[sceneId]
      expect(variants).toHaveLength(8)
      expect(variants.filter((variant) => variant.isDefault)).toHaveLength(1)
      expect(variants.find((variant) => variant.isDefault)?.id).toBe('network-business-key-process')
      expect(variants.map((variant) => variant.id)).toEqual(source.map(([id]) => id))

      for (const [index, variant] of variants.entries()) {
        expect(variant.expectedPenCount).toBe(source[index]?.[1])
        expect(variant.sourceSha256).toBe(source[index]?.[2])

        const filePath = resolve(process.cwd(), 'public/topology', `${sceneId}-json-preview`, variant.topologyPath)
        const data = JSON.parse(readFileSync(filePath, 'utf8')) as {
          pens: { id?: string; image?: string; x?: number; y?: number; width?: number; height?: number }[]
        }
        expect(data.pens).toHaveLength(variant.expectedPenCount)
        expect(new Set(data.pens.map((pen) => pen.id)).size).toBe(data.pens.length)
        expect(data.pens.every((pen) => [pen.x, pen.y, pen.width, pen.height].every(Number.isFinite))).toBe(true)

        for (const pen of data.pens.filter((item) => item.image)) {
          expect(pen.image).toMatch(/^(assets|background|icons)\//)
          const publicImagePath = TOPOLOGY_SHARED_ASSET_ALIASES[pen.image!] ?? pen.image!
          expect(existsSync(resolve(process.cwd(), 'public/topology/shared', publicImagePath))).toBe(true)
          expect(getTopologySharedPublicAssetUrl(pen.image!, '/power/', undefined))
            .toBe(`/power/topology/shared/${publicImagePath}`)
        }

        for (const processPenId of variant.processPenIds) {
          expect(data.pens.some((pen) => pen.id === processPenId)).toBe(true)
        }
      }
    }
  })

  it.each(BUSINESS_SCENE_TOPOLOGY_SCENE_IDS)('%s 的全部版本移除整图选择父级且保持源图几何位置', (sceneId) => {
    /** 比较任意父子链的最终画布矩形，确保展平只改坐标系表达。 */
    const getWorldRect = (penId: string, penById: ReadonlyMap<string, Pen>) => {
      const pen = penById.get(penId)!
      let x = pen.x!; let y = pen.y!; let width = pen.width!; let height = pen.height!
      let parentId = pen.parentId
      while (parentId) {
        const parent = penById.get(parentId)!
        x = parent.x! + x * parent.width!
        y = parent.y! + y * parent.height!
        width *= parent.width!
        height *= parent.height!
        parentId = parent.parentId
      }
      return [x, y, width, height]
    }

    for (const variant of BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE[sceneId]) {
      const path = resolve(process.cwd(), 'public/topology', `${sceneId}-json-preview`, variant.topologyPath)
      const source = JSON.parse(readFileSync(path, 'utf8')) as { pens: Pen[] }
      const sourcePens = structuredClone(source.pens)
      const sourcePenById = new Map(sourcePens.map((pen) => [pen.id!, pen]))
      const flattenIds = new Set(variant.flattenedCombines.map((item) => item.id))
      const flattened = flattenBusinessSceneTopologyPens(structuredClone(source.pens), variant)
      const flattenedPenById = new Map(flattened.map((pen) => [pen.id!, pen]))

      expect(flattened).toHaveLength(variant.expectedRuntimePenCount)
      expect([...flattenIds].every((id) => !flattenedPenById.has(id))).toBe(true)
      for (const sourcePen of sourcePens.filter((pen) => !flattenIds.has(pen.id!))) {
        expect(getWorldRect(sourcePen.id!, flattenedPenById)).toEqual(
          getWorldRect(sourcePen.id!, sourcePenById).map((value) => expect.closeTo(value, 8)),
        )
      }
    }
  })

  it.each(BUSINESS_SCENE_TOPOLOGY_SCENE_IDS)('%s uses the supplied standalone files for filters and combinations', (sceneId) => {
    const profile = getBusinessSceneTopologyPreviewProfile(sceneId)
    const defaultSelection = profile.createDefaultSelection()
    expect(profile.resolveVariant(defaultSelection)?.id).toBe('network-business-key-process')

    const architecture = profile.toggleFilter(defaultSelection, 'architecture', true)
    expect([...architecture]).toEqual(['architecture'])
    expect(profile.resolveVariant(architecture)?.id).toBe('architecture')

    const networkAndBusiness = profile.toggleFilter(
      profile.toggleFilter(new Set(), 'network', true),
      'business',
      true,
    )
    expect(profile.resolveVariant(networkAndBusiness)?.id).toBe('network-business')
  })
})
