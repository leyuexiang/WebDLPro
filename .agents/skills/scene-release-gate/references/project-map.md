# 项目文件地图

只在需要定位实现、门禁、测试或文档时读取本文件。路径均相对于仓库根目录。

## 清单与发布

| 责任 | 文件 | 修改时机 |
| --- | --- | --- |
| 联合场景清单与发布包生成 | `power-data-web/scripts/build-gas-power-smoke-release.mjs` | 新增或修改场景、动作、关键环节、三维映射、自测入口、发布摘要时 |
| 最终产物绝对契约与一致性门禁 | `power-data-web/scripts/release-artifact-contract.mjs` | 公开能力、导航场景边界或关键环节发生变化时 |
| 最终发布目录校验入口 | `power-data-web/scripts/validate-release-artifact.mjs` | 门禁编排或最终目录结构变化时 |
| 结构清单校验命令 | `power-data-web/scripts/validate-scene-topology-manifest.mjs` | 清单结构约束变化时 |
| 运行时清单校验器 | `power-data-web/src/config/scene-topology/validator.ts` | 浏览器运行时也需要拒绝新型非法结构时 |
| 关键环节生产审计 | `power-data-web/scripts/audit-process-detail-production.mjs` | 关键环节生产资源、上下文或发布审计变化时 |
| 第三层拓扑上下文 | `power-data-web/src/modules/visual/topology/process-detail-topology-contexts.ts` | 新增关键环节拓扑及其显式图元绑定时 |

## 测试

| 范围 | 文件 |
| --- | --- |
| 最终产物门禁正向与负向测试 | `power-data-web/tests/release-artifact-contract.spec.ts` |
| 联合场景清单、动作和映射 | `power-data-web/tests/configured-power-scenes-manifest.spec.ts` |
| 燃气总览专项契约 | `power-data-web/tests/gas-power-overview-release-contract.spec.ts` |
| 燃煤拓扑专项契约 | `power-data-web/tests/coal-power-topology-contract.spec.ts` |
| 第三层拓扑上下文 | `power-data-web/src/modules/visual/topology/process-detail-topology-contexts.spec.ts` |

新增场景时先搜索同类场景专项测试。只有存在真实的场景专属规则时才新增专项文件；跨场景公共约束应进入联合清单或最终产物门禁测试。

## 核心文档

以下三份文档在公开动作、打包流程或合作方协议变化时必须同步：

- `Docs/前端原子任务/测试包与正式包输出标准.md`
- `Docs/前端原子任务/场景拓扑动作映射规范.md`
- `Docs/前端原子任务/外层内嵌框架双向通信协议.md`

还应按影响范围更新：

- `Docs/前端原子任务/00-任务总览.md`
- 对应场景或发布任务的“实施状态”文档
- 当前版本发布记录、合作方接入说明或交付清单

不要照抄旧文档中的动作数量。先运行 `scripts/inspect-release-contract.mjs` 获取当前事实，再更新数量、标识、能力边界和示例。
