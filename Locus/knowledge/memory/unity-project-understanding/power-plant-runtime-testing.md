---
id: kd_4f804207-826c-4761-a782-d3a146045042
type: memory
path: unity-project-understanding/power-plant-runtime-testing.md
title: power-plant-runtime-testing
inheritInjectMode: true
summaryEnabled: true
commandEnabled: false
readOnly: false
inheritAiConfig: true
createdAt: 1785511892053
updatedAt: 1785775541010
---

# power-plant-runtime-testing

## Summary
SampleScene 燃气电厂运行时测试面板及流程协议索引。

<!-- locus:body:start -->
- `Assets/Scenes/SampleScene.unity` 的 `PowerPlantRuntime` 承载 `PowerPlantProcessController`、`UnityIframeBridgeManager` 与运行时手工验证面板 `PowerPlantRuntimeTestPanel`。
- 测试面板位于 `Assets/Scripts/PowerPlant/PowerPlantRuntimeTestPanel.cs`，仅在 Editor 或 Development Build 显示；提供流程步骤、节点、iframe 指令与流程自动巡检，F8 可显隐。
- 自由相机位于 `Assets/Scripts/PowerPlant/PowerPlantFreeCameraController.cs`；流程镜头改写 Transform 后，右键首次按下会同步 yaw/pitch，避免旧缓存角度造成视角闪跳。
- 二维拓扑选中单个节点时，Unity 聚焦该节点并应用青色描边 `(0, 1, 0.921)`，描边宽度为 `0.24`；仅切换流程步骤时不显示流程范围描边。告警描边仍为红色、宽度 `0.3`。
- 场景映射由 `Assets/Editor/PowerPlantSceneSetup.cs` 在编辑期解析一次并序列化写入 `PowerPlantRuntime`；`PowerPlantProcessController` 运行时不再使用 `Transform.Find` 或名称字符串查找模型。当前拓扑节点直接映射：`inlet-duct`→烟囱、`gas-turbine`→燃气轮机、`hrsg`→余热锅炉、`steam-turbine`→低中高压汽轮机、`generator`→发电机、`grid-output`→变压站+电网。
- 当前 `hrsg` 系统展示集合由用户确认：`余热锅炉管道`、`余热锅炉`、`凝结水到锅炉管道2`、`冷凝水泵1/2`、`凝汽器`、`排水口管道1/002`、`海水进水口管道`、`海水进口管道支架`、`取水泵站`、`取水泵站管道`；`地面`保持不透明，未列入此集合的场景模型在隔离时以 0.22 不透明度显示。
- 已取消路由级动态流动控制。当前 9 条用户选择的场景管道直接绑定 `Assets/Art/Generated/StaticPipelineFlow/` 下的共享流动材质，打开场景即持续播放，流程切换、节点聚焦、复位和桥接协议均不会停止或替换它们。海水进水口、排水口管道1、凝结水到锅炉管道2使用反向速度；管道5、汽轮机管道1、取水泵站管道及其他选中管道使用正向速度。
- `Assets/Editor/PowerPlantPipelineUvBaker.cs` 可通过 `Tools/Power Plant/Bake Flow UVs` 重建这些网格：它根据三角面拓扑计算每个分离网格块的测地距离 UV。合并模型中的每根并行管线是独立网格块，因此该方法能保持单根管线经弯头的连续性，但无法自动判断多个独立管线之间的工艺连接与正反方向；方向须以源模型 UV 或单独路线元数据最终确认。
<!-- locus:body:end -->
