import type { TopologyDeviceStatus, TopologyIconKey } from '@/config/process/types'

/** 每套图元都必须显式登记四个状态，渲染器不会根据文件名或外部输入拼接资源地址。 */
type TopologyIconAssetSet = Readonly<Record<TopologyDeviceStatus, string>>

/** 将四态 SVG 归并为只读资源集，缺少任一状态会在类型检查阶段暴露。 */
function createIconAssetSet(normal: string, alarm: string, fault: string, offline: string): TopologyIconAssetSet {
  return { normal, alarm, fault, offline }
}

/**
 * 燃气控制网络允许使用的拟物化 Cisco 风格图元登记表。
 * 资源使用 Vite 的静态 URL 转换打包，运行时只按受控图元键和四态索引，
 * 既避免业务配置出现文件路径，也避免动态路径造成未审核资源被加载。
 */
const topologyIconRegistry: Readonly<Record<TopologyIconKey, TopologyIconAssetSet>> = {
  'core-switch': createIconAssetSet(
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/net_通用网络/icon_net_switch_core_normal.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/net_通用网络/icon_net_switch_core_alarm.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/net_通用网络/icon_net_switch_core_fault.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/net_通用网络/icon_net_switch_core_offline.svg', import.meta.url).href,
  ),
  firewall: createIconAssetSet(
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/sec_网络安全/icon_sec_firewall_normal.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/sec_网络安全/icon_sec_firewall_alarm.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/sec_网络安全/icon_sec_firewall_fault.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/sec_网络安全/icon_sec_firewall_offline.svg', import.meta.url).href,
  ),
  server: createIconAssetSet(
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/aux_辅助设备/icon_aux_server_normal.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/aux_辅助设备/icon_aux_server_alarm.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/aux_辅助设备/icon_aux_server_fault.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/aux_辅助设备/icon_aux_server_offline.svg', import.meta.url).href,
  ),
  workstation: createIconAssetSet(
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/aux_辅助设备/icon_aux_workstation_normal.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/aux_辅助设备/icon_aux_workstation_alarm.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/aux_辅助设备/icon_aux_workstation_fault.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/aux_辅助设备/icon_aux_workstation_offline.svg', import.meta.url).href,
  ),
  'data-gateway': createIconAssetSet(
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/disp_调度/icon_disp_data_gateway_normal.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/disp_调度/icon_disp_data_gateway_alarm.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/disp_调度/icon_disp_data_gateway_fault.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/disp_调度/icon_disp_data_gateway_offline.svg', import.meta.url).href,
  ),
  dcs: createIconAssetSet(
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_dcs_normal.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_dcs_alarm.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_dcs_fault.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_dcs_offline.svg', import.meta.url).href,
  ),
  plc: createIconAssetSet(
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_plc_normal.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_plc_alarm.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_plc_fault.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_plc_offline.svg', import.meta.url).href,
  ),
  'gas-turbine': createIconAssetSet(
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_gas_turbine_normal.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_gas_turbine_alarm.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_gas_turbine_fault.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_gas_turbine_offline.svg', import.meta.url).href,
  ),
  'steam-turbine': createIconAssetSet(
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_steam_turbine_normal.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_steam_turbine_alarm.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_steam_turbine_fault.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_steam_turbine_offline.svg', import.meta.url).href,
  ),
  'excitation-system': createIconAssetSet(
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_excitation_system_normal.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_excitation_system_alarm.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_excitation_system_fault.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_excitation_system_offline.svg', import.meta.url).href,
  ),
  'sis-system': createIconAssetSet(
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_sis_system_normal.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_sis_system_alarm.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_sis_system_fault.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_sis_system_offline.svg', import.meta.url).href,
  ),
  instrument: createIconAssetSet(
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_cems_normal.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_cems_alarm.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_cems_fault.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/gen_发电/icon_gen_cems_offline.svg', import.meta.url).href,
  ),
  'circuit-breaker': createIconAssetSet(
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/transf_变电/icon_transf_circuit_breaker_normal.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/transf_变电/icon_transf_circuit_breaker_alarm.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/transf_变电/icon_transf_circuit_breaker_fault.svg', import.meta.url).href,
    new URL('../../../../Docs/前端原子任务/拓扑图/icons_3d/transf_变电/icon_transf_circuit_breaker_offline.svg', import.meta.url).href,
  ),
}

/** 供配置发布校验和渲染器共同判断图元键是否属于受控资源集合。 */
export function hasTopologyIconKey(iconKey: string): iconKey is TopologyIconKey {
  return Object.hasOwn(topologyIconRegistry, iconKey)
}

/** 仅返回已经登记的四态 SVG 地址，调用方无需了解磁盘目录或文件命名。 */
export function getTopologyIconUrl(iconKey: TopologyIconKey, deviceStatus: TopologyDeviceStatus): string {
  return topologyIconRegistry[iconKey][deviceStatus]
}
