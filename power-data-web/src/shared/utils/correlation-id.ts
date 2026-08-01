/**
 * 生成用于请求、命令和状态展示的关联标识。
 * 优先使用浏览器安全随机标识；旧环境回退到时间戳和随机数的组合，避免把业务名称或用户信息写入标识。
 */
export function createCorrelationId(prefix: string): string {
  const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}:${randomPart}`
}
