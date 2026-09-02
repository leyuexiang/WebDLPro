/**
 * 相对 Vite 基础路径仅用于发布包内的 `shell`（嵌入壳）目录。网页历史模式会在首屏
 * 路由就绪时写入地址；若仍把 `./` 直接交给路由器，路由器会将 `/shell/embed` 错误改写成
 * `/embed`，进而使所有相对静态资源丢失 `shell` 前缀。此函数在改写发生前固定壳目录。
 */
const KNOWN_ROUTE_SUFFIXES = Object.freeze([
  '/embed',
  '/gas-topology-json-preview',
  '/coal-topology-json-preview',
])

/**
 * 计算网页历史模式的真实基础路径。
 *
 * 绝对资源前缀原样交给 Vue 路由器（网页路由库），保持常规部署兼容；只有 `./` 或 `.`
 * 才从初始地址剥离已知路由段。例如 `/shell/embed` 固定为 `/shell/`，随后任何导航都会
 * 保持在嵌入壳目录内。纯函数参数使这一发布场景可在无浏览器环境下单测。
 */
export function resolveRouterHistoryBase(viteBaseUrl: string, initialPathname: string): string {
  if (viteBaseUrl !== './' && viteBaseUrl !== '.') return viteBaseUrl

  const normalizedPathname = initialPathname.startsWith('/') ? initialPathname : `/${initialPathname}`
  for (const routeSuffix of KNOWN_ROUTE_SUFFIXES) {
    if (!normalizedPathname.endsWith(routeSuffix)) continue
    const shellPath = normalizedPathname.slice(0, -routeSuffix.length)
    return shellPath ? `${shellPath}/` : '/'
  }

  // 直接打开 `shell/` 时路径本身就是目录；未知路径会由服务器回退到嵌入壳，不在此猜测目录层级。
  return normalizedPathname.endsWith('/') ? normalizedPathname : `${normalizedPathname}/`
}
