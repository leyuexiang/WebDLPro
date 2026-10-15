import type { TopologyDeviceStatus, TopologyIconKey } from '@/config/process/types'
import { getTopologySharedPublicAssetUrl } from './topology-shared-assets'

/** 每套图元都必须显式登记四个状态，渲染器不会根据文件名或外部输入拼接资源地址。 */
type TopologyIconAssetSet = Readonly<Record<TopologyDeviceStatus, string>>

/** 将四态图像归并为只读资源集，缺少任一状态会在类型检查阶段暴露。 */
function createIconAssetSet(normal: string, alarm: string, fault: string, offline: string): TopologyIconAssetSet {
  return { normal, alarm, fault, offline }
}

/**
 * 拓扑运行时仅允许通过受控图元键读取显式登记的四态图标，避免业务配置拼接任意资源路径。
 * 核心交换机改用补充目录中的“双交换机”公共四态 WebP，服务器和工作站复用公共服务器、台式电脑 WebP；
 * 这三类不再引用旧版 PNG 或旧版告警矢量图。其余设备仍保留各自已登记的矢量图片，不按名称猜配缺失素材。
 * 公共 WebP 地址由统一地址工具生成，能够跟随站点基准路径及壳目录部署。
 */
/** `generic` 仅是画布中性占位，不对应任何图像资源，也不应进入正式图元资产登记。 */
type RegisteredTopologyIconKey = Exclude<TopologyIconKey, 'generic'>

const topologyIconRegistry: Readonly<Record<RegisteredTopologyIconKey, TopologyIconAssetSet>> = {
  'core-switch': createIconAssetSet(
    getTopologySharedPublicAssetUrl('icons/registry/core-switch/normal.webp'),
    getTopologySharedPublicAssetUrl('icons/registry/core-switch/alarm.webp'),
    getTopologySharedPublicAssetUrl('icons/registry/core-switch/fault.webp'),
    getTopologySharedPublicAssetUrl('icons/registry/core-switch/offline.webp'),
  ),
  firewall: createIconAssetSet(
    new URL('../../assets/topology-icons/sec_网络安全/icon_sec_firewall_normal.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/sec_网络安全/icon_sec_firewall_alarm.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/sec_网络安全/icon_sec_firewall_fault.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/sec_网络安全/icon_sec_firewall_offline.svg', import.meta.url).href,
  ),
  server: createIconAssetSet(
    getTopologySharedPublicAssetUrl('icons/normal/server.webp'),
    getTopologySharedPublicAssetUrl('icons/alarm/server.webp'),
    getTopologySharedPublicAssetUrl('icons/fault/server.webp'),
    getTopologySharedPublicAssetUrl('icons/offline/server.webp'),
  ),
  workstation: createIconAssetSet(
    getTopologySharedPublicAssetUrl('icons/normal/desktop.webp'),
    getTopologySharedPublicAssetUrl('icons/alarm/desktop.webp'),
    getTopologySharedPublicAssetUrl('icons/fault/desktop.webp'),
    getTopologySharedPublicAssetUrl('icons/offline/desktop.webp'),
  ),
  'data-gateway': createIconAssetSet(
    new URL('../../assets/topology-icons/disp_调度/icon_disp_data_gateway_normal.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/disp_调度/icon_disp_data_gateway_alarm.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/disp_调度/icon_disp_data_gateway_fault.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/disp_调度/icon_disp_data_gateway_offline.svg', import.meta.url).href,
  ),
  dcs: createIconAssetSet(
    new URL('../../assets/topology-icons/gen_发电/icon_gen_dcs_normal.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_dcs_alarm.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_dcs_fault.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_dcs_offline.svg', import.meta.url).href,
  ),
  plc: createIconAssetSet(
    new URL('../../assets/topology-icons/gen_发电/icon_gen_plc_normal.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_plc_alarm.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_plc_fault.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_plc_offline.svg', import.meta.url).href,
  ),
  'gas-turbine': createIconAssetSet(
    new URL('../../assets/topology-icons/gen_发电/icon_gen_gas_turbine_normal.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_gas_turbine_alarm.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_gas_turbine_fault.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_gas_turbine_offline.svg', import.meta.url).href,
  ),
  'steam-turbine': createIconAssetSet(
    new URL('../../assets/topology-icons/gen_发电/icon_gen_steam_turbine_normal.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_steam_turbine_alarm.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_steam_turbine_fault.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_steam_turbine_offline.svg', import.meta.url).href,
  ),
  'excitation-system': createIconAssetSet(
    new URL('../../assets/topology-icons/gen_发电/icon_gen_excitation_system_normal.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_excitation_system_alarm.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_excitation_system_fault.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_excitation_system_offline.svg', import.meta.url).href,
  ),
  'sis-system': createIconAssetSet(
    new URL('../../assets/topology-icons/gen_发电/icon_gen_sis_system_normal.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_sis_system_alarm.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_sis_system_fault.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_sis_system_offline.svg', import.meta.url).href,
  ),
  instrument: createIconAssetSet(
    new URL('../../assets/topology-icons/gen_发电/icon_gen_cems_normal.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_cems_alarm.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_cems_fault.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/gen_发电/icon_gen_cems_offline.svg', import.meta.url).href,
  ),
  'circuit-breaker': createIconAssetSet(
    new URL('../../assets/topology-icons/transf_变电/icon_transf_circuit_breaker_normal.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/transf_变电/icon_transf_circuit_breaker_alarm.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/transf_变电/icon_transf_circuit_breaker_fault.svg', import.meta.url).href,
    new URL('../../assets/topology-icons/transf_变电/icon_transf_circuit_breaker_offline.svg', import.meta.url).href,
  ),
}

/**
 * 正式图元键目录由本文件集中冻结；清单投影只能使用其中键值，未知键一律转为中性占位。
 * 将键集与缓存容量导出为只读常量，画布可据此证明图片缓存不会随外部配置无限增长。
 */
export const REGISTERED_TOPOLOGY_ICON_KEYS: readonly RegisteredTopologyIconKey[] = Object.freeze(Object.keys(topologyIconRegistry) as RegisteredTopologyIconKey[])
/** 每个受控图元固定对应四个状态图像，因此图片缓存的理论最大资源数可在编译期审计。 */
export const MAXIMUM_TOPOLOGY_ICON_ASSETS = REGISTERED_TOPOLOGY_ICON_KEYS.length * 4

/** 供投影器与发布校验共同判断图元键是否属于已登记的受控图像资源集合。 */
export function hasTopologyIconKey(iconKey: string): iconKey is RegisteredTopologyIconKey {
  return Object.hasOwn(topologyIconRegistry, iconKey)
}

/**
 * 仅返回已经登记的四态图像地址，调用方无需了解磁盘目录或文件命名。
 * 中性占位不返回地址，确保外部清单中未登记的图元键不会被拼接为动态资源请求。
 */
export function getTopologyIconUrl(iconKey: TopologyIconKey, deviceStatus: TopologyDeviceStatus): string | undefined {
  return iconKey === 'generic' ? undefined : topologyIconRegistry[iconKey][deviceStatus]
}
