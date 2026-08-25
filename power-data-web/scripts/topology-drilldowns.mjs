/**
 * 燃气、燃煤说明型下钻内容的唯一正式业务源。
 *
 * 每个分支都逐项来自《通用拓扑图参考0810_AI友好版.md》的显式关系；本模块只把已确认
 * 的“入口 → 直接子节点 → 下方模型节点”转换为局部说明标识和确定性二维坐标，不读取标题
 * 推断关系，也不向说明节点附加正式 nodeId、sceneNodeId、设备状态或三维绑定。
 */

/** 两层说明图使用固定纵向层级；横坐标只负责均匀排版，不表达业务顺序或通信方向。 */
const drilldownLayerY = Object.freeze({ source: 14, logic: 53, boundary: 84 })

/**
 * 按已登记分支数给出明确横坐标。当前资料最多三条真实分支，固定表可以避免运行时
 * 根据标题、节点尺寸或连线数量反复求解布局；单分支的视觉副本由渲染模型单独生成。
 */
const branchXByCount = Object.freeze({
  1: Object.freeze([50]),
  2: Object.freeze([34, 66]),
  3: Object.freeze([22, 50, 78]),
})

/**
 * 构造函数只消除十三份内容中重复的结构文字，branches 参数仍是逐项人工登记的正式关系。
 * 生成的局部标识只在 contentKey 内有效；单分支保持三个语义节点，并明确声明复制布局。
 */
function createDrilldownContent({ contentKey, version, title, sourceNodeId, sourceTitle, sourceIconKey, branches }) {
  const xPositions = branchXByCount[branches.length]
  if (!xPositions) throw new Error(`下钻内容${contentKey}的真实分支数超出已审核布局范围。`)

  const nodes = [
    // 图标键必须由业务映射显式登记；渲染器只按受控键取正式图标，不根据标题猜测设备类型。
    Object.freeze({ id: 'source', title: sourceTitle, kind: 'source', iconKey: sourceIconKey, x: 50, y: drilldownLayerY.source, description: '当前正式拓扑入口的只读投影' }),
  ]
  const edges = []

  branches.forEach((branch, index) => {
    const branchNumber = index + 1
    const x = xPositions[index]
    const logicId = `logic.${branchNumber}`
    const boundaryId = `boundary.${branchNumber}`
    nodes.push(
      Object.freeze({ id: logicId, title: branch.logicTitle, kind: 'logic', iconKey: branch.logicIconKey, x, y: drilldownLayerY.logic, description: '入口节点的直接现场子节点' }),
      Object.freeze({ id: boundaryId, title: branch.boundaryTitle, kind: 'boundary', iconKey: branch.boundaryIconKey, x, y: drilldownLayerY.boundary, description: '业务资料明确登记的下方模型说明节点' }),
    )
    edges.push(
      Object.freeze({ id: `edge.source.${branchNumber}`, fromId: 'source', toId: logicId }),
      Object.freeze({ id: `edge.boundary.${branchNumber}`, fromId: logicId, toId: boundaryId }),
    )
  })

  return Object.freeze({
    contentKey,
    version,
    title,
    sourceNodeId,
    ...(branches.length === 1 ? { duplicateSingleBranch: true } : {}),
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
  })
}

/** 生成燃气六个入口、七条真实分支的正式说明内容。 */
export function createGasPowerDrilldowns(version) {
  return Object.freeze([
    createDrilldownContent({
      contentKey: 'gas.mark-vie', version, title: '燃机 Mark VIe 控制器关联说明', sourceNodeId: 'inlet-duct', sourceTitle: '燃机 Mark VIe 控制器', sourceIconKey: 'plc',
      branches: [
        { logicTitle: '燃气调压控制阀组', logicIconKey: 'instrument', boundaryTitle: '燃料调压站', boundaryIconKey: 'instrument' },
        { logicTitle: '燃机燃烧器执行机构', logicIconKey: 'instrument', boundaryTitle: '燃气轮机', boundaryIconKey: 'gas-turbine' },
      ],
    }),
    createDrilldownContent({
      contentKey: 'gas.hrsg-dcs', version, title: 'HRSG 余热锅炉 DCS 关联说明', sourceNodeId: 'hrsg', sourceTitle: 'HRSG 余热锅炉 DCS', sourceIconKey: 'dcs',
      branches: [{ logicTitle: '余热锅炉温度变送器', logicIconKey: 'instrument', boundaryTitle: '余热锅炉 HRSG', boundaryIconKey: 'dcs' }],
    }),
    createDrilldownContent({
      contentKey: 'gas.steam-turbine', version, title: '蒸汽轮机控制器关联说明', sourceNodeId: 'steam-turbine', sourceTitle: '蒸汽轮机控制器', sourceIconKey: 'steam-turbine',
      branches: [{ logicTitle: '汽机主汽调节阀', logicIconKey: 'instrument', boundaryTitle: '蒸汽轮机', boundaryIconKey: 'steam-turbine' }],
    }),
    createDrilldownContent({
      contentKey: 'gas.generator-excitation', version, title: '发电机励磁保护装置关联说明', sourceNodeId: 'generator', sourceTitle: '发电机励磁保护装置', sourceIconKey: 'excitation-system',
      branches: [{ logicTitle: '发电机出口断路器', logicIconKey: 'circuit-breaker', boundaryTitle: '发电机', boundaryIconKey: 'excitation-system' }],
    }),
    createDrilldownContent({
      contentKey: 'gas.auxiliary-plc', version, title: '辅机系统 PLC 关联说明', sourceNodeId: 'auxiliary-plc', sourceTitle: '辅机系统 PLC', sourceIconKey: 'plc',
      branches: [{ logicTitle: '循环水泵变频器', logicIconKey: 'plc', boundaryTitle: '循环水泵', boundaryIconKey: 'instrument' }],
    }),
    createDrilldownContent({
      contentKey: 'gas.safety-sil', version, title: '燃机安全 SIL 控制器关联说明', sourceNodeId: 'grid-output', sourceTitle: '燃机安全 SIL 控制器', sourceIconKey: 'sis-system',
      branches: [{ logicTitle: '燃气泄漏检测探头', logicIconKey: 'instrument', boundaryTitle: '燃气管道', boundaryIconKey: 'instrument' }],
    }),
  ])
}

