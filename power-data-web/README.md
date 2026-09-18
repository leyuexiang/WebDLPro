# 电力全流程平台可视化前端

本工程是平台内嵌的可视化子应用，负责一个三维运行时（Unity）、一个拓扑画布、场景拓扑联动和受控跨窗口通信。平台负责页面导航、权限、真实设备绑定和状态来源；本工程只发布结构拓扑和稳定节点标识。

生产入口已收缩为 `/embed`。我方服务可以独立启动和访问；平台通过 iframe（内嵌框架）加载根入口，并使用 `window.postMessage`（跨窗口消息）通信。平台不得直接调用三维运行时，也不得修改我方压缩构建产物。

## 当前实现基线

- 业务目录、公开动作、第三层和三维映射从联合清单生成器与 Unity 配置读取，不以历史发布包作为事实源。
- 第二层拓扑按显式组合键切换完整数据文件；第三层按关键环节上下文加载唯一完整拓扑并隐藏筛选轨。
- 全程复用一个 Unity 实例和一个拓扑画布；场景、拓扑、选择和状态通过稳定上下文协调。
- 平台从结构清单读取 `nodeId` 并在内部绑定真实设备编号；本工程不接收、保存或转发平台设备编号。
- 只有显式登记 `sceneNodeId` 的节点可派生三维聚焦、状态或反向选择，不按名称、坐标或数组顺序猜测映射。

## 开发与验证

开发和构建环境：JavaScript运行时（Node.js）20.19或更高版本，或22.12及以上版本；该下限来自当前构建工具（Vite）的实际运行要求。

```powershell
npm install
npm run dev
npm run typecheck
npm run test:unit
npm run build
```

`npm run build` 只用于通用前端生产构建验证，输出目录不包含发布摘要、结构清单、Unity资源和产物完整性清单，因此不得直接交付平台，也不得改名冒充合作方联调包或正式包。燃气可交付产物必须使用下文专用发布器，显式选择包类型并通过完整发布门禁。

清单发布前必须使用同一套运行时校验器：

```powershell
npm run validate:manifest -- --manifest <工作区内场景拓扑结构清单.json> --report <工作区内既有目录/报告.json>
```

结构模式递归拒绝任意层级的设备编号、设备映射、绑定元数据、第二份运行时清单及其大小写和分隔符变体，同时拒绝 `emit-device`，并校验来源节点 `nodeId` 全局唯一、`sceneNodeId` 反向唯一、过滤视图引用闭环和单场景500个三维目标上限。

## 三类发布包

| 类型 | 标识 | 允许内容 | 禁止或限制 |
| --- | --- | --- | --- |
| 本地测试包 | `local-test` | 可显式生成自测页和结构清单 | 不得交付平台，不得作为正式来源或安全验收证据 |
| 合作方联调包 | `partner-integration` | 干净根入口、独立服务配置、同一份结构清单和节点协议声明 | 不得包含自测页、本机地址或设备绑定数据 |
| 正式包 | `standalone-formal` | 与合作方联调包相同的独立访问、iframe 嵌入和节点协议能力 | 禁止自测页和部署后修改产物；是否使用 HTTPS 由实际部署环境决定 |

本地测试包可继续使用默认回环配置：

```powershell
node .\scripts\build-gas-power-smoke-release.mjs --package-type local-test --release-id <不可变发布标识> --unity-release-id <三维发布标识> --port <本机端口> --include-self-test false
```

合作方联调包和正式包默认使用运行时同源模式：只需指定监听地址和端口，服务启动后即可用局域网实际地址独立访问；Unity 和结构清单分别从当前服务下的 `/unity/index.html`、`/scene-topology-manifest.json` 加载。平台嵌入时再把 `parentOrigin`、`instanceId` 和 `protocolVersion` 写入 iframe 地址。只有 `scripts/build-gas-power-smoke-release.mjs` 生成且通过产物复核的目录才属于燃气可交付包，普通 `npm run build` 结果不具备该资格。完整命令和失败条件见[测试包与正式包输出标准](../Docs/前端原子任务/测试包与正式包输出标准.md)。

| 配置项 | 含义 |
| --- | --- |
| `VITE_POWER_PARENT_ORIGIN` | 固定来源模式的平台父页面来源；运行时模式使用 `__RUNTIME_PARENT_ORIGIN__`，由 iframe 查询参数提供 |
| `VITE_POWER_UNITY_PARENT_ORIGIN` | 固定来源模式的 Unity 直接父来源；运行时模式使用 `__RUNTIME_SELF_ORIGIN__` |
| `VITE_POWER_UNITY_ENTRY_URL` | 固定来源模式的 Unity 完整入口；运行时模式使用当前服务下的 `/unity/index.html` |
| `VITE_POWER_MANIFEST_URL` | 固定来源模式的同源结构清单；运行时模式使用当前服务下的 `/scene-topology-manifest.json`，不得指向平台接口 |
| `VITE_POWER_MINIMUM_VIEWPORT_WIDTH` | 平台允许的最小容器宽度 |
| `VITE_POWER_MINIMUM_VIEWPORT_HEIGHT` | 平台允许的最小容器高度 |

平台父来源与三维直接父来源在独立部署时不是同一个值。`127.0.0.1`、`localhost` 和 `0.0.0.0` 均不应写成固定浏览器公开来源；合作方联调包可以监听 `0.0.0.0` 接收局域网请求，实际浏览器地址由运行时决定。直接访问时不依赖平台，只有 iframe 嵌入时才建立外层通信桥。

结构清单由我方可视化服务同源提供，返回 `Cache-Control: no-cache`，在十秒内完成响应，并允许不携带浏览器凭据的请求。节点结构变化后由平台重载整个壳并重新获取完整清单；真实设备绑定只在平台内部维护。

发布目录构建完成和部署完成后均须复核文件摘要：

```powershell
npm run validate:release-artifact -- --root <发布目录>
```

## 关键文档

- [前端架构设计](../Docs/电力全流程平台-前端架构设计.md)
- [当前文档索引与事实源](../Docs/前端原子任务/00-任务总览.md)
- [十一场景当前配置基线](../Docs/前端原子任务/06-十一场景当前配置基线.md)
- [拓扑容器与多图切换规范](../Docs/前端原子任务/拓扑图/拓扑容器与多图切换规范.md)
- [图元与设备状态规范](../Docs/前端原子任务/拓扑图/图元与设备状态规范.md)
- [多拓扑与三维多场景联动规范](../Docs/前端原子任务/拓扑图/多拓扑与Unity多场景联动规范.md)
- [外层双向通信协议](../Docs/前端原子任务/外层内嵌框架双向通信协议.md)
- [合作方设备绑定与状态确认结论](../Docs/前端原子任务/合作方设备绑定与状态对接确认结论.md)
- [测试包与正式包输出标准](../Docs/前端原子任务/测试包与正式包输出标准.md)
