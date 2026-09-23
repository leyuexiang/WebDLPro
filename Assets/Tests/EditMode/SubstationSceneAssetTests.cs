using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

namespace WebDLPro.Unity.Tests
{
    public sealed class SubstationSceneAssetTests
    {
        [TestCase("step-up-substation", "Assets/Scenes/Business/StepUpSubstation.unity", "Assets/Art/升压站场景/Materials/")]
        [TestCase("step-down-substation", "Assets/Scenes/Business/StepDownSubstation.unity", "Assets/Art/降压站场景/Materials/")]
        public void 新增变电站具备独立材质与可初始化浏览入口(string sceneId, string path, string materialFolder)
        {
            var scene = EditorSceneManager.OpenScene(path, OpenSceneMode.Additive);
            try
            {
                var catalog = AssetDatabase.LoadAssetAtPath<BusinessSceneCatalog>("Assets/Configuration/BusinessSceneCatalog.asset");
                Assert.That(catalog.TryGetBySceneId(sceneId, out var entry), Is.True);
                Assert.That(BusinessSceneControllerRegistry.TryResolve(scene, entry, out var controller, out var error), Is.True, error);
                bool completed = false;
                var routine = controller.InitializeAsync(new BusinessSceneInitializationContext(sceneId, sceneId, "test.substation", false), result =>
                {
                    Assert.That(result.Success, Is.True, result.Message);
                    completed = true;
                });
                while (routine.MoveNext()) { }
                Assert.That(completed, Is.True);
                var roots = scene.GetRootGameObjects();
                Assert.That(roots.SelectMany(g => g.GetComponentsInChildren<Camera>(true)).Count(c => c.enabled), Is.EqualTo(1));
                var renderers = roots.SelectMany(g => g.GetComponentsInChildren<Renderer>(true)).ToArray();
                Assert.That(renderers.Length, Is.GreaterThan(0));
                foreach (var material in renderers.SelectMany(r => r.sharedMaterials).Distinct())
                {
                    Assert.That(material, Is.Not.Null);
                    Assert.That(AssetDatabase.GetAssetPath(material), Does.StartWith(materialFolder));
                    Assert.That(material.shader.isSupported, Is.True, material.name);
                }
                Assert.That(controller.ReleaseScene().Success, Is.True);
                Assert.That(controller.ReleaseScene().Success, Is.True);
            }
            finally
            {
                EditorSceneManager.CloseScene(scene, true);
            }
        }
    }
}
