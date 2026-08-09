import { describe, expect, it } from 'vitest'
import { shouldInstallWorkflowTrigger } from '@/modules/visual/orchestration/workflow-trigger-capability'

describe('shouldInstallWorkflowTrigger', () => {
  it('清单没有动作时不安装或向父页面声明流程触发能力', () => {
    expect(shouldInstallWorkflowTrigger({ actions: [] })).toBe(false)
  })

  it('清单登记至少一个动作时才安装流程触发能力', () => {
    // 本测试只校验能力门禁的常数时间判断；动作内容仍由完整清单校验器负责验证。
    expect(shouldInstallWorkflowTrigger({ actions: [{}] as never })).toBe(true)
  })
})
