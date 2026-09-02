import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 第三层往返必须保留唯一拓扑画布实例。该契约测试锁定组件选择条件与受控端口，
 * 防止后续把暂停重新实现成 v-if（条件渲染）卸载，从而丢失 Meta2D（二维组态引擎）实例和监听状态。
 */
describe('拓扑画布暂停契约', () => {
  const panelSource = readFileSync(`${process.cwd()}/src/modules/visual/components/TopologyPanel.vue`, 'utf8')
  const controllerSource = readFileSync(`${process.cwd()}/src/modules/visual/components/topology-canvas-controller.ts`, 'utf8')

  it('暂停不参与三种画布组件的创建条件', () => {
    expect(panelSource).toContain('v-if="usesLatestCoalOverviewCanvas"')
    expect(panelSource).toContain('v-else-if="usesLatestJsonOverviewCanvas"')
    // 使用空白匹配兼容 UTF-8 文件在不同开发环境中的换行格式，契约只约束组件分支而非 CRLF/LF。
    expect(panelSource).toMatch(/<TopologyCanvas\s+v-else/)
    expect(panelSource).not.toMatch(/v-(?:if|else-if)="[^"]*props\.suspended/)
  })

  it('唯一画布端口提供显式暂停恢复能力', () => {
    expect(controllerSource).toContain('setSuspended(suspended: boolean): void')
    expect(panelSource).toContain('stableCanvasController.setSuspended(Boolean(suspended))')
  })

  it('重新显示时自动重置视口且面板提供手动重置按钮', () => {
    expect(controllerSource).toContain('resetView(): void')
    expect(panelSource).toContain('controller.resetView()')
    expect(panelSource).toContain('aria-label="重置拓扑图位置"')
    expect(panelSource).toContain('@click="resetTopologyView"')
  })
})
