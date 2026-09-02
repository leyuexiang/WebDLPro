import { toCameraPoseId, type CameraPoseId, type SceneId } from '@/config/scene-topology/identifiers'

/**
 * 第二层厂区三维视口允许展示镜头按钮的场景闭集。
 * 该闭集与九场景目录分开维护，防止其他业务场景因标题相似而误用燃气或燃煤镜头点。
 */
export type CameraPoseNavigationSceneId = 'gas-power' | 'coal-power'

/**
 * 单个镜头按钮只保存用户可见标题、临时说明和 Unity 已登记的稳定镜头标识。
 * 说明仅用于左上角信息气泡，不进入 Unity 命令载荷；页面仍不会接收坐标、旋转、层级路径或用户输入，
 * 因此按钮无法扩展成任意 Unity 调用入口。
 */
export interface CameraPoseNavigationButton {
  readonly label: string
  readonly description: string
  readonly cameraPoseId: CameraPoseId
}

/** 空数组作为所有不支持场景的共享返回值，避免响应式计算期间重复分配临时数组。 */
const EMPTY_CAMERA_POSE_BUTTONS: readonly CameraPoseNavigationButton[] = Object.freeze([])

/**
 * 燃气与燃煤各六个按钮严格按工艺顺序登记。
 * 标识必须与 Unity 场景内 BusinessSceneNamedCameraPoseRegistry（业务场景命名镜头注册表）一致；
 * 后续若只调整 Unity 镜头位置和旋转，不需要改动此固定映射。
 */
const CAMERA_POSE_BUTTONS_BY_SCENE: Readonly<Record<CameraPoseNavigationSceneId, readonly CameraPoseNavigationButton[]>> = Object.freeze({
  'gas-power': Object.freeze([
    {
      label: '天然气管道进气',
      description: '天然气经进气管道进入厂区，在调压与计量后送往燃气轮机，为联合循环机组提供稳定燃料。',
      cameraPoseId: toCameraPoseId('gas-power.camera.gas-inlet'),
    },
    {
      label: '燃气轮机燃烧',
      description: '天然气与压缩空气在燃烧室内混合燃烧，形成高温高压燃气并推动燃气轮机持续旋转。',
      cameraPoseId: toCameraPoseId('gas-power.camera.gas-turbine'),
    },
    {
      label: '余热锅炉加热产生蒸汽',
      description: '燃气轮机排出的高温烟气进入余热锅炉，加热给水并产生驱动蒸汽轮机所需的蒸汽。',
      cameraPoseId: toCameraPoseId('gas-power.camera.hrsg'),
    },
    {
      label: '蒸汽推动蒸汽机转动',
      description: '高温高压蒸汽进入蒸汽轮机膨胀做功，推动转子旋转并向联合循环轴系输出机械能。',
      cameraPoseId: toCameraPoseId('gas-power.camera.steam-turbine'),
    },
    {
      label: '带动发电机发电',
      description: '燃气轮机和蒸汽轮机输出的机械能带动发电机转子旋转，将机械能转换为电能。',
      cameraPoseId: toCameraPoseId('gas-power.camera.generator'),
    },
    {
      label: '电能经变压器并网',
      description: '燃气联合循环发电机输出的电能经主变压器升压后接入电网，完成电能输送与并网。',
      cameraPoseId: toCameraPoseId('gas-power.camera.grid-output'),
    },
  ]),
  'coal-power': Object.freeze([
    {
      label: '输煤皮带输送煤',
      description: '原煤经输煤皮带连续送入煤仓，为制粉系统和锅炉燃烧环节提供稳定的燃料来源。',
      cameraPoseId: toCameraPoseId('coal-power.camera.coal-conveying'),
    },
    {
      label: '磨煤机磨煤',
      description: '原煤进入磨煤机后被研磨并干燥成煤粉，再由一次风输送至锅炉的各级燃烧器。',
      cameraPoseId: toCameraPoseId('coal-power.camera.coal-mill'),
    },
    {
      label: '锅炉燃烧产生蒸汽',
      description: '煤粉在锅炉炉膛内燃烧释放热量，加热受热面中的水并产生高温高压蒸汽。',
      cameraPoseId: toCameraPoseId('coal-power.camera.boiler'),
    },
    {
      label: '带动蒸汽轮机转动',
      description: '锅炉产生的高温高压蒸汽进入蒸汽轮机膨胀做功，推动燃煤机组转子持续旋转。',
      cameraPoseId: toCameraPoseId('coal-power.camera.steam-turbine'),
    },
    {
      label: '带动发电机发电',
      description: '燃煤机组蒸汽轮机输出的机械能带动发电机转子旋转，将机械能转换为电能。',
      cameraPoseId: toCameraPoseId('coal-power.camera.generator'),
    },
    {
      label: '电能经变压器并网',
      description: '燃煤机组发电机输出的电能经主变压器升压后送入电网，完成厂内输出与系统并网。',
      cameraPoseId: toCameraPoseId('coal-power.camera.grid-output'),
    },
  ]),
})

/**
 * 按稳定场景标识读取只读按钮表；未登记场景返回共享空表。
 * 显式值判断比标题、拓扑名称或字符串包含判断更安全，也保持常数时间查询。
 */
export function getCameraPoseNavigationButtons(sceneId: SceneId | undefined): readonly CameraPoseNavigationButton[] {
  if (sceneId === 'gas-power') return CAMERA_POSE_BUTTONS_BY_SCENE['gas-power']
  if (sceneId === 'coal-power') return CAMERA_POSE_BUTTONS_BY_SCENE['coal-power']
  return EMPTY_CAMERA_POSE_BUTTONS
}
