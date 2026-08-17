import { describe, expect, it } from 'vitest'
import {
  createContainerTooSmallReason,
  createEmbeddedShellDiagnostic,
} from '@/app/embedded-shell-diagnostics'

/** 任务-006回归：嵌入壳只保留受控诊断，不从异常对象透传细节；普通生命周期提示不展示技术字段。 */
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

  it('尺寸不足提示包含与部署配置一致的最小宽高', () => {
    expect(createContainerTooSmallReason(1280, 720)).toBe(
      '当前窗口可用区域不足，请将窗口调整至不小于 1280 × 720 像素后重试。',
    )
  })
})
