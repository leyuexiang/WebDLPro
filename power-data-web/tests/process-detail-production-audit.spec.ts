import { describe, expect, it } from 'vitest'
import { auditProcessDetailProduction } from '../scripts/audit-process-detail-production.mjs'
import { validateProcessDetailTopologies } from '../scripts/process-detail-topology-contract.mjs'

/**
 * 静态审计只扫描名称明确属于新第三层的生产模块，并另外核对正式清单。
 * 共享桥接器可以保留第二层历史命令声明，但新第三层不得反向调用这些旧视觉路径。
 */
describe('第三层生产隔离与独立拓扑审计', () => {
  it('三项第三层动作、实现和独立拓扑均满足现行合同', async () => {
    const result = await auditProcessDetailProduction('process-detail-static-audit-test')

    expect(result.files.length).toBeGreaterThan(0)
    expect(result.issues).toEqual([])
  })

  it('不存在的拓扑根目录会逐项报告三份缺失文件', async () => {
    // 直接验证共享合同的负向路径，避免测试修改项目中的正式拓扑文件。
    const issues = await validateProcessDetailTopologies('Z:/不存在的第三层拓扑目录')

    expect(issues).toHaveLength(3)
    expect(issues.every((issue) => issue.code === 'process-detail.topology-missing')).toBe(true)
  })
})
