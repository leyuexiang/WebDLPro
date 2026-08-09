# 双容器视觉基准

本目录只服务任务-050的双容器视觉回归。它使用本地合成清单和 Unity 模拟页，验证真实的“视觉宿主页 → 嵌入壳 → 模拟运行时”渲染边界；不代表任务-039—047的正式九场景、设备、动作或资源映射。

## 已提交基准

- `baselines/double-container-600x600.jpg`：最小测试画布，验证尺寸不足时上下双容器、拓扑控件与唯一画布仍可操作。
- `baselines/double-container-1280x720.jpg`：常规桌面视口，验证上方三维 16:9 区域与下方拓扑余量。

旧 `double-container-3440x1440.jpg` 实际只有 2244×1440 像素，并且截取了带鱼屏画布的左侧区域，不能作为 3440×1440 视觉证据，已从有效基准中移除。清理前原文件已保存到本地 Git 贮藏 `task050-visual-baseline-backup-20260805`。

## 复现方法

1. 按 `tests/local-shell-regression/README.md` 启动本地测试宿主、Unity 模拟页和 Vite 开发服务。
2. 在内部浏览器按需打开下列已登记测试尺寸；查询参数只接受三个固定值，其他值继续使用浏览器真实视口：
   - `http://127.0.0.1:5510/visual-baseline.html?size=600x600`
   - `http://127.0.0.1:5510/visual-baseline.html?size=1280x720`
   - `http://127.0.0.1:5510/visual-baseline.html?size=3440x1440`
3. 等待根元素出现 `data-visual-baseline-ready="true"`，确认嵌入壳已完成受控握手与 `system.init`（系统初始化）。
4. 对 600×600 和 1280×720 分别截图，并与本目录同尺寸基准图进行人工或受控图像差异核对。

桌面应用内的截图合成器在截图宽度超过当前可见浏览器宽度时，可能重复跨源内嵌框架图层。3440×1440 因此只用于读取嵌入壳的实际客户区、滚动区、三维比例、拓扑余量和画布数量，当前不得把内部浏览器导出的超宽图片提交为视觉基准。正式持续集成若使用可原生创建 3440×1440 视口的浏览器，可在确认跨源图层没有重复后另行增加基准。

常规视口截图可用以下命令执行受控 JPEG（联合图像专家组格式）差异核验：

```powershell
npm run test:visual -- --baseline tests/visual-regression/baselines/double-container-1280x720.jpg --actual <当前截图.jpg>
```

最小尺寸截图使用同一命令，只需将基准路径替换为 `tests/visual-regression/baselines/double-container-600x600.jpg`。

命令会限制图片必须位于前端工作区内、文件不超过 25 MB、解码后不超过 1,200 万像素；输出只包含相对路径、尺寸、变更像素比例与平均绝对误差。默认阈值为单通道差异大于 8 才计为变更像素、变更像素比例不高于 0.5%、平均绝对误差不高于 1.5；阈值可通过命令参数显式收紧或放宽，不能静默修改基准图。

需要归档差异图时，先创建目标目录，再显式传入一个尚不存在的工作区内 JPEG 路径：

```powershell
New-Item -ItemType Directory -Force artifacts | Out-Null
npm run test:visual -- --baseline tests/visual-regression/baselines/double-container-1280x720.jpg --actual <当前截图.jpg> --diff artifacts/double-container-1280x720.diff.jpg
```

差异图以黑底亮差异表示三个色彩通道的绝对差异，并放大八倍方便人工审阅。`--diff`（差异图路径）只允许写入预先存在的工作区目录，且采用“仅新建”策略；它不能覆盖已有文件、基准图或当前截图。

## 边界与更新规则

- 基准页刻意删除控制栏、时间戳和日志，避免外层调试信息制造无意义的视觉差异。
- 页面只固定合成燃气初始上下文；不得以此补全或推断正式场景资料。
- 更新基准前必须同时复核三维 16:9、拓扑余量、唯一画布与浏览器控制台错误；正式内容只影响任务-053的业务验收，不改变本组件基准的结构职责。
- 当前内部浏览器导出的截图为 JPEG（联合图像专家组格式）。基准文件必须使用 `.jpg` 扩展名，避免图像工具按错误格式解析。
