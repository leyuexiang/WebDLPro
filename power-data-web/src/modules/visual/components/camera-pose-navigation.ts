import { toCameraPoseId, type CameraPoseId, type SceneId } from '@/config/scene-topology/identifiers'

/**
 * 第二层厂区三维视口允许展示镜头按钮的场景闭集。
 * 该闭集与九场景目录分开维护，防止其他业务场景因标题相似而误用燃气或燃煤镜头点。
 */
export type CameraPoseNavigationSceneId = 'gas-power' | 'coal-power'

/**
 * 单个镜头按钮只保存用户可见文案和 Unity 已登记的稳定镜头标识。
 * 页面不会接收坐标、旋转、层级路径或用户输入，因此按钮无法扩展成任意 Unity 调用入口。
 */
export interface CameraPoseNavigationButton {
  readonly label: string
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
    { label: '天然气管道进气', cameraPoseId: toCameraPoseId('gas-power.camera.gas-inlet') },
    { label: '燃气轮机燃烧', cameraPoseId: toCameraPoseId('gas-power.camera.gas-turbine') },
    { label: '余热锅炉加热产生蒸汽', cameraPoseId: toCameraPoseId('gas-power.camera.hrsg') },
    { label: '蒸汽推动蒸汽机转动', cameraPoseId: toCameraPoseId('gas-power.camera.steam-turbine') },
    { label: '带动发电机发电', cameraPoseId: toCameraPoseId('gas-power.camera.generator') },
    { label: '电能经变压器并网', cameraPoseId: toCameraPoseId('gas-power.camera.grid-output') },
  ]),
  'coal-power': Object.freeze([
    { label: '输煤皮带输送煤', cameraPoseId: toCameraPoseId('coal-power.camera.coal-conveying') },
    { label: '磨煤机磨煤', cameraPoseId: toCameraPoseId('coal-power.camera.coal-mill') },
    { label: '锅炉燃烧产生蒸汽', cameraPoseId: toCameraPoseId('coal-power.camera.boiler') },
    { label: '带动蒸汽轮机转动', cameraPoseId: toCameraPoseId('coal-power.camera.steam-turbine') },
    { label: '带动发电机发电', cameraPoseId: toCameraPoseId('coal-power.camera.generator') },
    { label: '电能经变压器并网', cameraPoseId: toCameraPoseId('coal-power.camera.grid-output') },
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
