using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 业务相机返回快照。使用值类型保存进入第三层前的世界变换和投影参数，
    /// 避免返回时错误恢复到场景初始镜头或依赖已销毁的 Transform。
    /// </summary>
    public readonly struct BusinessSceneCameraPoseSnapshot
    {
        public Vector3 Position { get; }
        public Quaternion Rotation { get; }
        public float FieldOfView { get; }
        public float OrthographicSize { get; }
        public bool Orthographic { get; }
        public bool IsValid { get; }

        public BusinessSceneCameraPoseSnapshot(
            Vector3 position,
            Quaternion rotation,
            float fieldOfView,
            float orthographicSize,
            bool orthographic)
        {
            Position = position;
            Rotation = rotation;
            FieldOfView = fieldOfView;
            OrthographicSize = orthographicSize;
            Orthographic = orthographic;
            IsValid = true;
        }
    }
    /// <summary>
    /// 业务场景显式镜头位控制契约。场景入口只依赖该接口，不反向引用具体相机控制器所在程序集。
    /// </summary>
    public interface IBusinessSceneCameraPoseController
    {
        void MoveToPose(Transform targetPose);
        void ResetToInitialTransform();
    }

    /// <summary>
    /// 第三层事务使用的相机快照扩展。它恢复进入前的业务镜头，而不是场景资产中的初始镜头。
    /// </summary>
    public interface IBusinessSceneCameraSnapshotController : IBusinessSceneCameraPoseController
    {
        BusinessSceneCameraPoseSnapshot CaptureCurrentPose();
        void MoveToSnapshot(BusinessSceneCameraPoseSnapshot snapshot);
    }

    /// <summary>
    /// 第二层本地三维交互门。第三层提交后只阻断鼠标选择和厂房入口，状态视觉与资源对象继续运行。
    /// </summary>
    public interface IBusinessSceneInteractionGate
    {
        bool InteractionsBlocked { get; }
        void SetInteractionsBlocked(bool blocked);
    }

    /// <summary>
    /// 业务场景中的优先三维点击消费者。它在普通设备节点选择之前获得同一条射线；
    /// 返回 true 表示该点击已由厂房下钻等场景内交互消费，调用方不得继续触发普通 Focus 或对象选择回传。
    /// </summary>
    public interface IBusinessScenePointerConsumer
    {
        bool TryConsumePointer(Ray ray);
    }
}
