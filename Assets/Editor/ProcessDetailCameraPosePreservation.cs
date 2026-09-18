using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/// <summary>
/// 关键环节 CameraPose 的制作期保留工具。
/// CameraPose 是美术/场景制作人员调整的权威数据；生成器更新 Prefab 时必须原样保留，
/// 不得根据模型包围盒或代码常量重新计算镜头。
/// </summary>
internal static class ProcessDetailCameraPosePreservation
{
    private readonly struct PoseData
    {
        public readonly Vector3 LocalPosition;
        public readonly Quaternion LocalRotation;
        public readonly Vector3 LocalScale;

        public PoseData(Transform transform)
        {
            LocalPosition = transform.localPosition;
            LocalRotation = transform.localRotation;
            LocalScale = transform.localScale;
        }
    }

    public static Transform CreateCameraPose(
        Transform newHost,
        string existingPrefabPath,
        Transform displayAnchor)
    {
        bool hasExistingPose = TryReadExistingPose(existingPrefabPath, out PoseData pose);
        Transform cameraPose = new GameObject("CameraPose").transform;
        cameraPose.SetParent(newHost, false);
        if (hasExistingPose)
        {
            cameraPose.localPosition = pose.LocalPosition;
            cameraPose.localRotation = pose.LocalRotation;
            cameraPose.localScale = pose.LocalScale;
        }
        else
        {
            // 首次创建只提供中性占位，不推断构图。后续由制作人员在 Prefab 中调整，重建时会原样保留。
            cameraPose.localPosition = displayAnchor.localPosition;
            cameraPose.localRotation = Quaternion.identity;
            cameraPose.localScale = Vector3.one;
        }
        return cameraPose;
    }

    private static bool TryReadExistingPose(string prefabPath, out PoseData pose)
    {
        PrefabStage currentStage = PrefabStageUtility.GetCurrentPrefabStage();
        if (currentStage != null &&
            string.Equals(currentStage.assetPath, prefabPath, System.StringComparison.Ordinal) &&
            currentStage.prefabContentsRoot != null)
        {
            Transform liveCameraPose = currentStage.prefabContentsRoot.transform.Find("CameraPose");
            if (liveCameraPose != null)
            {
                // Prefab Mode 中尚未保存的制作期调整也是权威数据，必须优先于磁盘资产。
                pose = new PoseData(liveCameraPose);
                return true;
            }
        }

        GameObject existingPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
        Transform existingCameraPose = existingPrefab != null
            ? existingPrefab.transform.Find("CameraPose")
            : null;
        if (existingCameraPose == null)
        {
            pose = default;
            return false;
        }

        pose = new PoseData(existingCameraPose);
        return true;
    }
}
