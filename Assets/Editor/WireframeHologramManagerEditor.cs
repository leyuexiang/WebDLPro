using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

/// <summary>
/// 线框全息管理器的编辑器配置工具。
///
/// 工具只修改当前场景中的管理器序列化数组，不向模型对象添加组件，也不改动 FBX、材质和线框网格资产。
/// 目标对象由用户通过层级选择明确指定；工具只负责收集网格、按烘焙规则匹配线框资产并写入管理器。
/// </summary>
public static class WireframeHologramManagerEditorTools
{
    private const string RuntimeRootName = "PowerPlantRuntime";
    private const string HologramMaterialPath = "Assets/Shaders/Hologram_Body.mat";
    private const string WireframeMaterialPath = "Assets/Shaders/Hologram_Wireframe.mat";

    private const string TargetsPropertyName = "_targets";
    private const string TargetIdPropertyName = "_id";
    private const string TargetObjectPropertyName = "_target";
    private const string TargetEnabledPropertyName = "_enabled";
    private const string MeshBindingsPropertyName = "_meshBindings";
    private const string SourceFilterPropertyName = "_sourceFilter";
    private const string WireframeMeshPropertyName = "_wireframeMesh";

    // 超过该数量通常意味着用户选中了场景级聚合模型；继续加入会显著增加启动扫描、材质切换和透明过绘成本。
    private const int LargeTargetRendererWarningThreshold = 512;

    private sealed class MeshBindingData
    {
        public MeshFilter SourceFilter;
        public Mesh WireframeMesh;
    }

    private sealed class TargetData
    {
        public string Id;
        public GameObject Target;
        public bool Enabled;
        public readonly List<MeshBindingData> MeshBindings = new List<MeshBindingData>();
    }

    private sealed class ExistingTargetData
    {
        public string Id;
        public bool Enabled;
    }

    [MenuItem("Tools/WebDLPro/全息线框/从选中对象配置总管理器", false, 210)]
    private static void ConfigureFromSelectedObjects()
    {
        ConfigureFromSelection(false);
    }

    [MenuItem("Tools/WebDLPro/全息线框/从选中根节点的直接子对象配置", false, 211)]
    private static void ConfigureFromSelectedChildren()
    {
        ConfigureFromSelection(true);
    }

    [MenuItem("Tools/WebDLPro/全息线框/创建或选择总管理器", false, 212)]
    private static void CreateOrSelectManager()
    {
        if (EditorApplication.isPlayingOrWillChangePlaymode)
        {
            EditorUtility.DisplayDialog("无法配置全息管理器", "请先退出播放模式。", "确定");
            return;
        }

        Scene activeScene = SceneManager.GetActiveScene();
        if (!activeScene.IsValid())
        {
            EditorUtility.DisplayDialog("无法配置全息管理器", "当前没有有效的活动场景。", "确定");
            return;
        }

        WireframeHologramManager manager = GetOrCreateManager(activeScene);
        if (manager == null)
        {
            return;
        }

        SerializedObject serializedManager = new SerializedObject(manager);
        serializedManager.Update();
        SetObjectReference(serializedManager, "_hologramMaterial", AssetDatabase.LoadAssetAtPath<Material>(HologramMaterialPath));
        SetObjectReference(serializedManager, "_wireframeMaterial", AssetDatabase.LoadAssetAtPath<Material>(WireframeMaterialPath));
        serializedManager.ApplyModifiedProperties();
        EditorUtility.SetDirty(manager);
        Selection.activeGameObject = manager.gameObject;

        Debug.Log("[WireframeHologramManager] 已创建或选中场景总管理器。", manager);
    }

    [MenuItem("Tools/WebDLPro/全息线框/从选中对象配置总管理器", true)]
    [MenuItem("Tools/WebDLPro/全息线框/从选中根节点的直接子对象配置", true)]
    private static bool ValidateConfigureMenu()
    {
        return !EditorApplication.isPlayingOrWillChangePlaymode &&
               SceneManager.GetActiveScene().IsValid() &&
               Selection.gameObjects.Length > 0;
    }

