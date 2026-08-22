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
 * 架构任务清单定义的 9 个工艺域、34 个页面。
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

/**
 * 燃气二维拓扑由用户提供的分层网络关系图确认；坐标只描述二维布局，
 * 不对应 Unity 世界坐标、对象层级或实际网络地址。实时状态契约尚未发布，
 * 因此全部节点明确以 offline 渲染，禁止把架构关系误显示为设备运行正常；
 * 单元和现场层横向预留节点间隙，局部细节由画布内缩放与拖拽查看。
 */
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
  nodes: [
    { nodeId: toProcessNodeId('ems-system'), title: 'EMS 能量管理系统', x: 25, y: 8, layerId: 'enterprise-it', iconKey: 'server', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('enterprise-core-switch'), title: '企业核心交换机', x: 52, y: 8, layerId: 'enterprise-it', iconKey: 'core-switch', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('enterprise-firewall'), title: '企业防火墙', x: 79, y: 8, layerId: 'enterprise-it', iconKey: 'firewall', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('historian-data-server'), title: '历史数据服务器', x: 25, y: 28, layerId: 'production-dmz', iconKey: 'server', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('dmz-industrial-firewall'), title: 'DMZ 工业防火墙', x: 52, y: 28, layerId: 'production-dmz', iconKey: 'firewall', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('scada-security-gateway'), title: 'SCADA 安全网关', x: 79, y: 28, layerId: 'production-dmz', iconKey: 'data-gateway', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('operator-station'), title: '机组操作员站', x: 14, y: 50, layerId: 'plant-control', iconKey: 'workstation', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('gas-network'), title: '厂级 DCS / 数据交换机', x: 52, y: 50, layerId: 'plant-control', iconKey: 'core-switch', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('plant-engineering-station'), title: '性能优化工作站', x: 52, y: 63, layerId: 'plant-control', iconKey: 'workstation', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('plant-data-station'), title: '集控工程师站', x: 88, y: 50, layerId: 'plant-control', iconKey: 'workstation', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('inlet-duct'), title: '燃机 Mark VI 控制器', x: 7, y: 77, layerId: 'unit-control', iconKey: 'plc', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('hrsg'), title: '余热锅炉辅助 DCS', x: 21, y: 77, layerId: 'unit-control', iconKey: 'dcs', deviceStatus: 'offline', detailKey: gasOverviewPage.detailKey, metricKeys: [toMetricKey('hrsg.pressure')] },
    { nodeId: toProcessNodeId('gas-turbine'), title: '燃气轮机控制器', x: 36, y: 77, layerId: 'unit-control', iconKey: 'gas-turbine', deviceStatus: 'offline', detailKey: gasOverviewPage.detailKey, metricKeys: [toMetricKey('gas_turbine.temperature')] },
    { nodeId: toProcessNodeId('steam-turbine'), title: '汽轮机控制器', x: 50, y: 77, layerId: 'unit-control', iconKey: 'steam-turbine', deviceStatus: 'offline', detailKey: gasOverviewPage.detailKey, metricKeys: [] },
    { nodeId: toProcessNodeId('generator'), title: '发电机励磁保护装置', x: 65, y: 77, layerId: 'unit-control', iconKey: 'excitation-system', deviceStatus: 'offline', detailKey: gasOverviewPage.detailKey, metricKeys: [toMetricKey('generator.power')] },
    { nodeId: toProcessNodeId('auxiliary-plc'), title: '辅机系统 PLC', x: 79, y: 77, layerId: 'unit-control', iconKey: 'plc', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('grid-output'), title: '燃机安全 SIL 控制器', x: 93, y: 77, layerId: 'unit-control', iconKey: 'sis-system', deviceStatus: 'offline', detailKey: gasOverviewPage.detailKey, metricKeys: [] },
    { nodeId: toProcessNodeId('fuel-gas-pressure-valve'), title: '燃气调压控制阀', x: 7, y: 94, layerId: 'field-device', iconKey: 'instrument', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('fuel-gas-electric-actuator'), title: '燃机燃料阀执行机构', x: 21, y: 94, layerId: 'field-device', iconKey: 'instrument', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('hrsg-drum-level-sensor'), title: '余热锅炉汽包液位变送器', x: 36, y: 94, layerId: 'field-device', iconKey: 'instrument', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('steam-main-control-valve'), title: '汽机主汽调节阀', x: 50, y: 94, layerId: 'field-device', iconKey: 'instrument', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('generator-outlet-breaker'), title: '发电机出口断路器', x: 65, y: 94, layerId: 'field-device', iconKey: 'circuit-breaker', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('condensate-pump-vfd'), title: '循环水泵变频器', x: 79, y: 94, layerId: 'field-device', iconKey: 'instrument', deviceStatus: 'offline', metricKeys: [] },
    { nodeId: toProcessNodeId('fuel-gas-leak-detector'), title: '燃气泄漏检测探头', x: 93, y: 94, layerId: 'field-device', iconKey: 'instrument', deviceStatus: 'offline', metricKeys: [] },
  ],
  /**
   * 本地兼容配置同步正式燃气总览的三组重点区域；关键环节由过滤拓扑投影生成且不会继承这些区域。
   * 区域成员关系来自已确认的三维入口与其子节点，不依据标题或坐标动态推断。
   */
  focusRegions: [
    {
      regionId: 'focus.gas-turbine-control',
      anchorNodeId: toProcessNodeId('inlet-duct'),
      nodeIds: [
        toProcessNodeId('inlet-duct'),
        toProcessNodeId('fuel-gas-pressure-valve'),
        toProcessNodeId('fuel-gas-electric-actuator'),
      ],
      label: '燃机控制区域',
    },
    {
      regionId: 'focus.hrsg-control',
      anchorNodeId: toProcessNodeId('hrsg'),
      nodeIds: [toProcessNodeId('hrsg'), toProcessNodeId('hrsg-drum-level-sensor')],
      label: '余热锅炉控制区域',
    },
    {
      regionId: 'focus.steam-turbine-control',
      anchorNodeId: toProcessNodeId('steam-turbine'),
      nodeIds: [toProcessNodeId('steam-turbine'), toProcessNodeId('steam-main-control-valve')],
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
    { edgeId: toRouteId('route.plant-to-markvi'), fromNodeId: toProcessNodeId('gas-network'), toNodeId: toProcessNodeId('inlet-duct'), title: '燃料气控制链路', protocolLabel: 'Modbus TCP', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.plant-to-hrsg'), fromNodeId: toProcessNodeId('gas-network'), toNodeId: toProcessNodeId('hrsg'), title: '余热锅炉控制链路', evidenceStatus: 'verified', sceneRouteIds: [toRouteId('route.exhaust-to-hrsg.1'), toRouteId('route.exhaust-to-hrsg.2')] },
    { edgeId: toRouteId('route.plant-to-gas-turbine'), fromNodeId: toProcessNodeId('gas-network'), toNodeId: toProcessNodeId('gas-turbine'), title: '燃机控制链路', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.plant-to-steam-turbine'), fromNodeId: toProcessNodeId('gas-network'), toNodeId: toProcessNodeId('steam-turbine'), title: '汽机控制链路', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.plant-to-generator'), fromNodeId: toProcessNodeId('gas-network'), toNodeId: toProcessNodeId('generator'), title: '发电机保护链路', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.plant-to-auxiliary'), fromNodeId: toProcessNodeId('gas-network'), toNodeId: toProcessNodeId('auxiliary-plc'), title: '辅机控制链路', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.plant-to-sis'), fromNodeId: toProcessNodeId('gas-network'), toNodeId: toProcessNodeId('grid-output'), title: '燃机安全联锁链路', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.markvi-to-pressure-valve'), fromNodeId: toProcessNodeId('inlet-duct'), toNodeId: toProcessNodeId('fuel-gas-pressure-valve'), title: '燃气调压控制', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.markvi-to-actuator'), fromNodeId: toProcessNodeId('inlet-duct'), toNodeId: toProcessNodeId('fuel-gas-electric-actuator'), title: '燃料阀执行控制', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.hrsg-to-drum-sensor'), fromNodeId: toProcessNodeId('hrsg'), toNodeId: toProcessNodeId('hrsg-drum-level-sensor'), title: '汽包液位采集', protocolLabel: '4–20mA', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.steam-turbine-to-control-valve'), fromNodeId: toProcessNodeId('steam-turbine'), toNodeId: toProcessNodeId('steam-main-control-valve'), title: '主汽调节控制', evidenceStatus: 'verified', sceneRouteIds: [] },
    { edgeId: toRouteId('route.generator-to-breaker'), fromNodeId: toProcessNodeId('generator'), toNodeId: toProcessNodeId('generator-outlet-breaker'), title: '出口断路器保护', evidenceStatus: 'verified', sceneRouteIds: [] },
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
    { stepId: toProcessStepId('gas-network'), title: '上游供气', description: '场景中尚无可确认的上游燃气管网模型，仅展示二维拓扑端点。', nodeIds: [toProcessNodeId('gas-network'), toProcessNodeId('inlet-duct')], activeRouteIds: [], order: 2 },
    { stepId: toProcessStepId('inlet-duct'), title: '进气与入口烟道', description: '管道 5/7 的介质仍待确认，因此不会播放三维流动效果。', nodeIds: [toProcessNodeId('inlet-duct'), toProcessNodeId('gas-turbine')], activeRouteIds: [], order: 3 },
    { stepId: toProcessStepId('gas-turbine'), title: '燃气轮机', description: '包含压气机、燃烧室和透平；当前由燃气轮机合并模型承载。', nodeIds: [toProcessNodeId('gas-turbine')], activeRouteIds: [toRouteId('route.exhaust-to-hrsg.1'), toRouteId('route.exhaust-to-hrsg.2')], order: 4 },
    { stepId: toProcessStepId('hrsg'), title: '余热锅炉', description: '包含高、中、低压蒸发器和过滤器；当前由余热锅炉合并模型承载。', nodeIds: [toProcessNodeId('hrsg')], activeRouteIds: [toRouteId('route.exhaust-to-hrsg.1'), toRouteId('route.exhaust-to-hrsg.2')], order: 5 },
    { stepId: toProcessStepId('steam-turbine'), title: '蒸汽轮机', description: '包含高压缸、中压缸和低压缸；当前由低中高压汽轮机合并模型承载。', nodeIds: [toProcessNodeId('steam-turbine')], activeRouteIds: [], order: 6 },
    { stepId: toProcessStepId('generator'), title: '发电机组', description: '机组至升压站没有已确认的直连模型，仅保留设备选择与二维关系。', nodeIds: [toProcessNodeId('generator')], activeRouteIds: [], order: 7 },
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
    'gas-turbine': [
      { blockId: toDetailBlockId('detail-block.gas-turbine-basic'), title: '设备说明', kind: 'basic', pagePermissionCode: processPagePermission, metricKeys: [] },
      { blockId: toDetailBlockId('detail-block.gas-turbine-metrics'), title: '运行指标', kind: 'metrics', pagePermissionCode: processPagePermission, metricKeys: [toMetricKey('gas_turbine.temperature')] },
    ],
    hrsg: [
      { blockId: toDetailBlockId('detail-block.hrsg-basic'), title: '设备说明', kind: 'basic', pagePermissionCode: processPagePermission, metricKeys: [] },
      { blockId: toDetailBlockId('detail-block.hrsg-metrics'), title: '运行指标', kind: 'metrics', pagePermissionCode: processPagePermission, metricKeys: [toMetricKey('hrsg.pressure')] },
    ],
    generator: [
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
  mappedNodeIds: [toProcessNodeId('inlet-duct'), toProcessNodeId('gas-turbine'), toProcessNodeId('hrsg'), toProcessNodeId('steam-turbine'), toProcessNodeId('generator'), toProcessNodeId('grid-output')],
  mappedRouteIds: [toRouteId('route.exhaust-to-hrsg.1'), toRouteId('route.exhaust-to-hrsg.2')],
}

