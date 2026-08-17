import { access, readFile, writeFile } from 'node:fs/promises'
import { constants as fileSystemConstants } from 'node:fs'
import path from 'node:path'
import { isCrossPlatformAbsolutePath } from './workspace-path-safety.mjs'
import { createServer } from 'vite'

/**
 * 发布前契约校验命令的唯一输入模型。
 * 清单与报告路径均限制在当前前端工作区内，避免发布脚本被误用为任意文件读取或写入工具。
 */
function parseArguments(argumentsList) {
  const options = { manifest: undefined, report: undefined }
  const suppliedOptions = new Set()

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--help' || argument === '-h') return { help: true }
    if (argument !== '--manifest' && argument !== '--report') {
      throw new Error('命令参数无效；仅支持 --manifest、--report 和 --help。')
    }

    const value = argumentsList[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${argument}必须提供参数值。`)
    if (suppliedOptions.has(argument)) throw new Error(`${argument}不能重复提供。`)
    suppliedOptions.add(argument)

    if (argument === '--manifest') options.manifest = value
    if (argument === '--report') options.report = value
    index += 1
  }

  if (!options.manifest) throw new Error('缺少 --manifest；发布前必须指定场景拓扑清单。')
  return options
}

/**
 * 将用户输入路径收敛到工作区内部的相对路径。
 * 契约校验只读取和输出项目发布物；绝对路径会按 Windows 与 POSIX 规则共同拒绝，
 * 避免 Linux 持续集成将 Windows 驱动器或网络共享路径误拼接为工作区内路径。
 */
function resolveWorkspacePath(workspaceRoot, inputPath, optionName) {
  if (isCrossPlatformAbsolutePath(inputPath)) throw new Error(`${optionName}必须使用工作区内的相对路径。`)
  const resolvedPath = path.resolve(workspaceRoot, inputPath)
  const relativePath = path.relative(workspaceRoot, resolvedPath)
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || relativePath === '..' || isCrossPlatformAbsolutePath(relativePath)) {
    throw new Error(`${optionName}必须指向工作区内的文件。`)
  }
  return { resolvedPath, relativePath: relativePath.split(path.sep).join('/') }
}

/**
 * 报告不记录原始清单载荷、绝对路径或异常堆栈，只保留发布方可复现问题的稳定问题代码和中文摘要。
 */
function createReport(manifestPath, issues) {
  return {
    status: issues.length === 0 ? 'valid' : 'invalid',
    mode: 'structure',
    manifestPath,
    issueCount: issues.length,
    issues: issues.map((issue) => ({ code: issue.code, message: issue.message })),
  }
}

/** 输出统一的 UTF-8 JSON（JavaScript对象表示法）报告，供本地执行、持续集成和发布流水线直接解析。 */
function writeStandardOutput(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

/**
 * 通过 Vite（前端构建工具）的服务端模块加载器复用前端运行时同一份校验器。
 * 这样发布门禁、远端加载器与浏览器运行时不会各自维护一套易漂移的场景、动作和设备映射规则。
 */
async function loadValidator(workspaceRoot) {
  const server = await createServer({
    root: workspaceRoot,
    // 命令标准输出是持续集成解析的唯一 JSON 报告，必须静默 Vite 的预构建日志，不能混入彩色文本。
    logLevel: 'silent',
    server: { middlewareMode: true },
    appType: 'custom',
  })

  try {
    const module = await server.ssrLoadModule('/src/config/scene-topology/validator.ts')
    if (typeof module.validateSceneTopologyManifest !== 'function') {
      throw new Error('场景拓扑校验器未导出。')
    }
    return module.validateSceneTopologyManifest
  } finally {
    await server.close()
  }
}

/**
 * 执行入口始终将预期校验失败与命令执行失败区分为不同退出码。
 * 退出码 1 表示清单契约不成立，退出码 2 表示参数、文件、解析或运行时加载错误；两者都会阻断发布。
 */
async function main() {
  let options
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : '命令参数解析失败。'}\n`)
    process.exitCode = 2
    return
  }

  if (options.help) {
    process.stdout.write('用法：node scripts/validate-scene-topology-manifest.mjs --manifest <场景拓扑结构清单.json> [--report <报告.json>]\n')
    return
  }

  const workspaceRoot = process.cwd()
  let manifestLocation
  let reportLocation
  let manifestPayload
  try {
    manifestLocation = resolveWorkspacePath(workspaceRoot, options.manifest, '--manifest')
    if (options.report) reportLocation = resolveWorkspacePath(workspaceRoot, options.report, '--report')
    await access(manifestLocation.resolvedPath, fileSystemConstants.R_OK)
    manifestPayload = JSON.parse(await readFile(manifestLocation.resolvedPath, 'utf8'))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : '清单文件读取或解析失败。'}\n`)
    process.exitCode = 2
    return
  }

  let validators
  try {
    validators = await loadValidator(workspaceRoot)
  } catch {
    process.stderr.write('场景拓扑校验器加载失败。\n')
    process.exitCode = 2
    return
  }

  // 发布、联调和运行时只存在一份结构清单，因此命令行与浏览器复用同一个严格校验器。
  const issues = validators(manifestPayload)
  const report = createReport(manifestLocation.relativePath, issues)
  try {
    if (reportLocation) await writeFile(reportLocation.resolvedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    writeStandardOutput(report)
  } catch {
    process.stderr.write('契约报告写入失败。\n')
    process.exitCode = 2
    return
  }

  if (report.status === 'invalid') process.exitCode = 1
}

await main()
