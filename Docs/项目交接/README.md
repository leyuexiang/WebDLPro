# WebDLPro 场景、拓扑与平台交接手册

## 1. 文档目的

本目录用于接手 WebDLPro 的业务场景、Unity 三维沙盘、二维拓扑、外部平台通信和发布交付。文档按实施顺序拆分，避免只接手某一侧而造成“二维可用、三维不动”或“工程可运行、合作方包不可见”。

| 顺序 | 文档 | 解决的问题 |
| --- | --- | --- |
| 1 | [场景新增与沙盘绑定](01-场景新增与沙盘绑定.md) | 新增业务场景、Unity 骨架、镜头、四态、第三层和沙盘入口怎么配 |
| 2 | [命名与映射规范](02-命名与映射规范.md) | 模型对象、三维节点、拓扑节点、平台设备号如何分工和绑定 |
| 3 | [拓扑资料接入与配置](03-拓扑资料接入与配置.md) | JSON 或压缩包如何转成第二层、第三层拓扑 |
| 4 | [发布门禁与打包交付](04-发布门禁与打包交付.md) | 清单、动作、门禁、测试包、联调包和正式包怎么生成 |
| 5 | [外部平台对接与联调](05-外部平台对接与联调.md) | 内嵌平台协议、状态、事件、来源安全和联调边界 |
| 6 | [交接清单与故障排查](06-交接清单与故障排查.md) | 交付证据、上线前检查、回滚和常见故障定位 |

## 2. 当前基线（以脚本为准）

2026-09-20 在仓库根目录执行：

```powershell
node .agents/skills/scene-release-gate/scripts/inspect-release-contract.mjs
```

本次审计得到：13 个业务场景、12 个公开动作、3 个第三层关键环节、8 个已发布场景。该输出是动态事实，不能把历史文档中的“十一场景”“九项”等数量当成永久基线。

当前已确认的第三层关键环节是燃气轮机、燃煤汽轮机和光伏逆变器；换流站、开关站目前仅为第二层纯导航场景，不能据此推导正式 Unity 模型、三维节点或状态能力。

当前存在一项必须在交接时持续跟踪的漂移：前端标识与发布审计已经统计 13 个场景并包含换流站、开关站纯导航入口，而 `BusinessSceneCatalog.asset`/Unity 目录仍是 11 个 Unity 业务场景闭集。换流站、开关站的三维映射为空，不能把前端可导航误写成 Unity 已正式接入。另有 `PowerPlantProcessController` 的示例配置可能出现 `grid-output` 等样例标识，不能直接复制到正式场景资产；以序列化场景和发布清单为准。

## 3. 事实源优先级

发生冲突时按以下顺序处理：

1. 当前运行时代码、序列化 Unity 场景和自动化测试共同证明的行为。
2. `inspect-release-contract.mjs`、结构清单校验器和最终产物门禁的当前输出。
3. 指定规范文档和本交接手册。
4. 截图、旧包、历史数量和口头约定。

关键事实源：

- Unity 场景目录：`Assets/Configuration/BusinessSceneCatalog.asset`。
- Unity 场景能力与协议：`Assets/Scripts/Visualization/Scenes/BusinessSceneCatalog.cs`、`BusinessSceneContracts.cs`、`SceneSwitchProtocolModels.cs`。
- 第三层目录：`Assets/Configuration/ProcessDetailCatalog.asset`。
- 场景生成与发布：`power-data-web/scripts/build-gas-power-smoke-release.mjs`。
- 运行时清单校验：`power-data-web/src/config/scene-topology/validator.ts`。
- 外层平台协议：`power-data-web/src/host-bridge/host-protocol.ts`。
- 最终产物门禁：`power-data-web/scripts/release-artifact-contract.mjs`。
- 拓扑运行时：`power-data-web/src/modules/visual/topology-preview/`。

## 4. 总原则

- 场景、拓扑、二维—三维映射、动作、版本、测试和交付说明必须同一事务完成。
- 只接受显式映射，不按中文标题、模型名称、坐标、层级、图片或数组顺序猜测关系。
- 二维节点标识（`nodeId`）用于选择、状态和平台内部绑定；三维节点标识（`sceneNodeId`）用于 Unity 聚焦、状态和反向选择；平台真实设备标识（`deviceId`）只存在于平台内部。
- 全局桥接能识别命令，不等于当前业务场景实际支持命令；能力必须同时通过目录声明、适配器运行时结果和序列化前置条件证明。
- 没有正式模型、拓扑、业务关系或四态资料时，保持空映射、受控占位或“不支持”，禁止补造。
- Unity 结构化资产通过 Unity 编辑器接口修改，不直接编辑场景或预制体文本；不得覆盖工作区已有未提交改动。

## 5. 交接时必须留下的证据

- 变更前后 `inspect-release-contract.mjs` 输出。
- 场景配置台账、节点映射台账、第三层目录和拓扑版本清单。
- JSON/压缩包来源、哈希、图元统计、资源缺失表和旧拓扑引用审计。
- 自动化测试、类型检查、生产构建、清单校验和最终产物门禁命令及结果。
- 联调消息记录、浏览器验收截图、发布目录路径、发布标识和资源摘要。
- 未完成项必须标为“不支持”“待确认”或“阻塞”，不能以占位内容伪装完成。

> 变更代码时必须同步补充与代码对应的中文注释；本次仅新增交接文档，不改动业务代码。
