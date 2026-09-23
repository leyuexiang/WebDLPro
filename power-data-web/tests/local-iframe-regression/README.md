# 网页图形本地回归环境

此目录由原 `F:\WorkSpace\DLPro\local-iframe-test` 复制并按当前网页图形协议升级；原目录未移动，避免影响既有联调。

## 启动

在两个终端分别执行：

```powershell
cd F:\WorkSpace\WebDLPro\power-data-web\tests\local-iframe-regression\host
python -m http.server 5510 --bind 127.0.0.1
```

```powershell
cd F:\WorkSpace\WebDLPro\power-data-web\tests\local-iframe-regression\unity-mock
python -m http.server 5511 --bind 127.0.0.1
```

随后访问 `http://127.0.0.1:5510`。

## 回归覆盖

- 正向握手：`ready` 元数据、`init` 的原始请求标识确认。
- 严格隔离：来源、窗口、频道、版本、实例和事件白名单。
- 尺寸同步：宿主容器变化触发 `resize`，模拟运行时回填 `commandResult`。
- 选择清除：先执行 `focusNode`（聚焦节点），再执行独立的 `clearSelection`（清除选择）并确认回执；不会用 `resetScene`（场景重置）替代取消描边。
- 可确认释放：`dispose` 与同一 `requestId` 的 `disposed` 回执。
- 重复进入：自动回归会释放第一个实例后创建新实例，旧实例消息无法影响新会话。
- 拒绝通信：点击“发送伪造消息”后，宿主日志应显示拒绝且状态不变。

“执行自动回归”会顺序执行创建、握手、尺寸同步、释放与重新创建；页面顶部显示通过或失败结果。
