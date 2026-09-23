/**
 * 安全管理器使用示例
 * 展示如何在实际项目中集成安全保护
 */

import { onMounted, ref } from 'vue';
import { securityManager } from './communication-security';
import { DISPLAY_CONFIG } from './security-config';

/**
 * 安全初始化 Composable
 * 在应用启动时调用
 */
export function useSecurityInit() {
  const isExpired = ref(false);
  const showWarning = ref(false);
  const warningMessage = ref('');
  const daysRemaining = ref(0);
  const vendorContact = ref(DISPLAY_CONFIG.VENDOR_CONTACT);

  const initializeSecurity = async () => {
    try {
      // 初始化加密管理器
      await securityManager.initialize();

      // 检查是否过期
      if (securityManager.checkExpired()) {
        isExpired.value = true;
        const warning = securityManager.showExpirationWarning();
        showWarning.value = warning.show;
        warningMessage.value = warning.message;
        return false;
      }

      // 检查是否需要显示警告
      const warning = securityManager.showExpirationWarning();
      if (warning.show) {
        showWarning.value = true;
        warningMessage.value = warning.message;
        daysRemaining.value = warning.daysRemaining;
      }

      return true;
    } catch (error) {
      console.error('[Security] 初始化失败:', error);
      return false;
    }
  };

  return {
    isExpired,
    showWarning,
    warningMessage,
    daysRemaining,
    vendorContact,
    initializeSecurity,
  };
}

/**
 * 在 App.vue 中使用示例
 * 
 * <template>
 *   <div v-if="isExpired" class="expired-overlay">
 *     <div class="expired-message">
 *       <h1>系统已过期</h1>
 *       <p>{{ warningMessage }}</p>
 *       <div class="contact-info">
 *         <p>联系方式：</p>
 *         <p>邮箱：{{ vendorContact.email }}</p>
 *         <p>电话：{{ vendorContact.phone }}</p>
 *       </div>
 *     </div>
 *   </div>
 *   
 *   <div v-else-if="showWarning" class="warning-banner">
 *     <span>⚠️ {{ warningMessage }}</span>
 *     <button @click="showWarning = false">知道了</button>
 *   </div>
 *   
 *   <router-view v-if="!isExpired" />
 * </template>
 * 
 * <script setup lang="ts">
 * import { onMounted } from 'vue';
 * import { useSecurityInit } from '@/host-bridge/security-example';
 * 
 * const { 
 *   isExpired, 
 *   showWarning, 
 *   warningMessage, 
 *   vendorContact,
 *   initializeSecurity 
 * } = useSecurityInit();
 * 
 * onMounted(async () => {
 *   const success = await initializeSecurity();
 *   if (!success) {
 *     console.error('安全初始化失败');
 *   }
 * });
 * </script>
 * 
 * <style scoped>
 * .expired-overlay {
 *   position: fixed;
 *   top: 0;
 *   left: 0;
 *   right: 0;
 *   bottom: 0;
 *   background: rgba(0, 0, 0, 0.9);
 *   display: flex;
 *   align-items: center;
 *   justify-content: center;
 *   z-index: 9999;
 * }
 * 
 * .expired-message {
 *   background: white;
 *   padding: 40px;
 *   border-radius: 8px;
 *   text-align: center;
 *   max-width: 500px;
 * }
 * 
 * .warning-banner {
 *   position: fixed;
 *   top: 0;
 *   left: 0;
 *   right: 0;
 *   background: #ff9800;
 *   color: white;
 *   padding: 12px 20px;
 *   display: flex;
 *   align-items: center;
 *   justify-content: space-between;
 *   z-index: 1000;
 * }
 * </style>
 */

/**
 * 在发送消息时使用加密（可选）
 */
export async function sendSecureMessage(
  iframe: HTMLIFrameElement,
  targetOrigin: string,
  messageType: string,
  payload: any
) {
  // 检查是否过期
  if (securityManager.checkExpired()) {
    throw new Error('系统已过期，无法发送消息');
  }

  // 构建消息
  const message = {
    channel: 'power-3d-unity-bridge',
    version: 1,
    instanceId: 'your-instance-id',
    messageId: `${Date.now()}-${Math.random().toString(36).substring(2)}`,
    type: messageType,
    payload: payload,
    timestamp: Date.now(),
  };

  // 发送（如果需要加密，可以在这里处理）
  iframe.contentWindow?.postMessage(message, targetOrigin);
}

/**
 * 定期检查过期状态（可选）
 * 在长时间运行的应用中定期检查
 */
export function usePeriodicSecurityCheck(intervalMinutes: number = 10) {
  let timer: number | null = null;

  const startChecking = () => {
    timer = window.setInterval(() => {
      if (securityManager.checkExpired()) {
        console.error('[Security] 系统在运行期间过期');
        // 可以触发全局事件或强制刷新页面
        window.location.reload();
      }
    }, intervalMinutes * 60 * 1000);
  };

  const stopChecking = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  onMounted(() => {
    startChecking();
  });

  return {
    startChecking,
    stopChecking,
  };
}