    /// <summary>
    /// 供管理器自定义检视面板调用的批量配置入口。
    /// </summary>
    public static void ConfigureFromSelection(bool useDirectChildren)
    {
        if (EditorApplication.isPlayingOrWillChangePlaymode)
        {
            EditorUtility.DisplayDialog("无法配置全息管理器", "请先退出播放模式。", "确定");
            return;
        }

        Scene activeScene = SceneManager.GetActiveScene();
        if (!activeScene.IsValid())
        {
            EditorUtility.DisplayDialog("无法配置全息管理器", "当前没有有效的活动场景。", "确定");
            return;
        }

        List<GameObject> selectedTargets = CollectSelectedTargets(activeScene, useDirectChildren);
        if (selectedTargets.Count == 0)
        {
            EditorUtility.DisplayDialog(
                "没有可配置对象",
                useDirectChildren
                    ? "请选中一个包含模型子对象的根节点。"
                    : "请先在层级中选中需要全息效果的模型对象。",
                "确定");
            return;
        }

        WireframeHologramManager manager = GetOrCreateManager(activeScene);
        if (manager == null)
        {
            return;
        }

        List<TargetData> targetData = BuildTargetData(selectedTargets);
        if (targetData.Count == 0)
        {
            EditorUtility.DisplayDialog("没有可配置对象", "选中的对象没有可用的场景模型。", "确定");
            return;
        }

        ApplyConfiguration(manager, targetData);
        Selection.activeGameObject = manager.gameObject;

        int meshBindingCount = 0;
        int missingWireframeCount = 0;
        for (int targetIndex = 0; targetIndex < targetData.Count; targetIndex++)
        {
            meshBindingCount += targetData[targetIndex].MeshBindings.Count;
            for (int bindingIndex = 0; bindingIndex < targetData[targetIndex].MeshBindings.Count; bindingIndex++)
            {
                if (targetData[targetIndex].MeshBindings[bindingIndex].WireframeMesh == null)
                {
                    missingWireframeCount++;
                }
            }
        }

        string saveHint = "场景已标记为未保存，请确认无误后保存场景。";
        Debug.Log(
            $"[WireframeHologramManager] 已配置目标={targetData.Count}，网格映射={meshBindingCount}，" +
            $"缺失线框={missingWireframeCount}。{saveHint}",
            manager);
        EditorSceneManager.MarkSceneDirty(activeScene);
    }

    /// <summary>
    /// 收集用户明确选择的目标。直接子对象模式用于避免把场景级聚合节点整体递归加入管理器。
    /// </summary>
    private static List<GameObject> CollectSelectedTargets(Scene activeScene, bool useDirectChildren)
    {
        GameObject[] selection = Selection.gameObjects;
        HashSet<GameObject> uniqueTargets = new HashSet<GameObject>();
        for (int selectionIndex = 0; selectionIndex < selection.Length; selectionIndex++)
        {
            GameObject selectedObject = selection[selectionIndex];
            if (selectedObject == null || selectedObject.scene != activeScene)
            {
                continue;
            }

            if (useDirectChildren)
            {
                Transform selectedTransform = selectedObject.transform;
                for (int childIndex = 0; childIndex < selectedTransform.childCount; childIndex++)
                {
                    GameObject child = selectedTransform.GetChild(childIndex).gameObject;
                    if (child.scene == activeScene)
                    {
                        uniqueTargets.Add(child);
                    }
                }
            }
            else
            {
                uniqueTargets.Add(selectedObject);
            }
        }

        List<GameObject> targets = new List<GameObject>(uniqueTargets);
        targets.Sort((left, right) => string.CompareOrdinal(GetHierarchyPath(left.transform), GetHierarchyPath(right.transform)));

        // 选中父节点和子节点时只保留父节点，避免同一个渲染器被两个目标重复接管。
        for (int index = targets.Count - 1; index >= 0; index--)
        {
            for (int otherIndex = 0; otherIndex < targets.Count; otherIndex++)
            {
                if (index == otherIndex)
                {
                    continue;
                }

                if (IsAncestorOf(targets[otherIndex].transform, targets[index].transform))
                {
                    targets.RemoveAt(index);
                    break;
                }
            }
        }

        return targets;
    }

