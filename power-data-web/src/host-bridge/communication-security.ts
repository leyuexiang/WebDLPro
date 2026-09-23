import { SECURITY_CONFIG, DISPLAY_CONFIG, calculateExpirationDate } from './security-config';

/**
 * 通信安全管理器 - 前端版本
 * 与 Unity 端的 CommunicationSecurityManager 配合使用
 * 提供消息加密/解密和时间验证功能
 */

/**
 * 使用 Web Crypto API 进行 AES-CBC 加密/解密
 * 密钥和 IV 必须与 Unity 端保持一致
 */
export class CommunicationSecurityManager {
  private static instance: CommunicationSecurityManager | null = null;
  private aesKey: CryptoKey | null = null;
  private expirationDate: Date;
  private isExpired: boolean = false;

  private constructor() {
    // 从配置文件读取过期日期
    this.expirationDate = calculateExpirationDate();
    
    if (DISPLAY_CONFIG.SHOW_SECURITY_LOGS) {
      console.log(`[Security] 系统过期日期: ${this.expirationDate.toISOString().split('T')[0]}`);
    }
  }

  public static getInstance(): CommunicationSecurityManager {
    if (!CommunicationSecurityManager.instance) {
      CommunicationSecurityManager.instance = new CommunicationSecurityManager();
    }
    return CommunicationSecurityManager.instance;
  }

  /**
   * 初始化加密密钥（必须在使用前调用）
   */
  public async initialize(): Promise<void> {
    try {
      // 生成与Unity端相同的密钥
      const keyMaterial = await this.generateObfuscatedKey();
      this.aesKey = await crypto.subtle.importKey(
        'raw',
        keyMaterial,
        { name: 'AES-CBC', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );

      // 验证时间锁定
      this.validateTimeLock();
    } catch (error) {
      console.error('[Security] 初始化加密管理器失败:', error);
      throw error;
    }
  }

  /**
   * 生成混淆后的密钥（与Unity端算法一致）
   */
  /** 返回基于 ArrayBuffer 的独立字节视图，满足 Web Crypto 对 BufferSource 的类型约束。 */
  private async generateObfuscatedKey(): Promise<Uint8Array<ArrayBuffer>> {
    // 与Unity端相同的混淆计算
    const part1 = this.xorUint32(0x4b65794d, 0x12345678);
    const part2 = this.xorUint32(0x61676963, 0x87654321);
    const part3 = this.xorUint32(0x50617373, 0xabcdef01);
    const part4 = this.xorUint32(0x776f7264, 0xfedcba98);

    const combined = new Uint8Array(16);
    combined.set(this.uint32ToBytes(part1), 0);
    combined.set(this.uint32ToBytes(part2), 4);
    combined.set(this.uint32ToBytes(part3), 8);
    combined.set(this.uint32ToBytes(part4), 12);

    // 使用 PBKDF2 派生最终密钥
    const salt = new TextEncoder().encode('PowerPlant3D_2024_Security_Layer');
    const baseKey = await crypto.subtle.importKey(
      'raw',
      combined,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 10000,
        hash: 'SHA-256',
      },
      baseKey,
      256
    );

    return new Uint8Array(derivedBits);
  }

  /**
   * 生成混淆后的IV（与Unity端算法一致）
   */
  /** 初始化向量固定为普通 ArrayBuffer 视图，保持 AES-CBC 输入类型明确。 */
  private generateObfuscatedIV(): Uint8Array<ArrayBuffer> {
    const part1 = this.xorUint32(0x49564d61, 0x11111111);
    const part2 = this.xorUint32(0x67696353, 0x22222222);
    const part3 = this.xorUint32(0x65637572, 0x33333333);
    const part4 = this.xorUint32(0x65313233, 0x44444444);

    const iv = new Uint8Array(16);
    iv.set(this.uint32ToBytes(part1), 0);
    iv.set(this.uint32ToBytes(part2), 4);
    iv.set(this.uint32ToBytes(part3), 8);
    iv.set(this.uint32ToBytes(part4), 12);

    return iv;
  }

