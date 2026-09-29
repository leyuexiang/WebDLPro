#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>一组被完全相同场景集合使用的资源及其确定性资源包名称。</summary>
    public sealed class SceneBundleDependencyPlan
    {
        public string BundleName { get; }
        public IReadOnlyList<string> SceneIds { get; }
        public IReadOnlyList<string> AssetPaths { get; }

        internal SceneBundleDependencyPlan(string bundleName, string[] sceneIds, string[] assetPaths)
        {
            BundleName = bundleName;
            SceneIds = Array.AsReadOnly(sceneIds);
            AssetPaths = Array.AsReadOnly(assetPaths);
        }
    }

    /// <summary>
    /// 纯编辑器构建规划逻辑：按资源的精确消费者集合分组，避免只因“某处共享”便把全部共享资产合成一个大包。
    /// 此类型仅供 Unity 编辑器构建器和编辑器测试使用，不进入 WebGL 播放器程序集。
    /// </summary>
    public static class SceneBundleDependencyPlanner
    {
        private const string SharedBundlePrefix = "scene-shared-";

        /// <summary>
        /// 按排序后的场景标识组合消费者签名。每个资源只进入一个组；单场景资源留在其场景包中，不创建共享包。
        /// </summary>
        public static IReadOnlyList<SceneBundleDependencyPlan> CreateSharedBundlePlans(
            IReadOnlyDictionary<string, HashSet<string>> consumersByAssetPath)
        {
            if (consumersByAssetPath == null)
            {
                throw new ArgumentNullException(nameof(consumersByAssetPath));
            }

            SortedDictionary<string, List<string>> assetPathsByConsumerSignature =
                new SortedDictionary<string, List<string>>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, HashSet<string>> pair in consumersByAssetPath)
            {
                if (string.IsNullOrWhiteSpace(pair.Key) || pair.Value == null)
                {
                    throw new ArgumentException("共享资源规划不能包含空路径或空消费者集合。", nameof(consumersByAssetPath));
                }

                string[] sceneIds = pair.Value.OrderBy(sceneId => sceneId, StringComparer.Ordinal).ToArray();
                for (int sceneIndex = 0; sceneIndex < sceneIds.Length; sceneIndex++)
                {
                    if (string.IsNullOrWhiteSpace(sceneIds[sceneIndex]) || sceneIds[sceneIndex].IndexOf('\n') >= 0)
                    {
                        throw new ArgumentException("共享资源规划中的场景标识必须非空且不能包含换行符。", nameof(consumersByAssetPath));
                    }
                }

                if (sceneIds.Length < 2)
                {
                    continue;
                }

                string signature = string.Join("\n", sceneIds);
                if (!assetPathsByConsumerSignature.TryGetValue(signature, out List<string> assetPaths))
                {
                    assetPaths = new List<string>();
                    assetPathsByConsumerSignature.Add(signature, assetPaths);
                }
                assetPaths.Add(pair.Key);
            }

            List<SceneBundleDependencyPlan> plans = new List<SceneBundleDependencyPlan>(assetPathsByConsumerSignature.Count);
            HashSet<string> bundleNames = new HashSet<string>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, List<string>> pair in assetPathsByConsumerSignature)
            {
                string bundleName = CreateBundleName(pair.Key);
                if (!bundleNames.Add(bundleName))
                {
                    throw new InvalidOperationException("消费者签名生成了重复的共享资源包名称。");
                }

                string[] sceneIds = pair.Key.Split('\n');
                string[] assetPaths = pair.Value.OrderBy(path => path, StringComparer.Ordinal).ToArray();
                plans.Add(new SceneBundleDependencyPlan(bundleName, sceneIds, assetPaths));
            }

            return plans.AsReadOnly();
        }

        /// <summary>以完整 SHA-256 消费者签名生成跨构建稳定且可安全用作文件段的资源包名。</summary>
        private static string CreateBundleName(string consumerSignature)
        {
            using (SHA256 algorithm = SHA256.Create())
            {
                byte[] digest = algorithm.ComputeHash(Encoding.UTF8.GetBytes(consumerSignature));
                StringBuilder name = new StringBuilder(SharedBundlePrefix, SharedBundlePrefix.Length + digest.Length * 2);
                for (int index = 0; index < digest.Length; index++)
                {
                    name.Append(digest[index].ToString("x2"));
                }
                return name.ToString();
            }
        }
    }
}
#endif
