import { describe, expect, it } from 'vitest'
import { isCrossPlatformAbsolutePath } from '../scripts/workspace-path-safety.mjs'

describe('工作区路径安全校验', () => {
  it.each([
    'C:/outside.jpg',
    'C:\\outside.jpg',
    '\\\\server\\share\\outside.jpg',
    '/outside.jpg',
  ])('在任何运行器上都拒绝绝对路径：%s', (inputPath) => {
    // 回归 Linux 持续集成未识别 Windows 路径的问题：判断与宿主操作系统无关。
    expect(isCrossPlatformAbsolutePath(inputPath)).toBe(true)
  })

  it('保留工作区内相对路径', () => {
    expect(isCrossPlatformAbsolutePath('tests/visual-regression/baselines/example.jpg')).toBe(false)
  })
})
