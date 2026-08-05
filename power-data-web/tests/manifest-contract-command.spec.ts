import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const commandPath = 'scripts/validate-scene-topology-manifest.mjs'
const releaseBuildCommandPath = 'scripts/build-release.mjs'

/**
 * 通过真实命令行执行发布门禁，而非只直接调用校验函数。
 * 这样可验证脚本会加载与运行时相同的校验器、输出有限 JSON（JavaScript对象表示法）报告，
 * 并将无效清单转换为可供持续集成识别的非零退出码。
 */
function runContractCommand(manifestPath: string, reportPath?: string): { status: number | null; stdout: string; stderr: string } {
  const argumentsList = [commandPath, '--manifest', manifestPath]
  if (reportPath) argumentsList.push('--report', reportPath)

  try {
    const stdout = execFileSync(process.execPath, argumentsList, {
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

/** 发布构建的无效清单路径必须在启动生产构建前原样失败，防止被构建步骤意外吞掉退出码。 */
function runReleaseBuildCommand(manifestPath: string): { status: number | null; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [releaseBuildCommandPath, '--manifest', manifestPath], {
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

describe('场景拓扑发布契约命令', () => {
  it('完整九场景夹具生成有效且不泄露绝对路径的报告', () => {
    const result = runContractCommand('tests/fixtures/scene-topology-contract-valid.json')

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      status: 'valid',
      manifestPath: 'tests/fixtures/scene-topology-contract-valid.json',
      issueCount: 0,
      issues: [],
    })
  })

  it('可将同一份有限报告写入工作区内指定位置，供发布流水线归档', () => {
    const reportPath = 'tests/fixtures/.scene-topology-contract-report.generated.json'
    const reportFilePath = `${process.cwd()}/${reportPath}`
    // 测试只清理自己的固定临时报告，绝不枚举或删除 fixtures（测试夹具）目录中的其他用户文件。
    rmSync(reportFilePath, { force: true })

    try {
      const result = runContractCommand('tests/fixtures/scene-topology-contract-valid.json', reportPath)

      expect(result.status).toBe(0)
      expect(JSON.parse(readFileSync(reportFilePath, 'utf8'))).toEqual(JSON.parse(result.stdout))
    } finally {
      rmSync(reportFilePath, { force: true })
    }
  })

  it('缺失九场景等契约问题会使命令失败并提供稳定问题代码', () => {
    const result = runContractCommand('tests/fixtures/scene-topology-contract-invalid.json')
    const report = JSON.parse(result.stdout) as { status: string; issueCount: number; issues: readonly { code: string }[] }

    expect(result.status).toBe(1)
    expect(report.status).toBe('invalid')
    expect(report.issueCount).toBeGreaterThan(0)
    expect(report.issues.some((issue) => issue.code === 'scene.missing')).toBe(true)
  })

  it('无效清单会在生产构建前阻断发布入口', () => {
    const result = runReleaseBuildCommand('tests/fixtures/scene-topology-contract-invalid.json')

    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'invalid' })
    expect(result.stdout).not.toContain('building client environment')
  })
})
