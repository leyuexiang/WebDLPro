using UnityEngine;
using UnityEngine.Scripting;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 标记包装实例由第三层独占资源句柄拥有。标记本身不主动销毁对象，统一释放仍由
    /// ProcessDetailLoadHandle 执行，避免组件销毁顺序造成资源包提前卸载。
    /// </summary>
    [Preserve]
    [DisallowMultipleComponent]
    public sealed class ProcessDetailOwnedResourceMarker : MonoBehaviour
    {
        [SerializeField] private string _resourceId;

        public string ResourceId => _resourceId ?? string.Empty;

#if UNITY_EDITOR
        public void ConfigureForEditor(string resourceId)
        {
            _resourceId = resourceId;
        }
#endif
    }
}
