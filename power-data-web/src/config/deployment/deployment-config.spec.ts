import { describe, expect, it } from 'vitest'
import { readDeploymentConfiguration } from '@/config/deployment/deployment-config'

const productionEnvironment = {
  DEV: false,
  VITE_POWER_PARENT_ORIGIN: 'https://portal.example.test',
  VITE_POWER_UNITY_PARENT_ORIGIN: 'https://visual.example.test',
  VITE_POWER_UNITY_ENTRY_URL: 'https://unity.example.test/webgl/index.html',
  VITE_POWER_MANIFEST_URL: 'https://config.example.test/power/manifest.json',
  VITE_POWER_MINIMUM_VIEWPORT_WIDTH: '1280',
  VITE_POWER_MINIMUM_VIEWPORT_HEIGHT: '720',
} as const

describe('部署配置读取器', () => {
  it('只在字段完整且地址合法时发布可用配置', () => {
    const result = readDeploymentConfiguration(productionEnvironment)

    expect(result.status).toBe('ready')
    expect(result.configuration?.unityChildOrigin).toBe('https://unity.example.test')
    expect(result.configuration?.unityParentOrigin).toBe('https://visual.example.test')
    expect(result.configuration?.minimumViewportWidth).toBe(1280)
    expect(result.issues).toEqual([])
  })

  it('生产环境缺少地址时不使用本机端口回退', () => {
    const result = readDeploymentConfiguration({ DEV: false })

    expect(result.status).toBe('invalid')
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'deployment.parent-origin',
      'deployment.unity-parent-origin',
      'deployment.unity-entry',
      'deployment.manifest-url',
      'deployment.minimum-viewport',
    ])
  })

  it('拒绝非精确来源和非法容器尺寸', () => {
    const result = readDeploymentConfiguration({
      ...productionEnvironment,
      VITE_POWER_PARENT_ORIGIN: 'https://portal.example.test/path',
      VITE_POWER_UNITY_PARENT_ORIGIN: 'https://visual.example.test/path',
      VITE_POWER_MINIMUM_VIEWPORT_WIDTH: '0',
    })

    expect(result.status).toBe('invalid')
    expect(result.issues.map((issue) => issue.code)).toContain('deployment.parent-origin')
    expect(result.issues.map((issue) => issue.code)).toContain('deployment.unity-parent-origin')
    expect(result.issues.map((issue) => issue.code)).toContain('deployment.minimum-viewport')
  })
})
