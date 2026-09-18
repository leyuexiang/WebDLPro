/**
 * 燃煤火力发电厂 OT（运营技术）拓扑的唯一业务源。
 *
 * 节点和连线逐项来自《通用拓扑图参考0810_AI友好版.md》第二节；过滤视图只保存
 * 来源节点、连线标识，不复制节点事实。该模块不保存平台设备编号，也不根据 Unity
 * 对象名称、坐标或中文标题推导三维映射。
 */

/**
 * 燃煤总图的五个展示层级。层级颜色和坐标只属于二维呈现，不代表设备权限或数据流向。
 */
const coalPowerLayers = Object.freeze([
  Object.freeze({ layerId: 'enterprise-it', title: '企业 IT 层', y: 8, color: '#7dd3fc' }),
  Object.freeze({ layerId: 'production-dmz', title: '生产 DMZ 层', y: 28, color: '#60a5fa' }),
  Object.freeze({ layerId: 'plant-control', title: '厂级监控层', y: 50, color: '#38bdf8' }),
  Object.freeze({ layerId: 'unit-control', title: '单元控制层', y: 69, color: '#22c55e' }),
  Object.freeze({ layerId: 'field-device', title: '现场设备层', y: 88, color: '#fb923c' }),
])

/**
 * 原图使用颜色表达网络连接类别；这里只保存可复现的二维颜色，不把颜色解释为安全等级、实时状态或协议。
 * 同一颜色常量由所有来源边复用，避免发布清单产生不一致的近似色。
 */
const coalPowerEdgeColors = Object.freeze({
  gray: '#9ca3af',
  blue: '#3b82f6',
  green: '#22c55e',
  orange: '#f97316',
})

/**
 * 正式燃煤清单在未接收外部状态快照时统一展示正常。
 * 该值只是发布基线；运行时收到外部数据后仍按稳定 nodeId 覆盖为正常、告警、故障或离线，
 * 构建器不推断通信状态，也不会阻止外部离线状态生效。
 */
const DEFAULT_TOPOLOGY_NODE_STATUS = 'normal'

/**
 * 总图节点顺序严格沿用资料的“层级 + 层内顺序”。x 坐标是为画布提供稳定排版的
 * 显式数据；资料未定义业务坐标，因此不会被当作三维绑定依据。
 */
