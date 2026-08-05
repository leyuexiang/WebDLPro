import { describe, expect, it } from 'vitest'
import {
  createWebglCommand,
  isWebglMessageEnvelope,
  isWebglObjectSelectedPayload,
  isWebglEnterProcessStepPayload,
  isWebglReadyPayload,
  isWebglRequestAcknowledgementPayload,
  isWebglSceneChangedPayload,
  isWebglSceneLoadProgressPayload,
  isWebglSceneNodeCommandPayload,
  isWebglSetNodeVisibilityPayload,
  isWebglSetNodeVisualStatePayload,
  isWebglSetRouteFlowPayload,
  isWebglSwitchScenePayload,
  parseExactOrigin,
} from './protocol'

/** 协议测试覆盖精确来源、最小信封与就绪元数据，防止安全边界退化为宽松匹配。 */
describe('网页图形协议', () => {
  it('只接受精确的 HTTP 或 HTTPS 来源', () => {
    expect(parseExactOrigin('https://platform.example.com')).toBe('https://platform.example.com')
    expect(parseExactOrigin('https://platform.example.com/path')).toBeNull()
    expect(parseExactOrigin('https://platform.example.com?debug=true')).toBeNull()
    expect(parseExactOrigin('*')).toBeNull()
  })

  it('创建并识别合法命令信封', () => {
    const command = createWebglCommand('instance-1', 'message-1', 'focusNode', { sceneNodeId: 'unit.demo.1' })

    expect(isWebglMessageEnvelope(command)).toBe(true)
    expect(isWebglMessageEnvelope({ channel: 'wrong' })).toBe(false)
  })

  /** ready 必须显式提供构建、映射、资源摘要及上下行能力，前端不会从单个事件反推能力。 */
  it('校验就绪载荷和原始请求标识', () => {
    expect(
      isWebglReadyPayload({
        runtimeKey: 'gas-turbine',
        buildId: 'build-1',
        sceneMappingVersion: 'map-1',
        protocolVersion: 1,
        resourceDigest: 'sha256:demo',
        commandCapabilities: ['init', 'dispose'],
        eventCapabilities: ['ready', 'disposed'],
      }),
    ).toBe(true)
    expect(isWebglReadyPayload({ runtimeKey: 'gas-turbine', commandCapabilities: [] })).toBe(false)
    expect(isWebglRequestAcknowledgementPayload({ requestId: 'message-1' })).toBe(true)
    expect(isWebglRequestAcknowledgementPayload({ messageId: 'message-1' })).toBe(false)
  })

  /** 场景协议把场景、事务、映射版本和原请求关联固定为不可拆分的受控载荷。 */
  it('拒绝缺失标识、错误完成状态或越界进度的场景切换载荷', () => {
    const switchPayload = { sceneId: 'gas-power', transitionId: 'transition-1', sceneMappingVersion: 'mapping-1' }
    expect(isWebglSwitchScenePayload(switchPayload)).toBe(true)
    expect(isWebglSwitchScenePayload({ ...switchPayload, transitionId: '' })).toBe(false)

    const progressPayload = {
      requestId: 'request-1',
      sceneId: 'gas-power',
      transitionId: 'transition-1',
      stageCode: 'loading-scene',
      progress: 0.6,
    }
    expect(isWebglSceneLoadProgressPayload(progressPayload)).toBe(true)
    expect(isWebglSceneLoadProgressPayload({ ...progressPayload, progress: 1.1 })).toBe(false)
    expect(isWebglSceneLoadProgressPayload({ ...progressPayload, stageCode: 'unexpected-stage' })).toBe(false)

    expect(isWebglSceneChangedPayload({ requestId: 'request-1', sceneId: 'gas-power', transitionId: 'transition-1', success: true })).toBe(true)
    expect(isWebglSceneChangedPayload({ requestId: 'request-1', sceneId: 'gas-power', transitionId: 'transition-1', success: false })).toBe(false)
  })

  /** 动作命令必须只携带稳定映射标识与固定枚举，不能夹带二维节点、路径对象或任意材质参数。 */
  it('校验流程、三维节点、四态状态和路径动作载荷', () => {
    expect(isWebglEnterProcessStepPayload({ processId: 'gas-power-generation', stepId: 'gas-turbine', unitId: 'unit-01', isolate: true })).toBe(true)
    expect(isWebglEnterProcessStepPayload({ processId: 'gas-power-generation', stepId: '', isolate: true })).toBe(false)

    expect(isWebglSceneNodeCommandPayload({ sceneNodeId: 'node.gas-turbine', isolate: true })).toBe(true)
    expect(isWebglSceneNodeCommandPayload({ nodeId: 'node.gas-turbine', isolate: true })).toBe(false)
    expect(isWebglSetNodeVisualStatePayload({ sceneNodeId: 'node.gas-turbine', visualState: 'alarm' })).toBe(true)
    expect(isWebglSetNodeVisualStatePayload({ sceneNodeId: 'node.gas-turbine', visualState: 'custom-color' })).toBe(false)
    expect(isWebglSetRouteFlowPayload({ routeId: 'route.gas-to-grid', enabled: true })).toBe(true)
    expect(isWebglSetRouteFlowPayload({ routeId: '', enabled: true })).toBe(false)
    expect(isWebglSetNodeVisibilityPayload({ sceneNodeId: 'node.gas-turbine', enabled: false })).toBe(true)
    expect(isWebglSetNodeVisibilityPayload({ sceneNodeId: 'node.gas-turbine', enabled: 'false' })).toBe(false)
  })

  it('对象选择只接受可映射的稳定三维节点标识，不接受对象名称、路径或超长字符串', () => {
    expect(isWebglObjectSelectedPayload({ nodeId: 'scene-node.gas-turbine' })).toBe(true)
    expect(isWebglObjectSelectedPayload({ nodeId: '燃气轮机对象' })).toBe(false)
    expect(isWebglObjectSelectedPayload({ nodeId: 'Assets/Scenes/GasPower.unity' })).toBe(false)
    expect(isWebglObjectSelectedPayload({ nodeId: 'a'.repeat(129) })).toBe(false)
  })
})
