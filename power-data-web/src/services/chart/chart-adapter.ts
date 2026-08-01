/**
 * 图表适配器边界：页面只传入可序列化配置与数据，具体画布实例由实现类私有持有。
 * 后续可接入 Apache ECharts（阿帕奇图表库）而不让页面依赖实例方法。
 */
export interface ChartAdapter<TOptions = unknown> {
  render(options: TOptions): void
  resize(): void
  dispose(): void
}
