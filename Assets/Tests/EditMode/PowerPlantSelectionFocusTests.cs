using System;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using WebDLPro.Unity.SceneRuntime;
using Object = UnityEngine.Object;

namespace WebDLPro.Unity.Tests
{
    public sealed class PowerPlantSelectionFocusTests
    {
        [TestCase(false)]
        [TestCase(true)]
        public void FocusFadesOtherRenderersAndRestoresSelectionAcrossHierarchy(bool grouped)
        {
            GameObject runtime = new GameObject("FocusTestRuntime");
            GameObject root = new GameObject("FocusTestScene");
            try
            {
                Transform parent = root.transform;
                if (grouped)
                {
                    GameObject group = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    group.name = "Equipment";
                    group.transform.SetParent(parent, false);
                    parent = group.transform;
                }

                GameObject first = CreateModel("First", parent);
                CreateModel("FirstChild", first.transform);
                GameObject second = CreateModel("Second", parent);
                CreateModel("Environment", root.transform);
                Renderer[] renderers = root.GetComponentsInChildren<Renderer>(true);
                Material[][] originals = Array.ConvertAll(renderers, renderer => renderer.sharedMaterials);
                Type controllerType = Type.GetType("PowerPlantProcessController, Assembly-CSharp");
                Assert.That(controllerType, Is.Not.Null);
                Component controller = runtime.AddComponent(controllerType);
                SerializedObject properties = new SerializedObject(controller);
                properties.FindProperty("_sceneRoot").objectReferenceValue = root.transform;
                properties.FindProperty("_focusOnSelection").boolValue = false;
                properties.FindProperty("_applyInitialOverviewContext").boolValue = false;
                Material fade = AssetDatabase.LoadAssetAtPath<Material>("Assets/Shaders/PowerPlant_ContextFade.mat");
                Assert.That(fade, Is.Not.Null);
                properties.FindProperty("_contextFadeMaterial").objectReferenceValue = fade;
                properties.FindProperty("_contextOpacity").floatValue = 0.15f;
                SerializedProperty nodes = properties.FindProperty("_nodes");
                nodes.arraySize = 2;
                ConfigureNode(nodes.GetArrayElementAtIndex(0), "first", first);
                ConfigureNode(nodes.GetArrayElementAtIndex(1), "second", second);
                // 重叠登记同一分组时，也不能将选中子模型重新淡化。
                SerializedProperty contexts = properties.FindProperty("_overviewContextObjects");
                contexts.arraySize = 1;
                contexts.GetArrayElementAtIndex(0).objectReferenceValue = parent.gameObject;
                properties.ApplyModifiedPropertiesWithoutUndo();
                controllerType.GetMethod("CacheSceneBindings", BindingFlags.Instance | BindingFlags.NonPublic)
                    .Invoke(controller, null);

                FocusNode(controllerType, controller, "first");
                AssertAppearance(renderers, originals, first);
                FocusNode(controllerType, controller, "second");
                AssertAppearance(renderers, originals, second);

                MethodInfo namedFocus = controllerType.GetMethod("TryApplyNamedCameraVisualFocus");
                object[] namedArgs = { new[] { first, second }, null };
                Assert.That((bool)namedFocus.Invoke(controller, namedArgs), Is.True, namedArgs[1] as string);
                AssertAppearance(renderers, originals, first, second);

                // 选中整组时子模型全部保留，组外环境仍淡化。
                if (grouped)
                {
                    namedArgs = new object[] { new[] { parent.gameObject }, null };
                    Assert.That((bool)namedFocus.Invoke(controller, namedArgs), Is.True, namedArgs[1] as string);
                    AssertAppearance(renderers, originals, parent.gameObject);
                }

                // 场景重置和相机视觉重置均应回到初始原材质，且后续仍可再次聚焦。
                string[] resetMethods = { "TryResetScene", "TryResetOverviewVisualsPreservingDeviceStates" };
                foreach (string method in resetMethods)
                {
                    FocusNode(controllerType, controller, "first");
                    object[] args = { null };
                    Assert.That((bool)controllerType.GetMethod(method).Invoke(controller, args), Is.True, args[args.Length - 1] as string);
                    for (int i = 0; i < renderers.Length; i++)
                    {
                        CollectionAssert.AreEqual(originals[i], renderers[i].sharedMaterials, method + ": " + renderers[i].name);
                    }
                }
            }
            finally
            {
                Object.DestroyImmediate(runtime);
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void 风电四个关键步骤的命名镜头和高亮模型显式绑定()
        {
            const string scenePath = "Assets/Scenes/Business/WindPower.unity";
            Scene windScene = SceneManager.GetSceneByPath(scenePath);
            bool openedForTest = !windScene.IsValid() || !windScene.isLoaded;
            if (openedForTest)
            {
                windScene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Additive);
            }

            try
            {
                BusinessSceneNamedCameraPoseRegistry registry = null;
                GameObject[] roots = windScene.GetRootGameObjects();
                for (int rootIndex = 0; rootIndex < roots.Length && registry == null; rootIndex++)
                {
                    registry = roots[rootIndex].GetComponentInChildren<BusinessSceneNamedCameraPoseRegistry>(true);
                }

                Assert.That(registry, Is.Not.Null, "风电场景缺少命名镜头注册表。");
                SerializedProperty poses = new SerializedObject(registry).FindProperty("_cameraPoses");
                Assert.That(poses, Is.Not.Null);
                Assert.That(poses.arraySize, Is.EqualTo(4), "风电场景必须登记四个关键环节命名镜头。");

                string[] expectedIds =
                {
                    "wind-power.camera.wind-generation",
                    "wind-power.camera.step-up-transmission",
                    "wind-power.camera.energy-storage",
                    "wind-power.camera.grid-output"
                };
                int[] expectedTargetCounts = { 16, 7, 1, 1 };

                for (int poseIndex = 0; poseIndex < poses.arraySize; poseIndex++)
                {
                    SerializedProperty pose = poses.GetArrayElementAtIndex(poseIndex);
                    Assert.That(pose.FindPropertyRelative("_cameraPoseId").stringValue, Is.EqualTo(expectedIds[poseIndex]));
                    Assert.That(pose.FindPropertyRelative("_targetPose").objectReferenceValue, Is.Not.Null,
                        $"镜头 {expectedIds[poseIndex]} 缺少相机目标点。");

                    SerializedProperty targets = pose.FindPropertyRelative("_highlightTargets");
                    Assert.That(targets.arraySize, Is.EqualTo(expectedTargetCounts[poseIndex]),
                        $"镜头 {expectedIds[poseIndex]} 的高亮目标数量错误。");
                    for (int targetIndex = 0; targetIndex < targets.arraySize; targetIndex++)
                    {
                        Assert.That(targets.GetArrayElementAtIndex(targetIndex).objectReferenceValue, Is.Not.Null,
                            $"镜头 {expectedIds[poseIndex]} 的高亮目标为空。");
                    }
                }
            }
            finally
            {
                if (openedForTest)
                {
                    EditorSceneManager.CloseScene(windScene, true);
                }
            }
        }

        [Test]
        public void 光伏四个关键步骤的命名镜头和高亮模型显式绑定()
        {
            const string scenePath = "Assets/Scenes/Business/SolarPower.unity";
            Scene solarScene = SceneManager.GetSceneByPath(scenePath);
            bool openedForTest = !solarScene.IsValid() || !solarScene.isLoaded;
            if (openedForTest)
            {
                solarScene = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Additive);
            }

            try
            {
                BusinessSceneNamedCameraPoseRegistry registry = null;
                GameObject[] roots = solarScene.GetRootGameObjects();
                for (int rootIndex = 0; rootIndex < roots.Length && registry == null; rootIndex++)
                {
                    registry = roots[rootIndex].GetComponentInChildren<BusinessSceneNamedCameraPoseRegistry>(true);
                }

                Assert.That(registry, Is.Not.Null, "光伏场景缺少命名镜头注册表。");
                SerializedProperty poses = new SerializedObject(registry).FindProperty("_cameraPoses");
                Assert.That(poses, Is.Not.Null);
                Assert.That(poses.arraySize, Is.EqualTo(4), "光伏场景必须登记四个关键环节命名镜头。");

                string[] expectedIds =
                {
                    "solar-power.camera.solar-array",
                    "solar-power.camera.combiner-inverter",
                    "solar-power.camera.energy-storage",
                    "solar-power.camera.grid-output"
                };
                string[][] expectedTargets =
                {
                    new[] { "SceneRoot/Equipment/光伏板" },
                    new[]
                    {
                        "SceneRoot/Equipment/逆变器控制/汇流箱＋逆变器",
                        "SceneRoot/Equipment/逆变器控制/汇流箱＋逆变器.001",
                        "SceneRoot/Equipment/逆变器控制/汇流箱＋逆变器.002",
                        "SceneRoot/Equipment/逆变器控制/汇流箱＋逆变器.003",
                        "SceneRoot/Equipment/逆变器控制/汇流箱＋逆变器.004",
                        "SceneRoot/Equipment/逆变器控制/汇流箱＋逆变器.005"
                    },
                    new[] { "SceneRoot/Equipment/储能箱" },
                    new[] { "SceneRoot/Equipment/变压器1" }
                };

                for (int poseIndex = 0; poseIndex < poses.arraySize; poseIndex++)
                {
                    SerializedProperty pose = poses.GetArrayElementAtIndex(poseIndex);
                    Assert.That(pose.FindPropertyRelative("_cameraPoseId").stringValue, Is.EqualTo(expectedIds[poseIndex]));
                    Assert.That(pose.FindPropertyRelative("_targetPose").objectReferenceValue, Is.Not.Null,
                        $"镜头 {expectedIds[poseIndex]} 缺少相机目标点。");

                    SerializedProperty targets = pose.FindPropertyRelative("_highlightTargets");
                    Assert.That(targets.arraySize, Is.EqualTo(expectedTargets[poseIndex].Length),
                        $"镜头 {expectedIds[poseIndex]} 的高亮目标数量错误。");
                    for (int targetIndex = 0; targetIndex < targets.arraySize; targetIndex++)
                    {
                        GameObject target = targets.GetArrayElementAtIndex(targetIndex).objectReferenceValue as GameObject;
                        Assert.That(target, Is.Not.Null, $"镜头 {expectedIds[poseIndex]} 的高亮目标为空。");
                        Assert.That(GetSceneHierarchyPath(target.transform), Is.EqualTo(expectedTargets[poseIndex][targetIndex]));
                    }
                }
            }
            finally
            {
                if (openedForTest)
                {
                    EditorSceneManager.CloseScene(solarScene, true);
                }
            }
        }

