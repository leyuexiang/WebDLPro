import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LockState, type Meta2dData } from '@meta2d/core'
import { getProcessDetailTopologyDataContext } from '../topology/process-detail-topology-contexts'
import { resolveManifestTopologyClickSelection } from './manifest-topology-click-selection'
import { createGasTopologyConnectedLineIndex, resolveGasTopologyConnectedLineIds } from './gas-topology-connection-highlight'
import { getWindTopologyTooltipContent } from './wind-topology-tooltip'
import { toProcessNodeId } from '@/config/process/identifiers'

// 加载器只消费锁定枚举；隔离引擎的浏览器初始化，避免无窗口单测提前访问 location。
vi.mock('@meta2d/core', () => ({ LockState: { DisableEdit: 1, Disable: 10 } }))

const context = getProcessDetailTopologyDataContext('process-detail.wind-power.yaw-system')!
const sourceText = readFileSync(`${process.cwd()}/public/topology/process-detail/wind-power/yaw-system/topology.json`, 'utf8')
const source = JSON.parse(sourceText) as Meta2dData
const deviceIds = ['35d10e8d', '3a61df5', '5221dc0', 'b6b1b5', '64b6ac4b', '7675822']

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('偏航专属第三层拓扑', () => {
  it('四个合作方状态节点只使用已登记的公共四态 WebP 图', async () => {
    const { getWindProcessDetailStatusImageUrl } = await import('./wind-process-detail-topology-data')
    expect(getWindProcessDetailStatusImageUrl(toProcessNodeId('asset.wind-turbine-yaw-system'), 'alarm')).toContain('/icons/alarm/wind-yaw-system.webp')
    expect(getWindProcessDetailStatusImageUrl(toProcessNodeId('asset.wind-turbine-drivetrain-system'), 'fault')).toContain('/icons/fault/gearbox.webp')
    expect(getWindProcessDetailStatusImageUrl(toProcessNodeId('asset.wind-gearbox-lubrication-unit'), 'offline')).toContain('/icons/offline/gearbox.webp')
    expect(getWindProcessDetailStatusImageUrl(toProcessNodeId('asset.wind-yaw-angle-sensor'), 'normal')).toContain('/icons/normal/gearbox.webp')
    expect(getWindProcessDetailStatusImageUrl(toProcessNodeId('asset.wind-yaw-angle-sensor'), 'alarm')).toContain('/icons/alarm/gearbox.webp')
    expect(getWindProcessDetailStatusImageUrl(toProcessNodeId('asset.wind-pitch-system'), 'alarm')).toBeUndefined()
  })

  it('原样保留十五个图元及布局，只使用公共 WebP，并允许无三维绑定设备独立二维选中', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(sourceText))
    vi.stubGlobal('fetch', fetchMock)
    const { loadWindProcessDetailTopologyData } = await import('./wind-process-detail-topology-data')
    const data = await loadWindProcessDetailTopologyData(context)
    // 比较来源中的视觉字段，不能靠增删图元或重新布局满足数量检查。
    const geometry = (pens: Meta2dData['pens']) => pens.map(({ id, x, y, width, height, text }) => ({ id, x, y, width, height, text }))
    expect(geometry(data.pens)).toEqual(geometry(source.pens))
    expect(data.pens).toHaveLength(15)
    expect(data.pens.filter((pen) => pen.image).every((pen) => pen.image!.includes('topology/shared/') && pen.image!.endsWith('.webp'))).toBe(true)
    for (const pen of data.pens) {
      expect(pen.locked).toBe(deviceIds.includes(pen.id!) ? LockState.DisableEdit : LockState.Disable)
      if (!deviceIds.includes(pen.id!)) continue
      expect(resolveManifestTopologyClickSelection(pen, new Map())).toEqual({ kind: 'select', pen })
    }
    expect(context.bindings).toEqual([{ penId: '5221dc0', nodeId: 'asset.wind-yaw-angle-sensor' }])
    expect(context.bindings[0]?.sceneNodeId).toBeUndefined()
    expect(data).toEqual(expect.objectContaining({ enableMock: false, dataPoints: [], networks: [], initJs: '' }))
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`?v=${context.sourceSha256}`)
  })

  it('相对部署从入口脚本定位专属文件，重复进入复用源缓存且返回隔离副本', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(sourceText))
    vi.stubGlobal('fetch', fetchMock)
    const { getWindProcessDetailTopologyUrl, loadWindProcessDetailTopologyData } = await import('./wind-process-detail-topology-data')
    expect(getWindProcessDetailTopologyUrl(context, './', 'https://example.test/shell/assets/index.js'))
      .toBe(`https://example.test/shell/topology/process-detail/wind-power/yaw-system/topology.json?v=${context.sourceSha256}`)
    const first = await loadWindProcessDetailTopologyData(context)
    first.pens[0]!.x = -999
    const second = await loadWindProcessDetailTopologyData(context)
    expect(second.pens[0]!.x).toBe(source.pens[0]!.x)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('拒绝错配路径、错误源数量和重复图元编号，不把错误输入提交到缓存', async () => {
    const invalidCount = { ...source, pens: source.pens.slice(1) }
    const duplicateIds = structuredClone(source)
    duplicateIds.pens[1]!.id = duplicateIds.pens[0]!.id
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(invalidCount)))
      .mockResolvedValueOnce(new Response(JSON.stringify(duplicateIds)))
    vi.stubGlobal('fetch', fetchMock)
    const { loadWindProcessDetailTopologyData } = await import('./wind-process-detail-topology-data')
    await expect(loadWindProcessDetailTopologyData({ ...context, topologyPath: 'process-detail/wind-power/gearbox/topology.json' })).rejects.toThrow('上下文未登记')
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(loadWindProcessDetailTopologyData(context)).rejects.toThrow('应为 15，实际为 14')
    await expect(loadWindProcessDetailTopologyData(context)).rejects.toThrow('编号缺失或重复')
  })
})

