# 任务-033：view.open 原子切换事务实施状态

## 当前状态

- 状态：进行中（80%）
- 已完成：原子清单校验、拓扑预解析、事务开始、可选 Unity 场景切换、可选动作执行、拓扑激活、稳定上下文单次提交、受控失败回滚、内层命令最终回执的可等待宿主端口，以及由协调器事务状态驱动的双容器统一遮罩。
- 未完成：真实正式清单与 Unity 网页图形构建（WebGL）的三层浏览器联调，以及正式动作映射验收。

## 本次交付

| 文件 | 作用 |
| --- | --- |
| `power-data-web/src/modules/visual/orchestration/view-open-transaction-handler.ts` | 受控 `view.open` 事务处理器；不直接操作 iframe、Canvas 或状态仓库。 |
| `power-data-web/src/config/scene-topology/topology-registry.ts` | 在已校验原子清单内补充场景与动作查询，事务可校验场景、拓扑、动作三者一致性。 |
| `power-data-web/src/modules/visual/runtime/visualization-runtime-view-open-port.ts` | 将事务动作映射为内层白名单命令，并等待受控最终结果。 |
| `power-data-web/src/services/webgl/runtime-connector.ts`、`VisualizationRuntimeHost.vue` | 连接器按原请求标识发出命令完成摘要；宿主提供可等待端口，并在失败、超时、切换和释放时结算等待项。 |
| `power-data-web/src/host-bridge/host-runtime-composition.ts`、`EmbeddedVisualizationShell.vue` | 仅在正式清单、唯一拓扑运行时、Unity 就绪和合法嵌入参数齐备后装配外层桥；`system.init` 与 `view.open` 复用本事务，稳定提交后上报视图变更。 |
| `power-data-web/src/modules/visual/orchestration/view-open-transaction-handler.spec.ts` | 覆盖预解析失败、原子提交、同场景切换、动作目标不一致和 Unity 切换失败恢复。 |
| `power-data-web/src/modules/visual/orchestration/visualization-transition-overlay.ts`、`visualization-transition-overlay.spec.ts` | 将完整活动事务收敛为脱敏遮罩模型；准备与跨场景切换均阻断双容器交互，不完整或已清理的事务不会锁住稳定视图。 |

## 已验证的事务顺序

1. 先验证场景、拓扑和可选动作均属于同一原子清单。
2. 先预解析目标拓扑；失败时不调用 Unity 场景切换，也不改写活动画布。
3. 创建切换事务后，跨场景才调用 Unity 切换；同场景只保留现有 Unity 业务场景。
4. 非空 Unity 动作在拓扑激活前执行；失败时恢复上一稳定上下文。
5. 只有 Unity 与拓扑都就绪时，协调器才提交一次稳定上下文并递增一次 `contextRevision`。
6. 旧事务在异步回调后发现已不再活动时返回 `superseded`，不能提交状态。

## 验证结果

- `npm run test:unit`：28 个测试文件、106 项通过，包含事务遮罩的完整目标、切换、完成和迟到状态回归。
- `npm run build`：类型检查与生产构建通过。
- 内部浏览器：在“外层测试宿主页 → 正式嵌入壳 → Unity 模拟页”中触发真实 `view.open` 后，已捕获“正在切换三维场景与拓扑”遮罩；双容器进入非活动状态（`inert`）、内容区标记忙碌（`aria-busy`），事务完成、失败或释放后遮罩移除并恢复可操作状态。
- 内部浏览器：高阶三层回归通过快速取代、失败恢复、十秒超时、迟到回调隔离与释放确认，最终遮罩数量为零且 `aria-busy=false`。

## 尚未关闭的事项

1. 正式原子清单与真实动作映射仍未提供，不能将合成测试清单作为发布内容。
2. 需以真实 Unity 网页图形构建完成父页 → 嵌入壳 → Unity 的浏览器联调，确认握手、原子切换、快速取代、错误恢复和释放顺序。
