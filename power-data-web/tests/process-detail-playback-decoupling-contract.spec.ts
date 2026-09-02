import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** 自测发布页通过受控播放命令验证第三层动态，不得再次用设备四态模拟独立播放控制。 */
describe('关键环节播放与四态解耦契约', () => {
  const buildSource = readFileSync(`${process.cwd()}/scripts/build-gas-power-smoke-release.mjs`, 'utf8')

  it('自测页生成独立播放/停止按钮且不使用设备四态模拟', () => {
    expect(buildSource).not.toContain('data-device-status=')
    expect(buildSource).not.toContain('gas-turbine-self-test-state-')
    expect(buildSource).not.toContain("pendingDetailPlaybackStatus === 'fault'")
    expect(buildSource).toContain('data-playback="play"')
    expect(buildSource).toContain('data-playback="stop"')
    expect(buildSource).toContain("process-detail.playback")
  })
})
