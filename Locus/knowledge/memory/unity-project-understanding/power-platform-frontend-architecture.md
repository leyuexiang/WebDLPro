---
id: kd_fcd1bd94-dd14-47a3-a76c-2b99f1286ccf
type: memory
path: unity-project-understanding/power-platform-frontend-architecture.md
title: power-platform-frontend-architecture
inheritInjectMode: true
summaryEnabled: true
commandEnabled: false
readOnly: false
inheritAiConfig: true
createdAt: 1785571975696
updatedAt: 1785765857318
---

# power-platform-frontend-architecture

## Summary
已确认的电力全流程平台前端与 Unity WebGL 集成架构决策。

<!-- locus:body:start -->
- 已确认前端总体架构：独立业务前端壳承载普通页面；可视化使用配置驱动的三栏工艺工作台；Unity WebGL 作为 iframe 运行时接入。
- `VisualizationRuntimeHost` 位于可视化布局层，是唯一持有 iframe、监听器与 WebGL 资源的宿主。页面仅申请 `runtimeKey` 使用权；同一运行时复用，跨运行时或离开可视化模块则经 `dispose`/`disposed` 释放。
- 工艺场景分为 `webgl`、`static-preview`、`empty`；只有通过资源预算、桥接协议、版本握手和节点映射校验的域可启用 WebGL。
- 业务页面配置仅可引用 `runtimeKey`；入口和来源信息来自受发布流程保护的运行时清单。清单区分 `frameOrigin`（Unity 子页来源）与 `allowedParentOrigin`（Unity 接受的父页来源）。
- 页面、二维拓扑、流程导览、Unity 映射需按 `configVersion` 原子发布；WebGL 握手还须核对 `runtimeKey`、`buildId`、`sceneMappingVersion`、协议版本与资源摘要。任何不匹配均降级。
- 当前桥接的 `ack` 和 `commandResult` 已通过 `payload.requestId` 关联原始命令；今后须分离命令/事件能力，且所有异步消息按唯一 `instanceId` 过滤。
- 本机联调运行时已登记：前端 `http://localhost:5173`，WebGL `http://localhost:8081/index.html`。`power-data-web` 通过 `npm run dev -- --host 127.0.0.1 --port 5173` 启动；WebGL 用 `Library/Locus/tmp/serve_webgl_local.py --directory Builds/WebGL-HighlightFlow-Skybox --port 8081` 启动，后者为 `.br` 文件正确返回 `Content-Encoding: br`。运行时元数据为 `gas-plant-release` / `local-webgl-topology-link` / `2026.08.01-local.1`。
- 二维拓扑一期采用 ECharts 作为查看与实时状态适配器；上线前按目标设备档位固化节点、边、刷新率、首帧与内存基准。拓扑编辑如被确认，新增独立编辑器适配器，输出保持为 `TopologyDefinition`。
- 实时连接以每浏览器标签页一条 WebSocket 为界；订阅携带页面实例、配置版本和会话标识，重连后必须重取快照或按序补数。
- Unity 部署优先与前端同源；跨域时仅允许受控固定子域，并同时配置父页 `frame-src`、子页 `frame-ancestors` 与精确消息来源校验。
<!-- locus:body:end -->
