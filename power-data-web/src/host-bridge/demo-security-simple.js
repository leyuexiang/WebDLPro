#!/usr/bin/env node

/**
 * 安全保护功能简单演示
 * 不依赖 TypeScript，直接运行
 */

// 配置信息
const BASE_DATE = '2024-01-01';
const TRIAL_DAYS = 180;
const WARNING_DAYS = 7;

console.log('\n====================================');
console.log('🔐 安全保护功能演示');
console.log('====================================\n');

// 计算过期日期
const baseDate = new Date(BASE_DATE + 'T00:00:00Z');
const expirationDate = new Date(baseDate.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
const now = new Date();
const daysRemaining = Math.floor((expirationDate - now) / (24 * 60 * 60 * 1000));
const isExpired = now > expirationDate;

// 显示配置
console.log('📋 当前配置：');
console.log(`   基准日期: ${BASE_DATE}`);
console.log(`   试用天数: ${TRIAL_DAYS} 天`);
console.log(`   过期日期: ${expirationDate.toISOString().split('T')[0]}`);
console.log(`   警告期限: ${WARNING_DAYS} 天`);

// 显示状态
console.log('\n⏰ 当前状态：');
console.log(`   当前日期: ${now.toISOString().split('T')[0]}`);
console.log(`   系统状态: ${isExpired ? '❌ 已过期' : '✅ 正常运行'}`);

if (!isExpired) {
  console.log(`   剩余天数: ${daysRemaining} 天`);
  
  if (daysRemaining <= WARNING_DAYS) {
    console.log(`   ⚠️  警告: 即将在 ${daysRemaining} 天后过期！`);
  } else {
    console.log(`   ✓ 状态良好`);
  }
} else {
  console.log(`   ⚠️  已过期 ${Math.abs(daysRemaining)} 天`);
}

// Unity 配置检查
console.log('\n🎮 Unity 配置文件：');
const unityFile = '../../../Assets/Scripts/Security/CommunicationSecurityManager.cs';
const fs = await import('fs');
const path = await import('path');
const { fileURLToPath } = await import('url');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const unityPath = path.resolve(__dirname, unityFile);

if (fs.existsSync(unityPath)) {
  console.log('   ✓ Unity 安全管理器已创建');
  console.log(`   位置: Assets/Scripts/Security/CommunicationSecurityManager.cs`);
} else {
  console.log('   ⚠️  Unity 安全管理器文件不存在');
}

// 前端配置检查
console.log('\n🌐 前端配置文件：');
const tsFiles = [
  'communication-security.ts',
  'security-config.ts',
  'security-example.ts',
];

for (const file of tsFiles) {
  const filePath = path.resolve(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(`   ✓ ${file}`);
  } else {
    console.log(`   ✗ ${file} (不存在)`);
  }
}

// 文档检查
console.log('\n📖 文档文件：');
const docs = [
  '../../../Docs/通信加密与时间限制说明.md',
  '../../../Docs/快速开始-安全配置.md',
  '../../../Docs/安全保护实施总结.md',
  '../../../Docs/安全保护测试指南.md',
];

for (const doc of docs) {
  const docPath = path.resolve(__dirname, doc);
  if (fs.existsSync(docPath)) {
    const name = path.basename(doc);
    console.log(`   ✓ ${name}`);
  }
}

// 使用建议
console.log('\n💡 使用建议：');
console.log('   1. 查看详细文档: Docs/快速开始-安全配置.md');
console.log('   2. 运行测试: Docs/安全保护测试指南.md');
console.log('   3. 修改配置: node configure-security.js --days 90');

// 测试场景
console.log('\n🧪 常见测试场景：');
console.log('   演示版 (30天):  node configure-security.js --days 30');
console.log('   开发版 (90天):  node configure-security.js --days 90');
console.log('   试用版 (180天): node configure-security.js --days 180');
console.log('   正式版 (永久):  注释代码中的过期检查');

// 下一步操作
console.log('\n📋 下一步操作：');
if (isExpired) {
  console.log('   1. 系统已过期，需要修改配置');
  console.log('   2. 运行: node configure-security.js --days 180');
  console.log('   3. 重新编译 Unity 和前端项目');
} else if (daysRemaining <= WARNING_DAYS) {
  console.log('   ⚠️  即将过期，建议延长试用期');
  console.log('   运行: node configure-security.js --days 90');
} else {
  console.log('   ✓ 配置正常，可以开始测试');
  console.log('   1. Unity: 打开编辑器，添加 SecurityTestRunner 组件');
  console.log('   2. 前端: npm run test (运行单元测试)');
  console.log('   3. 集成: 测试过期行为和通信加密');
}

console.log('\n====================================');
console.log('✅ 演示完成');
console.log('====================================\n');

// 保护机制说明
console.log('🛡️  保护机制说明：');
console.log('   ✓ 时间锁定 - 硬编码过期日期');
console.log('   ✓ 防时间回拨 - 记录上次运行时间');
console.log('   ✓ 双端检查 - Unity 和前端同步验证');
console.log('   ✓ 消息加密 - AES-256-CBC (可选)');
console.log('   ✓ 多点拦截 - 启动、接收、发送时检查');

console.log('\n⚠️  重要提示：');
console.log('   - 此方案能防止普通用户随意使用');
console.log('   - 无法防止专业破解和内存修改');
console.log('   - 建议配合商业合同和分期付款');
console.log('   - 主要依靠客户信任和法律保护\n');
