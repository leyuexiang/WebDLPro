using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

/// <summary>
/// 发电场景控制器的属性面板扩展。
///
/// 燃煤场景的绑定事实保存在 PowerPlantProcessController 的序列化数组中，不能在运行时按
/// 模型名称查找或由脚本自动猜测。本编辑器只负责把这些字段清晰地展示出来并检查空引用、
/// 重复标识、步骤引用和四态目标关系，不会改写用户已经填写的场景映射。
/// </summary>
[CustomEditor(typeof(PowerPlantProcessController))]
public sealed class PowerPlantProcessControllerEditor : Editor
{
    private const string ConfiguredProcessIdPropertyName = "_configuredProcessId";
    private const string SceneRootPropertyName = "_sceneRoot";
    private const string InteractionCameraPropertyName = "_interactionCamera";
    private const string NodesPropertyName = "_nodes";
    private const string VisualStateColorPropertyNamesPropertyName = "_visualStateColorPropertyNames";
    private const string VisualStateBindingsPropertyName = "_visualStateBindings";

    private SerializedProperty _configuredProcessId;
    private SerializedProperty _sceneRoot;
    private SerializedProperty _interactionCamera;
    private SerializedProperty _nodes;
    private SerializedProperty _visualStateColorPropertyNames;
    private SerializedProperty _visualStateBindings;

    private void OnEnable()
    {
        _configuredProcessId = serializedObject.FindProperty(ConfiguredProcessIdPropertyName);
        _sceneRoot = serializedObject.FindProperty(SceneRootPropertyName);
        _interactionCamera = serializedObject.FindProperty(InteractionCameraPropertyName);
        _nodes = serializedObject.FindProperty(NodesPropertyName);
        _visualStateColorPropertyNames = serializedObject.FindProperty(VisualStateColorPropertyNamesPropertyName);
        _visualStateBindings = serializedObject.FindProperty(VisualStateBindingsPropertyName);
    }

    public override void OnInspectorGUI()
    {
        serializedObject.Update();

        EditorGUILayout.HelpBox(
            "场景节点和四态目标均在此组件的属性面板（Inspector）中配置：每个节点可选填写聚焦相机点位；留空时使用模型包围盒默认聚焦。标识与对象引用由场景负责人手工填写，运行时不按模型名称自动绑定。",
            MessageType.Info);

        if (_configuredProcessId != null)
        {
            EditorGUILayout.PropertyField(_configuredProcessId, new GUIContent("流程标识"));
        }

        // 其余字段继续使用 Unity 默认绘制器，保留数组的展开、拖拽和多对象编辑能力。
        DrawPropertiesExcluding(serializedObject, "m_Script", ConfiguredProcessIdPropertyName);
        serializedObject.ApplyModifiedProperties();

        EditorGUILayout.Space(6f);
        if (GUILayout.Button("校验场景绑定"))
        {
            ValidateConfiguration();
        }
    }

    /// <summary>
    /// 在编辑器中执行一次有界校验，尽早发现运行时会导致节点不可聚焦或四态能力关闭的问题。
    /// 校验只读 SerializedProperty，绝不根据对象名称补齐或替换目标引用。
    /// </summary>
    private void ValidateConfiguration()
    {
        serializedObject.Update();

        List<string> errors = new List<string>();
        List<string> warnings = new List<string>();
        HashSet<string> nodeIds = new HashSet<string>(System.StringComparer.Ordinal);

        string processId = _configuredProcessId != null ? _configuredProcessId.stringValue : string.Empty;
        if (processId != "gas-power-generation" && processId != "coal-power-generation")
        {
            errors.Add("流程标识必须是 gas-power-generation 或 coal-power-generation。");
        }

        if (_sceneRoot == null || _sceneRoot.objectReferenceValue == null)
        {
            errors.Add("未配置场景根节点。");
        }

        if (_interactionCamera == null || _interactionCamera.objectReferenceValue == null)
        {
            warnings.Add("未配置交互相机，三维点击反向选择将不可用。");
        }

        ValidateNodeBindings(_nodes, "节点绑定", nodeIds, errors);
        ValidateVisualStateBindings(_visualStateBindings, _visualStateColorPropertyNames, nodeIds, errors, warnings);

        serializedObject.ApplyModifiedProperties();

        if (errors.Count > 0)
        {
            Debug.LogError(
                $"[PowerPlantProcessController] 属性面板校验失败：{string.Join("；", errors)}",
                target);
            return;
        }

        if (warnings.Count > 0)
        {
            Debug.LogWarning(
                $"[PowerPlantProcessController] 属性面板校验通过，但有提示：{string.Join("；", warnings)}",
                target);
            return;
        }

        Debug.Log("[PowerPlantProcessController] 属性面板绑定校验通过。", target);
    }

