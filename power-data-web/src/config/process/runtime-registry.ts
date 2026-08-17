import { toRuntimeKey } from '@/config/process/identifiers'
import type { RuntimeKey } from '@/config/process/identifiers'
import { LOCAL_PROCESS_CONFIG_VERSION } from '@/config/process/config-version'
import { readDeploymentConfiguration, type DeploymentConfigurationLoadResult } from '@/config/deployment/deployment-config'
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
 * 运行时地址、外层来源、Unity 直接父来源和清单地址统一从部署配置读取。
 * 开发模式的本机地址只存在于部署配置读取器的编译期回退中；生产环境缺少正式配置时
 * 不生成运行时登记，因此无法把本地端口或任意 iframe 地址带入正式运行。
 */
const deploymentConfigurationResult = readDeploymentConfiguration()

/** 部署配置失败时保留稳定问题码，嵌入壳据此显示安全错误态而不输出原始环境变量。 */
export const deploymentConfigurationIssues = deploymentConfigurationResult.issues

/**
 * 只有部署配置完整时才发布燃气基线登记；构造时不接受业务页面提供的 URL。
 * 测试可显式传入受控读取结果，生产代码只能使用当前构建环境的全局读取结果。
 */
export function createRuntimeRegistry(configurationResult: DeploymentConfigurationLoadResult): ReadonlyWebglRuntimeRegistry {
  const registrations: readonly WebglRuntimeRegistration[] = configurationResult.configuration
    ? [
      {
        runtimeKey: toRuntimeKey('gas-plant-release'),
        buildId: 'local-webgl-topology-link',
        configVersion: LOCAL_PROCESS_CONFIG_VERSION,
        sceneMappingVersion: LOCAL_PROCESS_CONFIG_VERSION,
        protocolVersion: WEBGL_PROTOCOL_VERSION,
        resourceDigest: 'local-webgl-topology-link',
        entryUrl: configurationResult.configuration.unityEntryUrl,
        childOrigin: configurationResult.configuration.unityChildOrigin,
        // Unity iframe 的直接父窗口是本嵌入壳；必须使用独立精确来源，不能错误沿用外层宿主页来源。
        allowedParentOrigin: configurationResult.configuration.unityParentOrigin,
        capabilities: ['init', 'resize', 'switchScene', 'enterProcessStep', 'resetScene', 'focusNode', 'clearSelection', 'setNodeVisualState', 'clearNodeVisualState', 'setRouteFlow', 'setNodeVisibility', 'dispose'],
        eventCapabilities: ['ready', 'ack', 'commandResult', 'sceneLoadProgress', 'sceneChanged', 'objectSelected', 'disposed'],
        resourceBudget: {
          initialMemoryMb: 256,
          maxConcurrentInstances: 1,
          cacheMode: 'none',
        },
      },
      ]
    : []

  return new ReadonlyWebglRuntimeRegistry(registrations)
}

export const localWebglRuntimeRegistry = createRuntimeRegistry(deploymentConfigurationResult)

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
