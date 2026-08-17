import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalShellDeviceStateRetryController } from './local-shell-regression/host/device-state-retry-controller.js'

/** 每份夹具都是合法的非空完整状态表，避免测试通过正式协议拒绝的空数组伪造空绑定或清除语义。 */
function createSnapshot(sourceRevision: number, deviceStatus: 'alarm' | 'fault') {
  return {
    sourceRevision,
    items: [{ nodeId: 'node.gas.turbine', deviceStatus, statusUpdatedAt: '2026-08-14T00:00:00.000Z' }],
  }
}

describe('任务-014本地父页面状态检查契约', () => {
  afterEach(() => vi.useRealTimers())

  it('五秒检查跳过在途项，十秒超时后重新读取最新快照并以新标识发送', () => {
    vi.useFakeTimers()
    let latestSnapshot = createSnapshot(300, 'alarm')
    const attempts: Array<{ messageId: string, sourceRevision: number }> = []
    const skippedMessageIds: string[] = []
    const timedOutMessageIds: string[] = []
    let sequence = 0
    const controller = new LocalShellDeviceStateRetryController({
      readLatestSnapshot: () => latestSnapshot,
      sendSnapshot: (snapshot) => {
        const messageId = `parent-state-${++sequence}`
        attempts.push({ messageId, sourceRevision: snapshot.sourceRevision })
        return messageId
      },
      onSkipped: ({ messageId }) => skippedMessageIds.push(messageId),
      onTimeout: ({ messageId }) => timedOutMessageIds.push(messageId),
    })

    controller.start()
    expect(attempts).toEqual([{ messageId: 'parent-state-1', sourceRevision: 300 }])

    // 第一条仍在等待确认时，五秒检查必须跳过；随后数据源改变，但旧在途消息也不得被重发或替换。
    vi.advanceTimersByTime(5_000)
    latestSnapshot = createSnapshot(1, 'fault')
    expect(skippedMessageIds).toEqual(['parent-state-1'])
    expect(attempts).toHaveLength(1)

    // 十秒总截止释放槽位。由于周期检查与超时在同一时刻的调度顺序并非协议语义，下一检查最迟在十五秒发送。
    vi.advanceTimersByTime(5_000)
    expect(timedOutMessageIds).toEqual(['parent-state-1'])
    vi.advanceTimersByTime(5_000)

    expect(attempts).toEqual([
      { messageId: 'parent-state-1', sourceRevision: 300 },
      { messageId: 'parent-state-2', sourceRevision: 1 },
    ])
    expect(skippedMessageIds).not.toHaveLength(0)
    expect(controller.isAwaiting('parent-state-2')).toBe(true)

    expect(controller.handleCommandResult('parent-state-2', {
      success: true,
      status: 'completed',
      error: null,
    })).toBe('settled')
    expect(controller.isAwaiting('parent-state-2')).toBe(false)
    controller.stop()
  })

  it('显式不可恢复失败会阻断相同状态内容，只有状态变化后才以新标识发送', () => {
    vi.useFakeTimers()
    let latestSnapshot = createSnapshot(300, 'alarm')
    const sentMessageIds: string[] = []
    const blockedMessageIds: string[] = []
    const controller = new LocalShellDeviceStateRetryController({
      readLatestSnapshot: () => latestSnapshot,
      sendSnapshot: () => {
        const messageId = `parent-state-${sentMessageIds.length + 1}`
        sentMessageIds.push(messageId)
        return messageId
      },
      onNonRecoverableFailure: ({ messageId }) => blockedMessageIds.push(messageId),
    })

    controller.start()
    expect(controller.handleCommandResult('parent-state-1', {
      success: false,
      status: 'failed',
      error: { code: 'manifest.version.mismatch', message: '运行时清单不匹配。', stage: 'validation', recoverable: false },
    })).toBe('settled')

    // 仅更新来源修订号仍是同一设备状态内容，不能绕过不可恢复失败门禁。
    latestSnapshot = createSnapshot(1, 'alarm')
    vi.advanceTimersByTime(10_000)
    expect(sentMessageIds).toEqual(['parent-state-1'])
    expect(blockedMessageIds).toEqual(['parent-state-1'])

    latestSnapshot = createSnapshot(1, 'fault')
    vi.advanceTimersByTime(5_000)
    expect(sentMessageIds).toEqual(['parent-state-1', 'parent-state-2'])
    controller.stop()
  })

  it('收到真实释放结果会取消检查与十秒等待，旧会话不会继续生成重试命令', () => {
    vi.useFakeTimers()
    const sentMessageIds: string[] = []
    const controller = new LocalShellDeviceStateRetryController({
      readLatestSnapshot: () => createSnapshot(1, 'alarm'),
      sendSnapshot: () => {
        const messageId = `parent-state-${sentMessageIds.length + 1}`
        sentMessageIds.push(messageId)
        return messageId
      },
    })

    controller.start()
    expect(controller.isAwaiting('parent-state-1')).toBe(true)
    expect(controller.handleCommandResult('parent-dispose-1', {
      success: true,
      status: 'disposed',
      error: null,
    })).toBe('disposed')
    vi.advanceTimersByTime(20_000)

    expect(sentMessageIds).toEqual(['parent-state-1'])
    expect(controller.isAwaiting('parent-state-1')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
