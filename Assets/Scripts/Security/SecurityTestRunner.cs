using System;
using UnityEngine;
using WebDLPro.Unity.Security;

namespace WebDLPro.Unity.Testing
{
    /// <summary>
    /// 安全管理器测试运行器
    /// 用于验证时间锁定和加密功能是否正常工作
    /// </summary>
    public class SecurityTestRunner : MonoBehaviour
    {
        [Header("测试控制")]
        [SerializeField] private bool runTestsOnStart = true;
        [SerializeField] private bool showDetailedLogs = true;

        private void Start()
        {
            if (runTestsOnStart)
            {
                RunAllTests();
            }
        }

        /// <summary>运行所有测试</summary>
        [ContextMenu("运行所有测试")]
        public void RunAllTests()
        {
            Debug.Log("====================================");
            Debug.Log("开始安全管理器测试");
            Debug.Log("====================================");

            TestTimeValidation();
            TestEncryption();
            TestDecryption();
            TestRoundTrip();
            TestExpiredBehavior();

            Debug.Log("====================================");
            Debug.Log("测试完成");
            Debug.Log("====================================");
        }

        /// <summary>测试1：时间验证</summary>
        [ContextMenu("测试 - 时间验证")]
        public void TestTimeValidation()
        {
            Debug.Log("\n[测试1] 时间验证测试");

            try
            {
                bool isExpired = CommunicationSecurityManager.Instance.IsExpired();
                int remainingDays = CommunicationSecurityManager.Instance.GetRemainingDays();

                if (isExpired)
                {
                    Debug.LogWarning($"✗ 系统已过期");
                }
                else
                {
                    Debug.Log($"✓ 系统正常运行，剩余 {remainingDays} 天");
                }

                if (remainingDays <= 7 && remainingDays > 0)
                {
                    Debug.LogWarning($"⚠ 即将过期警告：剩余 {remainingDays} 天");
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"✗ 时间验证测试失败：{ex.Message}");
            }
        }

        /// <summary>测试2：加密功能</summary>
        [ContextMenu("测试 - 加密功能")]
        public void TestEncryption()
        {
            Debug.Log("\n[测试2] 加密功能测试");

            try
            {
                string plainText = "Hello Unity Security Test 123!";
                Debug.Log($"原始文本：{plainText}");

                string encrypted = CommunicationSecurityManager.Instance.EncryptPayload(plainText);
                Debug.Log($"加密结果：{encrypted.Substring(0, Math.Min(50, encrypted.Length))}...");

                if (!string.IsNullOrEmpty(encrypted) && encrypted != plainText)
                {
                    Debug.Log("✓ 加密成功");
                }
                else
                {
                    Debug.LogError("✗ 加密失败");
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"✗ 加密测试失败：{ex.Message}");
            }
        }

        /// <summary>测试3：解密功能</summary>
        [ContextMenu("测试 - 解密功能")]
        public void TestDecryption()
        {
            Debug.Log("\n[测试3] 解密功能测试");

            try
            {
                string plainText = "Test Decryption 解密测试 456";
                string encrypted = CommunicationSecurityManager.Instance.EncryptPayload(plainText);
                string decrypted = CommunicationSecurityManager.Instance.DecryptPayload(encrypted);

                Debug.Log($"原始文本：{plainText}");
                Debug.Log($"解密文本：{decrypted}");

                if (decrypted == plainText)
                {
                    Debug.Log("✓ 解密成功，内容一致");
                }
                else
                {
                    Debug.LogError("✗ 解密失败，内容不一致");
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"✗ 解密测试失败：{ex.Message}");
            }
        }

        /// <summary>测试4：往返加密解密</summary>
        [ContextMenu("测试 - 往返加密解密")]
        public void TestRoundTrip()
        {
            Debug.Log("\n[测试4] 往返加密解密测试");

            string[] testCases = new[]
            {
                "简单文本",
                "English Text",
                "混合 Mixed 内容 123",
                "{\"type\":\"test\",\"value\":123}",
                "特殊字符!@#$%^&*()",
            };

            int passed = 0;
            int failed = 0;

            foreach (string testCase in testCases)
            {
                try
                {
                    string encrypted = CommunicationSecurityManager.Instance.EncryptPayload(testCase);
                    string decrypted = CommunicationSecurityManager.Instance.DecryptPayload(encrypted);

                    if (decrypted == testCase)
                    {
                        Debug.Log($"✓ 通过：{testCase}");
                        passed++;
                    }
                    else
                    {
                        Debug.LogError($"✗ 失败：{testCase}");
                        failed++;
                    }
                }
                catch (Exception ex)
                {
                    Debug.LogError($"✗ 异常：{testCase} - {ex.Message}");
                    failed++;
                }
            }

            Debug.Log($"\n测试结果：通过 {passed}/{testCases.Length}，失败 {failed}/{testCases.Length}");
        }