        private static string GetSceneHierarchyPath(Transform target)
        {
            System.Collections.Generic.List<string> segments = new System.Collections.Generic.List<string>();
            for (Transform current = target; current != null; current = current.parent)
            {
                segments.Insert(0, current.name);
            }

            return string.Join("/", segments);
        }

        private static GameObject CreateModel(string name, Transform parent)
        {
            GameObject model = GameObject.CreatePrimitive(PrimitiveType.Cube);
            model.name = name;
            model.transform.SetParent(parent, false);
            return model;
        }

        private static void ConfigureNode(SerializedProperty node, string id, GameObject target)
        {
            node.FindPropertyRelative("_id").stringValue = id;
            SerializedProperty targets = node.FindPropertyRelative("_targets");
            targets.arraySize = 1;
            targets.GetArrayElementAtIndex(0).objectReferenceValue = target;
        }

        private static void FocusNode(Type type, Component controller, string id)
        {
            object[] args = { id, false, null };
            Assert.That((bool)type.GetMethod("TryFocusNode").Invoke(controller, args), Is.True, args[2] as string);
        }

        private static void AssertAppearance(Renderer[] renderers, Material[][] originals, params GameObject[] selected)
        {
            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer renderer = renderers[i];
                bool keepOriginal = Array.Exists(selected, target => renderer.transform == target.transform ||
                    renderer.transform.IsChildOf(target.transform));
                if (keepOriginal)
                {
                    CollectionAssert.AreEqual(originals[i], renderer.sharedMaterials, renderer.name);
                }
                else
                {
                    Assert.That(renderer.sharedMaterial, Is.Not.SameAs(originals[i][0]), renderer.name);
                    Assert.That(renderer.sharedMaterial.GetFloat("_Opacity"), Is.EqualTo(0.15f).Within(0.001f), renderer.name);
                }
            }
        }
    }
}
