---
name: business-scene-configuration
description: "在 WebDLPro 项目中新增或调整 Unity 业务场景时，统一配置场景骨架、节点四态、第二层前端关键环节步骤、命名镜头、厂房入口、第三层关键环节、前端拓扑绑定、公开动作、三层能力清单、版本发布和平台交付验收。用户提到新增业务场景、调整燃气或燃煤式场景配置、第二层步骤、二维三维映射、场景能力、平台联动或场景配置验收时使用。"
---

# 业务场景配置与平台联动

用于新增或调整 WebDLPro 业务场景，并让 Unity 场景、前端拓扑、二维/三维绑定、公开动作、平台能力清单和发布版本保持原子一致。燃气、燃煤是结构参考，不是可直接复制模型路径或业务语义的模板。

## 适用范围

在以下任一情况使用本 Skill：

- 新增或替换 `Assets/Scenes/Business/` 下的业务场景。
- 调整场景模型层级、可交互节点、四态目标、命名镜头、厂房入口或第三层关键环节。
- 新增或调整前端拓扑节点、连线、动作、`sceneNodeId` 映射。
- 更新给平台方的动作、命令、事件、节点或版本能力清单。
- 排查“二维能选但三维不动”“三维点击反选错误”“平台能调命令但场景返回不支持”等跨端配置问题。

不把本 Skill 用于只调整灯光颜色、纯美术材质或不影响协议和映射的局部视觉修改；但调整后仍要检查是否破坏 Renderer、材质槽、Collider 或序列化引用。

## 当前事实源

执行前读取实际文件，不凭本 Skill 中的示例猜测当前配置。关键事实源如下：

### Unity

- 业务场景目录：`Assets/Configuration/BusinessSceneCatalog.asset`
- 场景目录类型与能力：`Assets/Scripts/Visualization/Scenes/BusinessSceneCatalog.cs`
- 场景能力枚举：`Assets/Scripts/Visualization/Scenes/BusinessSceneContracts.cs`
- WebGL 全局协议能力：`Assets/Scripts/Visualization/Scenes/SceneSwitchProtocolModels.cs`
- 启动、目录和构建顺序：`Assets/Editor/BusinessSceneBootstrapGenerator.cs`
- 电厂二层控制：`Assets/Scripts/PowerPlant/PowerPlantProcessController.cs`
- 燃气/燃煤场景适配器：
  - `Assets/Scripts/PowerPlant/GasPowerBusinessSceneControllerAdapter.cs`
  - `Assets/Scripts/PowerPlant/CoalPowerBusinessSceneControllerAdapter.cs`
- 第三层目录：`Assets/Configuration/ProcessDetailCatalog.asset`
- 共用四态配置：`Assets/Configuration/PowerPlantVisualStateConfig.asset`
- 参考场景：
  - `Assets/Scenes/Business/GasPower.unity`
  - `Assets/Scenes/Business/CoalPower.unity`

### 前端与发布

- 结构清单类型：`power-data-web/src/config/scene-topology/types.ts`
- 结构清单校验器：`power-data-web/src/config/scene-topology/validator.ts`
- 运行时登记与 Unity 内层能力：`power-data-web/src/config/process/runtime-registry.ts`
- 外层平台协议能力：`power-data-web/src/host-bridge/host-protocol.ts`
- 联合结构清单与发布生成：`power-data-web/scripts/build-gas-power-smoke-release.mjs`
- 燃煤拓扑与映射参考：`power-data-web/scripts/coal-power-topology.mjs`
- 运行时图元绑定：`power-data-web/src/modules/visual/topology-preview/`
- 第二层命名镜头步骤定义：`power-data-web/src/modules/visual/components/camera-pose-navigation.ts`
- 第二层步骤编排与显示条件：`power-data-web/src/app/EmbeddedVisualizationShell.vue`
- 第二层步骤说明气泡：`power-data-web/src/modules/visual/components/CameraPoseInformationBubble.vue`
- 第二层步骤映射测试：`power-data-web/src/modules/visual/components/camera-pose-navigation.spec.ts`
- 发布产物门禁：`power-data-web/scripts/release-artifact-contract.mjs`

### 规则文档

- `Docs/前端原子任务/场景模型节点与拓扑节点命名规范.md`
- `Docs/前端原子任务/场景拓扑动作映射规范.md`
- `Docs/前端原子任务/合作方设备绑定与状态对接确认结论.md`
- `Docs/前端原子任务/Unity设备状态视觉搭建标准.md`
- `Docs/前端原子任务/测试包与正式包输出标准.md`

若代码、场景与文档不一致，以当前运行时代码、序列化场景、自动化测试和发布门禁共同证明的行为为准；先报告漂移，再决定修正哪一侧。

## 核心原则

