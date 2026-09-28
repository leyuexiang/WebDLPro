using System;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

namespace WebDLPro.Unity.Tests
{
    public sealed class WindTurbineDetailPresentationTests
    {
        private const string DetailPath = "Assets/ProcessDetails/WindPower/WindTurbine/WindTurbineProcessDetail.prefab";
        private const string SourcePath = "Assets/Art/风机/FJPrefab.prefab";

        [Test]
        public void PackagedDetailKeepsSourceModelAndSevenExplicitCallouts()
        {
            GameObject root = AssetDatabase.LoadAssetAtPath<GameObject>(DetailPath);
            Transform model = root.transform.Find("DisplayAnchor/FJPrefab");
            Assert.That(PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(model.gameObject), Is.EqualTo(SourcePath));
            Type viewType = Type.GetType("GearboxExplodedView, Assembly-CSharp", true);
            Component view = model.GetComponent(viewType);
            Assert.That(view, Is.Not.Null);
            var serialized = new SerializedObject(view);
            var parts = serialized.FindProperty("_parts");
            string[] expected = { "变桨系统", "偏航系统", "齿轮箱", "刹车润滑油", "散热", "塔架", "塔底升压" };
            Assert.That(parts.arraySize, Is.EqualTo(expected.Length));
            for (int index = 0; index < expected.Length; index++)
            {
                SerializedProperty part = parts.GetArrayElementAtIndex(index);
                Assert.That(part.FindPropertyRelative("label").stringValue, Is.EqualTo(expected[index]));
                var target = part.FindPropertyRelative("target").objectReferenceValue as Transform;
                Assert.That(target, Is.Not.Null);
                Assert.That(target.IsChildOf(model), Is.True, "Callouts must not retain ShowTest scene references.");
                Assert.That(part.FindPropertyRelative("offset").vector3Value, Is.EqualTo(Vector3.zero));
            }
            Assert.That(serialized.FindProperty("_showControls").boolValue, Is.False);
            Assert.That(serialized.FindProperty("_showLabels").boolValue, Is.True);
            Assert.That(serialized.FindProperty("_targetCamera").objectReferenceValue, Is.Null);
            Assert.That(parts.GetArrayElementAtIndex(5).FindPropertyRelative("focusCameraOnClick").boolValue, Is.True);
            Assert.That(parts.GetArrayElementAtIndex(6).FindPropertyRelative("focusCameraOnClick").boolValue, Is.True);
            Assert.That(parts.GetArrayElementAtIndex(6).FindPropertyRelative("showOffscreenIndicator").boolValue, Is.True);
        }

        [Test]
        public void ReferenceCameraIsMappedToTheRemoteModelWithoutMovingGeometry()
        {
            GameObject root = AssetDatabase.LoadAssetAtPath<GameObject>(DetailPath);
            Transform model = root.transform.Find("DisplayAnchor/FJPrefab");
            Transform pose = root.transform.Find("CameraPose");
            Assert.That(Vector3.Distance(model.InverseTransformPoint(pose.position),
                new Vector3(-24.915f, 13.899681f, 5.956507f)), Is.LessThan(0.002f));
            Assert.That(Quaternion.Angle(pose.rotation,
                Quaternion.Euler(11.68839f, 123.2674f, -0.001468635f)), Is.LessThan(0.02f));
            Assert.That(root.GetComponent<ProcessDetailDeviceBinding>().CameraPose, Is.EqualTo(pose));
            GameObject source = AssetDatabase.LoadAssetAtPath<GameObject>(SourcePath);
            Assert.That(model.localPosition, Is.EqualTo(source.transform.localPosition));
            foreach (Renderer renderer in model.GetComponentsInChildren<Renderer>(true))
            {
                string relative = AnimationUtility.CalculateTransformPath(renderer.transform, model);
                Renderer original = source.transform.Find(relative).GetComponent<Renderer>();
                CollectionAssert.AreEqual(original.sharedMaterials, renderer.sharedMaterials, relative);
            }
        }

        [Test]
        public void StateTintTargetsExcludeRuntimeGlassAndHologramShells()
        {
            GameObject root = AssetDatabase.LoadAssetAtPath<GameObject>(DetailPath);
            Transform model = root.transform.Find("DisplayAnchor/FJPrefab");
            Type effectType = Type.GetType("WireframeHologramEffect, Assembly-CSharp", true);
            var effect = new SerializedObject(model.GetComponent(effectType));
            var state = new SerializedObject(root.GetComponent<ProcessDetailStateVisualAdapter>()).FindProperty("_renderers");
            Assert.That(state.arraySize, Is.GreaterThan(0));
            for (int index = 0; index < state.arraySize; index++)
            {
                Renderer renderer = state.GetArrayElementAtIndex(index).objectReferenceValue as Renderer;
                Assert.That(renderer, Is.Not.Null);
                foreach (string field in new[] { "glassTargets", "exteriorTargets", "extraTransparentTargets" })
                {
                    var excluded = effect.FindProperty(field);
                    for (int item = 0; item < excluded.arraySize; item++)
                    {
                        UnityEngine.Object target = excluded.GetArrayElementAtIndex(item).objectReferenceValue;
                        if (target is Renderer shell) Assert.That(renderer, Is.Not.EqualTo(shell));
                        if (target is Transform shellTransform)
                            Assert.That(renderer.transform == shellTransform || renderer.transform.IsChildOf(shellTransform), Is.False);
                    }
                }
            }
        }

        [Test]
        public void PausingTurbineRotationDoesNotDisableCalloutInteraction()
        {
            GameObject root = AssetDatabase.LoadAssetAtPath<GameObject>(DetailPath);
            Type adapterType = Type.GetType("WindPowerProcessDetailDynamicAdapter, Assembly-CSharp", true);
            var adapter = new SerializedObject(root.GetComponent(adapterType));
            Assert.That(adapter.FindProperty("_rotationControllers").arraySize, Is.EqualTo(1));
            Assert.That(adapter.FindProperty("_gearboxViews").arraySize, Is.Zero);
        }
    }
}