describe('齿轮箱最新第三层拓扑', () => {
  const gearboxContext = getProcessDetailTopologyDataContext('process-detail.wind-power.gearbox')!
  const gearboxText = readFileSync(`${process.cwd()}/public/topology/process-detail/wind-power/gearbox/topology.json`, 'utf8')
  const gearboxSource = JSON.parse(gearboxText) as Meta2dData
  // 按本次文件逐项审核，不因旧版同编号图元曾表示齿轮箱，就把新版散热风扇绑定到齿轮箱整机。
  const gearboxDeviceIds = new Set(['57e6a4bd', '310a9d42', 'a7d5ad8', '229c868c', '127fdca', '3e772cb3', '778ca658'])

  it('加载二十个原始图元、七个独立设备和公共图片，保留原布局及源文件文字', async () => {
    // 无版本参数的请求故意返回旧数量；缓存版本丢失时本用例必须失败，不能误把旧图当新图。
    const fetchMock = vi.fn(async (url: string) => new Response(url.endsWith(`?v=${gearboxContext.sourceSha256}`)
      ? gearboxText
      : JSON.stringify({ ...gearboxSource, pens: gearboxSource.pens.slice(0, 15) })))
    vi.stubGlobal('fetch', fetchMock)
    const { loadWindProcessDetailTopologyData } = await import('./wind-process-detail-topology-data')
    const data = await loadWindProcessDetailTopologyData(gearboxContext)
    expect(data.pens).toHaveLength(20)
    // 排除仅在运行副本中允许变更的图片、锁定和事件字段，其余布局、锚点、箭头、文字和顺序全部逐项相同。
    const visualFields = (pens: Meta2dData['pens']) => pens.map(({ image: _image, locked: _locked, events: _events, ...visual }) => visual)
    expect(visualFields(data.pens)).toEqual(visualFields(gearboxSource.pens))
    expect(data.pens.filter((pen) => pen.image)).toHaveLength(9)
    for (const pen of data.pens) {
      expect(pen.locked).toBe(gearboxDeviceIds.has(pen.id!) ? LockState.DisableEdit : LockState.Disable)
      if (pen.image) expect(pen.image).toMatch(/\/topology\/shared\/(icons|background)\/.+\.webp$/)
      if (gearboxDeviceIds.has(pen.id!)) {
        expect(resolveManifestTopologyClickSelection(pen, new Map())).toEqual({ kind: 'select', pen })
        expect(getWindTopologyTooltipContent(pen)?.status).toBe('正常')
      } else {
        expect(resolveManifestTopologyClickSelection(pen, new Map())).toEqual({ kind: 'clear' })
        expect(getWindTopologyTooltipContent(pen)).toBeUndefined()
      }
    }
    expect(gearboxContext.bindings).toEqual([{ penId: 'a7d5ad8', nodeId: 'asset.wind-gearbox-lubrication-unit' }])
    expect(gearboxContext.bindings[0]?.sceneNodeId).toBeUndefined()
    expect(data.pens.find((pen) => pen.id === '229c868c')?.text?.trim()).toBe('太阳能')
    expect((data as Meta2dData & { image?: string }).image).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('复用公共连线索引，只高亮真实直连线并过滤来源文件残留编号', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(gearboxText)))
    const { loadWindProcessDetailTopologyData } = await import('./wind-process-detail-topology-data')
    const data = await loadWindProcessDetailTopologyData(gearboxContext)
    const index = createGasTopologyConnectedLineIndex(data.pens)
    // 散热风扇的 fa09e8b 已不在新文件中；公共索引必须过滤它，而六条真实主控制器连线均应保留。
    expect([...resolveGasTopologyConnectedLineIds(['310a9d42'], index)]).toEqual(['cbb6ccd'])
    expect([...resolveGasTopologyConnectedLineIds(['57e6a4bd'], index)])
      .toEqual(['cbb6ccd', 'ef2b8cf', '7adf00f0', '55481770', '4f98606', '6b7247b'])
    expect([...resolveGasTopologyConnectedLineIds([], index)]).toEqual([])
  })
})

