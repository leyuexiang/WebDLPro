import {
  toDetailBlockId,
  toDetailKey,
  toGuideKey,
  toMetricKey,
  toPermissionCode,
  toProcessDomainId,
  toProcessId,
  toProcessNodeId,
  toProcessPageId,
  toProcessStepId,
  toRouteId,
  toRuntimeKey,
  toTopologyKey,
} from '@/config/process/identifiers'
import { LOCAL_PROCESS_CONFIG_VERSION } from '@/config/process/config-version'
import { ProcessConfigLoader, type ProcessConfigDataset } from '@/config/process/loader'
import { localWebglRuntimeRegistry, type ReadonlyWebglRuntimeRegistry } from '@/config/process/runtime-registry'
import type {
  DetailDefinition,
  ProcessDomainDefinition,
  ProcessGuideDefinition,
  ProcessPageDefinition,
  SceneMappingDefinition,
  TopologyDefinition,
} from '@/config/process/types'

// 保留从本模块导出，避免现有专题配置和调用方改变引用路径；真实版本值只在 config-version.ts 中维护。
export { LOCAL_PROCESS_CONFIG_VERSION } from '@/config/process/config-version'

/** 当前开发环境仅声明页面访问边界，真实角色和数据权限将在外部鉴权契约完成后注入。 */
const processPagePermission = toPermissionCode('visual.process.view')

/** 用于生成尚未完成业务配置页面的轻量定义，避免页面组件硬编码 34 个页面。 */
interface PageSeed {
  pageId: string
  domainId: string
  processId: string
  title: string
  description: string
  order: number
}

/**
 * 需求变更后的 13 个工艺域、38 个页面。
 * 非燃气总览页也拥有完整原子配置，只是显式使用 empty 场景模式，绝不尝试猜测资源地址。
 */
