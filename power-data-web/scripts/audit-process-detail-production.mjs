import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConfiguredPowerScenesManifest } from './build-gas-power-smoke-release.mjs'

const webProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = path.resolve(webProjectRoot, '..')

/**
 * 审计范围只包含名称明确属于第三层的生产实现文件。共享协议和桥接文件会同时声明历史业务命令，
 * 不能用整文件字符串搜索误判；真正的第三层模块必须以 process-detail 或 ProcessDetail 命名并保持隔离。
 */
// 本轮 Unity 包装预制体、桥接器和运行时由项目人员单独装配；该脚本只审计前端新第三层，
// 既避免把 Unity 旧场景的历史兼容代码误判为新链路，也不让前端发布门禁越权要求 Unity 改动。
const productionRoots = Object.freeze([path.join(webProjectRoot, 'src')])
const processDetailPathPattern = /(?:process-detail|processdetail)/i
const productionSourceExtensionPattern = /\.(?:ts|vue|cs)$/i
const testPathPattern = /(?:\.spec\.|\.test\.|[\\/]Tests?[\\/])/i

/**
 * 旧流程步骤、场景级显隐、上下文半透明、流程描边和包围盒聚焦均被禁止。
 * 每项规则只核对新第三层模块，不影响仍由第二层设备选择使用的最小历史兼容代码。
 */
const forbiddenReferences = Object.freeze([
  Object.freeze({ code: 'legacy.enter-process-step', pattern: /\benterProcessStep\b/i }),
  Object.freeze({ code: 'legacy.focus-node', pattern: /\bfocusNode\b/i }),
  Object.freeze({ code: 'legacy.set-node-visibility', pattern: /\bsetNodeVisibility\b/i }),
  Object.freeze({ code: 'legacy.reset-scene', pattern: /\bresetScene\b/i }),
  Object.freeze({ code: 'legacy.context-fade', pattern: /context(?:Fade|Transparency)|ApplyContextFade/i }),
  Object.freeze({ code: 'legacy.process-outline', pattern: /processOutline|ApplyProcessOutline/i }),
  Object.freeze({ code: 'legacy.bounds-focus', pattern: /Focus.*Bounds|Calculate.*Bounds|Encapsulate.*Bounds/i }),
])

/**
 * 静态审计只判断实际可执行标识符，不把注释中的迁移说明或字符串中的错误文案当作调用。
 * 这里保留换行和字符宽度，确保后续正则的边界判断稳定，也避免复杂的抽象语法树依赖进入发布脚本。
 */
function maskCommentsAndStrings(source) {
  let masked = ''
  let index = 0
  let state = 'code'
  let stringDelimiter = ''
  while (index < source.length) {
    const current = source[index]
    const next = source[index + 1]
    if (state === 'code') {
      if (current === '/' && next === '/') {
        masked += '  '
        index += 2
        state = 'line-comment'
        continue
      }
      if (current === '/' && next === '*') {
        masked += '  '
        index += 2
        state = 'block-comment'
        continue
      }
      if (current === "'" || current === '"' || current === '`') {
        masked += ' '
        index += 1
        stringDelimiter = current
        state = current === '`' ? 'template-string' : 'string'
        continue
      }
      masked += current
      index += 1
      continue
    }
    if (state === 'line-comment') {
      masked += current === '\n' ? '\n' : ' '
      if (current === '\n') state = 'code'
      index += 1
      continue
    }
    if (state === 'block-comment') {
      if (current === '*' && next === '/') {
        masked += '  '
        index += 2
        state = 'code'
        continue
      }
      masked += current === '\n' ? '\n' : ' '
      index += 1
      continue
    }
    if (current === '\\') {
      masked += next === '\n' ? ' \n' : '  '
      index += Math.min(2, source.length - index)
      continue
    }
    if (current === stringDelimiter) {
      masked += ' '
      index += 1
      state = 'code'
      stringDelimiter = ''
      continue
    }
    // 普通模板字面量中的 ${...} 对本项目第三层模块没有合法旧调用场景；整体掩码可避免
    // 模板诊断文本中的禁用词导致误报，并使扫描保持线性复杂度。
    masked += current === '\n' ? '\n' : ' '
    index += 1
  }
  return masked
}

/** 使用显式目录栈完成单次遍历，不读取模型、贴图、构建产物或其他大型资源。 */
async function listProcessDetailProductionFiles() {
  const files = []
  const directories = [...productionRoots]
  while (directories.length > 0) {
    const directory = directories.pop()
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        directories.push(entryPath)
        continue
      }
      if (!entry.isFile() || !productionSourceExtensionPattern.test(entry.name) || testPathPattern.test(entryPath)) continue
      if (processDetailPathPattern.test(entryPath)) files.push(entryPath)
    }
  }
  return files.sort()
}

/**
 * 同时核对生产源码隔离和正式清单映射。结果只返回稳定问题码与工作区相对路径，
 * 不回显源码内容，避免发布流水线日志携带 Unity 层级或资源内部信息。
 */
export async function auditProcessDetailProduction(releaseId = 'process-detail-static-audit') {
  const issues = []
  const files = await listProcessDetailProductionFiles()
  if (files.length === 0) issues.push({ code: 'process-detail.implementation-missing', file: null })

  for (const file of files) {
    const source = maskCommentsAndStrings(await readFile(file, 'utf8'))
    for (const forbidden of forbiddenReferences) {
      if (forbidden.pattern.test(source)) {
        issues.push({ code: forbidden.code, file: path.relative(workspaceRoot, file).split(path.sep).join('/') })
      }
    }
  }

  const manifest = await createConfiguredPowerScenesManifest(releaseId, 'gas-power')
  const gasDetails = manifest.processDetails.filter((detail) => detail.sceneId === 'gas-power')
  const detailAction = manifest.actions.find((action) => action.actionId === 'action.gas-power.gas-turbine')
  const gasMapping = manifest.unitySceneMappings.find((mapping) => mapping.sceneId === 'gas-power')
  if (gasDetails.length !== 1 || gasDetails[0]?.processDetailId !== 'process-detail.gas-power.gas-turbine') {
    issues.push({ code: 'process-detail.catalog-not-single', file: 'power-data-web/scripts/build-gas-power-smoke-release.mjs' })
  }
  if (!detailAction || detailAction.targetViewMode !== 'process-detail' ||
      Object.prototype.hasOwnProperty.call(detailAction, 'targetTopologyId') ||
      detailAction.unityAction?.type !== 'enterProcessDetail') {
    issues.push({ code: 'process-detail.action-uses-legacy-path', file: 'power-data-web/scripts/build-gas-power-smoke-release.mjs' })
  }
  if (gasMapping?.processSteps.some((step) => step.stepId === 'gas-turbine')) {
    issues.push({ code: 'process-detail.legacy-step-published', file: 'power-data-web/scripts/build-gas-power-smoke-release.mjs' })
  }

  return Object.freeze({ files: Object.freeze(files.map((file) => path.relative(workspaceRoot, file).split(path.sep).join('/'))), issues: Object.freeze(issues) })
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectExecution) {
  auditProcessDetailProduction().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (result.issues.length > 0) process.exitCode = 1
  }).catch(() => {
    process.stderr.write('第三层生产静态审计无法完成。\n')
    process.exitCode = 1
  })
}
