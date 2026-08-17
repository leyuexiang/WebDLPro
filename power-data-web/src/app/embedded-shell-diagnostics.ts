/** 嵌入壳可展示的有限运行状态；错误代码可供父页面或受控日志关联，不携带原始外部载荷。 */
export type EmbeddedShellDiagnosticKind =
  | 'initializing'
  | 'container-too-small'
  | 'configuration-error'
  | 'unity-error'
  | 'topology-error'
  | 'startup-timeout'
  | 'released'

/** 每个状态都有稳定代码和安全默认说明，组件只渲染此模型而不直接渲染异常对象。 */
export interface EmbeddedShellDiagnostic {
  kind: EmbeddedShellDiagnosticKind
  code: string
  reason: string
  correlationId?: string
}

/** 可展示的额外稳定失败码；仅允许清单读取器已声明的有限集合进入界面。 */
export type EmbeddedShellAdditionalDiagnosticCode =
  | 'manifest.http-status'
  | 'manifest.package-not-found'
  | 'manifest.file-missing'
  | 'manifest.payload'
  | 'manifest.timeout'
  | 'manifest.aborted'
  | 'manifest.network'
  | 'manifest.cache-policy'
  | 'manifest.invalid'

/** 统一构造诊断，调用方只能替换已脱敏的原因、关联标识和有限额外失败码。 */
export function createEmbeddedShellDiagnostic(
  kind: EmbeddedShellDiagnosticKind,
  options: Readonly<Pick<EmbeddedShellDiagnostic, 'reason' | 'correlationId'> & { code?: EmbeddedShellAdditionalDiagnosticCode }>,
): EmbeddedShellDiagnostic {
  const codeByKind: Record<EmbeddedShellDiagnosticKind, string> = {
    initializing: 'runtime.initializing',
    'container-too-small': 'container.too-small',
    'configuration-error': 'deployment.invalid',
    'unity-error': 'unity.runtime-failed',
    'topology-error': 'topology.invalid',
    'startup-timeout': 'runtime.startup-timeout',
    released: 'runtime.disposed',
  }

  return {
    kind,
    code: options.code ?? codeByKind[kind],
    reason: options.reason,
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
  }
}

/**
 * 使用已经通过部署配置校验的宽高生成尺寸提示，确保界面文案与运行时比较条件共用同一阈值。
 * “不小于”与实际的小于号判断严格对应：宽高恰好达到阈值时即可正常运行。
 */
export function createContainerTooSmallReason(minimumWidth: number, minimumHeight: number): string {
  return `当前窗口可用区域不足，请将窗口调整至不小于 ${minimumWidth} × ${minimumHeight} 像素后重试。`
}

/**
 * 为当前壳生命周期生成有限长度的关联标识。
 * 随机接口不可用时仍附加时间和伪随机片段，且该标识仅用于错误关联，不承担授权职责。
 */
export function createEmbeddedShellCorrelationId(): string {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `embedded-shell-${randomPart}`.slice(0, 128)
}
