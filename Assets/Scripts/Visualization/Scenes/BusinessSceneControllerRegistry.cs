using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>默认程序集中的现有业务控制器可通过工厂适配到统一接口，无需移动或改写用户场景脚本。</summary>
    public delegate IBusinessSceneController BusinessSceneControllerFactory(Scene scene, BusinessSceneCatalogEntry entry);

    /// <summary>
    /// 场景控制器解析器先查找场景内显式接口组件，再调用按 sceneId 注册的兼容适配工厂。
    /// 工厂表容量最多为九项，场景卸载后不保存控制器引用，避免跨场景对象泄漏。
    /// </summary>
    public static class BusinessSceneControllerRegistry
    {
        private static readonly Dictionary<string, BusinessSceneControllerFactory> Factories =
            new Dictionary<string, BusinessSceneControllerFactory>(StringComparer.Ordinal);

        public static bool RegisterFactory(string sceneId, BusinessSceneControllerFactory factory)
        {
            if (!BusinessSceneCatalog.IsRequiredSceneId(sceneId) || factory == null)
            {
                return false;
            }

            Factories[sceneId] = factory;
            return true;
        }

        public static bool TryResolve(Scene scene, BusinessSceneCatalogEntry entry, out IBusinessSceneController controller, out string error)
        {
            controller = FindExplicitController(scene, entry.SceneId);
            if (controller == null && Factories.TryGetValue(entry.SceneId, out BusinessSceneControllerFactory factory))
            {
                controller = factory(scene, entry);
            }

            if (controller == null)
            {
                error = "目标场景没有实现统一业务场景控制接口。";
                return false;
            }
            if (!string.Equals(controller.SceneId, entry.SceneId, StringComparison.Ordinal))
            {
                error = "目标场景控制器的 sceneId 与目录不一致。";
                controller = null;
                return false;
            }
            if (!SceneCapabilityRegistry.MatchesCatalog(entry, controller, out error))
            {
                controller = null;
                return false;
            }

            return true;
        }

        /// <summary>
        /// 仅用于当前 SampleScene 本地兼容：不依据文件名猜测场景，而是让已登记适配工厂检查实际控制器组件。
        /// 正式多场景协调器禁止调用此入口，必须使用经过校验的目录条目。
        /// </summary>
        public static bool TryResolveLegacyLoadedScene(Scene scene, out IBusinessSceneController controller, out string error)
        {
            controller = null;
            error = string.Empty;
            foreach (BusinessSceneControllerFactory factory in Factories.Values)
            {
                IBusinessSceneController candidate = factory(scene, null);
                if (candidate == null)
                {
                    continue;
                }
                if (controller != null)
                {
                    controller = null;
                    error = "当前场景同时匹配多个业务控制器适配器。";
                    return false;
                }
                controller = candidate;
            }

            if (controller == null)
            {
                error = "当前场景没有可兼容的统一业务控制器。";
                return false;
            }
            return true;
        }

        private static IBusinessSceneController FindExplicitController(Scene scene, string expectedSceneId)
        {
            if (!scene.IsValid() || !scene.isLoaded)
            {
                return null;
            }

            GameObject[] roots = scene.GetRootGameObjects();
            for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
            {
                MonoBehaviour[] behaviours = roots[rootIndex].GetComponentsInChildren<MonoBehaviour>(true);
                for (int behaviourIndex = 0; behaviourIndex < behaviours.Length; behaviourIndex++)
                {
                    if (behaviours[behaviourIndex] is IBusinessSceneController candidate &&
                        string.Equals(candidate.SceneId, expectedSceneId, StringComparison.Ordinal))
                    {
                        return candidate;
                    }
                }
            }

            return null;
        }
    }
}
