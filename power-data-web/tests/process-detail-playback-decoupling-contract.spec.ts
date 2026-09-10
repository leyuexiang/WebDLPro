import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** 自测发布页通过受控播放命令验证第三层动态；设备四态仅用于独立的状态投影测试。 */
describe('关键环节播放与四态解耦契约', () => {
  const buildSource = readFileSync(`${process.cwd()}/scripts/build-gas-power-smoke-release.mjs`, 'utf8')

  it('自测页生成独立播放/停止按钮且与设备状态切换解耦', () => {
    expect(buildSource).toContain('data-device-status="normal"')
    expect(buildSource).toContain("sendCommand('device.states.update'")
    expect(buildSource).not.toContain('gas-turbine-self-test-state-')
    expect(buildSource).not.toContain("pendingDetailPlaybackStatus === 'fault'")
    expect(buildSource).toContain('data-playback="play"')
    expect(buildSource).toContain('data-playback="stop"')
    expect(buildSource).toContain("process-detail.playback")
  })
})
