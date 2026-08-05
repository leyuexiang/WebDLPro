import type { InjectionKey, Ref } from 'vue'
import type { WebglRuntimeRegistration } from '@/config/process/types'
import type { WebglCommandType, WebglObjectSelectedPayload } from '@/services/webgl/protocol'

/**
 * 可视化布局唯一宿主对外公开的生命周期状态。
 * iframe、Window、计时器与 ResizeObserver 均留在宿主内部，不会写入 Pinia 或传给业务页面。
 */
export type VisualizationRuntimeLifecycle =
  | 'idle'
  | 'creating'
  | 'handshaking'
  | 'ready'
  | 'switching'
  | 'releasing'
  | 'disposed'
  | 'failed'

/** 业务页面订阅到的对象选中事件只包含稳定业务标识，不暴露 Unity 层级或跨窗口对象。 */
export interface VisualizationObjectSelection {
  payload: WebglObjectSelectedPayload
  messageId: string
}

/** 编排层等待内层命令时只得到成功或失败，不得到 iframe、消息信封或 Unity 回执正文。 */
export interface VisualizationRuntimeCommandResult {
  success: boolean
}

/**
 * 业务组件唯一可使用的运行时门面。
 * acquire、release 与 sendCommand 都由宿主进一步校验；页面层不拥有 iframe，也不能碰 postMessage。
 */
export interface VisualizationRuntimeHostController {
  readonly status: Readonly<Ref<VisualizationRuntimeLifecycle>>
  readonly reason: Readonly<Ref<string | null>>
  readonly capabilities: Readonly<Ref<readonly WebglCommandType[]>>
  registerViewport: (viewport: HTMLElement) => () => void
  acquire: (runtime: WebglRuntimeRegistration) => void
  release: (runtimeKey?: string) => void
  /** 等待内层确认释放或本地兜底清理完成；调用方只得到有限成功摘要，不访问 iframe 或连接器。 */
  releaseAndWait: (runtimeKey?: string) => Promise<VisualizationRuntimeCommandResult>
  sendCommand: (command: Exclude<WebglCommandType, 'init'>, payload: unknown) => string | undefined
  /** 基于连接器已经校验的原请求回执完成等待；失败、超时和释放都会结算，不保留悬挂 Promise。 */
  sendCommandAndWait: (command: Exclude<WebglCommandType, 'init'>, payload: unknown) => Promise<VisualizationRuntimeCommandResult>
  subscribeObjectSelected: (listener: (selection: VisualizationObjectSelection) => void) => () => void
}

/** 可视化布局提供的单例依赖键；工艺页只能通过该键获取受控门面。 */
export const visualizationRuntimeHostKey: InjectionKey<VisualizationRuntimeHostController> = Symbol('visualization-runtime-host')
