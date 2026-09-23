import path from 'node:path'

/**
 * 以 Windows 与 POSIX（可移植操作系统接口）两套规则同时识别绝对路径。
 * 持续集成运行在 Linux 时，Node 默认路径工具不会把 C:/...、\\\\server\\share
 * 等 Windows 写法视作绝对路径；若只依赖当前操作系统规则，外部输入会被错误拼接到
 * 工作区内并绕过“绝对路径禁止”校验。该函数只做纯字符串判断，不访问文件系统，供所有
 * 工作区边界校验复用，确保本地与持续集成环境得到一致且可预测的安全结果。
 */
export function isCrossPlatformAbsolutePath(inputPath) {
  return path.win32.isAbsolute(inputPath) || path.posix.isAbsolute(inputPath)
}
