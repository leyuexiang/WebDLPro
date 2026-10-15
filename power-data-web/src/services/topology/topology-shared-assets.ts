/**
 * 把历史拓扑 JSON 中的共享 PNG 资源键定向到公共 WebP。
 * 这些键只作为来源识别值，解析器在生成图片地址前完成替换，因此运行时不会请求旧 PNG。
 * 所有非背景 WebP 统一存放在 icons 目录；散列命名的静态图元集中放在 icons/static。
 * 对源图像字节完全一致的历史资源使用同一目标，避免重复下载和浏览器缓存副本。
 */
export const TOPOLOGY_SHARED_ASSET_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png": "icons/static/8d0315d77f6a8912efa50b79ed1e4ac44d276d699a9fd722ac76412e89bb6bd3.webp",
  "assets/14e5a4ee2373d1040a58bfc2224ba1025e74b65b20abe57c78a411c9618506cc.png": "icons/static/608d8b8443e0b4483124d2e8d6e8d6ced75ec73279108cf09fc27d5cde945154.webp",
  "assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png": "icons/normal/desktop.webp",
  "assets/21960efa9d7b5349021290020a64889d5bf9116717949f55b5be9225fe67162a.png": "icons/static/e2e275e4a94ef6d9f2313aee8ee7857b2ba21ac4d323bd53378144dc47169f7f.webp",
  "assets/24ebf71e12d52b8eefa670e47598f2d2a983ad9c8144a48c54995269286485f4.png": "icons/normal/gearbox.webp",
  "assets/2df25d7612010634e5629e5a52d4c634b576444c2b7ea8cf76a21212552bdfa4.png": "icons/normal/office.webp",
  "assets/3bccb7e7c803d154697613cbf9442e7a1a0558ae700eff0fe525e3fa1540b50f.png": "icons/static/def6155598057373934ea3668fa58a2ed4cf26f9d1722fae22f6a06af732859a.webp",
  "assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png": "icons/static/fc0d7f043c577c6c378f47d2dbdebba016d21fe1080819ffae5f14d4a7416a0d.webp",
  "assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png": "icons/normal/server.webp",
  "assets/5b122128c42fee0b3e5880ee75156d7158e3993a997df872f89e6e9058d29bd2.png": "icons/static/cd6828e95bede9b2101c2444d65c367328521133720bd598d8be4b665b505b37.webp",
  "assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png": "icons/normal/firewall.webp",
  "assets/718cec05f75e70931df037e80f0a799a96d7795ff32ba78372954eb90ee864f6.png": "icons/normal/combiner.webp",
  "assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png": "icons/normal/protection.webp",
  "assets/7ce160d65d7ab7ffc650db4465b08cb17cc7629c7c968fbc2c399823a4864ab3.png": "icons/normal/solar.webp",
  "assets/9dcf00f20a365b2173fdd125676166950388cf84cd7fb0f4765eb29685bc1c38.png": "icons/static/72c7e1e4eed654c8cddb379b8db4c6f3554b810eff9fd8d74f9084c5d28fe6e5.webp",
  "assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png": "icons/static/f6ce2eb85bb851727eb46af15e165bd4dc0c3d718b251ddf3dad5d59d546ca4a.webp",
  "assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png": "icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp",
  "assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png": "icons/static/3c55a879863799ca393401c68510aca17af14fdff71e330d1300e7ca5567e5fa.webp",
  "assets/b011121d41fd5c5120f175568c67e49d84eb66556973676d70635376f809b966.png": "icons/normal/plc.webp",
  "assets/ba8187270926d7debab4e2073959d603c10b126425efc533883ac60c4579130e.png": "background/flow-light-3.webp",
  "assets/boiler-safety-control.png": "icons/normal/dcs.webp",
  "assets/boiler.png": "icons/normal/boiler.webp",
  "assets/booster-compressor.png": "icons/normal/compressor.webp",
  "assets/c22310dddba4eac96f3576338f9fb8c1a3c8c35c8135860d41f65a2bc919b8b4.png": "icons/static/3f298fdca1e67c404570bede325564faebedad1ef887ad355bca07ee0be56767.webp",
  "assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png": "icons/static/daf2fb1b44161fe4932687c9c6b6506bc5c31d7a4ed899070c8844cac9cccda2.webp",
  "assets/cb72eb3dc26fab5c53c23d6867455bfdddd5e7201cba90243b2f21fcb127af76.png": "icons/normal/router.webp",
  "assets/chemical-water-control.png": "icons/normal/plc.webp",
  "assets/coal-handling-control.png": "icons/normal/plc.webp",
  "assets/coordination-control.png": "icons/normal/dcs.webp",
  "assets/data-server.png": "icons/normal/server.webp",
  "assets/denitration-control.png": "icons/normal/plc.webp",
  "assets/denitration.png": "icons/normal/desulfurization.webp",
  "assets/e0f941a41a0b6b66c8a695949c90a17dace3b97ff5d0553fd3ac1a3f7b47f437.png": "icons/normal/box_transformer.webp",
  "assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png": "icons/static/86f82e4489853e4ee9eb849071eb8d3d8f34de00b771ba6615a43fb0da1b204c.webp",
  "assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png": "icons/static/33c45e58ffbc78349129843cc7619e5a831aa08ac8175370f7f131d290ebf5b3.webp",
  "assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png": "icons/static/194a1218e43f8e81192c29054a52f65edeca7b517aaaf7bad21a0c9739f2a33f.webp",
  "assets/enterprise-system.png": "icons/normal/desktop.webp",
  "assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png": "icons/normal/transformer.webp",
  "assets/fc2eb70c87fa47ee40600832dd9de280ba60b79aedbaaf99304ed30043fd5ffb.png": "icons/static/cd8655f8bcede28c1a381160c4a696c93556459006d8fd8c2583a261b312d755.webp",
  "assets/fe44783bc63ef1f69551cba04ad53c53a41fc89feebc2a0d94a850d6c9b80fbb.png": "icons/normal/dcs.webp",
  "assets/firewall-compact.png": "icons/normal/firewall.webp",
  "assets/firewall.png": "icons/normal/firewall.webp",
  "assets/generator-excitation-control.png": "icons/normal/dcs.webp",
  "assets/generator.png": "icons/normal/generator.webp",
  "assets/high-pressure-pump.png": "icons/normal/pump.webp",
  "assets/mirror-server.png": "icons/normal/server.webp",
  "assets/operator.png": "icons/normal/office.webp",
  "assets/process-detail/gas-turbine-critical.png": "icons/normal/gas_turbine.webp",
  "assets/server.png": "icons/normal/server.webp",
  "assets/steam-turbine.png": "icons/normal/steam_turbine.webp",
  "assets/switch-compact.png": "icons/normal/router.webp",
  "assets/switch.png": "icons/static/31e08369011912241004d9da628aa4ac3a80ba97a8abd2e83289e7a7515f4c8b.webp",
  "assets/turbine-governor.png": "icons/normal/dcs.webp",
  "assets/unit-coordination.png": "icons/static/84aa73a62f2c0663b2d9e6525749f6fe3e41ba975eb277620d26600072d94c91.webp",
  "assets/workstation.png": "icons/normal/office.webp",
  "background/flow-light-3.png": "background/flow-light-3.webp",
})

