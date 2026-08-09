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
  isWebglFocusNodePayload,
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
    const command = createWebglCommand('instance-1', 'message-1', 'focusNode', {
      sceneNodeId: 'unit.demo.1',
      selectionId: 'selection.topology.01',
      isolate: false,
    })

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
    // 场景切换失败后 Unity 可能已经自动恢复旧场景；该失败回执必须允许携带恢复后新生成的物理实例标识。
    expect(isWebglRequestAcknowledgementPayload({ requestId: 'message-1', success: false, sceneActivationId: 'scene-activation.restored-1' })).toBe(true)
    expect(isWebglRequestAcknowledgementPayload({ requestId: 'message-1', success: false, sceneActivationId: '' })).toBe(false)
    expect(isWebglRequestAcknowledgementPayload({ messageId: 'message-1' })).toBe(false)
  })

  /** 场景协议把场景、事务、映射版本和原请求关联固定为不可拆分的受控载荷。 */
  it('拒绝缺失标识、错误完成状态或越界进度的场景切换载荷', () => {
    const switchPayload = { sceneId: 'gas-power', transitionId: 'transition-1', sceneMappingVersion: 'mapping-1', forceReload: false }
    expect(isWebglSwitchScenePayload(switchPayload)).toBe(true)
    expect(isWebglSwitchScenePayload({ ...switchPayload, forceReload: true })).toBe(true)
    expect(isWebglSwitchScenePayload({ ...switchPayload, transitionId: '' })).toBe(false)
    expect(isWebglSwitchScenePayload({ sceneId: 'gas-power', transitionId: 'transition-1', sceneMappingVersion: 'mapping-1' })).toBe(false)
    expect(isWebglSwitchScenePayload({ ...switchPayload, forceReload: 'true' })).toBe(false)

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

    const changedPayload = { requestId: 'request-1', sceneId: 'gas-power', transitionId: 'transition-1', sceneActivationId: 'scene-activation.gas-1', success: true }
    expect(isWebglSceneChangedPayload(changedPayload)).toBe(true)
    expect(isWebglSceneChangedPayload({ ...changedPayload, sceneActivationId: '' })).toBe(false)
    expect(isWebglSceneChangedPayload({ ...changedPayload, success: false })).toBe(false)
  })

  /** 动作命令必须只携带稳定映射标识与固定枚举，不能夹带二维节点、路径对象或任意材质参数。 */
  it('校验流程、三维节点、四态状态和路径动作载荷', () => {
    expect(isWebglEnterProcessStepPayload({ processId: 'gas-power-generation', stepId: 'gas-turbine', unitId: 'unit-01', isolate: true })).toBe(true)
    expect(isWebglEnterProcessStepPayload({ processId: 'gas-power-generation', stepId: '', isolate: true })).toBe(false)

    expect(isWebglFocusNodePayload({ sceneNodeId: 'node.gas-turbine', selectionId: 'selection.topology.01', isolate: true })).toBe(true)
    expect(isWebglFocusNodePayload({ sceneNodeId: 'node.gas-turbine', isolate: true })).toBe(false)
    expect(isWebglFocusNodePayload({ nodeId: 'node.gas-turbine', selectionId: 'selection.topology.01', isolate: true })).toBe(false)
    const visualStatePayload = {
      sceneNodeId: 'node.gas-turbine',
      visualState: 'alarm',
      statusUpdatedAt: '2026-08-08T10:00:00.000Z',
      hasSourceRevision: true,
      sourceRevision: 5,
    }
    expect(isWebglSetNodeVisualStatePayload(visualStatePayload)).toBe(true)
    expect(isWebglSetNodeVisualStatePayload({ ...visualStatePayload, sourceRevision: 0 })).toBe(true)
    expect(isWebglSetNodeVisualStatePayload({ ...visualStatePayload, hasSourceRevision: false, sourceRevision: 0 })).toBe(true)
    expect(isWebglSetNodeVisualStatePayload({ ...visualStatePayload, hasSourceRevision: false })).toBe(false)
    expect(isWebglSetNodeVisualStatePayload({ ...visualStatePayload, sourceRevision: -1 })).toBe(false)
    expect(isWebglSetNodeVisualStatePayload({ ...visualStatePayload, sourceRevision: 1.5 })).toBe(false)
    expect(isWebglSetNodeVisualStatePayload({ ...visualStatePayload, sourceRevision: Number.MAX_SAFE_INTEGER + 1 })).toBe(false)
    expect(isWebglSetNodeVisualStatePayload({ sceneNodeId: 'node.gas-turbine', visualState: 'alarm', statusUpdatedAt: '2026-08-08T10:00:00.000Z' })).toBe(false)
    expect(isWebglSetNodeVisualStatePayload({ sceneNodeId: 'node.gas-turbine', visualState: 'custom-color' })).toBe(false)
    expect(isWebglSetNodeVisualStatePayload({ sceneNodeId: 'node.gas-turbine', visualState: 'alarm' })).toBe(false)
    expect(isWebglSetNodeVisualStatePayload({ sceneNodeId: 'node.gas-turbine', visualState: 'alarm', statusUpdatedAt: 'not-a-time' })).toBe(false)
    expect(isWebglSetRouteFlowPayload({ routeId: 'route.gas-to-grid', enabled: true })).toBe(true)
    expect(isWebglSetRouteFlowPayload({ routeId: '', enabled: true })).toBe(false)
    expect(isWebglSetNodeVisibilityPayload({ sceneNodeId: 'node.gas-turbine', enabled: false })).toBe(true)
    expect(isWebglSetNodeVisibilityPayload({ sceneNodeId: 'node.gas-turbine', enabled: 'false' })).toBe(false)
  })

  it('对象选择只接受可映射的稳定三维节点标识，不接受对象名称、路径或超长字符串', () => {
    const objectSelectedPayload = { sceneId: 'gas-power', sceneNodeId: 'scene-node.gas-turbine', sceneActivationId: 'scene-activation.gas-1' }
    expect(isWebglObjectSelectedPayload(objectSelectedPayload)).toBe(true)
    expect(isWebglObjectSelectedPayload({ ...objectSelectedPayload, sceneNodeId: '燃气轮机对象' })).toBe(false)
    expect(isWebglObjectSelectedPayload({ ...objectSelectedPayload, sceneNodeId: 'Assets/Scenes/GasPower.unity' })).toBe(false)
    expect(isWebglObjectSelectedPayload({ ...objectSelectedPayload, sceneNodeId: 'a'.repeat(129) })).toBe(false)
    expect(isWebglObjectSelectedPayload({ ...objectSelectedPayload, sceneId: 'unregistered-scene' })).toBe(false)
    expect(isWebglObjectSelectedPayload({ ...objectSelectedPayload, sceneActivationId: '' })).toBe(false)
    // 对象名称和其他扩展字段一律拒绝，防止旧 Unity 构建把未经映射的内部文本带入选择链路。
    expect(isWebglObjectSelectedPayload({ ...objectSelectedPayload, nodeName: '燃气轮机对象' })).toBe(false)
    // 即使字符串格式正确，旧二维字段也不允许被前端猜测为三维对象标识。
    expect(isWebglObjectSelectedPayload({ sceneId: 'gas-power', nodeId: 'scene-node.gas-turbine', sceneActivationId: 'scene-activation.gas-1' })).toBe(false)
  })
})
