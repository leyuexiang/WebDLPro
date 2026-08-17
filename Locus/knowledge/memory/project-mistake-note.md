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
