import { spawnSync } from 'node:child_process'

/**
 * 正式发布构建入口必须先执行场景拓扑契约校验。
 * 校验不通过时立即透传非零退出码，不运行 Vite（前端构建工具）构建，确保孤立引用、版本错配、
 * 唯一结构清单夹带旧设备职责、节点编号重复或三维节点映射失效都不能被打包为可发布产物。
 */
function execute(command, argumentsList) {
  const result = spawnSync(command, argumentsList, {
    cwd: process.cwd(),
    stdio: 'inherit',
  })
  return typeof result.status === 'number' ? result.status : 2
}

const validationExitCode = execute(process.execPath, [
  './scripts/validate-scene-topology-manifest.mjs',
  ...process.argv.slice(2),
])

if (validationExitCode !== 0) {
  process.exitCode = validationExitCode
} else {
  /*
   * 仅在清单已验证时调用普通生产构建。
   * Windows 的 npm.cmd（包管理器命令脚本）须由命令解释器启动；命令文本是本文件固定常量，
   * 不拼接任何用户输入，因而不会把清单路径带入 Shell（命令解释器）解析。
   */
  process.exitCode = process.platform === 'win32'
    ? execute(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run build'])
    : execute('npm', ['run', 'build'])
}
