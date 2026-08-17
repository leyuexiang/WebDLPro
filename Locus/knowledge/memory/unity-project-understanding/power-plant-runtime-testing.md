---
id: kd_4f804207-826c-4761-a782-d3a146045042
injectMode: inherit
summary: SampleScene 燃气电厂运行时测试面板及流程协议索引。
aiEditMode: inherit
---

- `Assets/Scenes/Business/GasPower.unity` 的 `PowerPlantRuntime` 承载 `PowerPlantProcessController`、`UnityIframeBridgeManager` 与运行时手工验证面板 `PowerPlantRuntimeTestPanel`。
- 运行时测试面板仅在 Unity 编辑器内编译；所有 WebGL 构建（含开发构建）都不显示桥接状态框或测试面板。桥接状态通过 `Debug.Log` / `Debug.LogWarning` 输出到浏览器开发者工具控制台，WebGL 模板的播放器警告和错误也只写控制台、不覆盖三维画面。
- 自由相机位于 `Assets/Scripts/PowerPlant/PowerPlantFreeCameraController.cs`；流程镜头改写 Transform 后，右键首次按下会同步 yaw/pitch，避免旧缓存角度造成视角闪跳。
- `PowerPlantProcessController.TryEnterProcessStep` 对 `overview` 使用独立总览语义：清除流程与告警描边，恢复上下文材质并强制显示场景根节点下全部模型；总览、关键流程与二维节点选择均保持用户当前镜头位置，不再触发相机聚焦。
- 二维拓扑选中单个节点时，Unity 仅应用青色描边 `(0, 1, 0.921)`；关键流程也仅描边其唯一业务节点；总览不显示流程描边。告警描边仍为红色、宽度 `0.3`。
- 场景映射由 `Assets/Editor/PowerPlantSceneSetup.cs` 在编辑期解析一次并序列化写入 `PowerPlantRuntime`；`PowerPlantProcessController` 运行时不再使用 `Transform.Find` 或名称字符串查找模型。当前拓扑节点直接映射：`inlet-duct`→烟囱、`gas-turbine`→燃气轮机、`hrsg`→余热锅炉、`steam-turbine`→低中高压汽轮机、`generator`→发电机、`grid-output`→变压站+电网。
- 当前 `hrsg` 系统展示集合由用户确认：`余热锅炉管道`、`余热锅炉`、`凝结水到锅炉管道2`、`冷凝水泵1/2`、`凝汽器`、`排水口管道1/002`、`海水进水口管道`、`海水进口管道支架`、`取水泵站`、`取水泵站管道`；`地面`保持不透明，未列入此集合的场景模型在隔离时以 0.22 不透明度显示。
- 已取消路由级动态流动控制。当前 9 条用户选择的场景管道直接绑定 `Assets/Art/Generated/StaticPipelineFlow/` 下的共享流动材质，打开场景即持续播放，流程切换、节点聚焦、复位和桥接协议均不会停止或替换它们。海水进水口、排水口管道1、凝结水到锅炉管道2使用反向速度；管道5、汽轮机管道1、取水泵站管道及其他选中管道使用正向速度。
- 已确认 WebGL 平台默认质量等级为 Balanced，而编辑器当前质量等级为 High Fidelity；前者使用 50 的主光阴影距离、单级级联和 1024 阴影图，后者使用 150 的阴影距离、四级级联和 4096 阴影图。若出现编辑器正常但 WebGL 近景模型变黑，应优先在浏览器开发者工具中临时关闭主光阴影、再关闭屏幕空间环境光遮蔽（SSAO）进行对照，并记录黑化距离；不要先改自定义管道 Shader。