        /// <summary>测试5：过期行为（模拟）</summary>
        [ContextMenu("测试 - 过期行为")]
        public void TestExpiredBehavior()
        {
            Debug.Log("\n[测试5] 过期行为测试");

            try
            {
                bool isExpired = CommunicationSecurityManager.Instance.IsExpired();

                if (isExpired)
                {
                    Debug.Log("系统当前处于过期状态，测试拒绝行为...");

                    try
                    {
                        string encrypted = CommunicationSecurityManager.Instance.EncryptPayload("test");
                        Debug.LogError("✗ 过期后仍然可以加密（应该抛出异常）");
                    }
                    catch (InvalidOperationException)
                    {
                        Debug.Log("✓ 过期后正确拒绝加密操作");
                    }

                    try
                    {
                        string decrypted = CommunicationSecurityManager.Instance.DecryptPayload("test");
                        Debug.LogError("✗ 过期后仍然可以解密（应该抛出异常）");
                    }
                    catch (InvalidOperationException)
                    {
                        Debug.Log("✓ 过期后正确拒绝解密操作");
                    }
                }
                else
                {
                    Debug.Log("系统未过期，跳过过期行为测试");
                    Debug.Log("提示：要测试过期行为，请修改系统时间到过期日期之后");
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"✗ 过期行为测试失败：{ex.Message}");
            }
        }

        /// <summary>性能测试</summary>
        [ContextMenu("测试 - 性能测试")]
        public void TestPerformance()
        {
            Debug.Log("\n[性能测试] 加密解密性能");

            const int iterations = 1000;
            string testData = "Performance test data 性能测试数据 1234567890";

            try
            {
                // 加密性能
                var encryptStart = DateTime.Now;
                for (int i = 0; i < iterations; i++)
                {
                    CommunicationSecurityManager.Instance.EncryptPayload(testData);
                }
                var encryptTime = (DateTime.Now - encryptStart).TotalMilliseconds;

                // 解密性能
                string encrypted = CommunicationSecurityManager.Instance.EncryptPayload(testData);
                var decryptStart = DateTime.Now;
                for (int i = 0; i < iterations; i++)
                {
                    CommunicationSecurityManager.Instance.DecryptPayload(encrypted);
                }
                var decryptTime = (DateTime.Now - decryptStart).TotalMilliseconds;

                Debug.Log($"加密 {iterations} 次：{encryptTime:F2} ms，平均 {encryptTime / iterations:F3} ms/次");
                Debug.Log($"解密 {iterations} 次：{decryptTime:F2} ms，平均 {decryptTime / iterations:F3} ms/次");

                if (encryptTime / iterations < 1.0 && decryptTime / iterations < 1.0)
                {
                    Debug.Log("✓ 性能测试通过（平均每次 < 1ms）");
                }
                else
                {
                    Debug.LogWarning("⚠ 性能较慢，考虑优化或减少加密频率");
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"✗ 性能测试失败：{ex.Message}");
            }
        }

        /// <summary>显示配置信息</summary>
        [ContextMenu("显示配置信息")]
        public void ShowConfiguration()
        {
            Debug.Log("\n====================================");
            Debug.Log("安全配置信息");
            Debug.Log("====================================");

            bool isExpired = CommunicationSecurityManager.Instance.IsExpired();
            int remainingDays = CommunicationSecurityManager.Instance.GetRemainingDays();

            Debug.Log($"系统状态：{(isExpired ? "已过期" : "正常运行")}");
            Debug.Log($"剩余天数：{remainingDays} 天");
            Debug.Log($"当前时间：{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC");

            Debug.Log("====================================");
        }
    }
}
