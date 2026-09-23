// ====================================================================
// 通信安全配置文件
// ====================================================================
// 
// 此文件用于配置系统的时间锁定和加密参数
// 修改此文件后需要重新编译 Unity 项目和前端项目
//
// ⚠️ 重要：Unity 端和前端必须使用相同的配置
// ====================================================================

/**
 * 时间锁定配置
 */
export const SECURITY_CONFIG = {
  /**
   * 基准日期（起始日期）
   * 格式：YYYY-MM-DD
   */
  BASE_DATE: '2026-09-23',

  /**
   * 试用期天数
   * 
   * 常用设置：
   * - 30：1个月试用期
   * - 90：3个月试用期
   * - 180：6个月试用期
   * - 365：1年试用期
   */
  TRIAL_DAYS: 30,

  /**
   * 过期警告天数
   * 距离过期还有多少天时开始显示警告
   */
  WARNING_DAYS: 7,

  /**
   * 是否启用防时间回拨检测
   */
  ENABLE_TIME_ROLLBACK_DETECTION: true,

  /**
   * 时间回拨容忍天数
   * 如果当前时间比上次运行时间早超过此天数，视为异常
   */
  TIME_ROLLBACK_TOLERANCE_DAYS: 1,
};

/**
 * 加密配置
 */
export const ENCRYPTION_CONFIG = {
  /**
   * 是否启用消息加密
   * 
   * false: 不加密（性能最好，安全性低）
   * true: 加密所有敏感消息（性能略有影响，安全性高）
   */
  ENABLE_ENCRYPTION: false,

  /**
   * 需要加密的命令类型列表
   * 只有这些命令会被加密，其他命令保持明文
   * 
   * 可选值：
   * - 'switchScene': 场景切换
   * - 'enterProcessStep': 进入流程步骤
   * - 'setNodeVisualState': 设置节点视觉状态
   * - 'focusNode': 聚焦节点
   * - 'setRouteFlow': 设置路径流动
   * - 'setNodeVisibility': 设置节点可见性
   * 
   * 留空数组 [] 表示不加密任何命令
   * 包含 '*' 表示加密所有命令
   */
  ENCRYPTED_COMMANDS: [] as string[],

  /**
   * 加密算法
   * 当前仅支持 'AES-256-CBC'
   */
  ALGORITHM: 'AES-256-CBC',

  /**
   * 密钥派生迭代次数
   * 更高的值提供更强的安全性，但初始化速度稍慢
   */
  PBKDF2_ITERATIONS: 10000,
};

/**
 * 显示配置
 */
export const DISPLAY_CONFIG = {
  /**
   * 是否在控制台显示安全日志
   */
  SHOW_SECURITY_LOGS: true,

  /**
   * 是否在UI显示过期警告
   */
  SHOW_EXPIRATION_WARNING_UI: true,

  /**
   * 过期后的提示消息
   */
  EXPIRATION_MESSAGE: '系统试用期已过期，请联系开发商续期。',

  /**
   * 过期警告消息模板
   * {days} 会被替换为剩余天数
   */
  WARNING_MESSAGE_TEMPLATE: '系统将在 {days} 天后过期，请及时续期。',

  /**
   * 开发商联系信息（显示在过期提示中）
   */
  VENDOR_CONTACT: {
    name: '开发团队',
    email: 'support@example.com',
    phone: '400-xxx-xxxx',
  },
};

/**
 * 计算过期日期
 */
export function calculateExpirationDate(): Date {
  const baseDate = new Date(SECURITY_CONFIG.BASE_DATE + 'T00:00:00Z');
  const expirationDate = new Date(
    baseDate.getTime() + SECURITY_CONFIG.TRIAL_DAYS * 24 * 60 * 60 * 1000
  );
  return expirationDate;
}

/**
 * 格式化过期日期为字符串
 */
export function formatExpirationDate(): string {
  const date = calculateExpirationDate();
  return date.toISOString().split('T')[0];
}

/**
 * 检查某个命令是否需要加密
 */
export function shouldEncryptCommand(commandType: string): boolean {
  if (!ENCRYPTION_CONFIG.ENABLE_ENCRYPTION) {
    return false;
  }

  if (ENCRYPTION_CONFIG.ENCRYPTED_COMMANDS.includes('*')) {
    return true;
  }

  return ENCRYPTION_CONFIG.ENCRYPTED_COMMANDS.includes(commandType);
}

// ====================================================================
// Unity C# 配置对照
// ====================================================================
//
// 修改此文件后，需要同步修改 Unity 端的配置：
// 
// 文件位置：Assets/Scripts/Security/CommunicationSecurityManager.cs
//
// 需要修改的代码段：
//
// private DateTime CalculateExpirationDate()
// {
//     DateTime baseDate = new DateTime(2024, 1, 1);  // ← BASE_DATE
//     int obfuscatedDays = 180;                      // ← TRIAL_DAYS
//     return baseDate.AddDays(obfuscatedDays);
// }
//
// ====================================================================

/**
 * 生成 Unity C# 配置代码
 * 仅供开发参考，不会自动同步
 */
export function generateCSharpConfig(): string {
  const baseDate = new Date(SECURITY_CONFIG.BASE_DATE);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth() + 1;
  const day = baseDate.getDate();

  return `
// Unity C# 配置代码（需手动复制到 CommunicationSecurityManager.cs）

private DateTime CalculateExpirationDate()
{
    DateTime baseDate = new DateTime(${year}, ${month}, ${day});
    int obfuscatedDays = ${SECURITY_CONFIG.TRIAL_DAYS};
    return baseDate.AddDays(obfuscatedDays);
}

// 过期日期：${formatExpirationDate()}
  `.trim();
}

// 开发时在控制台打印配置信息
if (process.env.NODE_ENV === 'development') {
  console.log('=== 安全配置信息 ===');
  console.log('基准日期:', SECURITY_CONFIG.BASE_DATE);
  console.log('试用天数:', SECURITY_CONFIG.TRIAL_DAYS);
  console.log('过期日期:', formatExpirationDate());
  console.log('加密启用:', ENCRYPTION_CONFIG.ENABLE_ENCRYPTION);
  console.log('==================');
}