/**
 * 生成拓扑公共资源部署地址，并在拼接部署路径前解析历史 PNG 键。
 * 四态图标、静态图元和底图都从 topology/shared 公共目录加载；相对发布时依据入口脚本恢复壳目录，
 * 子目录部署时使用 Vite 基准路径，避免正式发布包从站点根目录错误取图。
 */
export function getTopologySharedPublicAssetUrl(
  relativePath: string,
  viteBaseUrl = import.meta.env.BASE_URL,
  entryModuleScriptUrl = typeof document === 'undefined'
    ? undefined
    : document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src || undefined,
): string {
  const hasAlias = Object.hasOwn(TOPOLOGY_SHARED_ASSET_ALIASES, relativePath)
  const canonicalPath = hasAlias ? TOPOLOGY_SHARED_ASSET_ALIASES[relativePath]! : relativePath
  // 禁止未经登记的历史 assets 路径或 PNG 地址穿透到公共目录，避免旧图元被构建产物继续引用。
  if ((relativePath.startsWith('assets/') && !hasAlias) || /\.png(?:$|\?)/i.test(canonicalPath)) {
    throw new Error(`拓扑公共图片未登记为 WebP 资源：${relativePath}`)
  }
  const assetRelativePath = `topology/shared/${canonicalPath}`
  if ((viteBaseUrl === './' || viteBaseUrl === '.') && entryModuleScriptUrl) {
    return new URL(`../${assetRelativePath}`, entryModuleScriptUrl).toString()
  }
  const basePath = viteBaseUrl.endsWith('/') ? viteBaseUrl : `${viteBaseUrl}/`
  return `${basePath}${assetRelativePath}`
}
