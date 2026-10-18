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
import { TOPOLOGY_SHARED_ASSET_ALIASES } from './topology-shared-assets'
import { DISTRIBUTION_TOPOLOGY_RUNTIME_BINDINGS } from './distribution-topology-runtime-bindings'
import { MICROGRID_TOPOLOGY_EQUIPMENT_NODE_IDS, getMicrogridTopologyRuntimeBindings } from './microgrid-topology-runtime-bindings'

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
    ['network-business-key-process', 85, '06d9a7650b68ac58432c0bb66b0c5b8cd6c76e6bcbbd74a62500649353f31e0a'],
  ],
  consumption: [
    ['architecture', 38, 'f0c1477c06a84cda9ad24894b1aae9e146eea1b808876273fca9e16d2069992b'],
    ['network', 44, 'dace4dda8ac02062afc2651958bcb5ec46706d0c5cd9f8e0eff49d1e19f82470'],
    ['business', 23, '5f575ae28464e5d191ec000ac0a18b2dd669f882864f4ccf3fee4a569bc4a839'],
    ['key-process', 26, '6619c9c62039e72485b701ed53a2092cead39d3e1d82d0644d4610b4107335c7'],
    ['network-key-process', 50, '583e4881a6f29da66b57aabbf244a45b5527f7bcf2c3659669a1f1ecbccb8589'],
    ['network-business', 51, '5ff080b707b35a859aea0ccc595d4045c970b8840ebaa11a448662dfcc48e6c9'],
    ['business-key-process', 32, 'a396e48c91b42235db242bce38c1c730cdfd434acb9b3b355857e89e9de4f3f1'],
    ['network-business-key-process', 48, '31273101e1bbb458134a41fec86e77471eb945f03d75058a54195192eb556f05'],
  ],
  dispatch: [
    ['network-business-key-process', 94, 'b2235a0ca3a7bb484b4c926519cfd016ae75517c2c4887498a926ca9ce797ef8'],
  ],
} as const

