import { createSubstationTopologyRuntimeBindingIndex, bindNode, type SubstationTopologyRuntimeBinding } from './substation-topology-runtime-bindings'

/**
 * 配电站 JSON 图纸的运行时绑定表：图元 penId → 二维业务节点 → Unity 三维节点。
 *
 * 登记规则：
 * - penId 来自 distribution-json-preview 各变体 JSON 的图元编号，同一业务节点在
 *   所有筛选组合中的图元编号已按图纸文字自动汇聚（bindNode 的 penIds 数组）。
 * - sceneNodeId 是按本次配电站截图确定的后续 Unity 配置目标编号，并同步登记进
 *   结构清单的 unitySceneMappings；它不表示当前离线 Unity 场景已创建或通过验收。
 * - 未登记图元点击只清空选择，不会发送任何 Unity 命令；禁止按标题或坐标推断绑定。
 * - 用户后续按此表配置 Unity 节点后，二维选择与三维反向选择才会实际命中对应对象。
 */
export const DISTRIBUTION_TOPOLOGY_RUNTIME_BINDINGS: readonly SubstationTopologyRuntimeBinding[] = Object.freeze([
  ...bindNode('asset.distribution-auxiliary-monitoring', 'node.distribution-auxiliary-monitoring', ['10527c7', '395abbc', '4b94d7b', '6ecfd09', '9c80115']),
  ...bindNode('asset.distribution-breaker', 'node.distribution-breaker', ['13426ae1', '30e5f12b', '31ff7f10', '4f0d6e4a', '6ca56b', 'a1a5b54', 'afecd8']),
  ...bindNode('asset.distribution-clock-system', 'node.distribution-clock-system', ['2b40638e', '4762446c', '640fbcf', '9eb654a', 'b61808f']),
  ...bindNode('asset.distribution-communication-server', 'node.distribution-communication-server', ['091e98c', '0b89e06', '29790b9a', '33365c00', '3c164cb', '3cb7741', '4f8c4803', 'b926902', 'd12dddf', 'd932999']),
  ...bindNode('asset.distribution-dispatch-management', 'node.distribution-dispatch-management', ['2b6e086f', '5cf91a1d', '926cf7b', 'b7fdf8f', 'da0c726']),
  ...bindNode('asset.distribution-energy-metering', 'node.distribution-energy-metering', ['07d8a77', '322ff655', '3cc51d9a', '5635ee4', '7264638c']),
  ...bindNode('asset.distribution-enterprise-firewall', 'node.distribution-enterprise-firewall', ['348e2d84', '42fe22e', '53ef3875', '5745f491', '5c0b4a67']),
  ...bindNode('asset.distribution-fault-recorder', 'node.distribution-fault-recorder', ['15d7987', '2cc2daeb', '50c74bb', '78d81701', '900b03']),
  ...bindNode('asset.distribution-forward-isolation', 'node.distribution-forward-isolation', ['07e4d73', '198da256', '5f9b8511', '66492b29', 'adc12e8']),
  ...bindNode('asset.distribution-industrial-firewall', 'node.distribution-industrial-firewall', ['43eef24c', '711ac79', '743699a', '94d066c', 'b2b4bc7']),
  ...bindNode('asset.distribution-instrument-transformer', 'node.distribution-instrument-transformer', ['1008c3eb', '16048c0', '34732a94', '370aedcf', '410a0956', '67b16fb', 'c1499f9']),
  ...bindNode('asset.distribution-measurement', 'node.distribution-measurement', ['11fae31', '1445bc7b', '175412f5', '2129aae6', '3140ba2', '49598d2', '4b8bda09', '4fcc054', '702519e1', '7e889114', '81b0721', '99f85e3', 'a3da4f']),
  ...bindNode('asset.distribution-merging-unit', 'node.distribution-merging-unit', ['088ed34', '29ee98b', '40d9c6d7', '4991a24c', '587127b', '68181ef2', '6de6f81', '7a71490', 'a2609ac', 'db68282', 'ec47592', 'f3291b6', 'fb2de9e']),
  ...bindNode('asset.distribution-monitoring-host', 'node.distribution-monitoring-host', ['45d69a80', '5f5cf112', '648ce0be', '6c3d3e4d', 'b60098']),
  ...bindNode('asset.distribution-pmu', 'node.distribution-pmu', ['10adc7', '186a3cc3', '1e70ceba', '7e3f096', 'ae36369']),
  ...bindNode('asset.distribution-production-management', 'node.distribution-production-management', ['13b80347', '450437cf', '45354b30', '66928640', 'd2e23c0']),
  ...bindNode('asset.distribution-protection', 'node.distribution-protection', ['134dc2d0', '1406260e', '147f09a', '1508d7f', '33e7840d', '35c9612', '529c6a', '5e8f1ef', '60edb2a', '6f255ece', '75530359', '7fd3908c', '9a9465']),
  ...bindNode('asset.distribution-relay-protection', 'node.distribution-relay-protection', ['241a5b36', '4caa30af', '64044f6', '6e6d2460', '7cf850f4']),
  ...bindNode('asset.distribution-remote-terminal', 'node.distribution-remote-terminal', ['117ae23', '44fa679', 'a7284', 'b22fad0', 'b5253bb']),
  ...bindNode('asset.distribution-reverse-isolation', 'node.distribution-reverse-isolation', ['200745c6', '28210ba', '4e0b46d', '64d0d83a', 'dd3e467']),
  ...bindNode('asset.distribution-smart-terminal', 'node.distribution-smart-terminal', ['086e034', '2f6af29', '3009912', '3cbe7a', '4a089ada', '533bff2', '6109506d', '7deef8', '7f9753f', '8b58cd4', 'b4c83ca', 'd0ea4ed', 'fda729e']),
  ...bindNode('asset.distribution-status-detection', 'node.distribution-status-detection', ['45df6619', '5f109d2c', '68298066', '7c1f1c23', 'f049f74']),
  ...bindNode('asset.distribution-switch', 'node.distribution-switch', ['28b893bd', '2eb2c0d1', '53faa19', '5532e0fd', '55c4546', '5de7d2e7', '65b0a5fc', '7f651a25', '7ff84ed0', '9f4d91', 'a90ae38', 'c5c594c', 'c602442', 'ced547c', 'e8a7d2d']),
  ...bindNode('asset.distribution-transformer', 'node.distribution-transformer', ['4ce6b4d9', '636b2c91', '697192b0', '6db2600f', '787454c6', '9b458ac', 'cb0cbf4']),
  ...bindNode('asset.distribution-valve-control', 'node.distribution-valve-control', ['3e05758']),
])
export const DISTRIBUTION_TOPOLOGY_RUNTIME_BINDING_INDEX = createSubstationTopologyRuntimeBindingIndex(DISTRIBUTION_TOPOLOGY_RUNTIME_BINDINGS)
