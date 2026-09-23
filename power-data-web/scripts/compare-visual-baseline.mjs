import { access, readFile, stat, writeFile } from 'node:fs/promises'
import { constants as fileSystemConstants } from 'node:fs'
import path from 'node:path'
import { decode, encode } from 'jpeg-js'
import { isCrossPlatformAbsolutePath } from './workspace-path-safety.mjs'

const maximumImageBytes = 25 * 1024 * 1024
const maximumPixels = 12_000_000

/**
 * 视觉回归命令只接受两张工作区内 JPEG（联合图像专家组格式）截图和三个有限阈值。
 * 不提供默认截图路径，避免测试命令在未明确选择基准时误把合成夹具、正式画面或任意用户文件混为一谈。
 */
function parseArguments(argumentsList) {
  const options = {
    baseline: undefined,
    actual: undefined,
    diff: undefined,
    pixelDifferenceThreshold: 8,
    maximumChangedPixelRatio: 0.5,
    maximumMeanAbsoluteError: 1.5,
  }

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--help' || argument === '-h') return { help: true }
    if (!['--baseline', '--actual', '--diff', '--pixel-difference-threshold', '--maximum-changed-pixel-ratio', '--maximum-mean-absolute-error'].includes(argument)) {
      throw new Error('命令参数无效；仅支持基准图、当前图、差异图和三类差异阈值。')
    }

    const value = argumentsList[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${argument}必须提供值。`)
    const key = argument.slice(2).replace(/-([a-z])/g, (_, character) => character.toUpperCase())
    if (options[key] !== undefined && !['pixelDifferenceThreshold', 'maximumChangedPixelRatio', 'maximumMeanAbsoluteError'].includes(key)) {
      throw new Error(`${argument}不能重复提供。`)
    }

    if (['pixelDifferenceThreshold', 'maximumChangedPixelRatio', 'maximumMeanAbsoluteError'].includes(key)) {
      const numericValue = Number(value)
      if (!Number.isFinite(numericValue) || numericValue < 0) throw new Error(`${argument}必须是非负有限数字。`)
      if (key === 'pixelDifferenceThreshold' && numericValue > 255) throw new Error(`${argument}不能超过255。`)
      if (key === 'maximumChangedPixelRatio' && numericValue > 100) throw new Error(`${argument}不能超过100。`)
      options[key] = numericValue
    } else {
      options[key] = value
    }
    index += 1
  }

  if (!options.baseline || !options.actual) throw new Error('必须同时提供 --baseline 和 --actual。')
  return options
}

/**
 * 所有图片路径必须是前端工作区内的相对 JPEG 路径。
 * 视觉比对只读取或输出明确声明的截图；绝对路径会按 Windows 与 POSIX 规则共同拒绝，
 * 防止 Linux 持续集成将 C:/... 等外部路径误当相对路径后拼接到工作区内。
 */
function resolveJpegPath(workspaceRoot, inputPath, optionName) {
  if (isCrossPlatformAbsolutePath(inputPath)) throw new Error(`${optionName}必须使用工作区内相对路径。`)
  const resolvedPath = path.resolve(workspaceRoot, inputPath)
  const relativePath = path.relative(workspaceRoot, resolvedPath)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || isCrossPlatformAbsolutePath(relativePath)) {
    throw new Error(`${optionName}必须指向工作区内文件。`)
  }
  if (!['.jpg', '.jpeg'].includes(path.extname(resolvedPath).toLowerCase())) {
    throw new Error(`${optionName}必须是JPEG截图。`)
  }
  return { resolvedPath, relativePath: relativePath.split(path.sep).join('/') }
}

/**
 * 解码前先限制文件大小，解码后再限制像素数量。
 * 双重限制避免误传超大图片时产生无界内存分配；本任务的 1280×720 与 3440×1440 基准都在上限内。
 */
async function readJpegImage(location, optionName) {
  await access(location.resolvedPath, fileSystemConstants.R_OK)
  const fileMetadata = await stat(location.resolvedPath)
  if (!fileMetadata.isFile() || fileMetadata.size <= 0 || fileMetadata.size > maximumImageBytes) {
    throw new Error(`${optionName}图片大小不在允许范围内。`)
  }

  let image
  try {
    image = decode(await readFile(location.resolvedPath), { useTArray: true, maxMemoryUsageInMB: 128 })
  } catch {
    throw new Error(`${optionName}无法按JPEG格式解码。`)
  }

  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || image.width * image.height > maximumPixels) {
    throw new Error(`${optionName}像素尺寸不在允许范围内。`)
  }
  return image
}

/**
 * 仅比较红、绿、蓝三通道；JPEG 固有压缩会带来极小噪声，因此按单像素最大通道差和平均绝对误差双重阈值判定。
 * 函数不生成差异图、不写入文件，也不缓存像素数组，调用结束即可回收两张图片的临时内存。
 */
function compareImages(baseline, actual, options) {
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      compatible: false,
      width: baseline.width,
      height: baseline.height,
      actualWidth: actual.width,
      actualHeight: actual.height,
      changedPixelCount: baseline.width * baseline.height,
      changedPixelRatio: 100,
      meanAbsoluteError: 255,
    }
  }

  const pixelCount = baseline.width * baseline.height
  let changedPixelCount = 0
  let absoluteErrorSum = 0
  for (let offset = 0; offset < baseline.data.length; offset += 4) {
    const redDifference = Math.abs(baseline.data[offset] - actual.data[offset])
    const greenDifference = Math.abs(baseline.data[offset + 1] - actual.data[offset + 1])
    const blueDifference = Math.abs(baseline.data[offset + 2] - actual.data[offset + 2])
    const greatestDifference = Math.max(redDifference, greenDifference, blueDifference)
    absoluteErrorSum += redDifference + greenDifference + blueDifference
    if (greatestDifference > options.pixelDifferenceThreshold) changedPixelCount += 1
  }

  return {
    compatible: true,
    width: baseline.width,
    height: baseline.height,
    changedPixelCount,
    changedPixelRatio: Number((changedPixelCount / pixelCount * 100).toFixed(6)),
    meanAbsoluteError: Number((absoluteErrorSum / (pixelCount * 3)).toFixed(6)),
  }
}

/**
 * 生成黑底亮差异的 JPEG 图：三个色彩通道分别记录基准图与当前图的绝对差，并放大八倍以便人工审阅。
 * 输出只允许尺寸相同的图片，且以 `wx`（仅新建）方式写入；任何已有文件、基准图或当前图都不能被覆盖。
 */
async function writeDifferenceImage(location, baselineLocation, actualLocation, baseline, actual) {
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    throw new Error('--diff仅支持尺寸相同的基准图和当前图。')
  }
  if (location.resolvedPath === baselineLocation.resolvedPath || location.resolvedPath === actualLocation.resolvedPath) {
    throw new Error('--diff不能覆盖基准图或当前图。')
  }
  try {
    await access(path.dirname(location.resolvedPath), fileSystemConstants.W_OK)
  } catch {
    throw new Error('--diff父目录必须已存在且可写。')
  }

  const differencePixels = new Uint8Array(baseline.data.length)
  for (let offset = 0; offset < baseline.data.length; offset += 4) {
    differencePixels[offset] = Math.min(255, Math.abs(baseline.data[offset] - actual.data[offset]) * 8)
    differencePixels[offset + 1] = Math.min(255, Math.abs(baseline.data[offset + 1] - actual.data[offset + 1]) * 8)
    differencePixels[offset + 2] = Math.min(255, Math.abs(baseline.data[offset + 2] - actual.data[offset + 2]) * 8)
    differencePixels[offset + 3] = 255
  }

  try {
    const encodedImage = encode({ data: differencePixels, width: baseline.width, height: baseline.height }, 90)
    await writeFile(location.resolvedPath, encodedImage.data, { flag: 'wx' })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      throw new Error('--diff输出路径已存在，拒绝覆盖。')
    }
    throw new Error('--diff无法生成JPEG差异图。')
  }
}

/**
 * 标准输出只保留相对路径、尺寸、有限统计与通过状态，供持续集成解析。
 * 原始像素、绝对路径和解码异常细节均不会输出，避免视觉回归命令扩散工作区内部信息。
 */
function createReport(baselinePath, actualPath, comparison, options, diffPath) {
  const passed = comparison.compatible &&
    comparison.changedPixelRatio <= options.maximumChangedPixelRatio &&
    comparison.meanAbsoluteError <= options.maximumMeanAbsoluteError
  return {
    status: passed ? 'passed' : 'failed',
    baselinePath,
    actualPath,
    ...(diffPath ? { diffPath } : {}),
    comparison,
    thresholds: {
      pixelDifferenceThreshold: options.pixelDifferenceThreshold,
      maximumChangedPixelRatio: options.maximumChangedPixelRatio,
      maximumMeanAbsoluteError: options.maximumMeanAbsoluteError,
    },
  }
}

/** 将命令入口与纯比较函数分离，测试可覆盖参数、路径、尺寸错配和阈值失败，而无需浏览器或 Unity 环境。 */
async function main() {
  let options
  try {
    options = parseArguments(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : '视觉比对参数解析失败。'}\n`)
    process.exitCode = 2
    return
  }

  if (options.help) {
    process.stdout.write('用法：node scripts/compare-visual-baseline.mjs --baseline <工作区内基准.jpg> --actual <工作区内当前.jpg> [--diff <工作区内新差异图.jpg>] [--pixel-difference-threshold <0-255>] [--maximum-changed-pixel-ratio <0-100>] [--maximum-mean-absolute-error <非负数字>]\n')
    return
  }

  try {
    const workspaceRoot = process.cwd()
    const baselineLocation = resolveJpegPath(workspaceRoot, options.baseline, '--baseline')
    const actualLocation = resolveJpegPath(workspaceRoot, options.actual, '--actual')
    const differenceLocation = options.diff ? resolveJpegPath(workspaceRoot, options.diff, '--diff') : undefined
    const [baseline, actual] = await Promise.all([
      readJpegImage(baselineLocation, '--baseline'),
      readJpegImage(actualLocation, '--actual'),
    ])
    if (differenceLocation) await writeDifferenceImage(differenceLocation, baselineLocation, actualLocation, baseline, actual)
    const report = createReport(
      baselineLocation.relativePath,
      actualLocation.relativePath,
      compareImages(baseline, actual, options),
      options,
      differenceLocation?.relativePath,
    )
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (report.status === 'failed') process.exitCode = 1
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : '视觉比对执行失败。'}\n`)
    process.exitCode = 2
  }
}

export { compareImages, createReport, parseArguments, resolveJpegPath, writeDifferenceImage }

await main()