1. **原子交付**：Unity 场景、目录能力、前端拓扑、动作、二维/三维映射、版本和平台交付说明必须同批更新。只改一侧不得标记完成。
2. **显式映射**：禁止由中文标题、Unity 对象名、层级、坐标、图标、数组顺序或相同字符串推断映射。
3. **职责分离**：
   - `nodeId`：二维逻辑节点，也是平台内部设备绑定和状态快照主键。
   - `sceneNodeId`：Unity 三维目标标识，只用于我方三维聚焦、状态和反向选择。
   - `deviceId`：只属于平台内部，不进入我方清单、消息、缓存或交付物。
4. **能力不虚报**：桥接协议支持一条命令，不等于当前业务场景支持该命令。场景目录声明、适配器运行时能力和真实序列化前置条件必须一致。
5. **上下层边界**：控制系统聚合节点与现场设备节点分开。上层只接受拓扑发起聚焦；下层单模型节点负责三维反选和四态。
6. **未确认即不发布**：没有正式拓扑、模型或业务关系证据时保持无映射、空目录或受控占位，不补造节点、流程、路径或第三层能力。
7. **不覆盖现有场景**：新增配置前读取现有场景、Prefab 来源和覆盖。结构化 Unity 资产只通过 Unity API 修改，不直接编辑 YAML。
8. **稳定标识不可随视觉改动变化**：中文标题、镜头位置、对象层级和图面坐标变化通常不改稳定 ID。确需改 ID 时按破坏性版本迁移处理。
9. **步骤配置禁止持久修改材质**：配置第二层或第三层步骤时，不得修改模型的场景材质槽、FBX 内嵌材质、Prefab 基础材质，也不得创建并绑定持久材质变体。步骤高亮、淡化、透明和变色都必须是运行时临时效果，并在退出步骤、复位或切换场景后完整恢复。只有用户另行明确提出与步骤无关的默认美术外观需求时，才可作为独立任务调整基础材质；禁止从步骤说明中推断默认材质需求。

## 三层能力模型

给平台方输出能力时必须区分以下三层，禁止合成一个模糊的“支持列表”。

### A. 外层平台协议能力

当前事实源是 `HOST_COMMAND_TYPES` 和 `HOST_EVENT_TYPES`。默认命令包括：

- `system.init`
- `view.open`
- `workflow.trigger`
- `process-detail.playback`
- `device.states.update`
- `state.get`
- `system.dispose`

默认事件包括：

- `system.ready`
- `system.ack`
- `command.result`
- `view.changed`
- `topology.node.dblclick`
- `scene.object.selected`
- `state.snapshot`
- `system.error`

实际 `system.ready` 只能声明已安装的能力；可选协调器未装配时不得发布对应命令。

### B. Unity WebGL 全局桥接能力

当前事实源是 `WebGlProtocolContract.CreateCommandCapabilities()` 和 `CreateEventCapabilities()`，并在成功构建后写入 `unity/webgl-protocol-capabilities.json`。

全局命令当前包括：

- `init`、`resize`、`switchScene`
- `moveCameraToPose`
- `prepareProcessDetail`、`commitProcessDetail`、`abortProcessDetail`
- `enterProcessDetail`、`exitProcessDetail`、`setProcessDetailPlayback`
- `resetScene`、`resetCamera`
- `focusNode`、`clearSelection`
- `setNodeVisualState`、`clearNodeVisualState`
- `setRouteFlow`、`setNodeVisibility`
- `dispose`

全局事件当前包括：

- `ready`、`ack`、`commandResult`
- `sceneLoadProgress`、`sceneChanged`
- `objectSelected`、`selectionCleared`
- `disposed`

该层表示播放器和桥接能识别命令，不证明目标场景能成功执行。

### C. 业务场景实际能力

当前事实源是：

1. `BusinessSceneCatalogEntry.DeclaredCapabilities`。
2. 对应 `IBusinessSceneController.Capabilities` 运行时结果。
3. 场景序列化配置是否满足能力前置条件。

基础能力枚举：`Initialize`、`FocusNode`、`ClearSelection`、`UpdateNodeVisualState`、`ClearNodeVisualState`、`SetRouteFlow`、`SetNodeVisibility`、`MoveCameraToPose`、`ResetScene`、`Release`。

注意：

- `UpdateNodeVisualState` / `ClearNodeVisualState` 只有全部四态目标成功登记后才可声明。
- `MoveCameraToPose` 只有场景存在有效 `BusinessSceneNamedCameraPoseRegistry` 时才可声明。
- 第三层能力还要求适配器实现 `IBusinessSceneProcessDetailController` 且目录、加载器、协调器和资源完整。
- `resetCamera` 是适配器接口能力，不等于 `BusinessSceneCapability.ResetScene`；两者语义不同。
- `SetRouteFlow` 即使存在于全局桥接中，燃气、燃煤适配器当前也可明确返回不支持；不得向平台宣称该场景支持动态路径流。

