import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Meta2dData } from '@meta2d/core'
import { describe, expect, it } from 'vitest'
import {
  SOLAR_PROCESS_DETAIL_VARIANTS,
  SOLAR_TOPOLOGY_VARIANTS,
} from './solar-topology-variant-manifest'

const topologyRoot = resolve(process.cwd(), 'public/topology/solar-json-preview')

/** 统一核验来源字节、图元数和编号，防止第三层文件被第二层组合或旧副本误替换。 */
function verifyVariant(variant: {
  readonly topologyPath: string
  readonly sourceSha256: string
  readonly expectedPenCount: number
}, verifySourceBytes = true): void {
  const file = resolve(topologyRoot, variant.topologyPath)
  expect(existsSync(file)).toBe(true)
  const bytes = readFileSync(file)
  // 旧第二层文件曾做过受控公共资源路径本地化，清单保留的是原压缩包散列；本次第三层原样归档才锁定当前文件字节。
  if (verifySourceBytes) expect(createHash('sha256').update(bytes).digest('hex')).toBe(variant.sourceSha256)
  const data = JSON.parse(bytes.toString('utf8')) as Meta2dData
  expect(data.pens).toHaveLength(variant.expectedPenCount)
  expect(new Set(data.pens.map((pen) => pen.id)).size).toBe(data.pens.length)
}

describe('光伏拓扑版本清单', () => {
  it('八份第二层文件继续按组合键独立登记', () => {
    expect(SOLAR_TOPOLOGY_VARIANTS).toHaveLength(8)
    expect(SOLAR_TOPOLOGY_VARIANTS.filter((variant) => 'isDefault' in variant)).toHaveLength(1)
    for (const variant of SOLAR_TOPOLOGY_VARIANTS) verifyVariant(variant, false)
  })

  it('逆变器第三层只登记唯一完整文件且不携带筛选字段', () => {
    expect(SOLAR_PROCESS_DETAIL_VARIANTS).toHaveLength(1)
    const detail = SOLAR_PROCESS_DETAIL_VARIANTS[0]
    expect(detail).toEqual(expect.objectContaining({
      id: 'process-detail-solar-inverter',
      isProcessDetail: true,
      expectedPenCount: 19,
    }))
    expect(detail).not.toHaveProperty('layerIds')
    expect(detail).not.toHaveProperty('combinationKey')
    verifyVariant(detail)
  })
})
