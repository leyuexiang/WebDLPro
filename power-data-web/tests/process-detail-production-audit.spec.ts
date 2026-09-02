import { describe, expect, it } from 'vitest'
import { auditProcessDetailProduction } from '../scripts/audit-process-detail-production.mjs'

/**
 * 静态审计只扫描名称明确属于新第三层的生产模块，并另外核对正式清单。
 * 共享桥接器可以保留第二层历史命令声明，但新第三层不得反向调用这些旧视觉路径。
 */
describe('燃气轮机第三层生产隔离审计', () => {
  it('唯一第三层动作和实现不引用旧步骤过滤、半透明、描边或包围盒聚焦', async () => {
    const result = await auditProcessDetailProduction('process-detail-static-audit-test')

    expect(result.files.length).toBeGreaterThan(0)
    expect(result.issues).toEqual([])
  })
})