## 工作流

### 阶段 0：确认目标和证据

在写入前建立配置台账：

| 字段 | 必填内容 |
| --- | --- |
| 场景名称 | 用户可见名称 |
| `sceneId` | 固定十一场景之一，或已批准的目录扩展 |
| Unity 场景路径 | 完整 `Assets/.../*.unity` |
| `unitySceneKey` | 目录中的稳定键 |
| `processId` | 若无流程则明确写“无” |
| 第二层前端步骤 | 是否展示；逐步标题、说明、顺序和 `cameraPoseId`；若无则明确写“无” |
| 默认 `topologyId` | 第二层厂区拓扑 |
| 资源来源 | 模型、材质、拓扑、流程资料 |
| 预期能力 | 按三层能力模型分别填写 |
| 未确认项 | 显式列出并阻止相应能力发布 |

先检查 Git 状态，保护用户未提交改动。只修改任务范围内文件；大量现有改动不是覆盖授权。

### 阶段 1：检查目录、构建和场景身份

1. 检查 `BusinessSceneCatalog.asset` 和 `BusinessSceneBootstrapGenerator.cs` 中的：
   - `sceneId`
   - `unitySceneKey`
   - 场景路径
   - 可用性
   - 声明能力
2. 检查 Build Settings：Bootstrap 第一、Overview 第二，之后是完整业务场景闭集。
3. 场景必须有独立稳定路径和 GUID；不要通过删除重建改变 GUID。
4. 对既有占位场景升级时，移除或替换 `UnavailableBusinessSceneController` 前先建立真实适配器和测试。
5. 新增固定目录外场景属于架构变更，必须同步修改 Unity 和前端的场景闭集、校验器、测试和发布门禁，不能只增加一个 `.unity` 文件。

### 阶段 2：导入与整理美术资源

1. 模型、材质和纹理按场景目录归属；保留源 FBX，不破坏 `.meta` 与 GUID。
2. 检查重复几何。主模型和独立电线/附属模型重叠时，只在场景实例停用重复 Renderer，不删除源资源。
3. 材质导入优先使用项目已验证的 External、BasedOnMaterialName、Local 方式，并将生成材质限制在场景资源目录。
4. 复杂管网流动必须有沿路径连续 UV0，或显式样条/中心线；不能期待 Shader 自动推断合并管网拓扑。
5. 记录 WebGL 质量差异。编辑器正常而 WebGL 黑化时先核对阴影距离、级联、阴影图和 SSAO，不先归因自定义 Shader。

### 阶段 3：搭建 Unity 场景骨架

参考燃气和燃煤的职责，不照抄对象路径。建议结构：

- `Main Camera`
  - `Camera`
  - `AudioListener`
  - `UniversalAdditionalCameraData`
  - `PowerPlantFreeCameraController` 或该场景专用统一相机控制器
- 主模型根：建议 `SceneRoot`
  - `Environment`
  - `Equipment`
  - `Effects`
- `PowerPlantRuntime` 或同职责运行时根
  - 场景控制器
  - 必需桥接/测试组件
  - 可选厂房入口
  - 可选命名镜头注册表
  - 可选第三层加载器与协调器
  - `ProcessDetailMount`
- 可选镜头点根

检查：

- `Main Camera` Tag 正确，场景只保留一个活动 `AudioListener`。
- 相机初始 Transform 是 `resetCamera` 和场景复位的真实基线。
- 场景根引用、交互相机、上下文材质均显式序列化。
- 运行时不使用 `GameObject.Find`、模糊名称匹配或全场景扫描补映射。
- 厂房入口壳体保持原始材质；透明变体按每个源材质严格配对。不要直接把场景材质槽替换成其他透明材质。

### 阶段 4：配置三维节点

先设计映射，再写 Inspector。推荐命名：

- 二维上层控制：`system.<technology>-<business-role>-control`
- 二维下层设备：`asset.<technology>-<business-role>`
- 三维上层聚合：`unit.<technology>-<business-role>.control`
- 三维下层设备：`node.<technology>-<business-role>`

每个 `PowerPlantProcessController._nodes` 项配置：

- `_id`：稳定 `sceneNodeId`
- `_targets`：显式 GameObject 引用
- `_topologyOnlySelection`
- `_focusCameraPose`：可选

边界规则：

