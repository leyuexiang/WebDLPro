import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 三项第三层拓扑的不可变发布合同。散列锁定经过验收的原始文件，图元数量用于提供更直观的
 * 结构诊断，显式绑定图元则保证二维状态投影不会在文件仍可解析时静默失效。
 */
export const processDetailTopologyContracts = Object.freeze([
  Object.freeze({
    contextId: 'process-detail.gas-power.gas-turbine',
    topologyPath: 'process-detail/gas-power/gas-turbine/topology.json',
    sourceSha256: '30652c2a8a2b5bf0af76c70501baa94e2ece57edb57fd35d164486546103b9ba',
    expectedPenCount: 32,
    bindingPenIds: Object.freeze(['14d76d6', '35d969bb', '621bf39b']),
  }),
  Object.freeze({
    contextId: 'process-detail.coal-power.steam-turbine',
    topologyPath: 'process-detail/coal-power/steam-turbine/topology.json',
    sourceSha256: '5c7262f198f4b4443d863d07a8b39f5bd0d9d841cb03d820b5535c736c78a79c',
    expectedPenCount: 45,
    bindingPenIds: Object.freeze(['429749ea', '8be4fc2', '9533a1f']),
  }),
  Object.freeze({
    contextId: 'process-detail.solar-power.inverter',
    topologyPath: 'process-detail/solar-power/inverter/topology.json',
    sourceSha256: '6391b1212c07664721cbccfea4bb9d5f7ef06487655b08fbf09d4b09e9018686',
    expectedPenCount: 19,
    bindingPenIds: Object.freeze(['df25e45', '2cf7b170']),
  }),
])

/**
 * 仅遍历第三层目录中的普通文件。文件集合先排序再比较，使不同操作系统和文件系统返回顺序
 * 不会影响门禁结果；目录缺失时返回空集合，由各项合同统一报告缺失文件。
 */
async function listProcessDetailFiles(topologyRoot) {
  const processDetailRoot = path.join(topologyRoot, 'process-detail')
  const files = []
  const directories = [processDetailRoot]
  while (directories.length > 0) {
    const directory = directories.pop()
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) directories.push(entryPath)
      else if (entry.isFile()) files.push(path.relative(topologyRoot, entryPath).split(path.sep).join('/'))
    }
  }
  return files.sort()
}

/**
 * 校验源码目录或发布包 shell/topology 目录中的第三层独立拓扑。算法对每份文件只读取一次，
 * 同一缓冲区同时用于散列和解析，避免重复磁盘查询；图元编号使用集合在线性时间内完成唯一性检查。
 */
export async function validateProcessDetailTopologies(topologyRoot) {
  const issues = []
  const actualFiles = await listProcessDetailFiles(topologyRoot)
  const expectedFiles = new Set(processDetailTopologyContracts.map((contract) => contract.topologyPath))
  for (const file of actualFiles) {
    if (!expectedFiles.has(file)) {
      issues.push(Object.freeze({ code: 'process-detail.topology-extra-resource', contextId: null, file }))
    }
  }

  for (const contract of processDetailTopologyContracts) {
    const topologyFile = path.join(topologyRoot, ...contract.topologyPath.split('/'))
    let sourceBuffer
    try {
      sourceBuffer = await readFile(topologyFile)
    } catch {
      issues.push(Object.freeze({ code: 'process-detail.topology-missing', contextId: contract.contextId, file: contract.topologyPath }))
      continue
    }

    const digest = createHash('sha256').update(sourceBuffer).digest('hex')
    if (digest !== contract.sourceSha256) {
      issues.push(Object.freeze({ code: 'process-detail.topology-digest-mismatch', contextId: contract.contextId, file: contract.topologyPath }))
    }

    let topology
    try {
      topology = JSON.parse(sourceBuffer.toString('utf8'))
    } catch {
      issues.push(Object.freeze({ code: 'process-detail.topology-invalid-json', contextId: contract.contextId, file: contract.topologyPath }))
      continue
    }
    const pens = Array.isArray(topology?.pens) ? topology.pens : []
    if (pens.length !== contract.expectedPenCount) {
      issues.push(Object.freeze({ code: 'process-detail.topology-pen-count-mismatch', contextId: contract.contextId, file: contract.topologyPath }))
    }

    const penIds = new Set()
    let hasInvalidOrDuplicatePenId = false
    for (const pen of pens) {
      const penId = pen?.id
      if (typeof penId !== 'string' || penId.length === 0 || penIds.has(penId)) {
        hasInvalidOrDuplicatePenId = true
        continue
      }
      penIds.add(penId)
    }
    if (hasInvalidOrDuplicatePenId) {
      issues.push(Object.freeze({ code: 'process-detail.topology-pen-id-invalid', contextId: contract.contextId, file: contract.topologyPath }))
    }
    if (contract.bindingPenIds.some((penId) => !penIds.has(penId))) {
      issues.push(Object.freeze({ code: 'process-detail.topology-binding-missing', contextId: contract.contextId, file: contract.topologyPath }))
    }
  }
  return Object.freeze(issues)
}

/** 将稳定问题码转换为发布流水线可直接定位的中文诊断，不回显拓扑业务数据。 */
export function formatProcessDetailTopologyIssue(issue) {
  const labels = {
    'process-detail.topology-extra-resource': '第三层拓扑目录包含合同外资源',
    'process-detail.topology-missing': '第三层拓扑文件缺失',
    'process-detail.topology-digest-mismatch': '第三层拓扑文件散列与验收版本不一致',
    'process-detail.topology-invalid-json': '第三层拓扑文件不是合法的 JSON（数据交换格式）',
    'process-detail.topology-pen-count-mismatch': '第三层拓扑图元数量与验收版本不一致',
    'process-detail.topology-pen-id-invalid': '第三层拓扑图元编号缺失或重复',
    'process-detail.topology-binding-missing': '第三层拓扑缺少已登记的状态绑定图元',
  }
  return `${labels[issue.code] ?? '第三层拓扑合同校验失败'}：${issue.file}。`
}