    /// <summary>
    /// 按每个目标递归收集 MeshFilter，并使用线框烘焙器的同一命名规则匹配线框资产。
    /// 缺失线框时保留源网格映射，使模型仍可显示全息本体，同时在控制台给出修复提示。
    /// </summary>
    private static List<TargetData> BuildTargetData(List<GameObject> targets)
    {
        Dictionary<GameObject, ExistingTargetData> existingStates = CaptureExistingTargetStates();
        HashSet<string> usedIds = new HashSet<string>(StringComparer.Ordinal);
        List<TargetData> targetData = new List<TargetData>(targets.Count);

        for (int targetIndex = 0; targetIndex < targets.Count; targetIndex++)
        {
            GameObject target = targets[targetIndex];
            if (target == null || target.GetComponent<WireframeHologramManager>() != null)
            {
                continue;
            }

            Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length > LargeTargetRendererWarningThreshold)
            {
                Debug.LogWarning(
                    $"[WireframeHologramManager] 跳过目标 {GetHierarchyPath(target.transform)}：" +
                    $"包含 {renderers.Length} 个渲染器，超过性能保护阈值 {LargeTargetRendererWarningThreshold}。" +
                    "请改为选择更小的模型对象，或拆分目标。",
                    target);
                continue;
            }

            ExistingTargetData existingData = existingStates.TryGetValue(target, out ExistingTargetData saved)
                ? saved
                : null;
            string targetId = existingData != null && !string.IsNullOrWhiteSpace(saved.Id)
                ? saved.Id
                : CreateUniqueId(target.name, usedIds);
            if (!usedIds.Add(targetId))
            {
                targetId = CreateUniqueId(target.name, usedIds);
                usedIds.Add(targetId);
            }

            TargetData data = new TargetData
            {
                Id = targetId,
                Target = target,
                Enabled = existingData != null && existingData.Enabled
            };

            MeshFilter[] filters = target.GetComponentsInChildren<MeshFilter>(true);
            HashSet<MeshFilter> uniqueFilters = new HashSet<MeshFilter>();
            for (int filterIndex = 0; filterIndex < filters.Length; filterIndex++)
            {
                MeshFilter sourceFilter = filters[filterIndex];
                if (sourceFilter == null || !uniqueFilters.Add(sourceFilter) ||
                    sourceFilter.name.StartsWith("__WireframeOverlay", StringComparison.Ordinal))
                {
                    continue;
                }

                Mesh sourceMesh = sourceFilter.sharedMesh;
                if (sourceMesh == null)
                {
                    Debug.LogWarning(
                        $"[WireframeHologramManager] 目标 {GetHierarchyPath(target.transform)} 的网格过滤器 {sourceFilter.name} 没有源网格，已跳过线框映射。",
                        sourceFilter);
                    continue;
                }

                string wireframePath = WireframeOverlayBaker.GetWireframeAssetPath(sourceMesh);
                Mesh wireframeMesh = AssetDatabase.LoadAssetAtPath<Mesh>(wireframePath);
                if (wireframeMesh == null)
                {
                    Debug.LogWarning(
                        $"[WireframeHologramManager] 未找到线框资产：{wireframePath}（源网格：{sourceMesh.name}）。" +
                        "请先选中对应模型执行线框烘焙，或稍后手动补齐映射。",
                        sourceFilter);
                }

                data.MeshBindings.Add(new MeshBindingData
                {
                    SourceFilter = sourceFilter,
                    WireframeMesh = wireframeMesh
                });
            }

            if (renderers.Length == 0)
            {
                Debug.LogWarning(
                    $"[WireframeHologramManager] 目标 {GetHierarchyPath(target.transform)} 没有渲染器，已跳过。",
                    target);
                continue;
            }

            targetData.Add(data);
        }

