import { describe, expect, it } from 'vitest'
import { createEmbeddedShellDiagnostic } from '@/app/embedded-shell-diagnostics'

/** 任务-006回归：嵌入壳只显示固定错误码和关联标识，不从异常对象透传诊断细节。 */
describe('嵌入壳诊断模型', () => {
  it('为基础状态生成固定错误码和关联标识', () => {
    expect(createEmbeddedShellDiagnostic('configuration-error', {
      reason: '部署配置未通过安全校验。',
      correlationId: 'embedded-shell-test-01',
    })).toEqual({
      kind: 'configuration-error',
      code: 'deployment.invalid',
      reason: '部署配置未通过安全校验。',
      correlationId: 'embedded-shell-test-01',
    })
  })

  it('仅允许清单读取器声明的额外稳定失败码覆盖拓扑错误默认码', () => {
    expect(createEmbeddedShellDiagnostic('topology-error', {
      reason: '场景拓扑清单在限定时间内未完成读取。',
      correlationId: 'embedded-shell-test-02',
      code: 'manifest.timeout',
    })).toMatchObject({
      kind: 'topology-error',
      code: 'manifest.timeout',
      correlationId: 'embedded-shell-test-02',
    })
  })
})