1. 上层控制节点可聚合主设备、控制线和控制柜，`_topologyOnlySelection = true`。
2. 下层现场节点通常只绑定一个主设备，`_topologyOnlySelection = false`。
3. 同一主设备可出现在上层聚合与下层节点中，但可点击对象的反向选择只能归属一个下层 `sceneNodeId`。
4. 地面、空白和未映射对象点击应清除交互选择，并通过 `selectionCleared` 同步前端。
5. 不需要三维映射的二维节点不要创建虚假 `sceneNodeId`。

建立双端映射台账：

| 二维 `nodeId` | 中文标题 | 三维 `sceneNodeId` | Unity 目标 | 拓扑单击聚焦 | Unity 反选 | 四态 | 依据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `system...` | 控制系统 | `unit...control` | 主设备+线+柜 | 是 | 否 | 否 | 正式资料 |
| `asset...` | 现场设备 | `node...` | 单一主设备 | 是 | 是 | 可选 | 正式资料 |

### 阶段 5：配置总览、聚焦和四态

1. 配置 `_groundObjects`、`_overviewOpaqueObjects`、`_overviewContextObjects`，不要依名字自动收集。
2. `_applyInitialOverviewContext` 在第二层业务场景通常保持关闭，避免场景启动即把大部分模型半透明。步骤需求不得用于推断或修改初始基础材质；默认材质调整必须来自独立、明确的美术需求。
3. `_contextFadeMaterial` 使用项目统一材质；上下文半透明不应覆盖设备告警/故障状态。
4. `_visualStateBindings` 只登记明确接收状态的下层真实设备。
5. 每个 Renderer 只能归属一个状态节点；每个材质槽必须包含控制器允许的颜色属性，如 `_BaseColor` 或 `_BASE_COLOR`。
6. `normal` 与 `clearNodeVisualState` 语义不同，但都必须正确恢复登记时基础材质；缺失节点不等于 `offline`。
7. 故障停流只在已有明确实现时声明；不要把普通二维边自动变成三维路径。

### 阶段 6：配置命名镜头和厂房入口

#### 命名镜头

每个 `BusinessSceneNamedCameraPoseRegistry._cameraPoses` 项包含：

- 稳定 `cameraPoseId`
- 场景内目标 Transform
- 一个或多个 `_highlightTargets`

前端只发送固定 `cameraPoseId`，不发送坐标、旋转或 Unity 路径。Unity 负责按场景登记应用镜头插值以及可选的临时上下文淡化、脉冲强调；前端不得另发选择、四态或流程命令来拼装同一效果。

命名镜头不得改变流程步骤、二维选择或设备四态。第三层活动时应拒绝第二层镜头命令。

命名镜头的高亮、淡化、透明和变色全部属于运行时临时步骤效果：

- 步骤触发后目标保持原材质、非目标统一半透明，属于燃气/燃煤已验证的运行时聚焦语义；新场景要求一致时直接复用。
- 配置步骤时禁止修改任何模型的场景材质槽、Prefab 或 FBX 基础材质，禁止创建并持久绑定所谓“步骤专用材质”。
- 运行时可创建或复用临时材质实例，但必须缓存真实基础材质，并在退出步骤、`resetCamera`、`resetScene`、切换场景和释放资源时完整恢复和销毁临时资源。
- 默认静态材质外观只能由用户独立明确提出，作为与步骤配置分离的美术任务处理；不得根据“高亮模型”“其他模型半透明”等步骤描述推断默认材质也要改变。
- 验证必须同时覆盖：进入步骤前基础材质未改变、步骤期间临时效果范围正确、退出或复位后所有 Renderer 恢复原材质。

#### 第二层前端关键环节步骤

第二层视口上的“01、02……”关键环节按钮是一组**前端展示步骤**，当前事实源是 `camera-pose-navigation.ts`，并由 `EmbeddedVisualizationShell.vue` 编排。它不是 `ProcessGuideStepDefinition` 流程导览步骤，也不是第三层 `processDetailId` 入口。三者不得因为标题相同而自动绑定：

| 类型 | 稳定主键 | 职责 | 是否进入第三层 |
| --- | --- | --- | --- |
| 第二层关键环节按钮 | `cameraPoseId` | 展示标题/说明，并定位二层命名镜头 | 否 |
| 流程导览步骤 | `stepId` | 关联二维节点和已验证路由 | 否，除非另有显式动作 |
| 第三层关键环节 | `processDetailId`，目录内另含 `stepId` | 准备、提交和退出独立精细资源 | 是 |

有第二层前端步骤时，按以下顺序配置：

1. **确认场景准入**：把场景稳定 `sceneId` 显式加入 `CameraPoseNavigationSceneId` 闭集，并在 `CAMERA_POSE_BUTTONS_BY_SCENE` 增加自己的只读按钮数组。不得按中文标题、技术类型或字符串包含关系复用其他场景步骤。
2. **逐步登记内容**：每项填写：
   - `label`：按钮短标题，描述一个明确业务环节。
   - `description`：信息气泡正文，说明输入、处理和输出，不写未确认设备关系。
   - `cameraPoseId`：通过 `toCameraPoseId(...)` 建立，必须与 Unity 当前场景 `BusinessSceneNamedCameraPoseRegistry` 完全一致。
