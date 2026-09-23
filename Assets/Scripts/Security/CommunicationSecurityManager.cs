using System;
using System.Security.Cryptography;
using System.Text;
using UnityEngine;

namespace WebDLPro.Unity.Security
{
    /// <summary>
    /// 通信安全管理器，提供时间限制和消息加密功能。
    /// 注意：此方案仅增加破解难度，无法完全防止逆向工程。
    /// </summary>
    public sealed class CommunicationSecurityManager
    {
        private static CommunicationSecurityManager _instance;
        private readonly byte[] _aesKey;
        private readonly byte[] _aesIV;
        private bool _isExpired;
        private DateTime _expirationDate;

        /// <summary>单例实例</summary>
        public static CommunicationSecurityManager Instance
        {
            get
            {
                if (_instance == null)
                {
                    _instance = new CommunicationSecurityManager();
                }
                return _instance;
            }
        }

        private CommunicationSecurityManager()
        {
            // 密钥混淆：将密钥拆分并通过计算生成，增加静态分析难度
            _aesKey = GenerateObfuscatedKey();
            _aesIV = GenerateObfuscatedIV();
            
            // 过期时间混淆：通过多个部分计算得出，而非直接硬编码
            _expirationDate = CalculateExpirationDate();
            _isExpired = false;
            
            ValidateTimeLock();
        }

        /// <summary>
        /// 生成混淆后的 AES 密钥（256位）
        /// 实际部署时应该修改这些魔数
        /// </summary>
        private byte[] GenerateObfuscatedKey()
        {
            // 使用看似无关的数值计算密钥，增加逆向难度
            byte[] part1 = BitConverter.GetBytes(0x4B65794D ^ 0x12345678); // KeyM ^ random
            byte[] part2 = BitConverter.GetBytes(0x61676963 ^ 0x87654321); // agic ^ random
            byte[] part3 = BitConverter.GetBytes(0x50617373 ^ 0xABCDEF01); // Pass ^ random
            byte[] part4 = BitConverter.GetBytes(0x776F7264 ^ 0xFEDCBA98); // word ^ random
            
            byte[] salt = Encoding.UTF8.GetBytes("PowerPlant3D_2024_Security_Layer");
            
            using (var deriveBytes = new Rfc2898DeriveBytes(
                CombineBytes(part1, part2, part3, part4), 
                salt, 
                10000))
            {
                return deriveBytes.GetBytes(32); // 256 bits
            }
        }

        /// <summary>生成混淆后的初始化向量（128位）</summary>
        private byte[] GenerateObfuscatedIV()
        {
            byte[] part1 = BitConverter.GetBytes(0x49564D61 ^ 0x11111111); // IVMa ^ random
            byte[] part2 = BitConverter.GetBytes(0x67696353 ^ 0x22222222); // gicS ^ random
            byte[] part3 = BitConverter.GetBytes(0x65637572 ^ 0x33333333); // ecur ^ random
            byte[] part4 = BitConverter.GetBytes(0x65313233 ^ 0x44444444); // e123 ^ random
            
            return CombineBytes(part1, part2, part3, part4);
        }

        /// <summary>
        /// 计算过期日期（混淆方式）
        /// 部署时修改这些数值来设置实际过期时间
        /// </summary>
    private DateTime CalculateExpirationDate()
    {
        // 基准日期：2026年9月23日
        DateTime baseDate = new DateTime(2026, 9, 23);
        
        // 通过计算得出过期日期，而非直接写死
        // 当前设置：2026年9月23日 + 30天 = 2026年10月23日
        int obfuscatedDays = 30; // 30天试用期
        
        // 你可以修改这个值来设置实际的试用期限
        // 例如：90天试用期、180天试用期等
        return baseDate.AddDays(obfuscatedDays);
    }

        /// <summary>验证时间锁定</summary>
        private void ValidateTimeLock()
        {
            DateTime now = DateTime.UtcNow;
            
            // 基本时间检查
            if (now > _expirationDate)
            {
                _isExpired = true;
                Debug.LogError("[Security] 系统试用期已过期，请联系开发商续期。");
                return;
            }

            // 防止系统时间被回拨（可选的额外保护）
            string lastRunKey = "LastSystemRun_" + GetMachineHash();
            if (PlayerPrefs.HasKey(lastRunKey))
            {
                string lastRunStr = PlayerPrefs.GetString(lastRunKey);
                if (DateTime.TryParse(lastRunStr, out DateTime lastRun))
                {
                    // 如果当前时间早于上次运行时间超过1天，可能是时间被回拨
                    if (now < lastRun.AddDays(-1))
                    {
                        _isExpired = true;
                        Debug.LogError("[Security] 检测到系统时间异常，请恢复正确的系统时间。");
                        return;
                    }
                }
            }

            // 记录本次运行时间
            PlayerPrefs.SetString(lastRunKey, now.ToString("o"));
            PlayerPrefs.Save();

            // 距离过期还有多少天
            int daysRemaining = (_expirationDate - now).Days;
            if (daysRemaining <= 7)
            {
                Debug.LogWarning($"[Security] 系统将在 {daysRemaining} 天后过期，请及时续期。");
            }
        }

