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
updatedAt: 1785587213923
---

# power-plant-runtime-testing

## Summary
SampleScene 燃气电厂运行时测试面板及流程协议索引。

<!-- locus:body:start -->
- `Assets/Scenes/SampleScene.unity` 的 `PowerPlantRuntime` 承载 `PowerPlantProcessController`、`UnityIframeBridgeManager` 与运行时手工验证面板 `PowerPlantRuntimeTestPanel`。
- 测试面板位于 `Assets/Scripts/PowerPlant/PowerPlantRuntimeTestPanel.cs`，仅在 Editor 或 Development Build 显示；提供流程步骤、节点、两条已确认烟道路由、iframe 指令与流程自动巡检，F8 可显隐。
- 自由相机位于 `Assets/Scripts/PowerPlant/PowerPlantFreeCameraController.cs`；流程镜头改写 Transform 后，右键首次按下会同步 yaw/pitch，避免旧缓存角度造成视角闪跳。
- 流程与告警高亮均由 `PowerPlantProcessController` 在运行时创建 Highlight Plus `HighlightEffect`；仅保留纯描边，流程色为青色 `(0, 1, 0.921)`，告警色为红色 `(1, 0.018, 0)`，外发光、内发光和覆盖层均关闭。
- 当前场景流程协议：`gas-power-generation`；步骤为 overview、grid-output、gas-network、inlet-duct、gas-turbine、hrsg、steam-turbine、generator；机组 all/1/2。
- 当前只登记并允许流动的实体路由：管道 6/9 分别为 `route.exhaust-to-hrsg.1/2`（燃气轮机排气至余热锅炉）。管道 1/3 是汽轮机—发电机轴系，禁止使用流体材质；管道 2/4 的介质与方向、管道 5/7 的介质均未确认，因此不登记为可播放路由。
<!-- locus:body:end -->
