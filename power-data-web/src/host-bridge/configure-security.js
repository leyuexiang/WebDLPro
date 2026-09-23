#!/usr/bin/env node

/**
 * 安全配置快速设置工具
 * 
 * 使用方法：
 *   node configure-security.js --days 90
 *   node configure-security.js --date 2024-12-31
 *   node configure-security.js --show
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置文件路径
const CONFIG_FILE = path.join(__dirname, 'security-config.ts');
const UNITY_FILE = path.join(__dirname, '../../Assets/Scripts/Security/CommunicationSecurityManager.cs');

// 解析命令行参数
const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].substring(2);
    const value = args[i + 1];
    options[key] = value;
    i++;
  }
}

// 显示当前配置
function showCurrentConfig() {
  try {
    const configContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
    
    // 提取配置值
    const baseDateMatch = configContent.match(/BASE_DATE:\s*'([^']+)'/);
    const trialDaysMatch = configContent.match(/TRIAL_DAYS:\s*(\d+)/);
    const encryptionMatch = configContent.match(/ENABLE_ENCRYPTION:\s*(true|false)/);
    
    if (baseDateMatch && trialDaysMatch) {
      const baseDate = new Date(baseDateMatch[1]);
      const trialDays = parseInt(trialDaysMatch[1]);
      const expirationDate = new Date(baseDate.getTime() + trialDays * 24 * 60 * 60 * 1000);
      
      console.log('====================================');
      console.log('当前安全配置');
      console.log('====================================');
      console.log('基准日期:', baseDateMatch[1]);
      console.log('试用天数:', trialDays);
      console.log('过期日期:', expirationDate.toISOString().split('T')[0]);
      console.log('消息加密:', encryptionMatch ? encryptionMatch[1] : 'false');
      
      const now = new Date();
      const daysRemaining = Math.floor((expirationDate - now) / (24 * 60 * 60 * 1000));
      if (daysRemaining > 0) {
        console.log('剩余天数:', daysRemaining);
      } else {
        console.log('状态: 已过期');
      }
      console.log('====================================');
    }
  } catch (error) {
    console.error('读取配置失败:', error.message);
  }
}

// 更新配置文件
function updateConfig(baseDate, trialDays) {
  try {
    let configContent = fs.readFileSync(CONFIG_FILE, 'utf-8');
    
    // 更新 BASE_DATE
    if (baseDate) {
      configContent = configContent.replace(
        /BASE_DATE:\s*'[^']+'/,
        `BASE_DATE: '${baseDate}'`
      );
    }
    
    // 更新 TRIAL_DAYS
    if (trialDays) {
      configContent = configContent.replace(
        /TRIAL_DAYS:\s*\d+/,
        `TRIAL_DAYS: ${trialDays}`
      );
    }
    
    fs.writeFileSync(CONFIG_FILE, configContent, 'utf-8');
    console.log('✓ 前端配置已更新:', CONFIG_FILE);
    
    return true;
  } catch (error) {
    console.error('✗ 更新前端配置失败:', error.message);
    return false;
  }
}

// 更新 Unity 配置文件
function updateUnityConfig(baseDate, trialDays) {
  try {
    if (!fs.existsSync(UNITY_FILE)) {
      console.warn('⚠ Unity 配置文件不存在，跳过更新:', UNITY_FILE);
      return false;
    }
    
    let unityContent = fs.readFileSync(UNITY_FILE, 'utf-8');
    
    // 解析日期
    const date = new Date(baseDate);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    // 更新基准日期
    if (baseDate) {
      unityContent = unityContent.replace(
        /DateTime baseDate = new DateTime\(\d+,\s*\d+,\s*\d+\);/,
        `DateTime baseDate = new DateTime(${year}, ${month}, ${day});`
      );
    }
    
    // 更新试用天数
    if (trialDays) {
      unityContent = unityContent.replace(
        /int obfuscatedDays = \d+;/,
        `int obfuscatedDays = ${trialDays};`
      );
    }
    
    fs.writeFileSync(UNITY_FILE, unityContent, 'utf-8');
    console.log('✓ Unity 配置已更新:', UNITY_FILE);
    
    return true;
  } catch (error) {
    console.error('✗ 更新 Unity 配置失败:', error.message);
    return false;
  }
}

// 主逻辑
function main() {
  if (options.show || Object.keys(options).length === 0) {
    showCurrentConfig();
    return;
  }
  
  let baseDate = null;
  let trialDays = null;
  
  // 通过天数设置
  if (options.days) {
    trialDays = parseInt(options.days);
    if (isNaN(trialDays) || trialDays <= 0) {
      console.error('错误：试用天数必须是正整数');
      return;
    }
    
    // 默认从今天开始
    baseDate = new Date().toISOString().split('T')[0];
  }
  
  // 通过过期日期设置
  if (options.date) {
    const expirationDate = new Date(options.date);
    if (isNaN(expirationDate.getTime())) {
      console.error('错误：无效的日期格式，请使用 YYYY-MM-DD');
      return;
    }
    
    // 计算从今天到过期日期的天数
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    baseDate = now.toISOString().split('T')[0];
    trialDays = Math.ceil((expirationDate - now) / (24 * 60 * 60 * 1000));
    
    if (trialDays <= 0) {
      console.error('错误：过期日期必须在未来');
      return;
    }
  }
  
  // 直接设置基准日期（高级用法）
  if (options.base) {
    const date = new Date(options.base);
    if (isNaN(date.getTime())) {
      console.error('错误：无效的基准日期格式，请使用 YYYY-MM-DD');
      return;
    }
    baseDate = options.base;
  }
  
  // 执行更新
  console.log('\n开始更新配置...\n');
  
  const frontendSuccess = updateConfig(baseDate, trialDays);
  const unitySuccess = updateUnityConfig(baseDate, trialDays);
  
  console.log('\n====================================');
  if (frontendSuccess || unitySuccess) {
    console.log('配置更新完成！');
    console.log('\n新配置：');
    if (baseDate) console.log('基准日期:', baseDate);
    if (trialDays) console.log('试用天数:', trialDays);
    
    if (baseDate && trialDays) {
      const expDate = new Date(new Date(baseDate).getTime() + trialDays * 24 * 60 * 60 * 1000);
      console.log('过期日期:', expDate.toISOString().split('T')[0]);
    }
    
    console.log('\n⚠ 重要提示：');
    console.log('1. 需要重新编译 Unity 项目');
    console.log('2. 需要重新构建前端项目');
    console.log('3. 确保 Unity 和前端配置保持一致');
  } else {
    console.log('配置更新失败，请检查错误信息。');
  }
  console.log('====================================\n');
}

// 显示帮助
if (options.help || options.h) {
  console.log(`
安全配置快速设置工具

用法：
  node configure-security.js [选项]

选项：
  --show              显示当前配置
  --days <天数>       设置试用天数（从今天开始）
  --date <日期>       设置过期日期（格式：YYYY-MM-DD）
  --base <日期>       设置基准日期（格式：YYYY-MM-DD）
  --help, -h          显示此帮助信息

示例：
  # 显示当前配置
  node configure-security.js --show

  # 设置90天试用期（从今天开始）
  node configure-security.js --days 90

  # 设置到2024年12月31日过期
  node configure-security.js --date 2024-12-31

  # 设置从2024年1月1日开始，180天试用期
  node configure-security.js --base 2024-01-01 --days 180
`);
  process.exit(0);
}

main();