    /// <summary>
    /// 检查普通场景节点：标识必须唯一，目标数组必须包含真实场景对象且至少有一个渲染器。
                // 每个节点独立校验完整性，不允许节点间共享配置掩盖缺项。
    /// </summary>
    private static void ValidateNodeBindings(
        SerializedProperty bindings,
        string label,
        HashSet<string> nodeIds,
        List<string> errors)
    {
        if (bindings == null || !bindings.isArray || bindings.arraySize == 0)
        {
            errors.Add($"{label}为空。");
            return;
        }

        Dictionary<GameObject, string> pointerNodeIdByTarget = new Dictionary<GameObject, string>();
        for (int index = 0; index < bindings.arraySize; index++)
        {
            SerializedProperty element = bindings.GetArrayElementAtIndex(index);
            SerializedProperty id = element.FindPropertyRelative("_id");
            SerializedProperty targets = element.FindPropertyRelative("_targets");
            SerializedProperty topologyOnlySelection = element.FindPropertyRelative("_topologyOnlySelection");
            string sceneNodeId = id != null ? id.stringValue : string.Empty;

            if (string.IsNullOrWhiteSpace(sceneNodeId))
            {
                errors.Add($"{label}[{index}]缺少 sceneNodeId。");
            }
            else if (!nodeIds.Add(sceneNodeId))
            {
                errors.Add($"{label}存在重复 sceneNodeId：{sceneNodeId}。");
            }

            ValidateTargetArray(targets, $"{label}[{index}]", errors, requireRenderer: true);

            // 仅拓扑节点可以与下级物理设备共享主设备；两个允许三维点击的节点不得共享目标，
            // 否则运行时反向索引会被后写节点覆盖，导致模型点击选中错误的拓扑节点。
            bool isTopologyOnly = topologyOnlySelection != null && topologyOnlySelection.boolValue;
            if (isTopologyOnly || targets == null || !targets.isArray)
            {
                continue;
            }

            for (int targetIndex = 0; targetIndex < targets.arraySize; targetIndex++)
            {
                GameObject targetObject = targets.GetArrayElementAtIndex(targetIndex).objectReferenceValue as GameObject;
                if (targetObject == null)
                {
                    continue;
                }

                if (pointerNodeIdByTarget.TryGetValue(targetObject, out string existingNodeId))
                {
                    errors.Add($"允许三维点击的节点 {sceneNodeId} 与 {existingNodeId} 共享目标：{targetObject.name}。");
                }
                else
                {
                    pointerNodeIdByTarget.Add(targetObject, sceneNodeId);
                }
            }
        }
    }

    /// <summary>
    /// 检查四态目标只能引用已登记的普通节点；这会阻止误把 SIS 逻辑节点或黑色模型写入视觉状态表。
    /// </summary>
    private static void ValidateVisualStateBindings(
        SerializedProperty bindings,
        SerializedProperty colorPropertyNames,
        HashSet<string> nodeIds,
        List<string> errors,
        List<string> warnings)
    {
        if (bindings == null || !bindings.isArray || bindings.arraySize == 0)
        {
            warnings.Add("未登记四态视觉目标，节点状态不会驱动三维材质。");
            return;
        }

        List<string> configuredColorPropertyNames = ReadColorPropertyNames(colorPropertyNames, errors);
        if (configuredColorPropertyNames.Count == 0)
        {
            return;
        }

        HashSet<string> visualIds = new HashSet<string>(System.StringComparer.Ordinal);
        for (int index = 0; index < bindings.arraySize; index++)
        {
            SerializedProperty element = bindings.GetArrayElementAtIndex(index);
            SerializedProperty id = element.FindPropertyRelative("_sceneNodeId");
            SerializedProperty targets = element.FindPropertyRelative("_targets");
            string sceneNodeId = id != null ? id.stringValue : string.Empty;

            if (string.IsNullOrWhiteSpace(sceneNodeId))
            {
                errors.Add($"四态绑定[{index}]缺少 sceneNodeId。");
            }
            else if (!nodeIds.Contains(sceneNodeId))
            {
                errors.Add($"四态绑定引用了未登记节点：{sceneNodeId}。");
            }
            else if (!visualIds.Add(sceneNodeId))
            {
                errors.Add($"四态绑定存在重复 sceneNodeId：{sceneNodeId}。");
            }

            ValidateTargetArray(
                targets,
                $"四态绑定[{index}]",
                errors,
                requireRenderer: true,
                colorPropertyNames: configuredColorPropertyNames);
        }
    }