3. **确定顺序**：数组顺序就是界面编号和工艺阅读顺序；编号由前端渲染生成，不保存成业务 ID。调整文案或镜头 Transform 通常不改 `cameraPoseId`；改变步骤顺序必须经过业务确认并同步测试。
4. **保持返回闭集**：`getCameraPoseNavigationButtons(sceneId)` 只为显式登记场景返回对应数组，其他场景和 `undefined` 必须返回共享空数组。禁止回退到燃气或燃煤步骤。
5. **保持显示门禁**：只有稳定第二层业务上下文、按钮数组非空且切换遮罩关闭时显示步骤。平台总览、第三层上下文、未登记场景和切场景过渡期间不显示。
6. **按能力禁用**：步骤可见但 Unity 未就绪或未声明 `moveCameraToPose` 时，保留结构并禁用按钮，以便直接暴露构建能力不兼容；不得静默伪造成功或退化成任意坐标调用。
7. **保持点击语义**：合法点击立即显示当前步骤标题和说明，并发送唯一受控命令 `moveCameraToPose({ cameraPoseId })`。说明气泡不等待 Unity 回执；成功回执只更新按钮成功态，失败时清除成功态并输出固定脱敏诊断。
8. **处理并发和切换**：允许连续点击不同步骤，后一次接管相机插值；用单调请求序号和稳定上下文 `contextRevision` 丢弃乱序、迟到或跨场景回执，不维护无界请求历史。
9. **清理临时界面状态**：`resetCamera` 成功、稳定上下文切换时清除活动按钮、在途按钮和说明气泡。用户关闭气泡只关闭说明，不撤销已完成的镜头定位。步骤导航和气泡必须挂在 Unity 视口覆盖层内，使浏览器原生全屏继续保留并随视口缩放。
10. **禁止隐式副作用**：前端步骤点击不触发 `workflow.trigger`、不改变二维拓扑选择、不进入第三层、不写设备状态，也不直接操作模型显隐、材质或描边；这类视觉效果只能由对应 Unity 命名镜头配置在命令内部受控执行。

若场景只有普通二维流程导览而没有命名镜头，不要创建空的第二层按钮数组或借用其他场景步骤；保持 `getCameraPoseNavigationButtons(sceneId)` 返回空数组。

#### 厂房入口

若使用 `BusinessScenePreloadedInteriorEntryController`：

- 配置稳定 `_interiorId`。
- 显式绑定相机控制器、厂房内镜头点和壳体 Renderer。
- 每个源材质逐项绑定透明变体。
- 控制器配置为优先指针消费者，避免入口射线与普通节点选择竞争。

### 阶段 7：配置第三层关键环节

只有确有独立精细资源时配置：

1. 创建包装 Prefab，保留源模型为嵌套 Prefab。
2. 配置第三层默认相机位、动态控制器和四态目标。
3. 在 `ProcessDetailCatalog.asset` 登记：
   - `processDetailId`
   - `sceneId`
   - `processId`
   - `stepId`
   - `resourceId`
   - `cameraPoseId`
   - `stateNodeId`
4. 在业务场景装配：
   - `ProcessDetailAssetBundleLoader`
   - `ProcessDetailCoordinator`
   - `ProcessDetailMount`
   - 二层业务根、控制器和相机控制器引用
5. 前端结构清单同步 `processDetails` 与 `enterProcessDetail` 动作。
6. 第三层动作使用 `targetViewMode: 'process-detail'`，携带 `processDetailId`，不得携带第二层 `topologyId`。
7. `topologyDataContextId` 若存在，必须指向第三层自己的二维数据上下文，不能复用或猜测第二层过滤图。

没有第三层资源时不要创建空动作、假目录或占位能力。

### 阶段 8：配置前端拓扑和二维/三维绑定

结构清单是唯一事实源。对每个场景配置：

- `SceneDefinition`
  - `sceneId`
  - `unitySceneKey`
  - `defaultTopologyId`
  - `topologyIds`
  - `supportedActionIds`
  - `sceneMappingVersion`
  - `resourceVersion`
  - `switchStrategy`
- `TopologyDefinition`
  - `topologyId`
  - `sceneId`
  - `configVersion`
  - `nodes`
  - `edges`
  - 可选 `layers`、`focusRegions` 或 `filter`
- `UnitySceneMappingDefinition`
  - `sceneId`
  - `mappingVersion`
  - `sceneNodeIds`
  - `routeIds`

节点规则：