const pageSeeds: readonly PageSeed[] = [
  { pageId: 'coal-overview', domainId: 'coal-power', processId: 'coal-power-generation', title: '燃煤发电总览', description: '燃煤机组全流程入口。', order: 1 },
  { pageId: 'coal-fuel', domainId: 'coal-power', processId: 'coal-power-generation', title: '燃料处理', description: '燃料接卸、储存与制粉流程。', order: 2 },
  { pageId: 'coal-boiler', domainId: 'coal-power', processId: 'coal-power-generation', title: '锅炉燃烧', description: '锅炉燃烧与热工流程。', order: 3 },
  { pageId: 'coal-turbine', domainId: 'coal-power', processId: 'coal-power-generation', title: '汽轮机发电', description: '汽轮机与发电机流程。', order: 4 },
  { pageId: 'coal-auxiliary', domainId: 'coal-power', processId: 'coal-power-generation', title: '辅机系统', description: '公用与辅助系统流程。', order: 5 },
  { pageId: 'coal-control', domainId: 'coal-power', processId: 'coal-power-generation', title: '集中控制', description: '机组集中控制流程。', order: 6 },
  { pageId: 'gas-overview', domainId: 'gas-power', processId: 'gas-power-generation', title: '燃气发电总览', description: '燃气联合循环全流程与已验证拓扑。', order: 1 },
  { pageId: 'gas-inlet', domainId: 'gas-power', processId: 'gas-power-generation', title: '进气系统', description: '进气和入口烟道流程。', order: 2 },
  { pageId: 'gas-turbine', domainId: 'gas-power', processId: 'gas-power-generation', title: '燃气轮机', description: '包含压气机、燃烧室和透平，当前由燃气轮机合并模型承载。', order: 3 },
  { pageId: 'wind-overview', domainId: 'wind-power', processId: 'wind-power-generation', title: '风电总览', description: '风力发电全流程入口。', order: 1 },
  { pageId: 'wind-turbine', domainId: 'wind-power', processId: 'wind-power-generation', title: '风力机组', description: '风机与变流流程。', order: 2 },
  { pageId: 'solar-overview', domainId: 'solar-power', processId: 'solar-power-generation', title: '光伏总览', description: '光伏发电全流程入口。', order: 1 },
  { pageId: 'solar-photovoltaic', domainId: 'solar-power', processId: 'solar-power-generation', title: '光伏阵列', description: '光伏阵列与逆变流程。', order: 2 },
  { pageId: 'substation-overview', domainId: 'substation', processId: 'substation-operation', title: '变电站总览', description: '变电站全景与设备入口。', order: 1 },
  { pageId: 'substation-primary', domainId: 'substation', processId: 'substation-operation', title: '一次设备', description: '一次设备运行流程。', order: 2 },
  { pageId: 'substation-secondary', domainId: 'substation', processId: 'substation-operation', title: '二次设备', description: '二次设备运行流程。', order: 3 },
  { pageId: 'substation-relay', domainId: 'substation', processId: 'substation-operation', title: '继电保护', description: '继电保护流程。', order: 4 },
  { pageId: 'substation-dc', domainId: 'substation', processId: 'substation-operation', title: '直流系统', description: '直流系统流程。', order: 5 },
  { pageId: 'substation-protection', domainId: 'substation', processId: 'substation-operation', title: '安全防护', description: '变电站安全防护流程。', order: 6 },
  { pageId: 'substation-operation', domainId: 'substation', processId: 'substation-operation', title: '运行操作', description: '变电站运行操作流程。', order: 7 },
  { pageId: 'distribution-overview', domainId: 'distribution', processId: 'distribution-network', title: '配电网总览', description: '配电网全流程入口。', order: 1 },
  { pageId: 'distribution-feeder', domainId: 'distribution', processId: 'distribution-network', title: '馈线运行', description: '馈线运行流程。', order: 2 },
  { pageId: 'distribution-transformer', domainId: 'distribution', processId: 'distribution-network', title: '配变管理', description: '配电变压器流程。', order: 3 },
  { pageId: 'distribution-automation', domainId: 'distribution', processId: 'distribution-network', title: '配电自动化', description: '配电自动化流程。', order: 4 },
  { pageId: 'distribution-fault', domainId: 'distribution', processId: 'distribution-network', title: '故障处置', description: '配电故障处置流程。', order: 5 },
  { pageId: 'consumption-overview', domainId: 'consumption', processId: 'energy-consumption', title: '用能总览', description: '用能侧全流程入口。', order: 1 },
  { pageId: 'consumption-load', domainId: 'consumption', processId: 'energy-consumption', title: '负荷管理', description: '负荷分析与管理流程。', order: 2 },
  { pageId: 'consumption-energy-efficiency', domainId: 'consumption', processId: 'energy-consumption', title: '能效管理', description: '能效分析与优化流程。', order: 3 },
  { pageId: 'consumption-demand-response', domainId: 'consumption', processId: 'energy-consumption', title: '需求响应', description: '需求响应流程。', order: 4 },
  { pageId: 'consumption-power-quality', domainId: 'consumption', processId: 'energy-consumption', title: '电能质量', description: '电能质量流程。', order: 5 },
  { pageId: 'microgrid-overview', domainId: 'microgrid', processId: 'microgrid-operation', title: '微电网总览', description: '微电网全流程入口。', order: 1 },
  { pageId: 'microgrid-operation', domainId: 'microgrid', processId: 'microgrid-operation', title: '微电网运行', description: '微电网运行控制流程。', order: 2 },
  { pageId: 'dispatch-overview', domainId: 'dispatch', processId: 'dispatch-operation', title: '调度总览', description: '调度运行全流程入口。', order: 1 },
  { pageId: 'dispatch-analysis', domainId: 'dispatch', processId: 'dispatch-operation', title: '调度分析', description: '调度分析流程。', order: 2 },
  { pageId: 'step-up-substation-overview', domainId: 'step-up-substation', processId: 'step-up-substation-operation', title: '升压站总览', description: '升压站场景浏览与已验证的第二层拓扑。', order: 1 },
  { pageId: 'step-down-substation-overview', domainId: 'step-down-substation', processId: 'step-down-substation-operation', title: '降压站总览', description: '降压站场景浏览与已验证的第二层拓扑。', order: 1 },
  { pageId: 'converter-station-overview', domainId: 'converter-station', processId: 'converter-station-operation', title: '换流站总览', description: '换流站纯导航场景浏览与已验证的第二层拓扑。', order: 1 },
  { pageId: 'switching-station-overview', domainId: 'switching-station', processId: 'switching-station-operation', title: '开关站总览', description: '开关站纯导航场景浏览与已验证的第二层拓扑。', order: 1 },
]

/** 只在配置初始化时建立域到页面的索引，工作台渲染时可直接按域读取。 */
const pageIdsByDomain = new Map<string, ReturnType<typeof toProcessPageId>[]>()
for (const seed of pageSeeds) {
  const pageIds = pageIdsByDomain.get(seed.domainId) ?? []
  pageIds.push(toProcessPageId(seed.pageId))
  pageIdsByDomain.set(seed.domainId, pageIds)
}

/** 架构目录中的域顺序由本表唯一维护，不在页面组件和路由中重复声明。 */
const domainTitles: ReadonlyArray<readonly [string, string]> = [
  ['coal-power', '燃煤发电'],
  ['gas-power', '燃气发电'],
  ['wind-power', '风力发电'],
  ['solar-power', '光伏发电'],
  ['substation', '变电站'],
  ['distribution', '配电网'],
  ['consumption', '用能侧'],
  ['microgrid', '微电网'],
  ['dispatch', '调度运行'],
  ['step-up-substation', '升压站'],
  ['step-down-substation', '降压站'],
  ['converter-station', '换流站'],
  ['switching-station', '开关站'],
]