describe('新业务场景拓扑数据契约', () => {
  it('正式面板只按三个稳定总览拓扑键选择对应业务场景画布', () => {
    expect(resolveBusinessSceneTopologySceneId('topology.microgrid.overview')).toBe('microgrid')
    expect(resolveBusinessSceneTopologySceneId('topology.distribution.overview')).toBe('distribution')
    expect(resolveBusinessSceneTopologySceneId('topology.consumption.overview')).toBe('consumption')
    expect(resolveBusinessSceneTopologySceneId('topology.dispatch.overview')).toBe('dispatch')
    expect(resolveBusinessSceneTopologySceneId('topology.unknown.overview')).toBeUndefined()
  })

  it('配电站默认组合按截图标签将重复图元绑定到五个后续 Unity 目标编号', () => {
    const variant = BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE.distribution.find((item) => item.isDefault)!
    const path = resolve(process.cwd(), 'public/topology/distribution-json-preview', variant.topologyPath)
    const topology = JSON.parse(readFileSync(path, 'utf8')) as { pens: Pen[] }
    const bindingsByPenId = new Map(DISTRIBUTION_TOPOLOGY_RUNTIME_BINDINGS.map((binding) => [binding.penId, binding]))
    const expected = [
      { title: '保护装置', image: 'icons/normal/protection-device.webp', nodeId: 'asset.distribution-protection', sceneNodeId: 'node.distribution-protection', penIds: ['1406260e', '1508d7f'] },
      { title: '测控装置', image: 'icons/normal/measurement-device.webp', nodeId: 'asset.distribution-measurement', sceneNodeId: 'node.distribution-measurement', penIds: ['175412f5', '99f85e3'] },
      { title: '配电变压器', image: 'icons/normal/distribution-transformer.webp', nodeId: 'asset.distribution-transformer', sceneNodeId: 'node.distribution-transformer', penIds: ['6db2600f', 'cb0cbf4'] },
      { title: '断路器', image: 'icons/normal/distribution-breaker.webp', nodeId: 'asset.distribution-breaker', sceneNodeId: 'node.distribution-breaker', penIds: ['a1a5b54', '4f0d6e4a'] },
      { title: '互感器', image: 'icons/normal/instrument-transformer.webp', nodeId: 'asset.distribution-instrument-transformer', sceneNodeId: 'node.distribution-instrument-transformer', penIds: ['c1499f9', '67b16fb'] },
    ] as const

    for (const item of expected) {
      const matchingPens = topology.pens.filter((pen) => pen.text?.trim() === item.title).map((pen) => pen.id)
      expect(matchingPens.sort()).toEqual([...item.penIds].sort())
      const targetPenIds = new Set<string>(item.penIds)
      expect(topology.pens.filter((pen) => targetPenIds.has(pen.id ?? '')).every((pen) => pen.image === item.image)).toBe(true)
      for (const penId of item.penIds) {
        expect(bindingsByPenId.get(penId)).toEqual({ penId, nodeId: item.nodeId, sceneNodeId: item.sceneNodeId })
      }
    }

    // 默认文件直接引用共享目录中的 WebP；PNG 源图和在线编辑器封面不进入前端拓扑 JSON。
    expect(topology.pens.filter((pen) => pen.image).every((pen) => /^(?:icons|background)\/.+\.webp$/i.test(pen.image!))).toBe(true)
    expect(JSON.stringify(topology)).not.toMatch(/\.png(?:$|[?#"])/i)
  })

  it('微电网只在默认组合中绑定六个设备层节点', () => {
    const variant = BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE.microgrid.find((item) => item.isDefault)!
    const path = resolve(process.cwd(), 'public/topology/microgrid-json-preview', variant.topologyPath)
    const topology = JSON.parse(readFileSync(path, 'utf8')) as { pens: Pen[] }
    const expected = [
      { key: 'windController', title: '风电控制器', penId: '58845f75' },
      { key: 'photovoltaicController', title: '光伏控制器', penId: 'ac4cdcc' },
      { key: 'dieselGeneratorController', title: '柴发控制器', penId: '6eaf50f7' },
      { key: 'atsController', title: 'ATS控制器', penId: '30ecc688' },
      { key: 'switchgear', title: '开关柜', penId: 'a6a3147' },
      { key: 'storageConverter', title: '储能变流器', penId: 'abf1410' },
    ] as const
    const expectedBindings = expected.map(({ key, penId }) => ({
      penId,
      ...MICROGRID_TOPOLOGY_EQUIPMENT_NODE_IDS[key],
    }))

    expect(getMicrogridTopologyRuntimeBindings(variant.id)).toEqual(expectedBindings)
    for (const { title, penId } of expected) {
      expect(topology.pens.find((pen) => pen.id === penId)?.text?.replace(/\n/g, '').trim()).toBe(title)
    }
    for (const otherVariant of BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE.microgrid.filter((item) => !item.isDefault)) {
      expect(getMicrogridTopologyRuntimeBindings(otherVariant.id)).toEqual([])
    }
  })

  it('逐项核对三类八版本场景和仅提供完整组合的调度中心源文件', () => {
    expect(BUSINESS_SCENE_TOPOLOGY_SCENE_IDS).toEqual(['microgrid', 'distribution', 'consumption', 'dispatch'])

    for (const sceneId of BUSINESS_SCENE_TOPOLOGY_SCENE_IDS) {
      const variants = BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE[sceneId]
      const source = SOURCE_CONTRACT[sceneId]
      expect(variants).toHaveLength(source.length)
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
          // 历史 PNG 只保留为解析键；磁盘与最终加载地址必须落到现存 WebP 文件。
          const sharedImagePath = TOPOLOGY_SHARED_ASSET_ALIASES[pen.image!] ?? pen.image!
          expect(sharedImagePath).toMatch(/\.webp$/i)
          expect(existsSync(resolve(process.cwd(), 'public/topology/shared', sharedImagePath))).toBe(true)
        }

        for (const processPenId of variant.processPenIds) {
          expect(data.pens.some((pen) => pen.id === processPenId)).toBe(true)
        }
      }
    }
  })

  it('调度中心使用唯一默认三层组合、局部点击和公共 WebP，不登记任何业务或三维绑定', () => {
    const variant = BUSINESS_SCENE_TOPOLOGY_VARIANTS_BY_SCENE.dispatch[0]!
    const topologyPath = resolve(
      process.cwd(),
      'public/topology/dispatch-json-preview',
      variant.topologyPath,
    )
    const topology = JSON.parse(readFileSync(topologyPath, 'utf8')) as {
      image?: string
      pens: Pen[]
      enableMock?: boolean
      initJs?: string
      dataPoints?: unknown[]
      networks?: unknown[]
    }
    const profile = getBusinessSceneTopologyPreviewProfile('dispatch')
    const imagePaths = topology.pens.flatMap((pen) => pen.image ? [pen.image] : [])

    expect(variant.layerIds).toEqual(['network', 'business', 'key-process'])
    expect(variant.combinationKey).toBe('network+business+key-process')
    expect(profile.sceneLabel).toBe('调度中心')
    expect(profile.selectionDelivery).toBe('local')
    expect(profile.getRuntimeBindings?.(variant.id)).toEqual([])
    expect(variant.processPenIds).toEqual([])
    expect(topology.pens).toHaveLength(94)
    expect(variant.expectedRuntimePenCount).toBe(93)
    expect(topology.pens.filter((pen) => pen.name === 'combine')).toEqual([
      expect.objectContaining({ id: 'a15a085' }),
    ])
    expect(variant.flattenedCombines).toEqual([{ id: 'a15a085', directChildCount: 0 }])
    expect(profile.resolveVariant(profile.createDefaultSelection())?.id).toBe(variant.id)
    expect(imagePaths.every((image) => /^(?:icons|background)\/.+\.webp$/i.test(image))).toBe(true)
    expect(imagePaths.every((image) => existsSync(resolve(process.cwd(), 'public/topology/shared', image)))).toBe(true)
    expect(topology.image).toBe('')
    expect(topology.enableMock).toBe(false)
    expect(topology.initJs).toBe('')
    expect(topology.dataPoints).toEqual([])
    expect(topology.networks).toEqual([])
    expect(JSON.stringify(topology)).not.toMatch(/\.(?:png|jpe?g)(?:$|[?#"])/i)
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

  it.each(BUSINESS_SCENE_TOPOLOGY_SCENE_IDS)('%s resolves only explicitly registered filter combinations', (sceneId) => {
    const profile = getBusinessSceneTopologyPreviewProfile(sceneId)
    const defaultSelection = profile.createDefaultSelection()
    expect(profile.resolveVariant(defaultSelection)?.id).toBe('network-business-key-process')

    const architecture = profile.toggleFilter(defaultSelection, 'architecture', true)
    expect([...architecture]).toEqual(['architecture'])

    const networkAndBusiness = profile.toggleFilter(
      profile.toggleFilter(new Set(), 'network', true),
      'business',
      true,
    )
    if (sceneId === 'dispatch') {
      // 调度中心只提供完整三层组合；缺失的单层和双层文件必须显示为未登记，不得由完整图裁剪生成。
      expect(profile.resolveVariant(architecture)).toBeUndefined()
      expect(profile.resolveVariant(networkAndBusiness)).toBeUndefined()
      return
    }

    expect(profile.resolveVariant(architecture)?.id).toBe('architecture')
    expect(profile.resolveVariant(networkAndBusiness)?.id).toBe('network-business')
  })
})