1. 所有来源业务节点使用全局唯一 `nodeId` 和 `doubleClickBehavior: 'emit-node'`。
2. 映射节点在自身定义中显式写 `sceneNodeId`。
3. 同一场景内 `sceneNodeId → nodeId` 必须反向唯一。
4. 过滤视图复用来源节点，不复制同一逻辑节点事实。
5. `focusRegions` 的锚点必须是已映射节点；成员全部来自同一来源拓扑。
6. 不写 `deviceId`、`deviceMappings`、`platformBindingCount`、绑定修订或第二份运行时清单。
7. 外部 JSON 图纸若另有图元 `penId`，在 `topology-preview/*-runtime-bindings.ts` 中逐版本显式维护 `penId → nodeId → 可选 sceneNodeId`；切换图纸版本必须重建索引，不能沿用旧图元 ID。

### 阶段 9：配置公开动作

每个动作至少核对：

| 字段 | 规则 |
| --- | --- |
| `actionId` | 全局唯一、稳定 |
| `targetSceneId` | 必须存在 |
| `targetViewMode` | `overview` / `business` / `process-detail` |
| `targetTopologyId` | 只允许第二层业务视图 |
| `processDetailId` | 只允许第三层关键环节 |
| `allowedParameters` | 默认空；禁止资源路径、材质、脚本名等任意参数 |
| `unityAction` | 只能使用受控动作类型 |
| `failurePolicy` | 关键动作使用 `keep-current-context` |
| `configVersion` | 与清单原子一致 |

同步保证：

1. `actions` 中指向场景的动作与该场景 `supportedActionIds` 双向一致。
2. `release-manifest.json.workflowActions` 逐项镜像结构清单公开动作。
3. 只有浏览能力的场景用 `unityAction: { type: 'none' }`，不得伪造流程或设备能力。
4. 返回业务总览可用 `resetScene`；独立相机复位使用 `resetCamera`，不要混用。

### 阶段 10：对齐三类版本

同一发布事务至少同步：

- `manifestVersion`
- Unity `unityBuildId` / release ID
- `sceneMappingVersion`
- 每场景 `resourceVersion`
- 拓扑 `configVersion`
- 动作 `configVersion`
- WebGL 协议版本与元数据结构版本
- 资源摘要 `resourceDigest`

`sceneMappingVersion` 必须同时出现在：

- 前端运行时登记
- 每个场景定义
- 每个 `unitySceneMappings` 条目
- 发给 Unity 的 `switchScene` 载荷

任一版本不一致都应拒绝加载，不拼接旧缓存降级运行。

### 阶段 11：自动化验证

#### Unity 静态与编辑器验证

至少验证：

1. C# 编译和 Console 无新增错误。
2. `BusinessSceneCatalog.ValidateForRuntime()` 无问题。
3. 目录声明能力与适配器运行时 `Capabilities` 完全一致。
4. 场景控制器的 `_nodes`、`_visualStateBindings`、命名镜头、第三层协调器均无空引用和重复 ID。
5. 可点击对象反向选择只指向规范下层 `sceneNodeId`。
6. 修改或新增相关 EditMode 测试，参考 `Assets/Tests/EditMode/BusinessSceneBootstrapAssetTests.cs`。
7. 序列化、Inspector、测试发现和场景资产验证前必须完成 Unity 全量编译/域重载，不能只依赖热重载。

#### 前端验证

在 `power-data-web` 运行：

```sh
npm run typecheck
npm run test:unit
npm run build
```

重点增加或更新：

- 场景拓扑合同测试。
- 完整 `nodeId`、边、映射和动作集合断言。
- `sceneNodeId → nodeId` 反查。
- `supportedActionIds` 双向一致。
- `sceneMappingVersion` 锁定。
- 图元 `penId` 绑定测试（若使用外部 JSON 图纸）。
- 第二层步骤映射测试：登记场景返回精确数量、顺序和 `cameraPoseId`；未登记场景及 `undefined` 返回空数组；每步标题和说明非空。
- 第二层步骤交互测试：显示门禁、能力缺失禁用、点击即展示气泡、命令载荷只含固定 `cameraPoseId`、快速连续点击以最后请求为准、失败回执不伪造活动态。
- 第二层步骤清理测试：相机复位、稳定上下文切换和第三层进入后不保留旧场景活动态、在途态或说明气泡；全屏前后覆盖控件仍属于同一 Unity 视口。

#### 清单与发布验证

先生成结构清单，再运行：

```sh
npm run validate:manifest -- --manifest <工作区内清单.json> --report <工作区内报告.json>
```

构建可交付包后运行：

```sh
npm run validate:release-artifact -- --root <发布目录>
```

普通 `npm run build` 输出不包含 Unity、结构清单、发布摘要和完整性清单，不得作为平台交付包。