/** 生成所有域导航配置，页面顺序直接沿用任务清单中的领域顺序。 */
const domains: readonly ProcessDomainDefinition[] = domainTitles.map(([domainId, title], index) => ({
  domainId: toProcessDomainId(domainId),
  title,
  order: index + 1,
  pageIds: pageIdsByDomain.get(domainId) ?? [],
}))

/** 非燃气、燃煤总览页的页面定义；空模式是明确能力边界，不是未处理的异常状态。 */
function createEmptyPage(seed: PageSeed): ProcessPageDefinition {
  return {
    processPageId: toProcessPageId(seed.pageId),
    processId: toProcessId(seed.processId),
    domainId: toProcessDomainId(seed.domainId),
    title: seed.title,
    description: seed.description,
    order: seed.order,
    configVersion: LOCAL_PROCESS_CONFIG_VERSION,
    permissionCode: processPagePermission,
    runtimeMode: 'empty',
    runtimeFallbackMode: 'empty',
    topologyKey: toTopologyKey(`topology.${seed.pageId}`),
    guideKey: toGuideKey(`guide.${seed.pageId}`),
    detailKey: toDetailKey(`detail.${seed.pageId}`),
  }
}

/**
 * 每个未展开页面仍获得同版本的空拓扑、空导览和空详情配置。
 * 这保证原子加载器能区分“业务尚未开放”与“配置文件缺失”，并可安全渲染结构化空态。
 */
function createEmptyArtifacts(page: ProcessPageDefinition): {
  topology: TopologyDefinition
  guide: ProcessGuideDefinition
  details: DetailDefinition
} {
  return {
    topology: {
      topologyKey: page.topologyKey,
      // 空拓扑仍携带页面已发布标题，面板无需依赖燃气名称或从拓扑标识猜测显示文案。
      title: page.title,
      configVersion: LOCAL_PROCESS_CONFIG_VERSION,
      nodes: [],
      edges: [],
    },
    guide: {
      guideKey: page.guideKey,
      configVersion: LOCAL_PROCESS_CONFIG_VERSION,
      steps: [],
    },
    details: {
      detailKey: page.detailKey,
      configVersion: LOCAL_PROCESS_CONFIG_VERSION,
      blocksByNodeId: {},
      metrics: [],
    },
  }
}

/**
 * 燃煤总览只负责申请已经审计的 Unity 运行时。
 *
 * 27 节点总图、三个关键流程和二维—三维节点映射均由远程场景拓扑清单提供，不能在本地
 * 工艺配置中复制第二份事实。这里因此只登记空的兼容原子配置，让旧工艺加载器完成版本、
 * 权限和运行时完整性校验；嵌入壳不会把这些空图元交给正式拓扑画布。
 */
const coalOverviewPage: ProcessPageDefinition = {
  processPageId: toProcessPageId('coal-overview'),
  processId: toProcessId('coal-power-generation'),
  domainId: toProcessDomainId('coal-power'),
  title: '燃煤发电总览',
  description: '燃煤火力发电总览；二维拓扑、关键流程和三维映射由正式场景清单统一提供。',
  order: 1,
  configVersion: LOCAL_PROCESS_CONFIG_VERSION,
  permissionCode: processPagePermission,
  runtimeMode: 'webgl',
  runtimeFallbackMode: 'static-preview',
  runtimeKey: toRuntimeKey('coal-plant-release'),
  topologyKey: toTopologyKey('topology.coal-overview'),
  guideKey: toGuideKey('guide.coal-overview'),
  detailKey: toDetailKey('detail.coal-overview'),
}

/** 燃气总览保留物理流程导览，同时展示用户确认的燃气机组控制网络分层关系。 */
const gasOverviewPage: ProcessPageDefinition = {
  processPageId: toProcessPageId('gas-overview'),
  processId: toProcessId('gas-power-generation'),
  domainId: toProcessDomainId('gas-power'),
  title: '燃气发电总览',
  description: '燃气联合循环总览，展示企业、生产隔离区、厂级、单元与现场设备的控制网络关系。',
  order: 1,
  configVersion: LOCAL_PROCESS_CONFIG_VERSION,
  permissionCode: processPagePermission,
  runtimeMode: 'webgl',
  runtimeFallbackMode: 'static-preview',
  runtimeKey: toRuntimeKey('gas-plant-release'),
  topologyKey: toTopologyKey('topology.gas-overview'),
  guideKey: toGuideKey('guide.gas-overview'),
  detailKey: toDetailKey('detail.gas-overview'),
  defaultStepId: toProcessStepId('overview'),
}