        return targetData;
    }

    /// <summary>
    /// 将目标、网格映射和默认材质写入管理器。使用 SerializedObject 保证私有嵌套数组可正确保存，
    /// 同时保留重新配置前已有目标的自定义标识和初始开关状态。
    /// </summary>
    private static void ApplyConfiguration(WireframeHologramManager manager, List<TargetData> targetData)
    {
        Undo.RecordObject(manager, "Configure Wireframe Hologram Manager");

        SerializedObject serializedManager = new SerializedObject(manager);
        serializedManager.Update();
        SetObjectReference(serializedManager, "_hologramMaterial", AssetDatabase.LoadAssetAtPath<Material>(HologramMaterialPath));
        SetObjectReference(serializedManager, "_wireframeMaterial", AssetDatabase.LoadAssetAtPath<Material>(WireframeMaterialPath));

        SerializedProperty targetsProperty = serializedManager.FindProperty(TargetsPropertyName);
        targetsProperty.arraySize = targetData.Count;
        for (int targetIndex = 0; targetIndex < targetData.Count; targetIndex++)
        {
            TargetData data = targetData[targetIndex];
            SerializedProperty targetProperty = targetsProperty.GetArrayElementAtIndex(targetIndex);
            targetProperty.FindPropertyRelative(TargetIdPropertyName).stringValue = data.Id;
            targetProperty.FindPropertyRelative(TargetObjectPropertyName).objectReferenceValue = data.Target;
            targetProperty.FindPropertyRelative(TargetEnabledPropertyName).boolValue = data.Enabled;

            SerializedProperty meshBindingsProperty = targetProperty.FindPropertyRelative(MeshBindingsPropertyName);
            meshBindingsProperty.arraySize = data.MeshBindings.Count;
            for (int bindingIndex = 0; bindingIndex < data.MeshBindings.Count; bindingIndex++)
            {
                MeshBindingData binding = data.MeshBindings[bindingIndex];
                SerializedProperty bindingProperty = meshBindingsProperty.GetArrayElementAtIndex(bindingIndex);
                bindingProperty.FindPropertyRelative(SourceFilterPropertyName).objectReferenceValue = binding.SourceFilter;
                bindingProperty.FindPropertyRelative(WireframeMeshPropertyName).objectReferenceValue = binding.WireframeMesh;
            }
        }

        serializedManager.ApplyModifiedProperties();
        EditorUtility.SetDirty(manager);
    }

    /// <summary>
    /// 读取旧数组中的目标状态，避免用户重新批量配置后丢失已手工调整的标识和初始开关。
    /// </summary>
    private static Dictionary<GameObject, ExistingTargetData> CaptureExistingTargetStates()
    {
        Dictionary<GameObject, ExistingTargetData> states = new Dictionary<GameObject, ExistingTargetData>();
        WireframeHologramManager[] managers = FindManagersInActiveScene(SceneManager.GetActiveScene());
        if (managers.Length == 0)
        {
            return states;
        }

        SerializedObject serializedManager = new SerializedObject(managers[0]);
        SerializedProperty targetsProperty = serializedManager.FindProperty(TargetsPropertyName);
        if (targetsProperty == null || !targetsProperty.isArray)
        {
            return states;
        }

        for (int index = 0; index < targetsProperty.arraySize; index++)
        {
            SerializedProperty targetProperty = targetsProperty.GetArrayElementAtIndex(index);
            GameObject target = targetProperty.FindPropertyRelative(TargetObjectPropertyName).objectReferenceValue as GameObject;
            if (target == null || states.ContainsKey(target))
            {
                continue;
            }

            states.Add(target, new ExistingTargetData
            {
                Id = targetProperty.FindPropertyRelative(TargetIdPropertyName).stringValue,
                Enabled = targetProperty.FindPropertyRelative(TargetEnabledPropertyName).boolValue
            });
        }

        return states;
    }

    /// <summary>
    /// 获取当前场景唯一的管理器。优先复用 PowerPlantRuntime，避免额外增加场景根节点数量。
    /// </summary>
    private static WireframeHologramManager GetOrCreateManager(Scene activeScene)
    {
        WireframeHologramManager[] managers = FindManagersInActiveScene(activeScene);
        if (managers.Length > 0)
        {
            return managers[0];
        }

        GameObject runtimeRoot = FindRootObject(activeScene, RuntimeRootName);
        if (runtimeRoot == null)
        {
            runtimeRoot = new GameObject(RuntimeRootName);
            SceneManager.MoveGameObjectToScene(runtimeRoot, activeScene);
            Undo.RegisterCreatedObjectUndo(runtimeRoot, "Create Wireframe Hologram Manager Root");
        }

        WireframeHologramManager manager = runtimeRoot.GetComponent<WireframeHologramManager>();
        if (manager == null)
        {
            manager = Undo.AddComponent<WireframeHologramManager>(runtimeRoot);
        }

        return manager;
    }

    private static WireframeHologramManager[] FindManagersInActiveScene(Scene activeScene)
    {
        List<WireframeHologramManager> managers = new List<WireframeHologramManager>();
        GameObject[] roots = activeScene.GetRootGameObjects();
        for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
        {
            WireframeHologramManager[] found = roots[rootIndex].GetComponentsInChildren<WireframeHologramManager>(true);
            for (int managerIndex = 0; managerIndex < found.Length; managerIndex++)
            {
                if (found[managerIndex] != null)
                {
                    managers.Add(found[managerIndex]);
                }
            }
        }

        return managers.ToArray();
    }

    private static GameObject FindRootObject(Scene scene, string objectName)
    {
        GameObject[] roots = scene.GetRootGameObjects();
        for (int index = 0; index < roots.Length; index++)
        {
            if (roots[index].name == objectName)
            {
                return roots[index];
            }
        }

        return null;
    }

    private static void SetObjectReference(SerializedObject serializedObject, string propertyName, UnityEngine.Object value)
    {
        SerializedProperty property = serializedObject.FindProperty(propertyName);
        if (property != null)
        {
            property.objectReferenceValue = value;
        }
    }

    private static string CreateUniqueId(string baseName, HashSet<string> usedIds)
    {
        string safeBaseName = string.IsNullOrWhiteSpace(baseName) ? "HologramTarget" : baseName.Trim();
        if (!usedIds.Contains(safeBaseName))
        {
            return safeBaseName;
        }

        int suffix = 2;
        string candidate;
        do
        {
            candidate = $"{safeBaseName}_{suffix}";
            suffix++;
        }
        while (usedIds.Contains(candidate));

        return candidate;
    }

    private static bool IsAncestorOf(Transform possibleAncestor, Transform target)
    {
        Transform current = target.parent;
        while (current != null)
        {
            if (current == possibleAncestor)
            {
                return true;
            }

            current = current.parent;
        }

        return false;
    }

    private static string GetHierarchyPath(Transform target)
    {
        List<string> names = new List<string>();
        Transform current = target;
        while (current != null)
        {
            names.Add(current.name);
            current = current.parent;
        }

        names.Reverse();
        return string.Join("/", names);
    }

    /// <summary>
    /// 供自定义检视面板调用的配置校验。只读场景和序列化数组，不会自动修复或替换用户引用。
    /// </summary>
    public static void ValidateManager(WireframeHologramManager manager)
    {
        if (manager == null)
        {
            return;
        }

        SerializedObject serializedManager = new SerializedObject(manager);
        SerializedProperty targetsProperty = serializedManager.FindProperty(TargetsPropertyName);
        List<string> errors = new List<string>();
        List<string> warnings = new List<string>();
        HashSet<string> ids = new HashSet<string>(StringComparer.Ordinal);
        HashSet<GameObject> targets = new HashSet<GameObject>();
        int rendererCount = 0;
        int missingWireframeCount = 0;

        if (targetsProperty == null || !targetsProperty.isArray || targetsProperty.arraySize == 0)
        {
            errors.Add("目标数组为空。");
        }
        else
        {
            for (int targetIndex = 0; targetIndex < targetsProperty.arraySize; targetIndex++)
            {
                SerializedProperty targetProperty = targetsProperty.GetArrayElementAtIndex(targetIndex);
                string id = targetProperty.FindPropertyRelative(TargetIdPropertyName).stringValue;
                GameObject target = targetProperty.FindPropertyRelative(TargetObjectPropertyName).objectReferenceValue as GameObject;
                SerializedProperty meshBindingsProperty = targetProperty.FindPropertyRelative(MeshBindingsPropertyName);

                if (string.IsNullOrWhiteSpace(id) || !ids.Add(id))
                {
                    errors.Add($"目标[{targetIndex}]的标识为空或重复：{id}。");
                }

                if (target == null || !targets.Add(target))
                {
                    errors.Add($"目标[{targetIndex}]为空或与其他目标重复。");
                    continue;
                }

                Renderer[] renderers = target.GetComponentsInChildren<Renderer>(true);
                rendererCount += renderers.Length;
                if (renderers.Length == 0)
                {
                    errors.Add($"目标[{targetIndex}]没有渲染器：{target.name}。");
                }
                else if (renderers.Length > LargeTargetRendererWarningThreshold)
                {
                    warnings.Add($"目标[{targetIndex}]包含 {renderers.Length} 个渲染器，可能造成较高透明过绘：{target.name}。");
                }

                if (meshBindingsProperty == null || !meshBindingsProperty.isArray || meshBindingsProperty.arraySize == 0)
                {
                    warnings.Add($"目标[{targetIndex}]没有线框网格映射：{target.name}。");
                    continue;
                }

                for (int bindingIndex = 0; bindingIndex < meshBindingsProperty.arraySize; bindingIndex++)
                {
                    SerializedProperty bindingProperty = meshBindingsProperty.GetArrayElementAtIndex(bindingIndex);
                    MeshFilter sourceFilter = bindingProperty.FindPropertyRelative(SourceFilterPropertyName).objectReferenceValue as MeshFilter;
                    Mesh wireframeMesh = bindingProperty.FindPropertyRelative(WireframeMeshPropertyName).objectReferenceValue as Mesh;
                    if (sourceFilter == null)
                    {
                        errors.Add($"目标[{targetIndex}]线框映射[{bindingIndex}]缺少源网格过滤器。");
                    }
                    if (wireframeMesh == null)
                    {
                        missingWireframeCount++;
                        warnings.Add($"目标[{targetIndex}]线框映射[{bindingIndex}]缺少线框网格。");
                    }
                }
            }
        }

        if (targetsProperty != null && targetsProperty.arraySize > 0 && rendererCount > LargeTargetRendererWarningThreshold * 4)
        {
            warnings.Add($"所有目标合计 {rendererCount} 个渲染器，启用全息时会增加透明过绘。建议只登记当前需要展示的设备。");
        }

        if (errors.Count > 0)
        {
            Debug.LogError(
                $"[WireframeHologramManager] 校验失败：{string.Join("；", errors)}",
                manager);
            return;
        }

        if (warnings.Count > 0)
        {
            Debug.LogWarning(
                $"[WireframeHologramManager] 校验通过，但有提示：{string.Join("；", warnings)}；缺失线框={missingWireframeCount}。",
                manager);
            return;
        }

        Debug.Log(
            $"[WireframeHologramManager] 校验通过：目标={targets.Count}，渲染器={rendererCount}。",
            manager);
    }
}

