import { describe, expect, it } from 'vitest'
import { createWebglCommand, isWebglMessageEnvelope, parseExactOrigin } from './protocol'

/** 协议测试覆盖来源精确性与最小信封校验，防止通信安全边界退化为通配来源。 */
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
})