/** 光伏总览接入 Unity 运行时；二维 JSON 拓扑由正式场景清单提供。 */
const solarOverviewPage: ProcessPageDefinition = {
  processPageId: toProcessPageId('solar-overview'),
  processId: toProcessId('solar-power-generation'),
  domainId: toProcessDomainId('solar-power'),
  title: '光伏发电总览',
  description: '光伏发电总览，逆变器控制与逆变器节点支持二维、三维和状态联动。',
  order: 1,
  configVersion: LOCAL_PROCESS_CONFIG_VERSION,
  permissionCode: processPagePermission,
  runtimeMode: 'webgl',
  runtimeFallbackMode: 'static-preview',
  runtimeKey: toRuntimeKey('solar-plant-release'),
  topologyKey: toTopologyKey('topology.solar-power.overview'),
  guideKey: toGuideKey('guide.solar-overview'),
  detailKey: toDetailKey('detail.solar-overview'),
  defaultStepId: toProcessStepId('overview'),
}

/**
 * 燃气二维拓扑由用户提供的分层网络关系图确认；坐标只描述二维布局，
 * 不对应 Unity 世界坐标、对象层级或实际网络地址。实时状态契约尚未发布，
 * 因此全部节点明确以 normal 渲染，作为尚未收到外部状态快照时的可用展示基线；
 * 外部状态到达后仍以稳定 nodeId 覆盖此基线，不在本地根据超时或缺失自行推断离线；
 * 单元和现场层横向预留节点间隙，局部细节由画布内缩放与拖拽查看。
 */
const DEFAULT_TOPOLOGY_NODE_STATUS = 'normal' as const

