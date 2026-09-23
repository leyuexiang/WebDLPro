import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Meta2dData, Pen } from '@meta2d/core'
import { describe, expect, it } from 'vitest'
import { toProcessNodeId } from '@/config/process/identifiers'
import type { TopologyDeviceStatus } from '@/config/process/types'
import { getSolarTopologyResourceManifest } from './solar-topology-manifest'
import { getSolarTopologyPreviewIconPath } from './solar-topology-preview-data'
import { projectSolarTopologyStatusesBeforeOpen } from './solar-topology-runtime-state'
import {
  SOLAR_TOPOLOGY_VARIANT_BY_ID,
  type SolarTopologyVariantId,
} from './solar-topology-variant-manifest'

const sharedRoot = resolve(process.cwd(), 'public/topology/shared')
const statuses: readonly TopologyDeviceStatus[] = ['normal', 'alarm', 'fault', 'offline']

/**
 * 图元编号来自八份第二层输入和一份逆变器第三层输入，按版本隔离保存。
 * 控制图元复用公共分散控制系统（DCS）四态图，实体逆变器复用公共光伏四态图。
 */
const EXPECTED_DEVICE_PENS: Readonly<Record<SolarTopologyVariantId, {
  readonly control: readonly string[]
  readonly inverter: readonly string[]
}>> = Object.freeze({
  architecture: { control: ['f5185f9'], inverter: ['f7bf477'] },
  business: { control: [], inverter: [] },
  'business-key-process': {
    control: ['75722e8b', 'c263844'],
    inverter: ['f007964', '7c754099'],
  },
  'key-process': {
    control: ['0f400f1', '1a75b51e'],
    inverter: ['119a9aa6', 'f7331d4'],
  },
  network: { control: ['7c5436', '32f050f8'], inverter: [] },
  'network-business': { control: ['0e822c6', '3a0e7852'], inverter: [] },
  'network-business-key-process': {
    control: ['49e49f47', '7ca1b67a'],
    inverter: ['6940ceef', 'ebd260c'],
  },
  'network-key-process': {
    control: ['447525ed', '77928430'],
    inverter: ['49fcb5e6', '93065bc'],
  },
  'process-detail-solar-inverter': { control: ['df25e45'], inverter: ['2cf7b170'] },
})

/** 去除图片字段后比较完整图元，确保四态投影不会改变编号、几何、文字或连线数据。 */
function omitImage(pen: Pen): Omit<Pen, 'image'> {
  const { image: _image, ...unchangedPen } = pen
  return unchangedPen
}

describe('光伏逆变器四态资源清单', () => {
  for (const variant of SOLAR_TOPOLOGY_VARIANT_BY_ID.values()) {
    it(`${variant.id} 只登记逆变器控制与逆变器实体，并为四态提供真实公共资源`, () => {
      const expected = EXPECTED_DEVICE_PENS[variant.id]
      const manifest = getSolarTopologyResourceManifest(variant.id)
      const allExpectedPenIds = [...expected.control, ...expected.inverter]

      expect([...manifest.devicePenIds]).toEqual(allExpectedPenIds)
      for (const penId of expected.control) {
        expect(manifest.deviceIconPathByPenId.get(penId)).toBe('icons/normal/dcs.webp')
      }
      for (const penId of expected.inverter) {
        expect(manifest.deviceIconPathByPenId.get(penId)).toBe('icons/normal/solar.webp')
      }

      // 每个登记图元的四态路径都必须落到实际发布文件，避免运行时切态后出现空图。
      for (const penId of allExpectedPenIds) {
        for (const status of statuses) {
          const relativePath = getSolarTopologyPreviewIconPath(variant.id, penId, status)
          expect(relativePath).toBeTruthy()
          expect(existsSync(resolve(sharedRoot, relativePath!))).toBe(true)
        }
      }
    })
  }
})

describe('光伏状态投影边界', () => {
  for (const variant of SOLAR_TOPOLOGY_VARIANT_BY_ID.values()) {
    it(`${variant.id} 切换四态只替换目标图片，不改变图元数量和几何`, () => {
      const sourcePath = resolve('public/topology/solar-json-preview', variant.topologyPath)
      const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as Meta2dData
      const expected = EXPECTED_DEVICE_PENS[variant.id]
      const targetPenIds = [...expected.control, ...expected.inverter]
      const bindings = targetPenIds.map((penId) => ({
        penId,
        nodeId: toProcessNodeId(`solar-status-test.${penId}`),
      }))

      for (const status of statuses) {
        const projected = structuredClone(source)
        const beforeWithoutImages = projected.pens.map(omitImage)
        const beforeImages = new Map(projected.pens.map((pen) => [pen.id, pen.image]))
        const applied = projectSolarTopologyStatusesBeforeOpen(
          projected,
          variant.id,
          bindings,
          () => true,
          () => status,
        )

        expect(projected.pens).toHaveLength(source.pens.length)
        expect(projected.pens.map(omitImage)).toEqual(beforeWithoutImages)
        expect([...applied.keys()]).toEqual(targetPenIds)
        for (const pen of projected.pens) {
          if (!pen.id || !targetPenIds.includes(pen.id)) {
            expect(pen.image).toBe(beforeImages.get(pen.id))
            continue
          }
          expect(pen.image).toContain(`/topology/shared/icons/${status}/`)
        }
      }
    })
  }
})
