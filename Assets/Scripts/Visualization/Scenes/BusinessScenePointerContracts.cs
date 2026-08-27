using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 业务场景中的优先三维点击消费者。它在普通设备节点选择之前获得同一条射线；
    /// 返回 true 表示该点击已由厂房下钻等场景内交互消费，调用方不得继续触发普通 Focus 或对象选择回传。
    /// </summary>
    public interface IBusinessScenePointerConsumer
    {
        bool TryConsumePointer(Ray ray);
    }
}