const gasTopology: TopologyDefinition = {
  topologyKey: gasOverviewPage.topologyKey,
  // 标题是当前拓扑的配置数据；通用面板不再持有任何燃气领域文字。
  title: '燃气发电分层通信关系',
  configVersion: LOCAL_PROCESS_CONFIG_VERSION,
  layers: [
    { layerId: 'enterprise-it', title: '企业 IT 层', y: 8, color: '#a8b4c7' },
    { layerId: 'production-dmz', title: '生产 DMZ 层', y: 28, color: '#3b82f6' },
    { layerId: 'plant-control', title: '厂级控制层', y: 48, color: '#38bdf8' },
    { layerId: 'unit-control', title: '单元控制层', y: 77, color: '#22c55e' },
    { layerId: 'field-device', title: '现场设备层', y: 94, color: '#f97316' },
  ],
  /**
   * 兼容加载器与对外发布清单使用同一套“场景-拓扑显示名”，避免旧页面在回退到本地配置时
   * 又显示历史名称。名称更新不改变稳定节点编号、指标键、详情键或三维映射关系。
   */
  nodes: [
    { nodeId: toProcessNodeId('ems-system'), title: '燃气-厂级信息监控系统（MES/SIS）', x: 25, y: 8, layerId: 'enterprise-it', iconKey: 'server', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, metricKeys: [] },
    { nodeId: toProcessNodeId('enterprise-core-switch'), title: '燃气-交换机（企业办公网）', x: 52, y: 8, layerId: 'enterprise-it', iconKey: 'core-switch', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, metricKeys: [] },
    { nodeId: toProcessNodeId('enterprise-firewall'), title: '燃气-企业级防火墙', x: 79, y: 8, layerId: 'enterprise-it', iconKey: 'firewall', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, metricKeys: [] },
    { nodeId: toProcessNodeId('historian-data-server'), title: '燃气-历史服务器', x: 25, y: 28, layerId: 'production-dmz', iconKey: 'server', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, metricKeys: [] },
    { nodeId: toProcessNodeId('dmz-industrial-firewall'), title: '燃气-工业防火墙', x: 52, y: 28, layerId: 'production-dmz', iconKey: 'firewall', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, metricKeys: [] },
    { nodeId: toProcessNodeId('scada-security-gateway'), title: '燃气-天然气输配调度终端', x: 79, y: 28, layerId: 'production-dmz', iconKey: 'data-gateway', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, metricKeys: [] },
    { nodeId: toProcessNodeId('operator-station'), title: '燃气-操作员站（机组）', x: 14, y: 50, layerId: 'plant-control', iconKey: 'workstation', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, metricKeys: [] },
    { nodeId: toProcessNodeId('gas-network'), title: '燃气-交换机（监控层）', x: 52, y: 50, layerId: 'plant-control', iconKey: 'core-switch', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, metricKeys: [] },
    { nodeId: toProcessNodeId('plant-engineering-station'), title: '燃气-工程师站（机组）', x: 52, y: 63, layerId: 'plant-control', iconKey: 'workstation', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, metricKeys: [] },
    { nodeId: toProcessNodeId('plant-data-station'), title: '燃气-数据服务器', x: 88, y: 50, layerId: 'plant-control', iconKey: 'workstation', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, metricKeys: [] },
    { nodeId: toProcessNodeId('system.gas-turbine-control'), title: '燃气-燃机控制系统', x: 7, y: 77, layerId: 'unit-control', iconKey: 'plc', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, metricKeys: [] },
    { nodeId: toProcessNodeId('system.gas-hrsg-control'), title: '燃气-余热锅炉控制系统', x: 21, y: 77, layerId: 'unit-control', iconKey: 'dcs', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, detailKey: gasOverviewPage.detailKey, metricKeys: [toMetricKey('hrsg.pressure')] },
    { nodeId: toProcessNodeId('system.gas-steam-turbine-control'), title: '燃气-汽轮机控制系统', x: 50, y: 77, layerId: 'unit-control', iconKey: 'steam-turbine', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, detailKey: gasOverviewPage.detailKey, metricKeys: [] },
    { nodeId: toProcessNodeId('system.gas-generator-control'), title: '燃气-发电机励磁与电控', x: 65, y: 77, layerId: 'unit-control', iconKey: 'excitation-system', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, detailKey: gasOverviewPage.detailKey, metricKeys: [toMetricKey('generator.power')] },
    { nodeId: toProcessNodeId('auxiliary-plc'), title: '燃气-化学水处理控制', x: 79, y: 77, layerId: 'unit-control', iconKey: 'plc', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, metricKeys: [] },
    { nodeId: toProcessNodeId('grid-output'), title: '燃气-环保脱硝控制系统', x: 93, y: 77, layerId: 'unit-control', iconKey: 'sis-system', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, detailKey: gasOverviewPage.detailKey, metricKeys: [] },
    { nodeId: toProcessNodeId('fuel-gas-pressure-valve'), title: '燃气-天然气调压站控制', x: 7, y: 94, layerId: 'field-device', iconKey: 'instrument', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, metricKeys: [] },
    { nodeId: toProcessNodeId('asset.gas-turbine'), title: '燃气-燃气轮机', x: 21, y: 94, layerId: 'field-device', iconKey: 'gas-turbine', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, detailKey: gasOverviewPage.detailKey, metricKeys: [toMetricKey('gas_turbine.temperature')] },
    { nodeId: toProcessNodeId('asset.gas-hrsg'), title: '燃气-余热锅炉', x: 36, y: 94, layerId: 'field-device', iconKey: 'dcs', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, detailKey: gasOverviewPage.detailKey, metricKeys: [toMetricKey('hrsg.pressure')] },
    { nodeId: toProcessNodeId('asset.gas-steam-turbine'), title: '燃气-蒸汽轮机', x: 50, y: 94, layerId: 'field-device', iconKey: 'steam-turbine', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, detailKey: gasOverviewPage.detailKey, metricKeys: [] },
    { nodeId: toProcessNodeId('asset.gas-generator'), title: '燃气-发电机', x: 65, y: 94, layerId: 'field-device', iconKey: 'excitation-system', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, detailKey: gasOverviewPage.detailKey, metricKeys: [toMetricKey('generator.power')] },
    { nodeId: toProcessNodeId('condensate-pump-vfd'), title: '燃气-高压水泵', x: 79, y: 94, layerId: 'field-device', iconKey: 'instrument', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, metricKeys: [] },
    { nodeId: toProcessNodeId('fuel-gas-leak-detector'), title: '燃气-脱硝装置', x: 93, y: 94, layerId: 'field-device', iconKey: 'instrument', deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS, metricKeys: [] },
  ],
  /**
   * 本地兼容配置同步正式燃气总览的三组重点区域；关键环节由过滤拓扑投影生成且不会继承这些区域。
   * 区域成员关系来自已确认的三维入口与其子节点，不依据标题或坐标动态推断。
   */
  focusRegions: [
    {
      regionId: 'focus.gas-turbine-control',
      anchorNodeId: toProcessNodeId('system.gas-turbine-control'),
      nodeIds: [
        toProcessNodeId('system.gas-turbine-control'),
        toProcessNodeId('fuel-gas-pressure-valve'),
        toProcessNodeId('asset.gas-turbine'),
      ],
      label: '燃机控制区域',
    },
    {
      regionId: 'focus.hrsg-control',
      anchorNodeId: toProcessNodeId('system.gas-hrsg-control'),
      nodeIds: [toProcessNodeId('system.gas-hrsg-control'), toProcessNodeId('asset.gas-hrsg')],
      label: '余热锅炉控制区域',
    },
    {
      regionId: 'focus.steam-turbine-control',
      anchorNodeId: toProcessNodeId('system.gas-steam-turbine-control'),
      nodeIds: [toProcessNodeId('system.gas-steam-turbine-control'), toProcessNodeId('asset.gas-steam-turbine')],
      label: '蒸汽轮机控制区域',
    },
  ],
  edges: [
    { edgeId: toRouteId('route.enterprise-core-to-ems'), fromNodeId: toProcessNodeId('enterprise-core-switch'), toNodeId: toProcessNodeId('ems-system'), title: '企业管理网通信', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.enterprise-core-to-firewall'), fromNodeId: toProcessNodeId('enterprise-core-switch'), toNodeId: toProcessNodeId('enterprise-firewall'), title: '企业网安全边界', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.enterprise-to-dmz'), fromNodeId: toProcessNodeId('enterprise-firewall'), toNodeId: toProcessNodeId('dmz-industrial-firewall'), title: '企业网至生产隔离区', protocolLabel: '安全隔离', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.historian-to-plant'), fromNodeId: toProcessNodeId('historian-data-server'), toNodeId: toProcessNodeId('gas-network'), title: '历史数据同步', protocolLabel: 'MMS', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.dmz-to-plant'), fromNodeId: toProcessNodeId('dmz-industrial-firewall'), toNodeId: toProcessNodeId('gas-network'), title: 'DMZ 至厂级控制网', protocolLabel: '工业隔离', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.scada-gateway-to-plant'), fromNodeId: toProcessNodeId('scada-security-gateway'), toNodeId: toProcessNodeId('gas-network'), title: 'SCADA 数据交换', protocolLabel: 'DNP3', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.operator-to-plant'), fromNodeId: toProcessNodeId('operator-station'), toNodeId: toProcessNodeId('gas-network'), title: '机组操作网络', protocolLabel: '工业以太网', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.plant-to-engineering'), fromNodeId: toProcessNodeId('gas-network'), toNodeId: toProcessNodeId('plant-engineering-station'), title: '工程维护网络', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.plant-to-data-station'), fromNodeId: toProcessNodeId('gas-network'), toNodeId: toProcessNodeId('plant-data-station'), title: '集中控制网络', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.plant-to-markvi'), fromNodeId: toProcessNodeId('gas-network'), toNodeId: toProcessNodeId('system.gas-turbine-control'), title: '燃料气控制链路', protocolLabel: 'Modbus TCP', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.plant-to-hrsg'), fromNodeId: toProcessNodeId('gas-network'), toNodeId: toProcessNodeId('system.gas-hrsg-control'), title: '余热锅炉控制链路', evidenceStatus: 'verified', sceneRouteIds: [toRouteId('route.exhaust-to-hrsg.1'), toRouteId('route.exhaust-to-hrsg.2')] },
    { edgeId: toRouteId('route.plant-to-steam-turbine'), fromNodeId: toProcessNodeId('gas-network'), toNodeId: toProcessNodeId('system.gas-steam-turbine-control'), title: '汽机控制链路', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.plant-to-generator'), fromNodeId: toProcessNodeId('gas-network'), toNodeId: toProcessNodeId('system.gas-generator-control'), title: '发电机保护链路', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.plant-to-auxiliary'), fromNodeId: toProcessNodeId('gas-network'), toNodeId: toProcessNodeId('auxiliary-plc'), title: '辅机控制链路', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.plant-to-sis'), fromNodeId: toProcessNodeId('gas-network'), toNodeId: toProcessNodeId('grid-output'), title: '燃机安全联锁链路', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.markvi-to-pressure-valve'), fromNodeId: toProcessNodeId('system.gas-turbine-control'), toNodeId: toProcessNodeId('fuel-gas-pressure-valve'), title: '燃气调压控制', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.markvi-to-device'), fromNodeId: toProcessNodeId('system.gas-turbine-control'), toNodeId: toProcessNodeId('asset.gas-turbine'), title: '燃气轮机设备控制', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.hrsg-to-device'), fromNodeId: toProcessNodeId('system.gas-hrsg-control'), toNodeId: toProcessNodeId('asset.gas-hrsg'), title: '余热锅炉设备控制', protocolLabel: '4–20mA', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.steam-turbine-to-device'), fromNodeId: toProcessNodeId('system.gas-steam-turbine-control'), toNodeId: toProcessNodeId('asset.gas-steam-turbine'), title: '蒸汽轮机设备控制', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.generator-to-device'), fromNodeId: toProcessNodeId('system.gas-generator-control'), toNodeId: toProcessNodeId('asset.gas-generator'), title: '发电机励磁与电控', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.auxiliary-to-vfd'), fromNodeId: toProcessNodeId('auxiliary-plc'), toNodeId: toProcessNodeId('condensate-pump-vfd'), title: '循环水泵变频控制', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.sis-to-leak-detector'), fromNodeId: toProcessNodeId('grid-output'), toNodeId: toProcessNodeId('fuel-gas-leak-detector'), title: '燃气泄漏安全联锁', evidenceStatus: 'verified', sceneRouteIds: [] },
  ],
}