/**
 * 燃煤兼容原子配置只用于旧工艺加载器校验和运行时租约申请。
 * 正式画布始终消费 scene-topology-manifest.json（场景拓扑清单），这里不复制 27 个节点、
 * 三个映射或四个流程动作，避免一处更新后二维选择与 Unity 聚焦产生版本漂移。
 */
const coalOverviewArtifacts = createEmptyArtifacts(coalOverviewPage)
const coalSceneMapping: SceneMappingDefinition = {
  processId: coalOverviewPage.processId,
  configVersion: LOCAL_PROCESS_CONFIG_VERSION,
  mappedNodeIds: [],
  mappedRouteIds: [],
}

/** 其余 32 页共享明确的空场景契约，页面可以访问但不会进行未经登记的外部资源加载。 */
const emptyPages = pageSeeds
  .filter((seed) => seed.pageId !== 'gas-overview' && seed.pageId !== 'coal-overview')
  .map(createEmptyPage)
const emptyArtifacts = emptyPages.map((page) => ({ page, ...createEmptyArtifacts(page) }))

/** 每个流程仅保留一份空场景映射；映射为空时不会产生三维命令。 */
const emptySceneMappingsByProcessId = new Map<string, SceneMappingDefinition>()
for (const page of emptyPages) {
  // 燃气、燃煤子页与对应总览复用流程标识，不能用空映射覆盖已经登记的总览场景映射。
  if (page.processId === gasOverviewPage.processId || page.processId === coalOverviewPage.processId) {
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
  pages: [coalOverviewPage, gasOverviewPage, ...emptyPages],
  topologies: [coalOverviewArtifacts.topology, gasTopology, ...emptyArtifacts.map((artifact) => artifact.topology)],
  guides: [coalOverviewArtifacts.guide, gasGuide, ...emptyArtifacts.map((artifact) => artifact.guide)],
  details: [coalOverviewArtifacts.details, gasDetails, ...emptyArtifacts.map((artifact) => artifact.details)],
  sceneMappings: [coalSceneMapping, gasSceneMapping, ...emptySceneMappingsByProcessId.values()],
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
