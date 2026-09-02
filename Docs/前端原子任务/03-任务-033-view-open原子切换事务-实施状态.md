# 任务-033：view.open 原子切换事务实施状态

> **2026-08-30 展示边界说明：** 本文记录任务-033交付时“场景与拓扑成对切换”的历史实现。当前稳定口径已调整为：第一层沙盘和第三层关键环节均为全屏三维且不展示拓扑；只有第二层厂区采用三维与当前业务拓扑并存。后续事务实现和验收以最新三层场景重构文档为准。

## 当前状态

- 状态：已完成（100%）
- 已完成：原子清单校验、拓扑预解析、事务开始、可选 Unity 场景切换、可选动作执行、拓扑激活、稳定上下文单次提交、受控失败回滚、内层命令最终回执的可等待宿主端口，以及由协调器事务状态驱动的双容器统一遮罩。
- 关闭依据：任务-033只交付可复用的原子事务机制。正式九场景业务内容、设备映射和动作参数属于任务-034、035、039—047与052，不能将合成清单误称为正式业务内容，也不反向阻塞本任务机制验收。

## 本次交付

| 文件 | 作用 |
| --- | --- |
| `power-data-web/src/modules/visual/orchestration/view-open-transaction-handler.ts` | 受控 `view.open` 事务处理器；不直接操作 iframe、Canvas 或状态仓库。 |
| `power-data-web/src/config/scene-topology/topology-registry.ts` | 在已校验原子清单内补充场景与动作查询，事务可校验场景、拓扑、动作三者一致性。 |
| `power-data-web/src/modules/visual/runtime/visualization-runtime-view-open-port.ts` | 将事务动作映射为内层白名单命令，并等待受控最终结果。 |
| `power-data-web/src/services/webgl/runtime-connector.ts`、`VisualizationRuntimeHost.vue` | 连接器按原请求标识发出命令完成摘要；宿主提供可等待端口，并在失败、超时、切换和释放时结算等待项。 |
| `power-data-web/src/host-bridge/host-runtime-composition.ts`、`EmbeddedVisualizationShell.vue` | 仅在正式清单、唯一拓扑运行时、Unity 就绪和合法嵌入参数齐备后装配外层桥；`system.init` 与 `view.open` 复用本事务，稳定提交后上报视图变更。 |
| `power-data-web/src/modules/visual/orchestration/view-open-transaction-handler.spec.ts` | 覆盖预解析失败、原子提交、同场景切换、动作目标不一致、Unity 切换失败恢复，以及真实事务快照驱动的统一遮罩和切场景→动作→拓扑的严格顺序。 |
| `power-data-web/src/modules/visual/orchestration/visualization-transition-overlay.ts`、`visualization-transition-overlay.spec.ts` | 将完整活动事务收敛为脱敏遮罩模型；准备与跨场景切换均阻断双容器交互，不完整或已清理的事务不会锁住稳定视图。 |

## 已验证的事务顺序

1. 先验证场景、拓扑和可选动作均属于同一原子清单。
2. 先预解析目标拓扑；失败时不调用 Unity 场景切换，也不改写活动画布。
3. 创建切换事务后，跨场景才调用 Unity 切换；同场景只保留现有 Unity 业务场景。
4. 非空 Unity 动作在拓扑激活前执行；失败时恢复上一稳定上下文。
5. 只有 Unity 与拓扑都就绪时，协调器才提交一次稳定上下文并递增一次 `contextRevision`。
6. 旧事务在异步回调后发现已不再活动时返回 `superseded`，不能提交状态。

## 验证结果

- 专项单元测试：`view-open-transaction-handler.spec.ts` 与 `visualization-transition-overlay.spec.ts` 共 2 个测试文件、19 项通过；新增直接断言证明预解析失败不创建事务或递增版本、跨场景等待期间遮罩持续显示、场景切换→动作→拓扑激活的顺序固定，成功后版本仅递增一次并解除遮罩。
- 全量前端单元测试：`npm run test:unit`，36 个测试文件、173 项通过。
- 生产构建：`npm run build`，类型检查与生产构建通过。
- 内部浏览器：当前真实燃气联调包稳定加载；外层只有一个嵌入壳，壳内只有一个 Unity 内嵌框架和一个拓扑画布，根壳无滚动，稳定态无事务遮罩。此前三层合成夹具已覆盖 `view.open` 命令的遮罩、快速取代、失败恢复、十秒超时、迟到回调隔离与释放；完成、失败或释放后均恢复可操作状态。

## 后续任务交接

1. 正式九场景清单、真实动作参数和设备映射由任务-034、035、039—047交付；真实业务三层联调由任务-052按场景资料逐项收口。
2. 本次交叉审计发现两项高风险恢复边界，移交任务-036：外层十秒超时必须使领域事务失去提交权；当旧事务已物理切至目标场景而新事务请求回到旧稳定场景时，不能只比较稳定上下文，必须依据已确认的实际 Unity 场景决定是否回切。
3. 事务成功摘要、阶段耗时和恢复结果需要以固定容量记录，避免只保留最后一条失败诊断；该可观测性补齐同样归任务-036。