        /// <summary>检查是否已过期</summary>
        public bool IsExpired()
        {
            // 每次检查时都重新验证，防止内存修改
            ValidateTimeLock();
            return _isExpired;
        }

        /// <summary>获取剩余天数（用于显示警告）</summary>
        public int GetRemainingDays()
        {
            if (_isExpired) return 0;
            return Math.Max(0, (_expirationDate - DateTime.UtcNow).Days);
        }

        /// <summary>
        /// 加密消息负载
        /// </summary>
        public string EncryptPayload(string plainText)
        {
            if (string.IsNullOrEmpty(plainText))
            {
                return plainText;
            }

            if (_isExpired)
            {
                throw new InvalidOperationException("系统已过期，无法加密消息。");
            }

            try
            {
                using (Aes aes = Aes.Create())
                {
                    aes.Key = _aesKey;
                    aes.IV = _aesIV;
                    aes.Mode = CipherMode.CBC;
                    aes.Padding = PaddingMode.PKCS7;

                    using (var encryptor = aes.CreateEncryptor(aes.Key, aes.IV))
                    {
                        byte[] plainBytes = Encoding.UTF8.GetBytes(plainText);
                        byte[] encryptedBytes = encryptor.TransformFinalBlock(plainBytes, 0, plainBytes.Length);
                        return Convert.ToBase64String(encryptedBytes);
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Security] 加密失败：{ex.Message}");
                throw;
            }
        }

        /// <summary>
        /// 解密消息负载
        /// </summary>
        public string DecryptPayload(string cipherText)
        {
            if (string.IsNullOrEmpty(cipherText))
            {
                return cipherText;
            }

            if (_isExpired)
            {
                throw new InvalidOperationException("系统已过期，无法解密消息。");
            }

            try
            {
                using (Aes aes = Aes.Create())
                {
                    aes.Key = _aesKey;
                    aes.IV = _aesIV;
                    aes.Mode = CipherMode.CBC;
                    aes.Padding = PaddingMode.PKCS7;

                    using (var decryptor = aes.CreateDecryptor(aes.Key, aes.IV))
                    {
                        byte[] cipherBytes = Convert.FromBase64String(cipherText);
                        byte[] decryptedBytes = decryptor.TransformFinalBlock(cipherBytes, 0, cipherBytes.Length);
                        return Encoding.UTF8.GetString(decryptedBytes);
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Security] 解密失败：{ex.Message}");
                throw;
            }
        }

        /// <summary>获取机器特征哈希（用于绑定设备）</summary>
        private string GetMachineHash()
        {
            // 使用多个系统标识组合，增加唯一性
            string machineId = SystemInfo.deviceUniqueIdentifier;
            string combined = $"{machineId}_{SystemInfo.deviceModel}_{SystemInfo.operatingSystem}";
            
            using (SHA256 sha256 = SHA256.Create())
            {
                byte[] hashBytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(combined));
                return Convert.ToBase64String(hashBytes).Substring(0, 16);
            }
        }

        /// <summary>合并字节数组</summary>
        private byte[] CombineBytes(params byte[][] arrays)
        {
            int totalLength = 0;
            foreach (var arr in arrays)
            {
                totalLength += arr.Length;
            }

            byte[] result = new byte[totalLength];
            int offset = 0;
            foreach (var arr in arrays)
            {
                Buffer.BlockCopy(arr, 0, result, offset, arr.Length);
                offset += arr.Length;
            }

            return result;
        }

        /// <summary>
        /// 生成许可证密钥（供客户激活使用，可选功能）
        /// 这个方法在生产环境中不应该存在，仅用于生成激活码
        /// </summary>
        public static string GenerateLicenseKey(DateTime expirationDate, string machineHash)
        {
            string data = $"{expirationDate:yyyyMMdd}|{machineHash}";
            using (SHA256 sha256 = SHA256.Create())
            {
                byte[] hashBytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(data + "SecretSalt2024"));
                string signature = Convert.ToBase64String(hashBytes).Substring(0, 8);
                return $"{expirationDate:yyyyMMdd}-{signature}";
            }
        }

        /// <summary>
        /// 验证许可证密钥（可选的激活功能）
        /// </summary>
        public bool ValidateLicenseKey(string licenseKey)
        {
            try
            {
                string[] parts = licenseKey.Split('-');
                if (parts.Length != 2) return false;

                string dateStr = parts[0];
                string signature = parts[1];

                if (!DateTime.TryParseExact(dateStr, "yyyyMMdd", null, 
                    System.Globalization.DateTimeStyles.None, out DateTime expDate))
                {
                    return false;
                }

                string machineHash = GetMachineHash();
                string expectedKey = GenerateLicenseKey(expDate, machineHash);

                if (expectedKey == licenseKey)
                {
                    _expirationDate = expDate;
                    _isExpired = DateTime.UtcNow > expDate;
                    return true;
                }

                return false;
            }
            catch
            {
                return false;
            }
        }
    }
}