  /**
   * 验证时间锁定
   */
  private validateTimeLock(): void {
    const now = new Date();

    if (now > this.expirationDate) {
      this.isExpired = true;
      if (DISPLAY_CONFIG.SHOW_SECURITY_LOGS) {
        console.error(`[Security] ${DISPLAY_CONFIG.EXPIRATION_MESSAGE}`);
        console.error(`[Security] 联系方式: ${DISPLAY_CONFIG.VENDOR_CONTACT.email}`);
      }
      return;
    }

    // 防止时间回拨（如果启用）
    if (SECURITY_CONFIG.ENABLE_TIME_ROLLBACK_DETECTION) {
      const lastRunKey = 'LastSystemRun_WebFrontend';
      const lastRunStr = localStorage.getItem(lastRunKey);
      if (lastRunStr) {
        const lastRun = new Date(lastRunStr);
        const toleranceMs = SECURITY_CONFIG.TIME_ROLLBACK_TOLERANCE_DAYS * 24 * 60 * 60 * 1000;
        if (now.getTime() < lastRun.getTime() - toleranceMs) {
          this.isExpired = true;
          if (DISPLAY_CONFIG.SHOW_SECURITY_LOGS) {
            console.error('[Security] 检测到系统时间异常，请恢复正确的系统时间。');
          }
          return;
        }
      }
      
      // 记录本次运行时间
      localStorage.setItem(lastRunKey, now.toISOString());
    }

    // 警告即将过期
    const daysRemaining = Math.floor(
      (this.expirationDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
    );
    if (daysRemaining <= SECURITY_CONFIG.WARNING_DAYS && daysRemaining > 0) {
      if (DISPLAY_CONFIG.SHOW_SECURITY_LOGS) {
        const message = DISPLAY_CONFIG.WARNING_MESSAGE_TEMPLATE.replace('{days}', daysRemaining.toString());
        console.warn(`[Security] ${message}`);
      }
    }
  }

  /**
   * 检查是否已过期
   */
  public checkExpired(): boolean {
    this.validateTimeLock();
    return this.isExpired;
  }

  /**
   * 获取剩余天数
   */
  public getRemainingDays(): number {
    if (this.isExpired) return 0;
    const now = new Date();
    return Math.max(
      0,
      Math.floor((this.expirationDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    );
  }

  /**
   * 加密消息负载
   */
  public async encryptPayload(plainText: string): Promise<string> {
    if (!plainText) {
      return plainText;
    }

    if (this.isExpired) {
      throw new Error('系统已过期，无法加密消息。');
    }

    if (!this.aesKey) {
      throw new Error('加密密钥未初始化，请先调用 initialize()');
    }

    try {
      const iv = this.generateObfuscatedIV();
      const encoder = new TextEncoder();
      const data = encoder.encode(plainText);

      const encryptedData = await crypto.subtle.encrypt(
        {
          name: 'AES-CBC',
          iv: iv,
        },
        this.aesKey,
        data
      );

      // 转换为 Base64
      return this.arrayBufferToBase64(encryptedData);
    } catch (error) {
      console.error('[Security] 加密失败:', error);
      throw error;
    }
  }

  /**
   * 解密消息负载
   */
  public async decryptPayload(cipherText: string): Promise<string> {
    if (!cipherText) {
      return cipherText;
    }

    if (this.isExpired) {
      throw new Error('系统已过期，无法解密消息。');
    }

    if (!this.aesKey) {
      throw new Error('加密密钥未初始化，请先调用 initialize()');
    }

    try {
      const iv = this.generateObfuscatedIV();
      const encryptedData = this.base64ToArrayBuffer(cipherText);

      const decryptedData = await crypto.subtle.decrypt(
        {
          name: 'AES-CBC',
          iv: iv,
        },
        this.aesKey,
        encryptedData
      );

      const decoder = new TextDecoder();
      return decoder.decode(decryptedData);
    } catch (error) {
      console.error('[Security] 解密失败:', error);
      throw error;
    }
  }

  // ========== 工具方法 ==========

  private xorUint32(a: number, b: number): number {
    return (a ^ b) >>> 0; // 无符号右移确保结果为正数
  }

  /** 从新建的 ArrayBuffer 生成 4 字节小端序视图，供密钥和初始化向量拼接。 */
  private uint32ToBytes(value: number): Uint8Array<ArrayBuffer> {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint32(0, value, true); // little-endian
    return new Uint8Array(buffer);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * 显示过期警告（用于UI提示）
   */
  public showExpirationWarning(): { 
    show: boolean; 
    message: string; 
    daysRemaining: number;
    vendorContact?: typeof DISPLAY_CONFIG.VENDOR_CONTACT;
  } {
    if (!DISPLAY_CONFIG.SHOW_EXPIRATION_WARNING_UI) {
      return { show: false, message: '', daysRemaining: this.getRemainingDays() };
    }

    const daysRemaining = this.getRemainingDays();
    if (this.isExpired) {
      return {
        show: true,
        message: DISPLAY_CONFIG.EXPIRATION_MESSAGE,
        daysRemaining: 0,
        vendorContact: DISPLAY_CONFIG.VENDOR_CONTACT,
      };
    }
    if (daysRemaining <= SECURITY_CONFIG.WARNING_DAYS) {
      const message = DISPLAY_CONFIG.WARNING_MESSAGE_TEMPLATE.replace('{days}', daysRemaining.toString());
      return {
        show: true,
        message,
        daysRemaining,
        vendorContact: DISPLAY_CONFIG.VENDOR_CONTACT,
      };
    }
    return {
      show: false,
      message: '',
      daysRemaining,
    };
  }
}

/**
 * 便捷导出的单例实例
 */
export const securityManager = CommunicationSecurityManager.getInstance();
