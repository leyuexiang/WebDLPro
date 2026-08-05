# 双容器视觉基准

本目录只服务任务-050的双容器视觉回归。它使用本地合成清单和 Unity 模拟页，验证真实的“视觉宿主页 → 嵌入壳 → 模拟运行时”渲染边界；不代表任务-039—047的正式九场景、设备、动作或资源映射。

## 已提交基准

- `baselines/double-container-1280x720.jpg`：常规桌面视口，验证上方三维 16:9 区域与下方拓扑余量。
- `baselines/double-container-3440x1440.jpg`：带鱼屏视口，验证三维区由动态高度约束并居中，拓扑不被超宽屏挤压。

## 复现方法

1. 按 `tests/local-shell-regression/README.md` 启动本地测试宿主、Unity 模拟页和 Vite 开发服务。
2. 在内部浏览器打开 `http://127.0.0.1:5510/visual-baseline.html`。
3. 等待根元素出现 `data-visual-baseline-ready="true"`，确认嵌入壳已完成受控握手与 `system.init`（系统初始化）。
4. 分别使用 1280×720、3440×1440 截图，并与本目录基准图进行人工或受控图像差异核对。

常规视口截图可用以下命令执行受控 JPEG（联合图像专家组格式）差异核验：

```powershell
npm run test:visual -- --baseline tests/visual-regression/baselines/double-container-1280x720.jpg --actual <当前截图.jpg>
```

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
- 更新基准前必须同时复核三维 16:9、拓扑余量、唯一画布与浏览器控制台错误；正式多拓扑和真实 WebGL 到位后应新增相应基准图。
- 当前内部浏览器导出的截图为 JPEG（联合图像专家组格式）。基准文件必须使用 `.jpg` 扩展名，避免图像工具按错误格式解析。
