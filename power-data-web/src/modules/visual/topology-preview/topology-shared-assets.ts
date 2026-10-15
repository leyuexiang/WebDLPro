/**
 * 同字节源图片只请求一个公共地址。别名依据源资源散列审计建立，不按设备名称猜配；
 * 源拓扑继续保留原始编号和图片键，各场景在装载时共用同一资源与浏览器图片缓存。
 */
export const TOPOLOGY_SHARED_ASSET_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': 'assets/firewall-compact.png',
  'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': 'assets/data-server.png',
  'assets/2df25d7612010634e5629e5a52d4c634b576444c2b7ea8cf76a21212552bdfa4.png': 'assets/operator.png',
  'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': 'assets/enterprise-system.png',
  'assets/b011121d41fd5c5120f175568c67e49d84eb66556973676d70635376f809b966.png': 'assets/chemical-water-control.png',
  'assets/fe44783bc63ef1f69551cba04ad53c53a41fc89feebc2a0d94a850d6c9b80fbb.png': 'assets/boiler-safety-control.png',
  'assets/ba8187270926d7debab4e2073959d603c10b126425efc533883ac60c4579130e.png': 'background/flow-light-3.png',
  'assets/cb72eb3dc26fab5c53c23d6867455bfdddd5e7201cba90243b2f21fcb127af76.png': 'assets/switch-compact.png',
  'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': 'assets/switch.png',
})

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
  const canonicalPath = Object.hasOwn(TOPOLOGY_SHARED_ASSET_ALIASES, relativePath)
    ? TOPOLOGY_SHARED_ASSET_ALIASES[relativePath]!
    : relativePath
  const assetRelativePath = `topology/shared/${canonicalPath}`
  if ((viteBaseUrl === './' || viteBaseUrl === '.') && entryModuleScriptUrl) {
    return new URL(`../${assetRelativePath}`, entryModuleScriptUrl).toString()
  }
  const basePath = viteBaseUrl.endsWith('/') ? viteBaseUrl : `${viteBaseUrl}/`
  return `${basePath}${assetRelativePath}`
}
