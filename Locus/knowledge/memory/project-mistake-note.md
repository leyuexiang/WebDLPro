---
id: kd_builtin_memory_project_mistake_note
injectMode: full
aiEditMode: auto
maintenanceRules: |-
  - Record only verified problems, rework causes, and avoidance steps
  - Prioritize recurring pitfalls, constraints, regression points, and confirmed fixes
  - Keep each entry short and focused on one lesson or constraint
  - Keep the list within 20 items and merge duplicates regularly
  - Remove outdated issues, non-reproducible issues, and unsupported guesses
---

- 复杂合并式管网 FBX 若缺少沿管线长度连续递增的 UV0，流动 Shader 只能按统一坐标轴投影，导致条带穿过弯头或与管线方向不一致。必须由模型导出提供路径 UV，或显式配置样条/中心线路径；不能依赖 Shader 自动推断管网拓扑。
- 第二层厂房入口的壳体透明运行时按当前 Renderer 的每个源材质严格匹配透明变体。禁止直接把场景实例材质槽替换成其他半透明材质，否则入口初始化会在射线检测前失败，表现为点击无半透明且相机不移动；应保留原始材质并由入口运行时统一切换透明变体。