    /// <summary>
    /// 检查目标引用是否为空以及是否能找到子级渲染器。对象可以是 FBX 根节点，渲染器允许位于其子级。
    /// </summary>
    private static void ValidateTargetArray(
        SerializedProperty targets,
        string label,
        List<string> errors,
        bool requireRenderer,
        IReadOnlyList<string> colorPropertyNames = null)
    {
        if (targets == null || !targets.isArray || targets.arraySize == 0)
        {
            errors.Add($"{label}没有目标对象。");
            return;
        }

        for (int index = 0; index < targets.arraySize; index++)
        {
            UnityEngine.Object reference = targets.GetArrayElementAtIndex(index).objectReferenceValue;
            GameObject targetObject = reference as GameObject;
            if (targetObject == null)
            {
                errors.Add($"{label}.targets[{index}]存在空引用或非游戏对象（GameObject）引用。");
                continue;
            }

            Renderer[] renderers = targetObject.GetComponentsInChildren<Renderer>(true);
            if (requireRenderer && renderers.Length == 0)
            {
                errors.Add($"{label}.targets[{index}]没有可用渲染器：{targetObject.name}。");
                continue;
            }

            if (colorPropertyNames == null)
            {
                continue;
            }

            for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
            {
                Renderer renderer = renderers[rendererIndex];
                Material[] materials = renderer.sharedMaterials;
                if (materials == null || materials.Length == 0)
                {
                    errors.Add($"{label}.targets[{index}]的渲染器 {renderer.name} 没有共享材质。");
                    continue;
                }

                for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
                {
                    Material material = materials[materialIndex];
                    if (material == null)
                    {
                        errors.Add($"{label}.targets[{index}]的渲染器 {renderer.name} 材质槽 {materialIndex} 为空。");
                        continue;
                    }

                    bool hasConfiguredColorProperty = false;
                    for (int propertyIndex = 0; propertyIndex < colorPropertyNames.Count; propertyIndex++)
                    {
                        if (material.HasProperty(colorPropertyNames[propertyIndex]))
                        {
                            hasConfiguredColorProperty = true;
                            break;
                        }
                    }

                    if (!hasConfiguredColorProperty)
                    {
                        errors.Add(
                            $"{label}.targets[{index}]的材质 {material.name} 不支持属性面板登记的任何颜色属性：{string.Join(", ", colorPropertyNames)}。");
                    }
                }
            }
        }
    }

    /// <summary>
    /// 读取属性面板登记的候选颜色属性，并在编辑器阶段拒绝空字符串和重复项。
    /// 运行时注册表会按同一顺序选取每个材质槽的实际属性，保证校验和执行使用同一事实源。
    /// </summary>
    private static List<string> ReadColorPropertyNames(SerializedProperty property, List<string> errors)
    {
        List<string> names = new List<string>();
        if (property == null || !property.isArray || property.arraySize == 0)
        {
            errors.Add("四态颜色属性候选列表为空。");
            return names;
        }

        HashSet<string> seen = new HashSet<string>(System.StringComparer.Ordinal);
        for (int index = 0; index < property.arraySize; index++)
        {
            string name = property.GetArrayElementAtIndex(index).stringValue;
            if (string.IsNullOrWhiteSpace(name))
            {
                errors.Add($"四态颜色属性候选[{index}]为空。");
                continue;
            }
            if (!seen.Add(name))
            {
                errors.Add($"四态颜色属性候选存在重复项：{name}。");
                continue;
            }
            names.Add(name);
        }

        return names;
    }
}
