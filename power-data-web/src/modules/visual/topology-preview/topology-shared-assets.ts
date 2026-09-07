/**
 * 生成拓扑公共资源的部署地址。
 *
 * 四态设备图标不属于燃气、燃煤或某个数据版本，因此统一放在 topology/shared（拓扑公共资源）下。
 * 相对构建时根据入口脚本恢复 shell（嵌入壳）目录，避免正式发布包从站点根目录错误取图。
 */
export function getTopologySharedPublicAssetUrl(
  relativePath: string,
  viteBaseUrl = import.meta.env.BASE_URL,
  entryModuleScriptUrl = typeof document === 'undefined'
    ? undefined
    : document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src || undefined,
): string {
  const assetRelativePath = `topology/shared/${relativePath}`
  if ((viteBaseUrl === './' || viteBaseUrl === '.') && entryModuleScriptUrl) {
    return new URL(`../${assetRelativePath}`, entryModuleScriptUrl).toString()
  }
  const basePath = viteBaseUrl.endsWith('/') ? viteBaseUrl : `${viteBaseUrl}/`
  return `${basePath}${assetRelativePath}`
}