/// <summary>
/// 线框全息管理器的轻量检视面板扩展。
/// </summary>
[CustomEditor(typeof(WireframeHologramManager))]
public sealed class WireframeHologramManagerEditor : Editor
{
    public override void OnInspectorGUI()
    {
        serializedObject.Update();
        DrawPropertiesExcluding(serializedObject, "m_Script");
        serializedObject.ApplyModifiedProperties();

        EditorGUILayout.Space(8f);
        EditorGUILayout.HelpBox(
            "模型对象不需要挂载脚本。先在层级中选择目标，再使用下方按钮批量写入管理器数组；" +
            "工具只创建一个场景级管理器，并按源网格自动匹配预烘焙线框资产。",
            MessageType.Info);

        using (new EditorGUI.DisabledScope(EditorApplication.isPlayingOrWillChangePlaymode))
        {
            if (GUILayout.Button("从当前选中对象覆盖目标数组"))
            {
                WireframeHologramManagerEditorTools.ConfigureFromSelection(false);
            }

            if (GUILayout.Button("从选中根节点的直接子对象覆盖目标数组"))
            {
                WireframeHologramManagerEditorTools.ConfigureFromSelection(true);
            }

            if (GUILayout.Button("校验管理器配置"))
            {
                WireframeHologramManagerEditorTools.ValidateManager((WireframeHologramManager)target);
            }

            if (GUILayout.Button("清空目标数组"))
            {
                ClearTargets();
            }
        }
    }

    private void ClearTargets()
    {
        if (!EditorUtility.DisplayDialog(
                "清空全息目标",
                "这会移除管理器中的目标引用，但不会删除模型或线框资产。是否继续？",
                "清空",
                "取消"))
        {
            return;
        }

        Undo.RecordObject(target, "Clear Wireframe Hologram Targets");
        SerializedProperty targetsProperty = serializedObject.FindProperty("_targets");
        targetsProperty.arraySize = 0;
        serializedObject.ApplyModifiedProperties();
        EditorUtility.SetDirty(target);
        EditorSceneManager.MarkSceneDirty(((WireframeHologramManager)target).gameObject.scene);
    }
}