/** 燃气导览来自现有模型与流程映射；只激活已确认的两条排气烟道路由。 */
const gasGuide: ProcessGuideDefinition = {
  guideKey: gasOverviewPage.guideKey,
  configVersion: LOCAL_PROCESS_CONFIG_VERSION,
  steps: [
    { stepId: toProcessStepId('overview'), title: '全景总览', description: '查看两套燃机岛与公共送出区。', nodeIds: [], activeRouteIds: [], order: 1 },
    { stepId: toProcessStepId('gas-network'), title: '上游供气', description: '场景中尚无可确认的上游燃气管网模型，仅展示二维拓扑端点。', nodeIds: [toProcessNodeId('gas-network'), toProcessNodeId('system.gas-turbine-control')], activeRouteIds: [], order: 2 },
    { stepId: toProcessStepId('inlet-duct'), title: '进气与入口烟道', description: '管道 5/7 的介质仍待确认，因此不会播放三维流动效果。', nodeIds: [toProcessNodeId('system.gas-turbine-control'), toProcessNodeId('asset.gas-turbine')], activeRouteIds: [], order: 3 },
    { stepId: toProcessStepId('gas-turbine'), title: '燃气轮机', description: '包含压气机、燃烧室和透平；当前由燃气轮机合并模型承载。', nodeIds: [toProcessNodeId('asset.gas-turbine')], activeRouteIds: [toRouteId('route.exhaust-to-hrsg.1'), toRouteId('route.exhaust-to-hrsg.2')], order: 4 },
    { stepId: toProcessStepId('hrsg'), title: '余热锅炉', description: '包含高、中、低压蒸发器和过滤器；当前由余热锅炉合并模型承载。', nodeIds: [toProcessNodeId('asset.gas-hrsg')], activeRouteIds: [toRouteId('route.exhaust-to-hrsg.1'), toRouteId('route.exhaust-to-hrsg.2')], order: 5 },
    { stepId: toProcessStepId('steam-turbine'), title: '蒸汽轮机', description: '包含高压缸、中压缸和低压缸；当前由低中高压汽轮机合并模型承载。', nodeIds: [toProcessNodeId('asset.gas-steam-turbine')], activeRouteIds: [], order: 6 },
    { stepId: toProcessStepId('generator'), title: '发电机组', description: '机组至升压站没有已确认的直连模型，仅保留设备选择与二维关系。', nodeIds: [toProcessNodeId('asset.gas-generator')], activeRouteIds: [], order: 7 },
    { stepId: toProcessStepId('grid-output'), title: '电力送出', description: '展示升压、配电与电网公共区域，不伪造机组直连电力管段。', nodeIds: [toProcessNodeId('grid-output')], activeRouteIds: [], order: 8 },
  ],
}