### 阶段 12：运行时联调矩阵

至少覆盖以下链路：

| 场景 | 操作 | 期望 |
| --- | --- | --- |
| 初始进入 | 平台 `system.init` / `view.open` | 场景、默认拓扑和稳定上下文一致 |
| 跨场景 | A → 目标场景 → A | 单 Unity 实例，旧场景释放，新激活 ID 生效 |
| 拓扑单击映射节点 | `focusNode` | 二维先选中，三维聚焦；失败不伪造成功 |
| 拓扑单击无映射节点 | 无三维命令 | 只保留二维选择 |
| Unity 点击下层模型 | `objectSelected` → `scene.object.selected` | 反选到唯一 `nodeId`，不回发 `focusNode` |
| Unity 点击空白/地面 | `selectionCleared` | 清除二维节点与连线，不形成回环 |
| 双击二维节点 | `topology.node.dblclick` | 只包含 `sceneId + topologyId + nodeId` |
| 状态完整快照 | `device.states.update` | 二维先提交；有映射节点尽力同步三维 |
| 清除/缺失状态 | `clearNodeVisualState` | 恢复基础视觉，不推断离线 |
| 第二层步骤点击 | 前端展示说明并发送 `moveCameraToPose` | 气泡立即显示；Unity 执行临时视觉聚焦和镜头同步，不改流程/选择/四态 |
| 第二层步骤快速切换 | A → B，回执乱序 | B 接管相机；A 的迟到回执不覆盖 B 的按钮状态 |
| 第二层步骤能力缺失 | Unity 未就绪或无 `moveCameraToPose` | 步骤结构保留但按钮禁用，不发送命令、不伪造成功 |
| 第二层步骤清理 | 复位、切场景或进入第三层 | 清除旧活动态、在途态和说明气泡；第三层不显示二层步骤 |
| 第三层进入/退出 | 准备、提交、退出 | 二层与三层资源、相机和状态正确切换 |
| 重置镜头 | `resetCamera` | 只回初始镜头并清临时选择，不重写流程 |
| 重置场景 | `resetScene` | 恢复二层默认显隐、材质和初始镜头 |
| 释放 | `system.dispose` / `dispose` | iframe、场景、运行时材质和监听器均释放 |

还要测试失败路径：未知 ID、能力未声明、版本不匹配、命令超时、快速切换取代、场景加载失败、第三层准备失败、Unity 迟到事件、释放竞争。

## 平台方交付包

每次新增或调整场景，给平台方提供以下内容。不要只发送一句“支持 Unity 联动”。

### 1. 发布身份

- 包类型：`partner-integration` 或 `standalone-formal`
- 不可变 `releaseId`
- Unity `buildId`
- `manifestVersion`
- `sceneMappingVersion`
- `resourceDigest`
- Host 协议版本、Unity 协议版本
- 发布目录摘要与完整性校验结果

### 2. 场景入口清单

| 场景名 | `sceneId` | `runtimeKey` | 默认 `topologyId` | `resourceVersion` | 加载策略 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |

### 3. 公开动作清单

| `actionId` | 标题 | 目标场景 | 视图模式 | 目标拓扑/关键环节 | Unity 动作 | 失败策略 |
| --- | --- | --- | --- | --- | --- | --- |

平台从 `release-manifest.json.workflowActions` 生成绑定菜单；该表用于人工评审，不能代替机器清单。

### 4. 外层平台协议能力

列出本次构建 `system.ready` 实际发布的命令和事件，以及：

- 通道：`power-scene-topology-shell`
- 协议版本
- 精确父来源要求
- `instanceId`、`sessionId`、`messageId` / `replyTo` 规则
- 超时、重复消息和容量限制
- `device.states.update` 是完整快照，不是增量

### 5. Unity 全局桥接能力

附 `unity/webgl-protocol-capabilities.json`，说明全局命令/事件及必填字段版本。明确“全局桥接能力不等于每个业务场景均支持”。

### 6. 逐场景实际能力矩阵

| 场景 | 初始化 | 聚焦 | 清选择 | 四态设置/清除 | 命名镜头 | 节点显隐 | 路径流 | 第三层 | 场景重置 | 镜头重置 | 释放 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

每个单元填写：`支持`、`不支持` 或 `条件支持`，并给出稳定错误语义。例如四态“仅在全部登记目标有效时支持”；路径流“桥接可识别，但该场景返回 `capability-unsupported`”。

### 7. 节点绑定表

给平台提供 `nodeId`，不提供或接收 `deviceId`：

| `sceneId` | `topologyId` | `nodeId` | 中文标题 | 可选 `sceneNodeId` | 双击 | 四态 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |

平台负责在内部维护 `nodeId → 真实设备编号`。平台不得回写结构清单，也不得要求我方等待第二份绑定后运行时清单。

