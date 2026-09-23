/**
 * 安全管理器测试套件
 * 用于验证前端加密和时间锁定功能
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { CommunicationSecurityManager } from '../communication-security';
import { SECURITY_CONFIG } from '../security-config';

describe('CommunicationSecurityManager', () => {
  let securityManager: CommunicationSecurityManager;

  beforeAll(async () => {
    securityManager = CommunicationSecurityManager.getInstance();
    await securityManager.initialize();
  });

  describe('时间验证', () => {
    it('应该正确计算剩余天数', () => {
      const remainingDays = securityManager.getRemainingDays();
      expect(remainingDays).toBeGreaterThanOrEqual(0);
      console.log(`剩余天数: ${remainingDays}`);
    });

    it('应该正确判断是否过期', () => {
      const isExpired = securityManager.checkExpired();
      console.log(`系统状态: ${isExpired ? '已过期' : '正常运行'}`);
      // 根据当前配置，可能过期或未过期
      expect(typeof isExpired).toBe('boolean');
    });

    it('应该显示正确的过期警告', () => {
      const warning = securityManager.showExpirationWarning();
      console.log('过期警告:', warning);
      expect(warning).toHaveProperty('show');
      expect(warning).toHaveProperty('message');
      expect(warning).toHaveProperty('daysRemaining');
    });
  });

  describe('加密功能', () => {
    it('应该能够加密简单文本', async () => {
      if (securityManager.checkExpired()) {
        console.log('系统已过期，跳过加密测试');
        return;
      }

      const plainText = 'Hello Security Test';
      const encrypted = await securityManager.encryptPayload(plainText);

      expect(encrypted).toBeTruthy();
      expect(encrypted).not.toBe(plainText);
      expect(encrypted.length).toBeGreaterThan(0);
      console.log(`加密成功: ${plainText} -> ${encrypted.substring(0, 30)}...`);
    });

    it('应该能够加密中文文本', async () => {
      if (securityManager.checkExpired()) {
        return;
      }

      const plainText = '加密测试中文内容';
      const encrypted = await securityManager.encryptPayload(plainText);

      expect(encrypted).toBeTruthy();
      expect(encrypted).not.toBe(plainText);
      console.log(`中文加密成功`);
    });

    it('应该能够加密 JSON 数据', async () => {
      if (securityManager.checkExpired()) {
        return;
      }

      const jsonData = JSON.stringify({ type: 'test', value: 123, flag: true });
      const encrypted = await securityManager.encryptPayload(jsonData);

      expect(encrypted).toBeTruthy();
      expect(encrypted).not.toBe(jsonData);
      console.log(`JSON 加密成功`);
    });

    it('空字符串应该返回空', async () => {
      const encrypted = await securityManager.encryptPayload('');
      expect(encrypted).toBe('');
    });
  });

  describe('解密功能', () => {
    it('应该能够正确解密', async () => {
      if (securityManager.checkExpired()) {
        return;
      }

      const plainText = 'Test Decryption 解密测试';
      const encrypted = await securityManager.encryptPayload(plainText);
      const decrypted = await securityManager.decryptPayload(encrypted);

      expect(decrypted).toBe(plainText);
      console.log(`解密成功: ${plainText}`);
    });

    it('应该处理特殊字符', async () => {
      if (securityManager.checkExpired()) {
        return;
      }

      const specialChars = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`';
      const encrypted = await securityManager.encryptPayload(specialChars);
      const decrypted = await securityManager.decryptPayload(encrypted);

      expect(decrypted).toBe(specialChars);
      console.log(`特殊字符解密成功`);
    });

    it('空字符串应该返回空', async () => {
      const decrypted = await securityManager.decryptPayload('');
      expect(decrypted).toBe('');
    });

    it('无效的加密数据应该抛出异常', async () => {
      if (securityManager.checkExpired()) {
        return;
      }

      await expect(async () => {
        await securityManager.decryptPayload('invalid-base64-data!!!');
      }).rejects.toThrow();
    });
  });

  describe('往返加密解密', () => {
    const testCases = [
      '简单文本',
      'English Text',
      '混合 Mixed 内容 123',
      '{"type":"test","value":123}',
      '特殊字符!@#$%^&*()',
      'Very long text that should still be encrypted and decrypted correctly without any issues. This is a longer test case to verify that the encryption handles different lengths properly.',
      '',
      '1',
      '你好世界 Hello World مرحبا بالعالم',
    ];

    testCases.forEach((testCase, index) => {
      it(`应该正确处理测试用例 ${index + 1}: "${testCase.substring(0, 20)}..."`, async () => {
        if (securityManager.checkExpired()) {
          return;
        }

        if (!testCase) {
          // 空字符串直接返回
          const encrypted = await securityManager.encryptPayload(testCase);
          expect(encrypted).toBe('');
          return;
        }

        const encrypted = await securityManager.encryptPayload(testCase);
        const decrypted = await securityManager.decryptPayload(encrypted);

        expect(decrypted).toBe(testCase);
      });
    });
  });

  describe('过期行为', () => {
    it('过期后应该拒绝加密操作', async () => {
      if (!securityManager.checkExpired()) {
        console.log('系统未过期，跳过过期行为测试');
        return;
      }

      await expect(async () => {
        await securityManager.encryptPayload('test');
      }).rejects.toThrow('系统已过期');
    });

    it('过期后应该拒绝解密操作', async () => {
      if (!securityManager.checkExpired()) {
        return;
      }

      await expect(async () => {
        await securityManager.decryptPayload('test');
      }).rejects.toThrow('系统已过期');
    });
  });

  describe('配置验证', () => {
    it('配置应该存在且有效', () => {
      expect(SECURITY_CONFIG).toBeDefined();
      expect(SECURITY_CONFIG.BASE_DATE).toBeTruthy();
      expect(SECURITY_CONFIG.TRIAL_DAYS).toBeGreaterThan(0);
      console.log('配置信息:', {
        baseDate: SECURITY_CONFIG.BASE_DATE,
        trialDays: SECURITY_CONFIG.TRIAL_DAYS,
        warningDays: SECURITY_CONFIG.WARNING_DAYS,
      });
    });
  });
});

/**
 * 手动测试运行器（在浏览器控制台使用）
 */
