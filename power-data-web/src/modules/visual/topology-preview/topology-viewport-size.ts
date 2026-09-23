/** Meta2D（二维组态引擎）恢复或重绘前允许使用的最小宿主尺寸。 */
export interface TopologyViewportSize {
  readonly width: number
  readonly height: number
}

/**
 * 只接受有限正数尺寸，并在进入 Meta2D 前收敛为整数像素。
 *
 * 第三层返回第二层时，Vue（渐进式网页框架）可能已经提交显示状态，但浏览器尚未完成布局，
 * 此时宿主会短暂报告 0×0。Meta2D 若收到该尺寸，会创建零尺寸离屏画布并在后续重绘时抛错。
 * 返回 undefined 代表本帧不得调用 resize、fitView、render、active 或 translate；
 * 已登记的 ResizeObserver（尺寸观察器）会在宿主真正可见后再次触发恢复。
 */
export function readUsableTopologyViewportSize(
  host: Pick<HTMLElement, 'clientWidth' | 'clientHeight'> | null | undefined,
): TopologyViewportSize | undefined {
  if (!host || !Number.isFinite(host.clientWidth) || !Number.isFinite(host.clientHeight)) return undefined

  const width = Math.round(host.clientWidth)
  const height = Math.round(host.clientHeight)
  return width > 0 && height > 0 ? { width, height } : undefined
}