const coalPowerNodes = Object.freeze([
  /*
   * 清单名称复用当前燃煤拓扑可见文字，并统一增加“燃煤-”前缀。位置限定词用于区分
   * 同一场景的多台工作站和交换机；稳定 nodeId、连线及 Unity 映射均保持不变。
   */
  Object.freeze({ nodeId: 'system.fuel-management', title: '燃煤-煤炭供应链管理', iconKey: 'server', x: 20, y: 8, layerId: 'enterprise-it' }),
  Object.freeze({ nodeId: 'system.enterprise-core-switch', title: '燃煤-交换机（企业办公网）', iconKey: 'core-switch', x: 50, y: 8, layerId: 'enterprise-it' }),
  Object.freeze({ nodeId: 'system.enterprise-firewall', title: '燃煤-企业级防火墙', iconKey: 'firewall', x: 80, y: 8, layerId: 'enterprise-it' }),

  Object.freeze({ nodeId: 'system.pi-historian', title: '燃煤-历史服务器', iconKey: 'server', x: 20, y: 28, layerId: 'production-dmz' }),
  Object.freeze({ nodeId: 'system.dmz-industrial-firewall', title: '燃煤-工业防火墙', iconKey: 'firewall', x: 50, y: 28, layerId: 'production-dmz' }),
  Object.freeze({ nodeId: 'endpoint.remote-maintenance-gateway', title: '燃煤-电厂综合运维 ERP', iconKey: 'data-gateway', x: 80, y: 28, layerId: 'production-dmz' }),

  Object.freeze({ nodeId: 'system.unit-operator-station', title: '燃煤-操作员站（机组）', iconKey: 'workstation', x: 10, y: 50, layerId: 'plant-control' }),
  Object.freeze({ nodeId: 'system.monitor-core-switch-primary', title: '燃煤-交换机（监控层主）', iconKey: 'core-switch', x: 30, y: 50, layerId: 'plant-control' }),
  Object.freeze({ nodeId: 'system.monitor-core-switch-standby', title: '燃煤-交换机（监控层备）', iconKey: 'core-switch', x: 50, y: 50, layerId: 'plant-control' }),
  Object.freeze({ nodeId: 'system.auxiliary-operator-station', title: '燃煤-操作员站（辅控）', iconKey: 'workstation', x: 70, y: 50, layerId: 'plant-control' }),
  Object.freeze({ nodeId: 'system.sis-performance-station', title: '燃煤-工程师站（性能）', iconKey: 'workstation', x: 90, y: 50, layerId: 'plant-control' }),

  // 锅炉控制组整体左移并拉宽三条分支；控制器位于 x=11 中轴，避免同层标题在窄容器中相互覆盖。
  Object.freeze({ nodeId: 'system.coal-boiler-control', title: '燃煤-锅炉安全与主燃料跳闸', iconKey: 'dcs', x: 11, y: 69, layerId: 'unit-control' }),
  // 其余单元控制节点与各自现场节点复用同一横坐标，直连边可保持竖直，避免为避让区域产生斜线。
  Object.freeze({ nodeId: 'system.coal-steam-turbine-control', title: '燃煤-汽轮机数字电调', iconKey: 'steam-turbine', x: 33, y: 69, layerId: 'unit-control' }),
  Object.freeze({ nodeId: 'system.coal-generator-control', title: '燃煤-发电机励磁与电控', iconKey: 'excitation-system', x: 47, y: 69, layerId: 'unit-control' }),
  Object.freeze({ nodeId: 'system.desulfurization-plc', title: '燃煤-环保脱硫控制系统', iconKey: 'plc', x: 61, y: 69, layerId: 'unit-control' }),
  Object.freeze({ nodeId: 'system.denitrification-plc', title: '燃煤-环保脱硝控制系统', iconKey: 'plc', x: 75, y: 69, layerId: 'unit-control' }),
  Object.freeze({ nodeId: 'system.coal-handling-ash-plc', title: '燃煤-输煤系统控制', iconKey: 'plc', x: 87, y: 69, layerId: 'unit-control' }),
  Object.freeze({ nodeId: 'system.sis-safety-controller', title: '燃煤-协调控制系统', iconKey: 'sis-system', x: 96, y: 69, layerId: 'unit-control' }),

  // 锅炉三个现场节点按 2/11/20 拉开间隔；后续一对一链路逐项复用控制层横坐标，维持竖直连接。
  Object.freeze({ nodeId: 'asset.coal-mill-actuator', title: '燃煤-传送带', iconKey: 'instrument', x: 2, y: 88, layerId: 'field-device' }),
  Object.freeze({ nodeId: 'asset.coal-boiler', title: '燃煤-锅炉', iconKey: 'dcs', x: 11, y: 88, layerId: 'field-device' }),
  Object.freeze({ nodeId: 'asset.furnace-pressure-transmitter', title: '燃煤-高压水泵', iconKey: 'instrument', x: 20, y: 88, layerId: 'field-device' }),
  Object.freeze({ nodeId: 'asset.coal-steam-turbine', title: '燃煤-汽轮机', iconKey: 'steam-turbine', x: 33, y: 88, layerId: 'field-device' }),
  Object.freeze({ nodeId: 'asset.coal-generator', title: '燃煤-发电机', iconKey: 'excitation-system', x: 47, y: 88, layerId: 'field-device' }),
  Object.freeze({ nodeId: 'asset.desulfurization-circulation-pump', title: '燃煤-脱硫装置', iconKey: 'instrument', x: 61, y: 88, layerId: 'field-device' }),
  Object.freeze({ nodeId: 'asset.denitrification-ammonia-valve', title: '燃煤-脱硝装置', iconKey: 'instrument', x: 75, y: 88, layerId: 'field-device' }),
  Object.freeze({ nodeId: 'asset.coal-belt-controller', title: '燃煤-机炉协调', iconKey: 'plc', x: 87, y: 88, layerId: 'field-device' }),
  Object.freeze({ nodeId: 'asset.esd-emergency-actuator', title: '燃煤-并网', iconKey: 'instrument', x: 96, y: 88, layerId: 'field-device' }),
])

