/**
 * 旧拓扑输入仍可能携带已删除的静态资源键。此索引按旧资源散列核对出的图元类型，
 * 将旧键定向到新公共图标；四态设备切换使用同一类别的状态目录，背景继续使用公共背景图。
 */
export const TOPOLOGY_SHARED_ASSET_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'assets/1142fad7b78fbe66df912de96bd28bf680fc661c753781dff5d1167582ba7eec.png': 'icons/normal/mutual_transformer.webp',
  'assets/14e5a4ee2373d1040a58bfc2224ba1025e74b65b20abe57c78a411c9618506cc.png': 'icons/normal/solar.webp',
  'assets/19dcad3def4614abf883d93cfa7412d1987746c281caf583222c0fbf0c066f8a.png': 'icons/normal/desktop.webp',
  'assets/21960efa9d7b5349021290020a64889d5bf9116717949f55b5be9225fe67162a.png': 'icons/normal/wind_blade.webp',
  'assets/24ebf71e12d52b8eefa670e47598f2d2a983ad9c8144a48c54995269286485f4.png': 'icons/normal/gearbox.webp',
  'assets/2df25d7612010634e5629e5a52d4c634b576444c2b7ea8cf76a21212552bdfa4.png': 'icons/normal/office.webp',
  'assets/3bccb7e7c803d154697613cbf9442e7a1a0558ae700eff0fe525e3fa1540b50f.png': 'icons/normal/yaw_motor.webp',
  'assets/445eba41b532a4b347be31bae3c552a5505528caa478feff65a0d00e3f6bb05c.png': 'icons/normal/clock.webp',
  'assets/530d3fc13221c734d8a858e909318243f598b07f241a9c485d554507fd820068.png': 'icons/normal/server.webp',
  'assets/5b122128c42fee0b3e5880ee75156d7158e3993a997df872f89e6e9058d29bd2.png': 'icons/normal/weather.webp',
  'assets/69eb24dd21a1d003dbede41cd0a40e266242005d55ecd3833ba74f09a114d7b0.png': 'icons/normal/firewall.webp',
  'assets/718cec05f75e70931df037e80f0a799a96d7795ff32ba78372954eb90ee864f6.png': 'icons/normal/combiner.webp',
  'assets/7a686f6f6f93cf82645abf82459a1169ca056e88d9e66c31060e9d6b899ff688.png': 'icons/normal/protection.webp',
  'assets/7ce160d65d7ab7ffc650db4465b08cb17cc7629c7c968fbc2c399823a4864ab3.png': 'icons/normal/solar_panel.webp',
  'assets/9dcf00f20a365b2173fdd125676166950388cf84cd7fb0f4765eb29685bc1c38.png': 'icons/normal/heat_fan.webp',
  'assets/a48cf8ac16a768b7d15645307ce139f77f63b1d30109441d29c061269d33de67.png': 'icons/normal/instrument.webp',
  'assets/a956a9c6b2bea6570c74070907fb9d934dd91bf9ac2428a5280c636a723c9782.png': 'icons/normal/dual_router.webp',
  'assets/afece8e6cc894b44000de34c0d20500835fd76c728fdbda488733ef172669622.png': 'icons/normal/remote_terminal.webp',
  'assets/b011121d41fd5c5120f175568c67e49d84eb66556973676d70635376f809b966.png': 'icons/normal/plc.webp',
  'assets/ba8187270926d7debab4e2073959d603c10b126425efc533883ac60c4579130e.png': 'background/flow-light-3.png',
  'assets/boiler-safety-control.png': 'icons/normal/dcs.webp',
  'assets/boiler.png': 'icons/normal/boiler.webp',
  'assets/booster-compressor.png': 'icons/normal/compressor.webp',
  'assets/c22310dddba4eac96f3576338f9fb8c1a3c8c35c8135860d41f65a2bc919b8b4.png': 'icons/normal/pitch_hydraulic.webp',
  'assets/c2ac0b8f497363804e162dde20c0c011a1df68f84a0c770890f09d074ac84ee4.png': 'icons/normal/monitor.webp',
  'assets/cb72eb3dc26fab5c53c23d6867455bfdddd5e7201cba90243b2f21fcb127af76.png': 'icons/normal/router.webp',
  'assets/chemical-water-control.png': 'icons/normal/plc.webp',
  'assets/coal-handling-control.png': 'icons/normal/plc.webp',
  'assets/coordination-control.png': 'icons/normal/dcs.webp',
  'assets/data-server.png': 'icons/normal/server.webp',
  'assets/denitration-control.png': 'icons/normal/plc.webp',
  'assets/denitration.png': 'icons/normal/desulfurization.webp',
  'assets/e0f941a41a0b6b66c8a695949c90a17dace3b97ff5d0553fd3ac1a3f7b47f437.png': 'icons/normal/box_transformer.webp',
  'assets/e7843f4b2ea238b8249953825efe7429c7d03c3b386d883c312bddc52cd497e2.webp': 'icons/normal/pmu.webp',
  'assets/eac4dee9e4c892efdb0e64f5838391d57962d3e39cd0ae07f0300ebd83fb7739.png': 'icons/normal/breaker.webp',
  'assets/ec43fecf6d16e9e9e68f6c36edde34e8a8ef727af2d0058cda872c41e0036037.png': 'icons/normal/combiner_unit.webp',
  'assets/edeaca0826ba842a23a73da84b2a32469b03b1845acc90c7522d9ed463629458.png': 'icons/normal/intelligent_terminal.webp',
  'assets/enterprise-system.png': 'icons/normal/desktop.webp',
  'assets/f19e04fdec6213386e2b118ffb79b11b9e404d88c8d86f004c8b613cd382c235.png': 'icons/normal/transformer.webp',
  'assets/fc2eb70c87fa47ee40600832dd9de280ba60b79aedbaaf99304ed30043fd5ffb.png': 'icons/normal/brake_disc.webp',
  'assets/fe44783bc63ef1f69551cba04ad53c53a41fc89feebc2a0d94a850d6c9b80fbb.png': 'icons/normal/dcs.webp',
  'assets/firewall-compact.png': 'icons/normal/firewall.webp',
  'assets/firewall.png': 'icons/normal/firewall.webp',
  'assets/generator-excitation-control.png': 'icons/normal/dcs.webp',
  'assets/generator.png': 'icons/normal/generator.webp',
  'assets/high-pressure-pump.png': 'icons/normal/pump.webp',
  'assets/mirror-server.png': 'icons/normal/server.webp',
  'assets/operator.png': 'icons/normal/office.webp',
  'assets/process-detail/gas-turbine-critical.png': 'icons/normal/gas_turbine.webp',
  'assets/server.png': 'icons/normal/server.webp',
  'assets/steam-turbine.png': 'icons/normal/steam_turbine.webp',
  'assets/switch-compact.png': 'icons/normal/router.webp',
  'assets/switch.png': 'icons/normal/dual_router.webp',
  'assets/turbine-governor.png': 'icons/normal/dcs.webp',
  'assets/unit-coordination.png': 'icons/normal/coordination.webp',
  'assets/workstation.png': 'icons/normal/office.webp',
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
