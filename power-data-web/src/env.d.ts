/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 由发布脚本从 Unity 协议元数据注入，禁止在源码中提供固定回退值。 */
  readonly VITE_POWER_UNITY_BUILD_ID?: string
  /** 由发布脚本对完整 Unity 目录计算并注入的 SHA-256 资源摘要。 */
  readonly VITE_POWER_UNITY_RESOURCE_DIGEST?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
