---
id: kd_4f804207-826c-4761-a782-d3a146045042
injectMode: inherit
summary: SampleScene 燃气电厂运行时测试面板及流程协议索引。
aiEditMode: inherit
---

- `Assets/Scenes/Business/GasPower.unity` 的 `PowerPlantRuntime` 承载 `PowerPlantProcessController`、`UnityIframeBridgeManager` 与运行时手工验证面板 `PowerPlantRuntimeTestPanel`。
- 运行时测试面板仅在 Unity 编辑器内编译；所有 WebGL 构建（含开发构建）都不显示桥接状态框或测试面板。桥接状态通过 `Debug.Log` / `Debug.LogWarning` 输出到浏览器开发者工具控制台，WebGL 模板的播放器警告和错误也只写控制台、不覆盖三维画面。
- 自由相机位于 `Assets/Scripts/PowerPlant/PowerPlantFreeCameraController.cs`；拓扑节点选择和 Unity 鼠标左键选择共用 `PowerPlantProcessController._focusOnSelection` 统一开关。每个 `_nodes` 节点可选配置 `_focusCameraPose`：已配置时平滑移动到该 Transform 的世界位置和旋转，留空时根据描边渲染器合并包围盒，以当前水平观察侧为基准平滑过渡到轻微俯视取景。关闭统一开关时仍描边和联动二维拓扑，但不移动镜头。用户的键盘移动、左键平移、右键旋转或滚轮推拉会立即中止补间并接管视角。
- `PowerPlantProcessController.TryEnterProcessStep` 在完成命令校验后调用统一相机控制器的 `ResetToInitialTransform`，总览与关键流程都会平滑恢复当前场景首次加载时缓存的初始位置和旋转；`TryResetScene` 复用同一初始视角。`TryFocusNode` 和 Unity 鼠标命中都会更新交互描边，并由统一开关决定是否聚焦；清空选择只停止未完成补间，不会复位镜头。
- Unity 鼠标命中已登记场景节点后，通过 `UnityIframeBridgeManager.ReportObjectSelected` 发送 `sceneId + sceneNodeId + sceneActivationId`；前端 `UnityObjectSelectionCoordinator` 按正式映射选中对应二维节点，不再次发送 `focusNode`，因此不会形成回环。存在交互选择时，Unity 鼠标点击空白、地面或未映射对象会清除交互描边并发送 `selectionCleared(sceneId, sceneActivationId)`；前端通过同一场景实例门禁清除二维节点与连线，不回发 Unity 命令。告警描边仍为红色、宽度 `0.3`。
- `Assets/Scenes/Business/GasPower.unity` 的燃气拓扑映射已拆分为上下两层：上层 `unit.gas-turbine.control`、`unit.hrsg.control`、`unit.steam-turbine.control`、`unit.generator.control` 分别聚合主设备、对应地面电线和控制柜，只允许拓扑发起聚焦；下层 `gas-turbine`、`hrsg`、`steam-turbine`、`generator` 各自只绑定一个主设备，独占 Unity 鼠标反向选择与四态视觉。前端对应下层 `nodeId` 为 `asset.gas-turbine`、`asset.hrsg`、`asset.steam-turbine`、`asset.generator`，避免三维点击反选到上层控制系统。
- `Assets/Scenes/Business/CoalPower.unity` 采用相同上下层边界：`unit.coal-boiler.control` 聚合锅炉、`dcs控制线`、`控制柜.006`，`unit.coal-steam-turbine.control` 聚合汽轮机、`deh控制线`、`控制柜.008`，`unit.coal-generator.control` 聚合发电机、`ecs控制线`、`控制柜.007`，三者只允许拓扑发起聚焦。下层 `node.coal-boiler`、`node.coal-steam-turbine`、`node.coal-generator` 分别绑定单个 Equipment 主设备，并与 `_visualStateBindings` 使用同一模型引用，独占 Unity 鼠标反选和四态；前端下层编号为 `asset.coal-boiler`、`asset.coal-steam-turbine`、`asset.coal-generator`。
- 当前 `hrsg` 系统展示集合由用户确认：`余热锅炉管道`、`余热锅炉`、`凝结水到锅炉管道2`、`冷凝水泵1/2`、`凝汽器`、`排水口管道1/002`、`海水进水口管道`、`海水进口管道支架`、`取水泵站`、`取水泵站管道`；`地面`保持不透明，未列入此集合的场景模型在隔离时以 0.22 不透明度显示。
- 已取消路由级动态流动控制。当前 9 条用户选择的场景管道直接绑定 `Assets/Art/Generated/StaticPipelineFlow/` 下的共享流动材质，打开场景即持续播放，流程切换、节点聚焦、复位和桥接协议均不会停止或替换它们。海水进水口、排水口管道1、凝结水到锅炉管道2使用反向速度；管道5、汽轮机管道1、取水泵站管道及其他选中管道使用正向速度。
- 已确认 WebGL 平台默认质量等级为 Balanced，而编辑器当前质量等级为 High Fidelity；前者使用 50 的主光阴影距离、单级级联和 1024 阴影图，后者使用 150 的阴影距离、四级级联和 4096 阴影图。若出现编辑器正常但 WebGL 近景模型变黑，应优先在浏览器开发者工具中临时关闭主光阴影、再关闭屏幕空间环境光遮蔽（SSAO）进行对照，并记录黑化距离；不要先改自定义管道 Shader。
- `Assets/Scenes/Overview/Overview.unity` 的燃煤、燃气故障已接入真实沙盘联动：燃煤绑定 `SceneRoot/电线.003`、`SceneRoot/电线.004`，燃气绑定 `SceneRoot/电线.002`、`SceneRoot/电线.001`。故障时仅给绑定渲染器的 `_FlowSpeed` 材质槽创建独占运行时材质副本：将 `_FlowSpeed` 设为 `0`，并用 `PowerPlantVisualStateConfig.FaultColor` 同步覆盖底色及两层流动颜色；共享材质资产和未绑定电线保持原速度与颜色。清除故障时恢复原共享材质引用并销毁副本。两厂共用场景内 `OverviewSphericalPulseEffect`；每座厂房可显式绑定多个独立模型目标，故障时逐个动态添加、清除时逐个删除。
- 燃气、燃煤第二层的六个命名镜头步骤已复用 `PowerPlantProcessController` 的视觉聚焦：每个 `BusinessSceneNamedCameraPoseRegistry.CameraPoseBinding` 显式保存一个或多个 `_highlightTargets`；点击后先让目标组保持原材质并启用青色脉冲描边，其余模型按 0.22 不透明度淡化，再播放固定镜头插值。该入口不改变正式流程状态、不回传二维拓扑选择，也不执行包围盒自动聚焦。