describe('风机最新第三层拓扑', () => {
  const turbineContext = getProcessDetailTopologyDataContext('process-detail.wind-power.wind-turbine')!
  const turbineText = readFileSync(`${process.cwd()}/public/topology/process-detail/wind-power/wind-turbine/topology.json`, 'utf8')
  const turbineSource = JSON.parse(turbineText) as Meta2dData
  const turbineDeviceIds = new Set(['0ac4afe', '3e288cbd', '43a646d3', 'f0f2767', '271b18a0', '7cd2eb0', '10fa25ae', '25ed876', 'bb18bd', 'c236be3', '777c77b'])
  const processPenIds = new Set(['2513e8', 'cacede1', 'bc1e364'])

  it('同为四十图元时仍通过新版本请求取得最新文案，原样保留布局并区分设备、工艺和背景命中', async () => {
    // 旧文件与新文件数量相同；只验证图元数量无法发现陈旧缓存，须同时覆盖版本化请求和最新可见文字。
    const staleSource = structuredClone(turbineSource)
    staleSource.pens.find((pen) => pen.id === '0ac4afe')!.text = '\n\n\n\n机组主控制器'
    staleSource.pens.find((pen) => pen.id === '15c5cd3')!.text = '现场控制\n与保护\n\n'
    const fetchMock = vi.fn(async (url: string) => new Response(url.endsWith(`?v=${turbineContext.sourceSha256}`)
      ? turbineText : JSON.stringify(staleSource)))
    vi.stubGlobal('fetch', fetchMock)
    const { loadWindProcessDetailTopologyData } = await import('./wind-process-detail-topology-data')
    const data = await loadWindProcessDetailTopologyData(turbineContext)
    expect(data.pens).toHaveLength(40)
    const visualFields = (pens: Meta2dData['pens']) => pens.map(({ image: _image, locked: _locked, events: _events, ...visual }) => visual)
    expect(visualFields(data.pens)).toEqual(visualFields(turbineSource.pens))
    expect(data.pens.find((pen) => pen.id === '0ac4afe')?.text?.trim()).toBe('主控制器')
    expect(data.pens.find((pen) => pen.id === '15c5cd3')?.text?.trim()).toBe('控制层')
    expect(data.pens.find((pen) => pen.id === '3707c3af')?.text?.trim()).toBe('设备层')
    expect(data.pens.filter((pen) => pen.image)).toHaveLength(14)
    for (const pen of data.pens) {
      const isSelectable = turbineDeviceIds.has(pen.id!) || processPenIds.has(pen.id!)
      expect(pen.locked).toBe(isSelectable ? LockState.DisableEdit : LockState.Disable)
      if (pen.image) expect(pen.image).toMatch(/\/topology\/shared\/(icons|background)\/.+\.webp$/)
      expect(resolveManifestTopologyClickSelection(pen, new Map()))
        .toEqual(isSelectable ? { kind: 'select', pen } : { kind: 'clear' })
      if (turbineDeviceIds.has(pen.id!)) expect(getWindTopologyTooltipContent(pen)?.status).toBe('正常')
      else expect(getWindTopologyTooltipContent(pen)).toBeUndefined()
    }
    // 第二层五系统绑定不属于本关键环节文件，工艺矩形和十一设备均不能被自动推导为整机三维节点。
    expect(turbineContext.bindings).toEqual([
      { penId: 'bb18bd', nodeId: 'asset.wind-turbine-yaw-system' },
      { penId: 'c236be3', nodeId: 'asset.wind-turbine-drivetrain-system' },
    ])
    expect(turbineContext.bindings.every((binding) => binding.sceneNodeId === undefined)).toBe(true)
  })

  it('主控制器及工艺矩形共用源文件连线索引，不增加图元或改写线条样式', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(turbineText)))
    const { loadWindProcessDetailTopologyData } = await import('./wind-process-detail-topology-data')
    const data = await loadWindProcessDetailTopologyData(turbineContext)
    const index = createGasTopologyConnectedLineIndex(data.pens)
    expect([...resolveGasTopologyConnectedLineIds(['0ac4afe'], index)])
      .toEqual(['cb9edf', '7924dce4', '7e085d80', '3e49088', '1fb7bf6'])
    expect([...resolveGasTopologyConnectedLineIds(['2513e8'], index)])
      .toEqual(['9083127', '4d1741c7', '60aac4a8'])
    expect(data.pens.filter((pen) => pen.name === 'line')).toHaveLength(15)
    expect([...resolveGasTopologyConnectedLineIds([], index)]).toEqual([])
  })
})
