import path from 'node:path'
import { validateReleaseArtifact } from './release-artifact-contract.mjs'

/**
 * 部署前只读复核命令。它重新计算目录中的全部文件摘要，并复用构建阶段相同的包类型、
 * 设备能力和独立服务门禁；不会改写、删除或修复发布目录中的任何文件。
 */
function readRootArgument(argumentsList) {
  if (argumentsList.length !== 2 || argumentsList[0] !== '--root' || !argumentsList[1]) {
    throw new Error('用法：node scripts/validate-release-artifact.mjs --root <发布目录>')
  }
  return path.resolve(process.cwd(), argumentsList[1])
}

async function main() {
  const rootDirectory = readRootArgument(process.argv.slice(2))
  const issues = await validateReleaseArtifact(rootDirectory)
  const report = {
    status: issues.length === 0 ? 'valid' : 'invalid',
    releaseDirectory: path.relative(process.cwd(), rootDirectory).split(path.sep).join('/'),
    issueCount: issues.length,
    issues,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (issues.length > 0) process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : '发布产物校验失败。'}\n`)
  process.exitCode = 2
})