/** 生成燃煤七个入口、九条真实分支；资料中无显式关系的“电除尘器”不会进入任何内容。 */
export function createCoalPowerDrilldowns(version) {
  return Object.freeze([
    createDrilldownContent({
      contentKey: 'coal.boiler-dcs', version, title: '锅炉 DCS 控制器关联说明', sourceNodeId: 'system.boiler-dcs', sourceTitle: '锅炉 DCS 控制器', sourceIconKey: 'dcs',
      branches: [
        { logicTitle: '磨煤机执行机构', logicIconKey: 'instrument', boundaryTitle: '磨煤机', boundaryIconKey: 'instrument' },
        { logicTitle: '引送风机变频器', logicIconKey: 'plc', boundaryTitle: '送风机/引风机', boundaryIconKey: 'instrument' },
        { logicTitle: '炉膛压力变送器', logicIconKey: 'instrument', boundaryTitle: '锅炉', boundaryIconKey: 'dcs' },
      ],
    }),
    createDrilldownContent({
      contentKey: 'coal.steam-turbine-dcs', version, title: '汽机 DCS 控制器关联说明', sourceNodeId: 'system.steam-turbine-dcs', sourceTitle: '汽机 DCS 控制器', sourceIconKey: 'steam-turbine',
      branches: [{ logicTitle: '汽机调门执行器', logicIconKey: 'instrument', boundaryTitle: '汽轮机', boundaryIconKey: 'steam-turbine' }],
    }),
    createDrilldownContent({
      contentKey: 'coal.generator-excitation', version, title: '发电机励磁控制器关联说明', sourceNodeId: 'system.generator-excitation-controller', sourceTitle: '发电机励磁控制器', sourceIconKey: 'excitation-system',
      branches: [{ logicTitle: '发电机保护装置', logicIconKey: 'circuit-breaker', boundaryTitle: '发电机', boundaryIconKey: 'excitation-system' }],
    }),
    createDrilldownContent({
      contentKey: 'coal.desulfurization-plc', version, title: '脱硫系统 PLC 关联说明', sourceNodeId: 'system.desulfurization-plc', sourceTitle: '脱硫系统 PLC', sourceIconKey: 'plc',
      branches: [{ logicTitle: '脱硫浆液循环泵', logicIconKey: 'instrument', boundaryTitle: '脱硫吸收塔', boundaryIconKey: 'instrument' }],
    }),
    createDrilldownContent({
      contentKey: 'coal.denitrification-plc', version, title: '脱硝系统 PLC 关联说明', sourceNodeId: 'system.denitrification-plc', sourceTitle: '脱硝系统 PLC', sourceIconKey: 'plc',
      branches: [{ logicTitle: '脱硝喷氨调节阀', logicIconKey: 'instrument', boundaryTitle: '脱硝反应器', boundaryIconKey: 'instrument' }],
    }),
    createDrilldownContent({
      contentKey: 'coal.coal-ash-plc', version, title: '输煤除灰 PLC 关联说明', sourceNodeId: 'system.coal-handling-ash-plc', sourceTitle: '输煤除灰 PLC', sourceIconKey: 'plc',
      branches: [{ logicTitle: '输煤皮带控制器', logicIconKey: 'plc', boundaryTitle: '输煤皮带', boundaryIconKey: 'instrument' }],
    }),
    createDrilldownContent({
      contentKey: 'coal.sis', version, title: 'SIS 安全仪表控制器关联说明', sourceNodeId: 'system.sis-safety-controller', sourceTitle: 'SIS 安全仪表控制器', sourceIconKey: 'sis-system',
      branches: [{ logicTitle: 'ESD 紧急停车执行器', logicIconKey: 'instrument', boundaryTitle: '锅炉 MFT/汽轮机 ETS', boundaryIconKey: 'sis-system' }],
    }),
  ])
}