### 8. 事件与状态样例

至少提供：

- `topology.node.dblclick`
- `scene.object.selected`
- `device.states.update`
- `command.result`
- `view.changed`
- 错误回包样例

状态项只含 `nodeId`、`deviceStatus`、`statusUpdatedAt`；状态取值固定为 `normal | alarm | fault | offline`。

### 9. 部署边界

- 平台通过 iframe 进入我方根入口，不直连 Unity。
- 结构清单由我方服务同源提供。
- 固定来源模式与运行时同源模式的 URL、父来源和 Unity 子页来源要分别说明。
- 合作方联调端口按发布规范执行；禁止把 `localhost`、`127.0.0.1` 或 `0.0.0.0` 固化为正式浏览器公开来源。
- 平台不得修改压缩产物；发布后变更必须生成新 release ID 和摘要。

## 燃气、燃煤参考差异

| 项目 | 燃气 | 燃煤 | 对新场景的启示 |
| --- | --- | --- | --- |
| 模型根 | `场景` | `SceneRoot` | 运行时依赖序列化引用，不依赖统一根名猜测 |
| 上层控制节点 | 4 个 | 3 个 | 数量来自业务资料，不照抄 |
| 下层设备节点 | 4 个主要设备 | 5 个状态设备 | 四态和反选目标可多于上层控制组 |
| 四态 | 显式单模型绑定 | 显式单模型绑定 | 上层聚合不得接收四态 |
| 命名镜头 | 6 个 | 6 个 | 数量可变，前端按钮与 Unity ID 必须一致 |
| 厂房入口 | 壳体多源材质透明变体 | 当前壳体配置不同 | 必须逐材质核验，不复制引用 |
| 第三层 | 燃气轮机 | 汽轮机 | 只为真实独立资源登记 |
| 路径流 | 静态共享材质持续播放 | 无已确认动态路径能力 | 不因全局命令存在而声明场景支持 |

## 常见失败与处理

### 二维能选中但三维不聚焦

检查：节点是否有 `sceneNodeId`、是否登记在 `unitySceneMappings`、场景 `_nodes` 是否同 ID、目录是否声明 `FocusNode`、运行时能力是否含 `focusNode`、场景激活 ID 是否当前。

### 三维点击反选到上层控制系统

原因通常是上层聚合节点未设置 `_topologyOnlySelection = true`，或共享主设备重复进入反向选择索引。只允许下层节点登记点击反选。

### 四态能力在目录声明但运行时缺失

检查全部 `_visualStateBindings`、Renderer 唯一归属、材质槽颜色属性和适配器 `SupportsNodeVisualState`。不要降低运行时门禁来迁就部分配置。

### 厂房入口不响应

先核对壳体当前材质是否仍与 `_shellMaterialVariants._sourceMaterial` 一一匹配；不要先改射线或相机逻辑。

### 平台握手通过但命令失败

先区分：外层命令已安装、Unity 全局桥接已声明、当前业务场景实际能力。场景返回 `capability-unsupported` 往往是能力矩阵错误，不是协议失联。

### 改节点 ID 后只一侧生效

按破坏性变更处理，同步 Unity `_nodes` / 四态、前端节点、映射、动作/第三层引用、测试、`sceneMappingVersion`、`manifestVersion`、`resourceVersion`，并通知平台刷新内部 `nodeId` 绑定。

### 步骤配置误改基础材质

步骤相关材质效果一律视为运行时临时效果。若在配置步骤时创建了持久材质变体或替换了场景、Prefab、FBX 的基础材质槽，应立即恢复原引用并删除仅由该误操作产生的未使用资产，再验证进入步骤前材质不变、步骤期间效果正确、退出后完整恢复。默认静态材质调整只有在用户独立明确提出时才允许执行，不能从步骤需求推断。

### 普通前端构建可运行但不能交付

`npm run build` 只验证前端，不含正式结构清单、Unity 资源、发布摘要和完整性清单。必须使用专用发布器并通过 `validate:release-artifact`。

## 完成定义

只有同时满足以下条件才可声明场景配置完成：

- Unity 场景和所有序列化引用保存完成。
- 目录声明能力与运行时能力完全一致。
- 前端拓扑、动作、映射和版本原子一致。
- `nodeId` / `sceneNodeId` 双向唯一且没有任何平台设备字段。
- 自动化编译、Unity 测试、前端类型检查/单测/构建、清单和发布门禁通过。
- 运行时联调覆盖正向、反向、状态、重置、失败恢复和释放。
- 平台能力清单、动作表、节点表、版本和部署说明已生成并与机器清单一致。
- 未验证项明确标记为不支持或待确认，没有以占位内容冒充已交付能力。
