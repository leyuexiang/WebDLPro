using System;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 能力登记校验只接受正式场景目录条目。控制器少声明会造成静默失败，多声明会扩大权限，
    /// 因此必须与目录中的 declaredCapabilities 完全一致。
    /// </summary>
    public static class SceneCapabilityRegistry
    {
        public static bool MatchesCatalog(BusinessSceneCatalogEntry entry, IBusinessSceneController controller, out string message)
        {
            if (entry == null || controller == null)
            {
                message = "场景目录项或业务控制器不存在。";
                return false;
            }
            if (!string.Equals(entry.SceneId, controller.SceneId, StringComparison.Ordinal))
            {
                message = "场景控制器标识与能力登记项不一致。";
                return false;
            }
            if (entry.DeclaredCapabilities != controller.Capabilities)
            {
                message = $"场景控制器能力与登记表不一致：expected={entry.DeclaredCapabilities};actual={controller.Capabilities}。";
                return false;
            }

            message = string.Empty;
            return true;
        }
    }
}
