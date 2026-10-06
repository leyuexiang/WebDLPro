using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;
using Object = UnityEngine.Object;

namespace WebDLPro.Unity.Tests
{
    /// <summary>
    /// 偏航系统第三层资源的结构契约：自动机位必须覆盖模型包围盒并看向中心，
    /// 稳定标识（关键环节/资源/相机位/状态节点）与目录登记一致，
    /// 齿轮 Animator 全部进入动态适配且保留制作期速度，四态渲染器覆盖全部不透明网格。
    /// </summary>
    public sealed class YawSystemDetailPresentationTests
    {
        private const string PrefabPath = "Assets/ProcessDetails/WindPower/YawSystem/YawSystemProcessDetail.prefab";

        private static (Transform anchor, Transform pose, Bounds localBounds) LoadDetail()
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            Assert.That(prefab, Is.Not.Null, "偏航系统第三层预制体未生成。");
            Transform anchor = prefab.transform.Find("DisplayAnchor");
            Transform pose = prefab.transform.Find("CameraPose");
            Assert.That(anchor, Is.Not.Null, "缺少远端展示锚点。");
            Assert.That(pose, Is.Not.Null, "缺少相机位节点。");
            return (anchor, pose, ComputeLocalBounds(anchor));
        }

        /// <summary>把模型全部网格渲染器的世界包围盒换算到锚点局部空间，形成与展示区域无关的稳定几何。/// </summary>
        private static Bounds ComputeLocalBounds(Transform anchor)
        {
            var bounds = new Bounds();
            bool first = true;
            foreach (Renderer renderer in anchor.GetComponentsInChildren<Renderer>(true))
            {
                if (!(renderer is MeshRenderer)) continue;
                Vector3 min = anchor.InverseTransformPoint(renderer.bounds.min);
                Vector3 max = anchor.InverseTransformPoint(renderer.bounds.max);
                Vector3 localMin = Vector3.Min(min, max);
                Vector3 localMax = Vector3.Max(min, max);
                if (first)
                {
                    bounds = new Bounds((localMin + localMax) * 0.5f, localMax - localMin);
                    first = false;
                }
                else
                {
                    bounds.Encapsulate(new Bounds((localMin + localMax) * 0.5f, localMax - localMin));
                }
            }

            Assert.That(first, Is.False, "偏航模型没有任何网格渲染器。");
            return bounds;
        }

        [Test]
        public void AutoCameraPoseStaysOutsideBoundsAndLooksAtCenter()
        {
            var (anchor, pose, bounds) = LoadDetail();
            Vector3 poseLocal = anchor.InverseTransformPoint(pose.position);
            float surfaceDistance = Vector3.Distance(poseLocal, bounds.ClosestPoint(poseLocal));
            Assert.That(surfaceDistance, Is.GreaterThan(1f), "自动机位必须离开模型表面，避免穿模。");
            Vector3 viewDirection = (bounds.center - poseLocal).normalized;
            Vector3 poseForward = (anchor.InverseTransformDirection(pose.forward)).normalized;
            Assert.That(Vector3.Angle(viewDirection, poseForward), Is.LessThan(1f), "初始机位必须看向模型包围盒中心。");
        }

        [Test]
        public void DeviceBindingRegistersApprovedStableIdentifiers()
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            var binding = new SerializedObject(prefab.GetComponent<ProcessDetailDeviceBinding>());
            Assert.That(binding.FindProperty("_processDetailId").stringValue, Is.EqualTo("process-detail.wind-power.yaw-system"));
            Assert.That(binding.FindProperty("_resourceId").stringValue, Is.EqualTo("process-detail-resource.wind-power.yaw-system"));
            Assert.That(binding.FindProperty("_cameraPoseId").stringValue, Is.EqualTo("camera-pose.wind-power.yaw-system"));
            var stateNodeIds = binding.FindProperty("_stateNodeIds");
            Assert.That(stateNodeIds.arraySize, Is.EqualTo(1));
            Assert.That(stateNodeIds.GetArrayElementAtIndex(0).stringValue, Is.EqualTo("node.wind-yaw-system"));
            Assert.That(binding.FindProperty("_displayAnchor").objectReferenceValue, Is.EqualTo(prefab.transform.Find("DisplayAnchor")));
            Assert.That(binding.FindProperty("_cameraPose").objectReferenceValue, Is.EqualTo(prefab.transform.Find("CameraPose")));
        }

        [Test]
        public void YawDynamicAdapterHoldsAllGearAnimatorsWithAuthoredSpeeds()
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            var adapter = new SerializedObject(prefab.GetComponent("YawSystemProcessDetailDynamicAdapter"));
            var animators = adapter.FindProperty("_gearAnimators");
            var speeds = adapter.FindProperty("_authoredSpeeds");
            Animator[] authored = prefab.GetComponentsInChildren<Animator>(true);
            Assert.That(animators.arraySize, Is.EqualTo(authored.Length), "全部齿轮 Animator 必须进入动态适配。");
            Assert.That(animators.arraySize, Is.GreaterThan(0));
            Assert.That(speeds.arraySize, Is.EqualTo(animators.arraySize));
            for (int index = 0; index < speeds.arraySize; index++)
            {
                Assert.That(speeds.GetArrayElementAtIndex(index).floatValue, Is.GreaterThan(0f), "制作期动画速度必须为正，恢复播放时不得停摆。");
            }
        }

        [Test]
        public void StateVisualAdapterCoversEveryFourStateCapableRenderer()
        {
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            var state = new SerializedObject(prefab.GetComponent<ProcessDetailStateVisualAdapter>());
            var renderers = state.FindProperty("_renderers");
            int meshRendererCount = prefab
                .transform.Find("DisplayAnchor")
                .GetComponentsInChildren<MeshRenderer>(true)
                .Count(renderer => renderer.sharedMaterials.All(material => material != null));
            // 偏航模型材质全部带 _BASE_COLOR，四态渲染器必须覆盖全部网格渲染器，不允许静默漏渲。
            Assert.That(renderers.arraySize, Is.EqualTo(meshRendererCount));
        }

        [Test]
        public void CatalogRegistersYawSystemEntryWithEditorPrefab()
        {
            ProcessDetailCatalog catalog = AssetDatabase.LoadAssetAtPath<ProcessDetailCatalog>("Assets/Configuration/ProcessDetailCatalog.asset");
            Assert.That(catalog, Is.Not.Null);
            ProcessDetailCatalogEntry entry = catalog.Entries
                .FirstOrDefault(item => item != null && item.ProcessDetailId == "process-detail.wind-power.yaw-system");
            Assert.That(entry, Is.Not.Null, "目录缺少偏航系统关键环节条目。");
            Assert.That(entry.SceneId, Is.EqualTo("wind-power"));
            Assert.That(entry.ProcessId, Is.EqualTo("wind-power-generation"));
            Assert.That(entry.StepId, Is.EqualTo("yaw-system"));
            Assert.That(entry.StateNodeIds, Is.EqualTo(new[] { "node.wind-yaw-system" }));
            GameObject prefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath);
            Assert.That(entry.EditorPrefab, Is.EqualTo(prefab), "目录编辑器预制体必须指向偏航系统第三层资源。");
        }
    }
}
