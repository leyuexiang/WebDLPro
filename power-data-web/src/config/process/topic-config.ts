import { toPermissionCode, toTopicId } from '@/config/process/identifiers'
import { LOCAL_PROCESS_CONFIG_VERSION } from '@/config/process/local-process-config'
import type { TopicDefinition } from '@/config/process/types'

/** 专题入口同样配置驱动；当前只声明已批准的五个专题，不加载任何未确认的专题资源。 */
export const localTopicDefinitions: readonly TopicDefinition[] = [
  { topicId: toTopicId('monitoring-data-collection'), title: '监控与数据采集', description: '采集链路、设备状态与数据质量入口。', permissionCode: toPermissionCode('visual.topic.view'), configVersion: LOCAL_PROCESS_CONFIG_VERSION },
  { topicId: toTopicId('distributed-control-system'), title: '分布式控制系统', description: '分布式控制系统专题入口。', permissionCode: toPermissionCode('visual.topic.view'), configVersion: LOCAL_PROCESS_CONFIG_VERSION },
  { topicId: toTopicId('programmable-logic-controller'), title: '可编程逻辑控制器', description: '可编程逻辑控制器专题入口。', permissionCode: toPermissionCode('visual.topic.view'), configVersion: LOCAL_PROCESS_CONFIG_VERSION },
  { topicId: toTopicId('fault-diagnosis'), title: '故障诊断', description: '故障诊断专题入口。', permissionCode: toPermissionCode('visual.topic.view'), configVersion: LOCAL_PROCESS_CONFIG_VERSION },
  { topicId: toTopicId('safety-warning'), title: '安全预警', description: '安全预警专题入口。', permissionCode: toPermissionCode('visual.topic.view'), configVersion: LOCAL_PROCESS_CONFIG_VERSION },
]

/** 以稳定专题 ID 查找配置，路由和页面复用此函数避免各自维护一份专题列表。 */
export function getLocalTopicDefinition(topicId: string): TopicDefinition | undefined {
  return localTopicDefinitions.find((topic) => topic.topicId === topicId)
}
