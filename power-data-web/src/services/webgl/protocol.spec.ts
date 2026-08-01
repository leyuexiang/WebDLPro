import { describe, expect, it } from 'vitest'
import {
  createWebglCommand,
  isWebglMessageEnvelope,
  isWebglReadyPayload,
  isWebglRequestAcknowledgementPayload,
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
    const command = createWebglCommand('instance-1', 'message-1', 'focusNode', { nodeId: 'unit.demo.1' })

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
})
