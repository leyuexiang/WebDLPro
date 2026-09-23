/**
 * 安全功能快速演示脚本
 * 运行: node demo-security.js
 */

import { SECURITY_CONFIG, calculateExpirationDate, formatExpirationDate } from './security-config.js';

console.log('\n====================================');
console.log('安全保护配置演示');
console.log('====================================\n');

// 显示配置
console.log('📋 当前配置：');
console.log(`   基准日期: ${SECURITY_CONFIG.BASE_DATE}`);
console.log(`   试用天数: ${SECURITY_CONFIG.TRIAL_DAYS}`);
console.log(`   过期日期: ${formatExpirationDate()}`);
console.log(`   警告天数: ${SECURITY_CONFIG.WARNING_DAYS}`);
console.log(`   防回拨: ${SECURITY_CONFIG.ENABLE_TIME_ROLLBACK_DETECTION ? '启用' : '禁用'}`);

// 计算状态
const now = new Date();
const expirationDate = calculateExpirationDate();
const daysRemaining = Math.floor((expirationDate - now) / (24 * 60 * 60 * 1000));
const isExpired = now > expirationDate;

console.log('\n⏰ 当前状态：');
console.log(`   当前日期: ${now.toISOString().split('T')[0]}`);
console.log(`   系统状态: ${isExpired ? '❌ 已过期' : '✅ 正常运行'}`);

if (!isExpired) {
  console.log(`   剩余天数: ${daysRemaining} 天`);
  
  if (daysRemaining <= SECURITY_CONFIG.WARNING_DAYS) {
    console.log(`   ⚠️  警告: 即将在 ${daysRemaining} 天后过期！`);
  } else {
    console.log(`   状态良好，距离过期还有 ${daysRemaining} 天`);
  }
}

console.log('\n🔐 加密配置：');
console.log(`   加密功能: ${SECURITY_CONFIG.ENABLE_ENCRYPTION ? '启用' : '禁用'}`);
console.log(`   加密算法: AES-256-CBC`);

console.log('\n💡 快速修改配置：');
console.log('   node configure-security.js --days 90    # 设置90天试用期');
console.log('   node configure-security.js --date 2024-12-31  # 设置到指定日期过期');

console.log('\n====================================\n');

// 测试加密功能（如果未过期）
if (!isExpired) {
  console.log('🧪 开始加密功能测试...\n');
  
  // 动态导入安全管理器
  import('./communication-security.js').then(async ({ securityManager }) => {
    try {
      await securityManager.initialize();
      console.log('✓ 安全管理器初始化成功');
      
      // 测试加密
      const testText = 'Hello Security Test 你好世界 123';
      console.log(`\n测试文本: "${testText}"`);
      
      const encrypted = await securityManager.encryptPayload(testText);
      console.log(`加密结果: ${encrypted.substring(0, 50)}...`);
      
      const decrypted = await securityManager.decryptPayload(encrypted);
      console.log(`解密结果: "${decrypted}"`);
      
      if (decrypted === testText) {
        console.log('\n✓ 加密解密测试通过！');
      } else {
        console.log('\n✗ 加密解密测试失败！');
      }
      
      // 性能测试
      console.log('\n⚡ 性能测试 (100次)...');
      const iterations = 100;
      
      const encryptStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        await securityManager.encryptPayload(testText);
      }
      const encryptTime = performance.now() - encryptStart;
      
      const decryptStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        await securityManager.decryptPayload(encrypted);
      }
      const decryptTime = performance.now() - decryptStart;
      
      console.log(`加密: ${encryptTime.toFixed(2)} ms (平均 ${(encryptTime / iterations).toFixed(3)} ms/次)`);
      console.log(`解密: ${decryptTime.toFixed(2)} ms (平均 ${(decryptTime / iterations).toFixed(3)} ms/次)`);
      
      console.log('\n====================================');
      console.log('✅ 所有测试完成！');
      console.log('====================================\n');
      
    } catch (error) {
      console.error('\n✗ 测试失败:', error.message);
    }
  }).catch(error => {
    console.error('✗ 加载安全管理器失败:', error.message);
  });
} else {
  console.log('⚠️  系统已过期，跳过加密测试\n');
}