/** 详情块只展示配置与数据可用性，尚未接入实时契约的指标一律不生成模拟数值。 */
const gasDetails: DetailDefinition = {
  detailKey: gasOverviewPage.detailKey,
  configVersion: LOCAL_PROCESS_CONFIG_VERSION,
  metrics: [
    { metricKey: toMetricKey('gas_turbine.temperature'), title: '燃机温度', unit: '℃', availability: 'pending' },
    { metricKey: toMetricKey('hrsg.pressure'), title: '余热锅炉压力', unit: 'MPa', availability: 'pending' },
    { metricKey: toMetricKey('generator.power'), title: '发电功率', unit: 'MW', availability: 'pending' },
  ],
  blocksByNodeId: {
    'asset.gas-turbine': [
      { blockId: toDetailBlockId('detail-block.gas-turbine-basic'), title: '设备说明', kind: 'basic', pagePermissionCode: processPagePermission, metricKeys: [] },
      { blockId: toDetailBlockId('detail-block.gas-turbine-metrics'), title: '运行指标', kind: 'metrics', pagePermissionCode: processPagePermission, metricKeys: [toMetricKey('gas_turbine.temperature')] },
    ],
    'asset.gas-hrsg': [
      { blockId: toDetailBlockId('detail-block.hrsg-basic'), title: '设备说明', kind: 'basic', pagePermissionCode: processPagePermission, metricKeys: [] },
      { blockId: toDetailBlockId('detail-block.hrsg-metrics'), title: '运行指标', kind: 'metrics', pagePermissionCode: processPagePermission, metricKeys: [toMetricKey('hrsg.pressure')] },
    ],
    'asset.gas-generator': [
      { blockId: toDetailBlockId('detail-block.generator-basic'), title: '设备说明', kind: 'basic', pagePermissionCode: processPagePermission, metricKeys: [] },
      { blockId: toDetailBlockId('detail-block.generator-metrics'), title: '运行指标', kind: 'metrics', pagePermissionCode: processPagePermission, metricKeys: [toMetricKey('generator.power')] },
    ],
    'grid-output': [
      { blockId: toDetailBlockId('detail-block.grid-output-basic'), title: '设备说明', kind: 'basic', pagePermissionCode: processPagePermission, metricKeys: [] },
    ],
  },
}

