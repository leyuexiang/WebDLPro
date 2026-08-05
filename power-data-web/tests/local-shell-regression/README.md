# 任务-014三层本地联调夹具

该目录只验证“外层测试宿主页 → 当前嵌入壳 → Unity 模拟页”的协议链路。它使用合成九场景清单，**不代表**任务-039—047的正式场景、设备、动作或资源资料。

## 启动

在三个终端分别执行：

```powershell
cd F:\WorkSpace\WebDLPro\power-data-web\tests\local-shell-regression
node server.mjs
```

```powershell
cd F:\WorkSpace\WebDLPro\power-data-web\tests\local-iframe-regression\unity-mock
python -m http.server 5511 --bind 127.0.0.1
```

```powershell
cd F:\WorkSpace\WebDLPro\power-data-web
$env:VITE_POWER_PARENT_ORIGIN='http://127.0.0.1:5510'
$env:VITE_POWER_UNITY_PARENT_ORIGIN='http://127.0.0.1:5174'
$env:VITE_POWER_UNITY_ENTRY_URL='http://127.0.0.1:5511/index.html'
$env:VITE_POWER_MANIFEST_URL='http://127.0.0.1:5510/manifest.json'
$env:VITE_POWER_MINIMUM_VIEWPORT_WIDTH='600'
$env:VITE_POWER_MINIMUM_VIEWPORT_HEIGHT='600'
npm run dev -- --mode local-shell-regression --host 127.0.0.1 --port 5174
```

然后在浏览器访问 `http://127.0.0.1:5510`。初始化成功后可点击“查询有限状态快照”；该页会显示 `system.ack`（系统确认）、`view.changed`（视图变更）、`state.snapshot`（状态快照）和 `command.result`（命令结果）的受控摘要。

“触发同场景流程动作”仅发送合成清单中的燃气重置动作，验证它通过 `workflow.trigger`（流程触发）进入原子事务且不改走场景切换；“触发跨场景流程动作”发送合成风电重置动作，验证切换目标场景后才执行动作并提交目标拓扑。二者均不代表正式业务映射。“发送合成设备状态”仅向本地清单中的 `device.gas-turbine` 发送告警四态，验证二维状态、受控 Unity 状态命令和关联结果，不能替代正式设备数据。点击 Unity 模拟页的“模拟三维对象”只会按本地清单的显式三维节点映射同步二维选择并上报受控事件，不会回发聚焦命令。“执行基础三层回归”验证查询关联、重复消息、旧会话、伪造来源与释放。“执行超时与恢复回归”约耗时十二秒，验证连续三次取代（前两条命令均被最后一条取代）、最终失败恢复、外层十秒命令超时、迟到完成回调隔离与释放。后者通过入口查询参数只控制本地 Unity 模拟页的三个固定测试场景，不影响默认开发或生产配置。

## 当前覆盖与边界

- 覆盖合法来源、实例、会话、握手、初始原子 `view.open`（打开视图）、Unity 模拟场景切换、稳定视图变更和状态查询关联。
- 覆盖重复结果回放、连续三次事务取代、最终失败后的稳定上下文恢复、十秒命令超时和迟到 Unity 完成回调隔离；所有断言均从外层命令结果或状态快照取得，不直读子框架状态。
- 该测试模式使用 600×600 的专用阈值以适配内置浏览器窗口，不能替代任务-002已经完成的 1280×720 产品最小尺寸验收。
- 外层宿主页不直连 Unity；嵌入壳不接收缺少精确启动参数的直接访问作为外层通信会话。
- 燃气夹具节点可用于后续验证 `topology.node.dblclick`（拓扑节点双击）；其设备标识为测试数据，不能迁移到生产配置。
- 覆盖本地清单的三维反向选择到二维节点和外层事件，且确认不会回发聚焦命令。
- 未覆盖正式三维映射、真实 WebGL 资源、九场景业务内容、性能预算或发布验收。
