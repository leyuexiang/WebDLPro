using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using WebDLPro.Unity.SceneRuntime;

namespace WebDLPro.Unity.Tests
{
    /// <summary>
    /// 验证共享资源按完全相同的场景使用集合分组，确保轻量总览不会被业务场景专用资源拖入大共享包。
    /// </summary>
    public sealed class SceneBundleDependencyPlannerTests
    {
        [Test]
        public void 相同消费者的共享资源合并且不同消费者资源隔离()
        {
            Dictionary<string, HashSet<string>> consumersByAssetPath = new Dictionary<string, HashSet<string>>
            {
                { "Assets/Shared/CommonA.mat", new HashSet<string> { "gas-power", "coal-power" } },
                { "Assets/Shared/CommonB.mat", new HashSet<string> { "coal-power", "gas-power" } },
                { "Assets/Overview/Label.font", new HashSet<string> { "overview", "gas-power" } },
                { "Assets/Coal/Boiler.fbx", new HashSet<string> { "coal-power" } }
            };

            IReadOnlyList<SceneBundleDependencyPlan> plans = SceneBundleDependencyPlanner.CreateSharedBundlePlans(consumersByAssetPath);

            Assert.That(plans, Has.Count.EqualTo(2), "只应为至少两个场景共用的资源创建共享包。");
            Assert.That(plans.Sum(plan => plan.AssetPaths.Count), Is.EqualTo(3), "共享资源必须且只能进入一个消费者组。");

            SceneBundleDependencyPlan businessPlan = plans.Single(plan => plan.AssetPaths.Contains("Assets/Shared/CommonA.mat"));
            CollectionAssert.AreEqual(new[] { "coal-power", "gas-power" }, businessPlan.SceneIds);
            CollectionAssert.AreEqual(new[] { "Assets/Shared/CommonA.mat", "Assets/Shared/CommonB.mat" }, businessPlan.AssetPaths);

            SceneBundleDependencyPlan overviewPlan = plans.Single(plan => plan.AssetPaths.Contains("Assets/Overview/Label.font"));
            CollectionAssert.AreEqual(new[] { "gas-power", "overview" }, overviewPlan.SceneIds);
            CollectionAssert.AreEqual(new[] { "Assets/Overview/Label.font" }, overviewPlan.AssetPaths);
            Assert.That(plans.SelectMany(plan => plan.AssetPaths), Does.Not.Contain("Assets/Coal/Boiler.fbx"));
        }

        [Test]
        public void 分组名称和资产顺序不受输入字典插入顺序影响()
        {
            Dictionary<string, HashSet<string>> firstInput = new Dictionary<string, HashSet<string>>
            {
                { "Assets/Z.mat", new HashSet<string> { "gas-power", "coal-power" } },
                { "Assets/A.mat", new HashSet<string> { "coal-power", "gas-power" } }
            };
            Dictionary<string, HashSet<string>> secondInput = new Dictionary<string, HashSet<string>>
            {
                { "Assets/A.mat", new HashSet<string> { "gas-power", "coal-power" } },
                { "Assets/Z.mat", new HashSet<string> { "coal-power", "gas-power" } }
            };

            IReadOnlyList<SceneBundleDependencyPlan> firstPlans = SceneBundleDependencyPlanner.CreateSharedBundlePlans(firstInput);
            IReadOnlyList<SceneBundleDependencyPlan> secondPlans = SceneBundleDependencyPlanner.CreateSharedBundlePlans(secondInput);

            Assert.That(firstPlans, Has.Count.EqualTo(1));
            Assert.That(secondPlans, Has.Count.EqualTo(1));
            Assert.That(firstPlans[0].BundleName, Is.EqualTo(secondPlans[0].BundleName));
            CollectionAssert.AreEqual(new[] { "Assets/A.mat", "Assets/Z.mat" }, firstPlans[0].AssetPaths);
        }
    }
}