/**
 * 总图的 27 条连线。边方向和协议标签只复现资料图示，不被解释为平台实时数据流。
 * 图片中的“汽机 Mark VIe 控制器”和“汽机阀门执行器”已按资料映射到总表节点。
 */
const coalPowerEdges = Object.freeze([
  Object.freeze({ edgeId: 'route.coal.enterprise-core-to-fuel-management', fromNodeId: 'system.enterprise-core-switch', toNodeId: 'system.fuel-management', title: '企业核心交换机至 ERP/燃料管理系统', lineColor: coalPowerEdgeColors.gray, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.enterprise-core-to-firewall', fromNodeId: 'system.enterprise-core-switch', toNodeId: 'system.enterprise-firewall', title: '企业核心交换机至企业边界防火墙', lineColor: coalPowerEdgeColors.gray, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.enterprise-firewall-to-dmz', fromNodeId: 'system.enterprise-firewall', toNodeId: 'system.dmz-industrial-firewall', title: '企业网至生产 DMZ', protocolLabel: '状态检测防火墙', lineColor: coalPowerEdgeColors.blue, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.historian-to-monitor-primary', fromNodeId: 'system.pi-historian', toNodeId: 'system.monitor-core-switch-primary', title: 'PI 实时历史数据库接入主监控核心交换机', lineColor: coalPowerEdgeColors.blue, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.dmz-to-monitor-primary', fromNodeId: 'system.dmz-industrial-firewall', toNodeId: 'system.monitor-core-switch-primary', title: 'DMZ 工业防火墙接入主监控核心交换机', lineColor: coalPowerEdgeColors.blue, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.dmz-to-monitor-standby', fromNodeId: 'system.dmz-industrial-firewall', toNodeId: 'system.monitor-core-switch-standby', title: 'DMZ 工业防火墙接入备监控核心交换机', lineColor: coalPowerEdgeColors.blue, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.monitor-primary-to-remote-maintenance', fromNodeId: 'system.monitor-core-switch-primary', toNodeId: 'endpoint.remote-maintenance-gateway', title: '主监控核心交换机至远程运维接入网关', lineColor: coalPowerEdgeColors.blue, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.monitor-primary-to-operator', fromNodeId: 'system.monitor-core-switch-primary', toNodeId: 'system.unit-operator-station', title: '主监控核心交换机至机组操作员站', lineColor: coalPowerEdgeColors.blue, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.monitor-primary-to-sis-performance', fromNodeId: 'system.monitor-core-switch-primary', toNodeId: 'system.sis-performance-station', title: '主监控核心交换机至 SIS 性能计算站', lineColor: coalPowerEdgeColors.blue, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.monitor-primary-to-standby', fromNodeId: 'system.monitor-core-switch-primary', toNodeId: 'system.monitor-core-switch-standby', title: '主备监控核心交换机冗余', protocolLabel: '虚拟路由冗余协议（VRRP）冗余', lineColor: coalPowerEdgeColors.blue, lineStyle: 'dashed' }),
  Object.freeze({ edgeId: 'route.coal.monitor-standby-to-auxiliary-operator', fromNodeId: 'system.monitor-core-switch-standby', toNodeId: 'system.auxiliary-operator-station', title: '备监控核心交换机至辅控操作员站', lineColor: coalPowerEdgeColors.blue, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.monitor-primary-to-boiler-dcs', fromNodeId: 'system.monitor-core-switch-primary', toNodeId: 'system.coal-boiler-control', title: '主监控核心交换机至锅炉 DCS 控制器', protocolLabel: '工业以太网环网', lineColor: coalPowerEdgeColors.green, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.monitor-primary-to-steam-turbine-dcs', fromNodeId: 'system.monitor-core-switch-primary', toNodeId: 'system.coal-steam-turbine-control', title: '主监控核心交换机至汽机 DCS 控制器', lineColor: coalPowerEdgeColors.green, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.monitor-primary-to-generator-excitation', fromNodeId: 'system.monitor-core-switch-primary', toNodeId: 'system.coal-generator-control', title: '主监控核心交换机至发电机励磁控制器', lineColor: coalPowerEdgeColors.green, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.monitor-standby-to-desulfurization', fromNodeId: 'system.monitor-core-switch-standby', toNodeId: 'system.desulfurization-plc', title: '备监控核心交换机至脱硫系统 PLC', protocolLabel: '基于传输控制协议的Modbus协议（Modbus TCP）', lineColor: coalPowerEdgeColors.green, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.monitor-standby-to-denitrification', fromNodeId: 'system.monitor-core-switch-standby', toNodeId: 'system.denitrification-plc', title: '备监控核心交换机至脱硝系统 PLC', lineColor: coalPowerEdgeColors.green, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.monitor-standby-to-coal-handling', fromNodeId: 'system.monitor-core-switch-standby', toNodeId: 'system.coal-handling-ash-plc', title: '备监控核心交换机至输煤除灰 PLC', lineColor: coalPowerEdgeColors.green, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.monitor-standby-to-sis', fromNodeId: 'system.monitor-core-switch-standby', toNodeId: 'system.sis-safety-controller', title: '备监控核心交换机至 SIS 安全仪表控制器', protocolLabel: '只读数据上传', lineColor: coalPowerEdgeColors.green, lineStyle: 'dashed' }),
  Object.freeze({ edgeId: 'route.coal.boiler-dcs-to-coal-mill', fromNodeId: 'system.coal-boiler-control', toNodeId: 'asset.coal-mill-actuator', title: '锅炉 DCS 至磨煤机执行机构', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.boiler-dcs-to-boiler', fromNodeId: 'system.coal-boiler-control', toNodeId: 'asset.coal-boiler', title: '锅炉安全与主燃料跳闸控制', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.boiler-dcs-to-furnace-pressure', fromNodeId: 'system.coal-boiler-control', toNodeId: 'asset.furnace-pressure-transmitter', title: '锅炉 DCS 至炉膛压力变送器', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.steam-turbine-dcs-to-turbine', fromNodeId: 'system.coal-steam-turbine-control', toNodeId: 'asset.coal-steam-turbine', title: '汽轮机数字电调控制', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.generator-excitation-to-generator', fromNodeId: 'system.coal-generator-control', toNodeId: 'asset.coal-generator', title: '发电机励磁与电控', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.desulfurization-to-pump', fromNodeId: 'system.desulfurization-plc', toNodeId: 'asset.desulfurization-circulation-pump', title: '脱硫系统 PLC 至脱硫浆液循环泵', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.denitrification-to-ammonia-valve', fromNodeId: 'system.denitrification-plc', toNodeId: 'asset.denitrification-ammonia-valve', title: '脱硝系统 PLC 至脱硝喷氨调节阀', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.coal-handling-to-belt-controller', fromNodeId: 'system.coal-handling-ash-plc', toNodeId: 'asset.coal-belt-controller', title: '输煤除灰 PLC 至输煤皮带控制器', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
  Object.freeze({ edgeId: 'route.coal.sis-to-esd', fromNodeId: 'system.sis-safety-controller', toNodeId: 'asset.esd-emergency-actuator', title: 'SIS 安全仪表控制器至 ESD 紧急停车执行器', lineColor: coalPowerEdgeColors.orange, lineStyle: 'solid' }),
])

/** 当前发布五个下层现场设备映射，并为锅炉、汽轮机、发电机新增三个仅拓扑聚焦的上层控制映射。 */
const coalPowerSceneNodeMappings = Object.freeze([
  Object.freeze({ nodeId: 'asset.coal-mill-actuator', sceneNodeId: 'node.coal-feeder' }),
  Object.freeze({ nodeId: 'system.coal-boiler-control', sceneNodeId: 'unit.coal-boiler.control' }),
  Object.freeze({ nodeId: 'system.coal-steam-turbine-control', sceneNodeId: 'unit.coal-steam-turbine.control' }),
  Object.freeze({ nodeId: 'system.coal-generator-control', sceneNodeId: 'unit.coal-generator.control' }),
  Object.freeze({ nodeId: 'asset.coal-boiler', sceneNodeId: 'node.coal-boiler' }),
  Object.freeze({ nodeId: 'asset.coal-steam-turbine', sceneNodeId: 'node.coal-steam-turbine' }),
  Object.freeze({ nodeId: 'asset.coal-generator', sceneNodeId: 'node.coal-generator' }),
  Object.freeze({ nodeId: 'system.coal-handling-ash-plc', sceneNodeId: 'node.coal-precipitator' }),
])

/**
 * 燃煤总览的重点区域声明。
 *
 * 重点区域只表达“一个已绑定三维入口及其显式子节点”的二维视觉分组，不能
 * 从连线、坐标或中文标题推导。当前燃煤场景已确认的三维入口只有锅炉、汽轮机
 * 和发电机三组，因此这里只登记这三组及其资料中明确对应的现场节点。过滤视图
 * 会由注册表投影时主动清空该字段，避免区域框错误出现在关键环节拓扑中。
 */
const coalPowerFocusRegions = Object.freeze([
  Object.freeze({
    regionId: 'focus.coal-boiler-control',
    anchorNodeId: 'system.coal-boiler-control',
    nodeIds: Object.freeze([
      'system.coal-boiler-control',
      'asset.coal-mill-actuator',
      'asset.coal-boiler',
      'asset.furnace-pressure-transmitter',
    ]),
    label: '锅炉控制区域',
  }),
  Object.freeze({
    regionId: 'focus.coal-steam-turbine-control',
    anchorNodeId: 'system.coal-steam-turbine-control',
    nodeIds: Object.freeze([
      'system.coal-steam-turbine-control',
      'asset.coal-steam-turbine',
    ]),
    label: '汽轮机控制区域',
  }),
  Object.freeze({
    regionId: 'focus.coal-generator-control',
    anchorNodeId: 'system.coal-generator-control',
    nodeIds: Object.freeze([
      'system.coal-generator-control',
      'asset.coal-generator',
    ]),
    label: '发电机控制区域',
  }),
])

/**
 * 将燃煤唯一来源总图转换为远程结构清单格式。
 * 来源节点统一以 normal（正常）作为初始状态，平台后续只按 nodeId 推送状态快照并覆盖该基线。
 */
export function createCoalPowerTopologies(manifestVersion) {
  const sceneNodeIdByNodeId = new Map(coalPowerSceneNodeMappings.map((mapping) => [mapping.nodeId, mapping.sceneNodeId]))
  const overview = {
    topologyId: 'topology.coal-power.overview',
    sceneId: 'coal-power',
    title: '燃煤火力发电厂 OT 网络拓扑',
    configVersion: manifestVersion,
    layers: coalPowerLayers.map((layer) => ({ ...layer })),
    nodes: coalPowerNodes.map((node) => ({
      ...node,
      ...(sceneNodeIdByNodeId.has(node.nodeId) ? { sceneNodeId: sceneNodeIdByNodeId.get(node.nodeId) } : {}),
      deviceStatus: DEFAULT_TOPOLOGY_NODE_STATUS,
      doubleClickBehavior: 'emit-node',
    })),
    edges: coalPowerEdges.map((edge) => ({ ...edge, evidenceStatus: 'verified' })),
    // 重点区域属于燃煤总览自身的显式声明；不复制到过滤视图，且不参与节点命中、路由或联动。
    focusRegions: coalPowerFocusRegions.map((region) => ({
      ...region,
      nodeIds: [...region.nodeIds],
    })),
  }

  // 新 JSON 图纸完整承载总览，不再生成旧版流程过滤拓扑或其坐标投影。
  return [overview]
}

/** 新版只公开恢复场景默认状态的总览动作；流程子图和下钻能力均不再进入外部白名单。 */
export function createCoalPowerActions(manifestVersion) {
  const actions = [
    ['overview', '总览', 'topology.coal-power.overview'],
  ]
  return actions.map(([stepId, title, targetTopologyId]) => ({
    actionId: `action.coal-power.${stepId}`,
    title: `进入燃煤${title}`,
    targetSceneId: 'coal-power',
    targetViewMode: 'business',
    targetTopologyId,
    allowedParameters: [],
    unityAction: { type: 'resetScene' },
    failurePolicy: 'keep-current-context',
    configVersion: manifestVersion,
  }))
}

export {
  coalPowerEdgeColors,
  coalPowerEdges,
  coalPowerFocusRegions,
  coalPowerLayers,
  coalPowerNodes,
  coalPowerSceneNodeMappings,
}
