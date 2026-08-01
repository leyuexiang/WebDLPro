import type { RuntimeKey } from '@/config/process/identifiers'
import type { ProcessConfigValidationIssue, WebglRuntimeRegistration } from '@/config/process/types'
import { isWebglCommandType, isWebglEventType, parseExactOrigin, WEBGL_PROTOCOL_VERSION } from '@/services/webgl/protocol'

/**
 * 只读网页图形运行时登记表。
 *
 * 业务页面只能声明 runtimeKey，真实入口地址、精确来源、能力清单、缓存及回滚策略
 * 均必须在这里经发布流程审核，防止业务配置把任意地址嵌入 iframe。
 */
export class ReadonlyWebglRuntimeRegistry {
  private readonly registrationsByKey: ReadonlyMap<RuntimeKey, WebglRuntimeRegistration>

  public constructor(registrations: readonly WebglRuntimeRegistration[]) {
    this.registrationsByKey = new Map(registrations.map((registration) => [registration.runtimeKey, Object.freeze(registration)]))
  }

  /** 按稳定键查询单份登记，不暴露可写的内部集合。 */
  public get(runtimeKey: RuntimeKey): WebglRuntimeRegistration | undefined {
    return this.registrationsByKey.get(runtimeKey)
  }

  /** 返回只读快照供发布检查使用，调用方不能修改登记表。 */
  public list(): readonly WebglRuntimeRegistration[] {
    return [...this.registrationsByKey.values()]
  }
}

/**
 * 本阶段不登记任何可启动的运行时。
 * 虽然 Unity WebGL 包已存在，但正式入口地址、父页面精确来源与部署资源版本尚未形成外部契约；
 * 空表会让页面明确降级，绝不会以本机路径或临时测试地址冒充生产运行时。
 */
export const localWebglRuntimeRegistry = new ReadonlyWebglRuntimeRegistry([])

/** 校验单个登记项的安全边界和资源约束。 */
export function validateRuntimeRegistration(runtime: WebglRuntimeRegistration): ProcessConfigValidationIssue[] {
  const issues: ProcessConfigValidationIssue[] = []
  const childOrigin = parseExactOrigin(runtime.childOrigin)
  const parentOrigin = parseExactOrigin(runtime.allowedParentOrigin)

  try {
    const entryUrl = new URL(runtime.entryUrl)

    if ((entryUrl.protocol !== 'http:' && entryUrl.protocol !== 'https:') || entryUrl.origin !== childOrigin) {
      issues.push({ code: 'runtime.entry-origin', message: '网页图形入口必须使用 HTTP(S) 且与登记子页面来源完全一致。' })
    }
  } catch {
    issues.push({ code: 'runtime.entry-url', message: '网页图形入口地址无效。' })
  }

  if (!childOrigin || !parentOrigin) {
    issues.push({ code: 'runtime.exact-origin', message: '父页面与网页图形来源必须是精确 HTTP(S) Origin。' })
  }

  if (runtime.protocolVersion !== WEBGL_PROTOCOL_VERSION) {
    issues.push({ code: 'runtime.protocol-version', message: '网页图形协议版本与前端固定协议版本不一致。' })
  }

  if (runtime.resourceBudget.initialMemoryMb <= 0 || runtime.resourceBudget.maxConcurrentInstances !== 1) {
    issues.push({ code: 'runtime.resource-budget', message: '网页图形运行时必须声明正数内存预算并限制为单实例。' })
  }

  if (!runtime.resourceDigest) {
    issues.push({ code: 'runtime.resource-digest', message: '网页图形运行时必须声明资源摘要。' })
  }

  if (!runtime.capabilities.includes('init') || !runtime.capabilities.includes('dispose') || !runtime.capabilities.every(isWebglCommandType)) {
    issues.push({ code: 'runtime.command-capabilities', message: '网页图形运行时必须声明合法的初始化、释放及命令能力。' })
  }

  if (!runtime.eventCapabilities.includes('ready') || !runtime.eventCapabilities.includes('disposed') || !runtime.eventCapabilities.every(isWebglEventType)) {
    issues.push({ code: 'runtime.event-capabilities', message: '网页图形运行时必须声明合法的就绪、释放及事件能力。' })
  }

  return issues
}
