import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const commandPath = 'scripts/compare-visual-baseline.mjs'
const standardBaselinePath = 'tests/visual-regression/baselines/double-container-1280x720.jpg'
const minimumBaselinePath = 'tests/visual-regression/baselines/double-container-600x600.jpg'

/**
 * 视觉比对只通过真实命令入口测试，确保参数限制、JPEG 解码、有限 JSON（JavaScript对象表示法）报告和退出码保持一致。
 * 差异图用例只创建并删除自己的固定隐藏临时文件；两个实际尺寸已核验的已提交基准
 * 分别用于同图通过和尺寸不一致失败，测试不再依赖曾被错误标记为3440×1440的裁剪图片。
 */
function runVisualComparison(argumentsList: string[]): { status: number | null; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [commandPath, ...argumentsList], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    const commandError = error as { status?: number | null; stdout?: string | Buffer; stderr?: string | Buffer }
    return {
      status: commandError.status ?? null,
      stdout: String(commandError.stdout ?? ''),
      stderr: String(commandError.stderr ?? ''),
    }
  }
}

describe('双容器视觉基准比对命令', () => {
  it('同一张已提交常规基准图在默认阈值内通过', () => {
    const result = runVisualComparison(['--baseline', standardBaselinePath, '--actual', standardBaselinePath])
    const report = JSON.parse(result.stdout) as { status: string; comparison: { changedPixelCount: number; meanAbsoluteError: number } }

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(report.status).toBe('passed')
    expect(report.comparison.changedPixelCount).toBe(0)
    expect(report.comparison.meanAbsoluteError).toBe(0)
  })

  it('可在预先存在的工作区目录中生成不可覆盖的JPEG差异图', () => {
    const differencePath = 'tests/fixtures/.visual-diff.generated.jpg'
    const differenceFilePath = `${process.cwd()}/${differencePath}`
    rmSync(differenceFilePath, { force: true })

    try {
      const result = runVisualComparison(['--baseline', standardBaselinePath, '--actual', standardBaselinePath, '--diff', differencePath])
      const report = JSON.parse(result.stdout) as { status: string; diffPath?: string }

      expect(result.status).toBe(0)
      expect(report).toMatchObject({ status: 'passed', diffPath: differencePath })
      expect(existsSync(differenceFilePath)).toBe(true)
      expect(readFileSync(differenceFilePath).subarray(0, 2).toString('hex')).toBe('ffd8')
    } finally {
      rmSync(differenceFilePath, { force: true })
    }
  })

  it('尺寸不同的最小画布截图必须以非零退出码失败', () => {
    const result = runVisualComparison(['--baseline', standardBaselinePath, '--actual', minimumBaselinePath])
    const report = JSON.parse(result.stdout) as { status: string; comparison: { compatible: boolean; changedPixelRatio: number } }

    expect(result.status).toBe(1)
    expect(report.status).toBe('failed')
    expect(report.comparison.compatible).toBe(false)
    expect(report.comparison.changedPixelRatio).toBe(100)
  })

  it('绝对路径和工作区外路径会在读取图片前被拒绝', () => {
    const result = runVisualComparison(['--baseline', 'C:/outside.jpg', '--actual', standardBaselinePath])

    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('--baseline必须使用工作区内相对路径。')
  })

  it('差异图路径不能覆盖已提交的基准图', () => {
    const result = runVisualComparison(['--baseline', standardBaselinePath, '--actual', standardBaselinePath, '--diff', standardBaselinePath])

    expect(result.status).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('--diff不能覆盖基准图或当前图。')
  })
})