/** 燃气三维映射只登记文档已确认的设备和排气烟道路由；运行时地址仍由只读登记表管理。 */
const gasSceneMapping: SceneMappingDefinition = {
  processId: gasOverviewPage.processId,
  configVersion: LOCAL_PROCESS_CONFIG_VERSION,
  mappedNodeIds: [
    toProcessNodeId('system.gas-turbine-control'),
    toProcessNodeId('system.gas-hrsg-control'),
    toProcessNodeId('system.gas-steam-turbine-control'),
    toProcessNodeId('system.gas-generator-control'),
    toProcessNodeId('asset.gas-turbine'),
    toProcessNodeId('asset.gas-hrsg'),
    toProcessNodeId('asset.gas-steam-turbine'),
    toProcessNodeId('asset.gas-generator'),
  ],
  mappedRouteIds: [toRouteId('route.exhaust-to-hrsg.1'), toRouteId('route.exhaust-to-hrsg.2')],
}

/**
 * 燃煤兼容原子配置只用于旧工艺加载器校验和运行时租约申请。
 * 正式画布始终消费 scene-topology-manifest.json（场景拓扑清单），这里不复制 27 个节点、
 * 三个映射或四个流程动作，避免一处更新后二维选择与 Unity 聚焦产生版本漂移。
 */
const coalOverviewArtifacts = createEmptyArtifacts(coalOverviewPage)
// 本地原子加载器只提供兼容空壳，正式光伏画布和节点定义仍以发布清单为唯一事实源。
const solarOverviewArtifacts = createEmptyArtifacts(solarOverviewPage)
const coalSceneMapping: SceneMappingDefinition = {
  processId: coalOverviewPage.processId,
  configVersion: LOCAL_PROCESS_CONFIG_VERSION,
  mappedNodeIds: [],
  mappedRouteIds: [],
}

/** 光伏场景只登记用户确认的逆变器控制和逆变器两个三维节点。 */
const solarSceneMapping: SceneMappingDefinition = {
  processId: solarOverviewPage.processId,
  configVersion: LOCAL_PROCESS_CONFIG_VERSION,
  // 业务节点标识与 Unity 场景节点标识分域维护，禁止把 sceneNodeId 写进业务映射。
  mappedNodeIds: [toProcessNodeId('system.solar-inverter-control'), toProcessNodeId('asset.solar-inverter')],
  mappedRouteIds: [],
}

/** 其余页面共享明确的空场景契约；换流站拓扑由正式面板按稳定拓扑键加载，不在此复制外部资源。 */
const emptyPages = pageSeeds
  .filter((seed) => !['gas-overview', 'coal-overview', 'solar-overview'].includes(seed.pageId))
  .map(createEmptyPage)
const emptyArtifacts = emptyPages.map((page) => ({ page, ...createEmptyArtifacts(page) }))

/** 每个流程仅保留一份空场景映射；映射为空时不会产生三维命令。 */
const emptySceneMappingsByProcessId = new Map<string, SceneMappingDefinition>()
for (const page of emptyPages) {
  // 燃气、燃煤子页与对应总览复用流程标识，不能用空映射覆盖已经登记的总览场景映射。
  if (page.processId === gasOverviewPage.processId || page.processId === coalOverviewPage.processId || page.processId === solarOverviewPage.processId) {
    continue
  }

  if (!emptySceneMappingsByProcessId.has(page.processId)) {
    emptySceneMappingsByProcessId.set(page.processId, {
      processId: page.processId,
      configVersion: LOCAL_PROCESS_CONFIG_VERSION,
      mappedNodeIds: [],
      mappedRouteIds: [],
    })
  }
}

/** 供路由守卫、工作台和单元测试共用的唯一本地配置数据集。 */
export const localProcessConfigDataset: ProcessConfigDataset = {
  domains,
  pages: [coalOverviewPage, gasOverviewPage, solarOverviewPage, ...emptyPages],
  topologies: [coalOverviewArtifacts.topology, gasTopology, solarOverviewArtifacts.topology, ...emptyArtifacts.map((artifact) => artifact.topology)],
  guides: [coalOverviewArtifacts.guide, gasGuide, solarOverviewArtifacts.guide, ...emptyArtifacts.map((artifact) => artifact.guide)],
  details: [coalOverviewArtifacts.details, gasDetails, solarOverviewArtifacts.details, ...emptyArtifacts.map((artifact) => artifact.details)],
  sceneMappings: [coalSceneMapping, gasSceneMapping, solarSceneMapping, ...emptySceneMappingsByProcessId.values()],
}

/**
 * 用指定运行时登记表创建加载器，测试可注入受控部署配置；生产壳只使用默认的构建环境登记表。
 * 加载器只缓存不可变配置结果，不保存 WebGL、Canvas 或其他运行时对象。
 */
export function createLocalProcessConfigLoader(runtimeRegistry: ReadonlyWebglRuntimeRegistry = localWebglRuntimeRegistry): ProcessConfigLoader {
  return new ProcessConfigLoader(localProcessConfigDataset, runtimeRegistry)
}

/** 全局单例只服务当前嵌入壳，不允许业务页面自行构造可写运行时登记。 */
export const localProcessConfigLoader = createLocalProcessConfigLoader()