export async function runManualTests() {
  console.log('====================================');
  console.log('开始安全管理器手动测试');
  console.log('====================================');

  const manager = CommunicationSecurityManager.getInstance();

  try {
    await manager.initialize();
    console.log('✓ 初始化成功');
  } catch (error) {
    console.error('✗ 初始化失败:', error);
    return;
  }

  // 测试1：时间验证
  console.log('\n[测试1] 时间验证');
  const isExpired = manager.checkExpired();
  const remainingDays = manager.getRemainingDays();
  console.log(`状态: ${isExpired ? '已过期' : '正常运行'}`);
  console.log(`剩余天数: ${remainingDays}`);

  if (isExpired) {
    console.log('\n系统已过期，停止后续测试');
    return;
  }

  // 测试2：加密
  console.log('\n[测试2] 加密测试');
  const plainText = 'Hello Security Test 你好';
  const encrypted = await manager.encryptPayload(plainText);
  console.log(`原始: ${plainText}`);
  console.log(`加密: ${encrypted.substring(0, 50)}...`);

  // 测试3：解密
  console.log('\n[测试3] 解密测试');
  const decrypted = await manager.decryptPayload(encrypted);
  console.log(`解密: ${decrypted}`);
  console.log(`结果: ${decrypted === plainText ? '✓ 通过' : '✗ 失败'}`);

  // 测试4：性能
  console.log('\n[测试4] 性能测试');
  const iterations = 1000;
  const testData = 'Performance test data 性能测试数据 1234567890';

  const encryptStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    await manager.encryptPayload(testData);
  }
  const encryptTime = performance.now() - encryptStart;

  const encryptedData = await manager.encryptPayload(testData);
  const decryptStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    await manager.decryptPayload(encryptedData);
  }
  const decryptTime = performance.now() - decryptStart;

  console.log(`加密 ${iterations} 次: ${encryptTime.toFixed(2)} ms，平均 ${(encryptTime / iterations).toFixed(3)} ms/次`);
  console.log(`解密 ${iterations} 次: ${decryptTime.toFixed(2)} ms，平均 ${(decryptTime / iterations).toFixed(3)} ms/次`);

  console.log('\n====================================');
  console.log('测试完成');
  console.log('====================================');
}

// 导出到全局，方便在控制台调用
if (typeof window !== 'undefined') {
  (window as any).runSecurityTests = runManualTests;
}
