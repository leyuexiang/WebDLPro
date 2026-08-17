using System.Collections;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityEngine;
using WebDLPro.Unity.SceneRuntime;

namespace WebDLPro.Unity.Tests
{
    /// <summary>验证九场景目录、能力登记和事务过滤的纯逻辑，不依赖用户正在编辑的 SampleScene。</summary>
    public sealed class BusinessSceneRuntimeTests
    {
        /// <summary>记录资源句柄的精确释放次数，用于验证幂等与释放后迟到登记行为。</summary>
        private sealed class TrackingDisposable : System.IDisposable
        {
            public int DisposeCount { get; private set; }

            public void Dispose()
            {
                DisposeCount++;
            }
        }

        [Test]
        public void 完整且唯一的九场景测试目录通过运行时校验()
        {
            BusinessSceneCatalog catalog = ScriptableObject.CreateInstance<BusinessSceneCatalog>();
            catalog.SetEntriesForEditor(CreateCompleteTestEntries());

            Assert.That(catalog.ValidateForRuntime(), Is.Empty);
            Assert.That(catalog.TryGetBySceneId("gas-power", out BusinessSceneCatalogEntry entry), Is.True);
            Assert.That(entry.UnitySceneKey, Is.EqualTo("test-unity-key.gas-power"));

            Object.DestroyImmediate(catalog);
        }

        [Test]
        public void 未解析或缺失正式条目会阻止目录进入运行时()
        {
            BusinessSceneCatalog catalog = ScriptableObject.CreateInstance<BusinessSceneCatalog>();
            List<BusinessSceneCatalogEntry> entries = CreateCompleteTestEntries();
            entries.RemoveAt(entries.Count - 1);
            entries[0] = new BusinessSceneCatalogEntry(
                "coal-power",
                string.Empty,
                string.Empty,
                BusinessSceneAvailability.Unresolved,
                BusinessSceneCapability.None);
            catalog.SetEntriesForEditor(entries);

            IReadOnlyList<BusinessSceneCatalogValidationIssue> issues = catalog.ValidateForRuntime();
            Assert.That(issues, Has.Some.Matches<BusinessSceneCatalogValidationIssue>(issue => issue.Code == "scene-catalog.count"));
            Assert.That(issues, Has.Some.Matches<BusinessSceneCatalogValidationIssue>(issue => issue.Code == "scene-catalog.unresolved"));
            Assert.That(issues, Has.Some.Matches<BusinessSceneCatalogValidationIssue>(issue => issue.Code == "scene-catalog.missing"));

            Object.DestroyImmediate(catalog);
        }

        [Test]
        public void 能力登记拒绝控制器多声明或少声明能力()
        {
            BusinessSceneCatalogEntry entry = new BusinessSceneCatalogEntry(
                "gas-power",
                "test-unity-key.gas-power",
                "Assets/Tests/Scenes/gas-power.unity",
                BusinessSceneAvailability.Available,
                BusinessSceneCapability.Initialize | BusinessSceneCapability.FocusNode);
            FakeBusinessSceneController controller = new FakeBusinessSceneController(
                "gas-power",
                BusinessSceneCapability.Initialize | BusinessSceneCapability.FocusNode | BusinessSceneCapability.SetRouteFlow);

            Assert.That(SceneCapabilityRegistry.MatchesCatalog(entry, controller, out string message), Is.False);
            Assert.That(message, Does.Contain("能力与登记表不一致"));
            Assert.That(controller.SetRouteFlow("route.test", true, 1f).Success, Is.False);
        }

        /// <summary>
        /// 控制器基类不能因能力位被错误声明就返回成功。
        /// 该回归用例模拟派生类只写能力清单、忘记覆写业务方法的情况，确保桥接收到的是可诊断失败，
        /// 而不是会让父页面误判命令已完成的静默空执行。
        /// </summary>
        [Test]
        public void 基类拒绝已声明但未实现的业务能力且释放保持幂等()
        {
            GameObject runtimeRoot = new GameObject("DeclaredButUnimplementedControllerTestRoot");
            DeclaredButUnimplementedController controller = runtimeRoot.AddComponent<DeclaredButUnimplementedController>();

            BusinessSceneCommandResult focusResult = controller.FocusNode("node.test", true);
            Assert.That(focusResult.Success, Is.False);
            Assert.That(focusResult.ErrorCode, Is.EqualTo("capability-not-implemented"));

            bool callbackReceived = false;
            BusinessSceneCommandResult initializationResult = default;
            IEnumerator initialization = controller.InitializeAsync(
                new BusinessSceneInitializationContext("coal-power", "coal-power", "transition.test", false),
                result =>
                {
                    callbackReceived = true;
                    initializationResult = result;
                });
            while (initialization.MoveNext())
            {
            }
            Assert.That(callbackReceived, Is.True);
            Assert.That(initializationResult.ErrorCode, Is.EqualTo("capability-not-implemented"));
            Assert.That(controller.ReleaseScene().Success, Is.True);
            Assert.That(controller.ReleaseScene().Success, Is.True);

            Object.DestroyImmediate(runtimeRoot);
        }

        /// <summary>
        /// 四态视觉适配器必须只修改显式登记渲染器的材质属性块，并在高频状态切换中保持共享材质引用不变。
        /// 该测试使用 Unity 内置立方体的现有共享材质，不创建业务材质或猜测正式场景颜色；
        /// 同时覆盖未知节点和释放后调用的结构化失败，避免桥接收到静默成功。
        /// </summary>
        [Test]
        public void 四态视觉适配器复用材质属性且未知节点返回明确错误()
        {
            GameObject visualRoot = GameObject.CreatePrimitive(PrimitiveType.Cube);
            Renderer renderer = visualRoot.GetComponent<Renderer>();
            Assert.That(renderer, Is.Not.Null);
            Material originalSharedMaterial = renderer.sharedMaterial;
            Assert.That(originalSharedMaterial, Is.Not.Null);

            string colorPropertyName = originalSharedMaterial.HasProperty("_BaseColor")
                ? "_BaseColor"
                : originalSharedMaterial.HasProperty("_Color") ? "_Color" : string.Empty;
            Assert.That(colorPropertyName, Is.Not.Empty, "测试共享材质必须提供一个可由材质属性块覆盖的颜色属性。");

            Color normalColor = new Color(0.15f, 0.75f, 0.95f, 1f);
            Color alarmColor = new Color(1f, 0.65f, 0.1f, 1f);
            Color faultColor = new Color(1f, 0.15f, 0.15f, 1f);
            Color offlineColor = new Color(0.35f, 0.35f, 0.35f, 1f);
            BusinessSceneVisualStateRegistry registry = new BusinessSceneVisualStateRegistry();
            BusinessSceneCommandResult registerResult = registry.Register(new BusinessSceneVisualStateBinding(
                "scene-node.test",
                new[] { renderer },
                colorPropertyName,
                new BusinessSceneVisualStatePalette(normalColor, alarmColor, faultColor, offlineColor)));

            Assert.That(registerResult.Success, Is.True, registerResult.Message);
            Assert.That(registry.RegisteredNodeCount, Is.EqualTo(1));
            BusinessSceneNodeVisualState[] states =
            {
                BusinessSceneNodeVisualState.Normal,
                BusinessSceneNodeVisualState.Alarm,
                BusinessSceneNodeVisualState.Fault,
                BusinessSceneNodeVisualState.Offline
            };
            for (int updateIndex = 0; updateIndex < 128; updateIndex++)
            {
                BusinessSceneCommandResult updateResult = registry.UpdateNodeVisualState(
                    "scene-node.test",
                    states[updateIndex % states.Length]);
                Assert.That(updateResult.Success, Is.True, updateResult.Message);
            }

            // 共享材质引用不变可证明状态更新没有调用 Renderer.material 或替换共享材质数组。
            Assert.That(renderer.sharedMaterial, Is.SameAs(originalSharedMaterial));
            MaterialPropertyBlock inspectionBlock = new MaterialPropertyBlock();
            renderer.GetPropertyBlock(inspectionBlock, 0);
            Color appliedColor = inspectionBlock.GetColor(Shader.PropertyToID(colorPropertyName));
            Assert.That(appliedColor.r, Is.EqualTo(offlineColor.r).Within(0.001f));
            Assert.That(appliedColor.g, Is.EqualTo(offlineColor.g).Within(0.001f));
            Assert.That(appliedColor.b, Is.EqualTo(offlineColor.b).Within(0.001f));
            Assert.That(appliedColor.a, Is.EqualTo(offlineColor.a).Within(0.001f));

            BusinessSceneCommandResult clearResult = registry.ClearNodeVisualState("scene-node.test");
            Assert.That(clearResult.Success, Is.True, clearResult.Message);
            renderer.GetPropertyBlock(inspectionBlock, 0);
            Color restoredColor = inspectionBlock.GetColor(Shader.PropertyToID(colorPropertyName));
            Color expectedBaselineColor = originalSharedMaterial.GetColor(Shader.PropertyToID(colorPropertyName));
            Assert.That(restoredColor.r, Is.EqualTo(expectedBaselineColor.r).Within(0.001f));
            Assert.That(restoredColor.g, Is.EqualTo(expectedBaselineColor.g).Within(0.001f));
            Assert.That(restoredColor.b, Is.EqualTo(expectedBaselineColor.b).Within(0.001f));
            Assert.That(restoredColor.a, Is.EqualTo(expectedBaselineColor.a).Within(0.001f));

            BusinessSceneCommandResult missingNodeResult = registry.UpdateNodeVisualState("scene-node.missing", BusinessSceneNodeVisualState.Alarm);
            Assert.That(missingNodeResult.Success, Is.False);
            Assert.That(missingNodeResult.ErrorCode, Is.EqualTo("invalid-node"));

            registry.Release();
            registry.Release();
            BusinessSceneCommandResult releasedResult = registry.UpdateNodeVisualState("scene-node.test", BusinessSceneNodeVisualState.Normal);
            Assert.That(releasedResult.Success, Is.False);
            Assert.That(releasedResult.ErrorCode, Is.EqualTo("scene-controller-released"));

            Object.DestroyImmediate(visualRoot);
        }

        /// <summary>
        /// 资源作用域必须按场景所有权释放动画、渲染纹理、句柄和退订动作；
        /// 单项异常不能阻断其余资源，重复释放与释放后迟到登记也不能重新打开作用域。
        /// </summary>
        [Test]
        public void 场景资源作用域逆序幂等释放且单项失败不阻断后续清理()
        {
            GameObject runtimeRoot = new GameObject("BusinessSceneResourceScopeTestRoot");
            Animator animator = runtimeRoot.AddComponent<Animator>();
            Animation legacyAnimation = runtimeRoot.AddComponent<Animation>();
            RenderTexture ownedRenderTexture = new RenderTexture(8, 8, 0);
            ownedRenderTexture.Create();
            TrackingDisposable disposable = new TrackingDisposable();
            TrackingDisposable lateDisposable = new TrackingDisposable();
            int releaseActionCount = 0;
            BusinessSceneResourceScope scope = new BusinessSceneResourceScope();

            Assert.That(scope.TrackDisposable(disposable), Is.True);
            Assert.That(scope.TrackDisposable(disposable), Is.False, "同一资源句柄不能重复登记。");
            Assert.That(scope.TrackAnimator(animator), Is.True);
            Assert.That(scope.TrackLegacyAnimation(legacyAnimation), Is.True);
            Assert.That(scope.TrackOwnedRenderTexture(ownedRenderTexture), Is.True);
            Assert.That(scope.TrackReleaseAction(() => throw new System.InvalidOperationException("测试释放失败")), Is.True);
            Assert.That(scope.TrackReleaseAction(() => releaseActionCount++), Is.True);
            Assert.That(scope.RegisteredResourceCount, Is.EqualTo(6));

            BusinessSceneResourceReleaseReport firstReport = scope.ReleaseAll();

            Assert.That(firstReport.AlreadyReleased, Is.False);
            Assert.That(firstReport.RegisteredResourceCount, Is.EqualTo(6));
            Assert.That(firstReport.ReleasedResourceCount, Is.EqualTo(5));
            Assert.That(firstReport.FailureCount, Is.EqualTo(1));
            Assert.That(releaseActionCount, Is.EqualTo(1));
            Assert.That(disposable.DisposeCount, Is.EqualTo(1));
            Assert.That(animator.enabled, Is.False);
            Assert.That(legacyAnimation.enabled, Is.False);
            Assert.That(ownedRenderTexture == null, Is.True, "独占渲染纹理必须释放底层缓冲并销毁对象。");
            Assert.That(scope.RegisteredResourceCount, Is.EqualTo(0), "释放后不得继续保留资源强引用。");

            BusinessSceneResourceReleaseReport repeatedReport = scope.ReleaseAll();
            Assert.That(repeatedReport.AlreadyReleased, Is.True);
            Assert.That(disposable.DisposeCount, Is.EqualTo(1));
            Assert.That(scope.TrackDisposable(lateDisposable), Is.False, "释放后迟到资源不能重新打开作用域。");
            Assert.That(lateDisposable.DisposeCount, Is.EqualTo(1), "释放后迟到资源必须立即清理。");

            Object.DestroyImmediate(runtimeRoot);
        }

        [Test]
        public void 新事务立即废弃旧事务的完成权()
        {
            SceneSwitchTransactionGate gate = new SceneSwitchTransactionGate();
            Assert.That(gate.TryBegin("transition.first", "gas-power", out SceneSwitchToken first, out _, out _), Is.True);
            Assert.That(gate.TryBegin("transition.second", "wind-power", out SceneSwitchToken second, out string superseded, out _), Is.True);

            Assert.That(superseded, Is.EqualTo("transition.first"));
            Assert.That(gate.IsCurrent(first), Is.False);
            Assert.That(gate.TryComplete(first), Is.False);
            Assert.That(gate.IsCurrent(second), Is.True);
            Assert.That(gate.TryComplete(second), Is.True);
        }

        [Test]
        public void 释放后拒绝新事务且所有旧令牌失效()
        {
            SceneSwitchTransactionGate gate = new SceneSwitchTransactionGate();
            gate.TryBegin("transition.active", "gas-power", out SceneSwitchToken token, out _, out _);
            gate.Dispose();

            Assert.That(gate.IsCurrent(token), Is.False);
            Assert.That(gate.TryBegin("transition.after-dispose", "dispatch", out _, out _, out string error), Is.False);
            Assert.That(error, Does.Contain("已经释放"));
        }

        [Test]
        public void 未配置正式目录的协调器拒绝切换且重复释放幂等()
        {
            GameObject runtimeRoot = new GameObject("MultiSceneCoordinatorTestRoot");
            MultiSceneCoordinator coordinator = runtimeRoot.AddComponent<MultiSceneCoordinator>();
            SceneSwitchResult received = default;
            bool receivedResult = false;
            coordinator.SceneSwitchCompleted += result =>
            {
                received = result;
                receivedResult = true;
            };

            Assert.That(coordinator.RequestSwitchScene("gas-power", "transition.test"), Is.False);
            Assert.That(receivedResult, Is.True);
            Assert.That(received.ErrorCode, Is.EqualTo("scene-catalog-invalid"));
            Assert.That(coordinator.ActiveController, Is.Null);

            coordinator.DisposeRuntime();
            coordinator.DisposeRuntime();
            Assert.That(coordinator.State, Is.EqualTo(MultiSceneCoordinatorState.Disposed));
            Object.DestroyImmediate(runtimeRoot);
        }

        /// <summary>
        /// 场景切换载荷必须绑定场景、事务和映射版本；进度与成功完成事件也必须保持有限、可关联的字段。
        /// 该测试不依赖 WebGL 浏览器，直接保护 C# 与网页协议共享的纯数据边界。
        /// </summary>
        [Test]
        public void 场景切换协议拒绝版本不匹配和非法进度()
        {
            SceneSwitchCommandPayload command = new SceneSwitchCommandPayload
            {
                sceneId = "gas-power",
                transitionId = "transition.gas.1",
                sceneMappingVersion = "mapping.1"
            };
            Assert.That(SceneSwitchProtocolValidator.IsValidCommand(command, "mapping.1"), Is.True);
            Assert.That(SceneSwitchProtocolValidator.IsValidCommand(command, "mapping.old"), Is.False);

            SceneLoadProgressPayload progress = new SceneLoadProgressPayload
            {
                requestId = "request.1",
                sceneId = "gas-power",
                transitionId = "transition.gas.1",
                stageCode = "loading-scene",
                progress = 0.5f
            };
            Assert.That(SceneSwitchProtocolValidator.IsValidProgress(progress), Is.True);
            progress.progress = 1.01f;
            Assert.That(SceneSwitchProtocolValidator.IsValidProgress(progress), Is.False);
            progress.progress = 0.5f;
            progress.stageCode = "unknown-stage";
            Assert.That(SceneSwitchProtocolValidator.IsValidProgress(progress), Is.False);

            SceneChangedPayload changed = new SceneChangedPayload
            {
                requestId = "request.1",
                sceneId = "gas-power",
                transitionId = "transition.gas.1",
                sceneActivationId = "scene-activation-1",
                success = true
            };
            Assert.That(SceneSwitchProtocolValidator.IsValidChanged(changed), Is.True);
            // 成功完成事件没有物理场景实例标识时，网页端无法阻断同场景往返后的 ABA 迟到对象选择。
            changed.sceneActivationId = string.Empty;
            Assert.That(SceneSwitchProtocolValidator.IsValidChanged(changed), Is.False);
            changed.sceneActivationId = "scene-activation-1";
            changed.success = false;
            Assert.That(SceneSwitchProtocolValidator.IsValidChanged(changed), Is.False);
        }

        /// <summary>
        /// 场景动作校验只验证跨端稳定标识与固定四态，不接触任何模型名称、层级、材质或路径资源。
        /// 因而协议可在正式九场景映射交付前安全拒绝无效输入，而不猜测业务对象。
        /// </summary>
        [Test]
        public void 场景动作协议拒绝空标识和未知四态()
        {
            Assert.That(SceneActionProtocolValidator.IsValidProcessStep("gas-power-generation", "gas-turbine", "unit-01"), Is.True);
            Assert.That(SceneActionProtocolValidator.IsValidProcessStep("gas-power-generation", string.Empty, "unit-01"), Is.False);
            Assert.That(SceneActionProtocolValidator.IsValidSceneNodeId("node.gas-turbine"), Is.True);
            Assert.That(SceneActionProtocolValidator.IsValidSceneNodeId(string.Empty), Is.False);
            Assert.That(SceneActionProtocolValidator.IsValidSelectionId("selection.topology.01"), Is.True);
            Assert.That(SceneActionProtocolValidator.IsValidSelectionId(string.Empty), Is.False);
            Assert.That(SceneActionProtocolValidator.IsValidRouteId("route.gas-to-grid"), Is.True);
            Assert.That(SceneActionProtocolValidator.IsValidRouteId(string.Empty), Is.False);
            Assert.That(SceneActionProtocolValidator.TryParseVisualState("alarm", out BusinessSceneNodeVisualState alarmState), Is.True);
            Assert.That(alarmState, Is.EqualTo(BusinessSceneNodeVisualState.Alarm));
            Assert.That(SceneActionProtocolValidator.TryParseVisualState("custom-color", out _), Is.False);
        }

        /// <summary>
        /// 运行诊断只保存当前事务的一份值快照：阶段重复上报不能重新采样内存，
        /// 被替代的旧事务也不能写回新事务。该用例使用注入的时间和内存，避免依赖机器负载。
        /// </summary>
        [Test]
        public void 运行诊断记录阶段首帧峰值并拒绝重复和过期写入()
        {
            double currentTime = 10d;
            long currentMemory = 100L;
            SceneRuntimeDiagnostics diagnostics = new SceneRuntimeDiagnostics(() => currentTime, () => currentMemory);

            diagnostics.BeginTransition("gas-power", "transition.gas", "coal-power");
            currentTime = 10.02d;
            currentMemory = 140L;
            Assert.That(diagnostics.RecordStage("transition.gas", "loading-scene", "coal-power"), Is.True);
            Assert.That(diagnostics.Snapshot.PeakAllocatedMemoryBytes, Is.EqualTo(140L));

            // 同一阶段的帧级进度不能导致额外采样，避免诊断功能退化成每帧性能开销。
            currentMemory = 150L;
            Assert.That(diagnostics.RecordStage("transition.gas", "loading-scene", "coal-power"), Is.False);
            Assert.That(diagnostics.Snapshot.PeakAllocatedMemoryBytes, Is.EqualTo(140L));

            currentTime = 10.2d;
            currentMemory = 160L;
            diagnostics.MarkSceneCommitted("gas-power", "transition.gas");
            Assert.That(diagnostics.Snapshot.TargetSceneId, Is.EqualTo("gas-power"));
            Assert.That(diagnostics.Snapshot.CurrentSceneId, Is.EqualTo("gas-power"));
            Assert.That(diagnostics.Snapshot.LoadDurationMilliseconds, Is.EqualTo(200L));

            currentTime = 10.23d;
            currentMemory = 170L;
            diagnostics.MarkFirstFrame("gas-power", "transition.gas");
            Assert.That(diagnostics.Snapshot.FirstFrameDelayMilliseconds, Is.EqualTo(30L));
            Assert.That(diagnostics.Snapshot.PeakAllocatedMemoryBytes, Is.EqualTo(170L));

            currentTime = 10.25d;
            currentMemory = 165L;
            diagnostics.Complete("transition.gas", "gas-power");
            Assert.That(diagnostics.Snapshot.Completed, Is.True);

            diagnostics.BeginTransition("wind-power", "transition.wind", "gas-power");
            Assert.That(diagnostics.RecordStage("transition.gas", "ready", "gas-power"), Is.False);
            currentTime = 10.4d;
            currentMemory = 220L;
            diagnostics.Fail("transition.wind", "gas-power", "loading-scene", "scene-load-failed");
            Assert.That(diagnostics.Snapshot.TargetSceneId, Is.EqualTo("wind-power"));
            Assert.That(diagnostics.Snapshot.CurrentSceneId, Is.EqualTo("gas-power"));
            Assert.That(diagnostics.Snapshot.FailureStageCode, Is.EqualTo("loading-scene"));
            Assert.That(diagnostics.Snapshot.ErrorCode, Is.EqualTo("scene-load-failed"));

            diagnostics.MarkReleased("gas-power");
            Assert.That(diagnostics.Snapshot.Released, Is.True);
        }

        /// <summary>
        /// 诊断器会作为 MultiSceneCoordinator（多场景协调器）的字段在 MonoBehaviour（Unity 行为组件）构造期间创建。
        /// 该阶段不能访问 Profiler（性能分析器）内存接口；因此构造只能生成零值快照，
        /// 首次有效事务才采样内存，防止编辑器加载 Bootstrap（启动壳）场景时出现生命周期异常。
        /// </summary>
        [Test]
        public void 运行诊断构造时不采样内存且首次事务开始后才采样()
        {
            int memorySampleCount = 0;
            SceneRuntimeDiagnostics diagnostics = new SceneRuntimeDiagnostics(
                () => 1d,
                () =>
                {
                    memorySampleCount++;
                    return 128L;
                });

            Assert.That(memorySampleCount, Is.EqualTo(0));
            Assert.That(diagnostics.Snapshot.CurrentAllocatedMemoryBytes, Is.EqualTo(0L));
            Assert.That(diagnostics.Snapshot.PeakAllocatedMemoryBytes, Is.EqualTo(0L));

            diagnostics.BeginTransition("gas-power", "transition.gas", string.Empty);

            Assert.That(memorySampleCount, Is.EqualTo(1));
            Assert.That(diagnostics.Snapshot.CurrentAllocatedMemoryBytes, Is.EqualTo(128L));
            Assert.That(diagnostics.Snapshot.PeakAllocatedMemoryBytes, Is.EqualTo(128L));
        }

        /// <summary>
        /// 空事务标识会在协程开始前被拒绝；诊断仍需提供与桥接响应一致的固定失败信息，
        /// 但不记录调用方的自由文本或异常细节。
        /// </summary>
        [Test]
        public void 运行诊断记录无有效事务的即时失败()
        {
            SceneRuntimeDiagnostics diagnostics = new SceneRuntimeDiagnostics(() => 1d, () => 64L);
            diagnostics.RecordImmediateFailure("unknown-scene", string.Empty, "gas-power", "validation", "transition-invalid");

            Assert.That(diagnostics.Snapshot.Completed, Is.True);
            Assert.That(diagnostics.Snapshot.TargetSceneId, Is.EqualTo("unknown-scene"));
            Assert.That(diagnostics.Snapshot.CurrentSceneId, Is.EqualTo("gas-power"));
            Assert.That(diagnostics.Snapshot.FailureStageCode, Is.EqualTo("validation"));
            Assert.That(diagnostics.Snapshot.ErrorCode, Is.EqualTo("transition-invalid"));
        }

        /// <summary>
        /// 静态保护构建边界：正式包必须走独立入口且不能默认附带开发模式；
        /// 资源治理禁止在切换循环中调用全局未使用资源卸载，以免造成帧卡顿。
        /// </summary>
        [Test]
        public void WebGL构建模式分离且场景切换不做每帧全局资源回收()
        {
            string buildScriptPath = Path.Combine(Application.dataPath, "Editor", "PowerPlantWebGlBuild.cs");
            string bundleBuildScriptPath = Path.Combine(Application.dataPath, "Editor", "PowerPlantSceneBundleBuild.cs");
            string coordinatorPath = Path.Combine(Application.dataPath, "Scripts", "Visualization", "Scenes", "MultiSceneCoordinator.cs");
            string bundleLoaderPath = Path.Combine(Application.dataPath, "Scripts", "Visualization", "Scenes", "SceneBundleRuntimeLoader.cs");
            string resourceScopePath = Path.Combine(Application.dataPath, "Scripts", "Visualization", "Scenes", "BusinessSceneResourceScope.cs");
            string buildScriptSource = File.ReadAllText(buildScriptPath);
            string bundleBuildScriptSource = File.ReadAllText(bundleBuildScriptPath);
            string coordinatorSource = File.ReadAllText(coordinatorPath);
            string bundleLoaderSource = File.ReadAllText(bundleLoaderPath);
            string resourceScopeSource = File.ReadAllText(resourceScopePath);

            Assert.That(buildScriptSource, Does.Contain("DevelopmentOutputPath"));
            Assert.That(buildScriptSource, Does.Contain("ProductionOutputPath"));
            Assert.That(buildScriptSource, Does.Contain("BuildDevelopmentWebGl"));
            Assert.That(buildScriptSource, Does.Contain("BuildProductionWebGl"));
            Assert.That(buildScriptSource, Does.Contain("isDevelopmentBuild ? BuildOptions.Development | BuildOptions.StrictMode : BuildOptions.StrictMode"));
            Assert.That(buildScriptSource, Does.Contain("scenes = new[] { BootstrapScenePath }"));
            Assert.That(buildScriptSource, Does.Contain("assetBundleManifestPath = assetBundleManifestPath"));
            Assert.That(buildScriptSource, Does.Contain("PowerPlantSceneBundleBuild.BuildSceneBundles"));
            // 合作方联调包和正式包都允许通过局域网 HTTP 下载场景资源；同时要求构建脚本保存并恢复编辑器原设置，
            // 以防止只修改了项目配置却没有把策略编译进 WebGL 播放器，或构建结束后污染后续编辑器会话。
            Assert.That(buildScriptSource, Does.Contain("PlayerSettings.insecureHttpOption"));
            Assert.That(buildScriptSource, Does.Contain("InsecureHttpOption.AlwaysAllowed"));
            Assert.That(buildScriptSource, Does.Contain("originalInsecureHttpOption"));
            Assert.That(bundleBuildScriptSource, Does.Contain("BuildAssetBundles"));
            Assert.That(bundleBuildScriptSource, Does.Contain("scene-catalog.json"));
            Assert.That(bundleBuildScriptSource, Does.Contain("scene-content-summary.json"));
            Assert.That(bundleBuildScriptSource, Does.Contain("SharedBundleName"));
            Assert.That(bundleBuildScriptSource, Does.Contain("schemaVersion = 2"));
            Assert.That(bundleBuildScriptSource, Does.Contain("sizeBytes = new FileInfo(bundlePath).Length"));
            Assert.That(bundleBuildScriptSource, Does.Contain("contentVersion = ComputeSceneContentVersion(sceneBundles)"));
            Assert.That(bundleBuildScriptSource, Does.Contain("transferSizeBytes = sceneBundles.Sum"));
            Assert.That(bundleBuildScriptSource, Does.Not.Contain("Addressables"));
            Assert.That(coordinatorSource, Does.Contain("RecordRuntimeStage"));
            Assert.That(coordinatorSource, Does.Contain("_sceneBundleLoader.LoadSceneAsync"));
            Assert.That(coordinatorSource, Does.Contain("ReleaseSceneBundle"));
            Assert.That(coordinatorSource, Does.Not.Contain("Resources.UnloadUnusedAssets"));
            Assert.That(coordinatorSource, Does.Not.Contain("private void Update()"));
            Assert.That(bundleLoaderSource, Does.Contain("UnityWebRequestAssetBundle.GetAssetBundle"));
            Assert.That(bundleLoaderSource, Does.Contain("Hash128.Parse"));
            Assert.That(bundleLoaderSource, Does.Contain("SupportedCatalogSchemaVersion = 2"));
            Assert.That(bundleLoaderSource, Does.Contain("document.sizeBytes <= 0"));
            Assert.That(bundleLoaderSource, Does.Contain("ReleaseSceneBundle"));
            // 资源包负责下载与内容校验，场景必须由 Unity 的场景管理器加载；禁止回归到不存在的 AssetBundle.LoadSceneAsync 调用。
            Assert.That(bundleLoaderSource, Does.Contain("SceneManager.LoadSceneAsync(entry.ScenePath, LoadSceneMode.Additive)"));
            Assert.That(bundleLoaderSource, Does.Not.Contain("sceneBundle.LoadSceneAsync"));
            Assert.That(resourceScopeSource, Does.Contain("StopCoroutine"));
            Assert.That(resourceScopeSource, Does.Contain("RenderTexture.ReleaseTemporary"));
            Assert.That(resourceScopeSource, Does.Contain("IDisposable"));
            Assert.That(resourceScopeSource, Does.Not.Contain("Resources.UnloadUnusedAssets"));
            Assert.That(resourceScopeSource, Does.Not.Contain("GC.Collect"));
            Assert.That(resourceScopeSource, Does.Not.Contain("private void Update()"));
        }

        /// <summary>
        /// 主播放器和同级场景资源目录必须共享一个发布标识。
        /// 此处直接覆盖完全一致、空值与相近版本三种边界，确保运行时不会把目录名、场景名或前缀相同误当成可混用版本。
        /// </summary>
        [Test]
        public void 场景资源目录只接受与主播放器完全一致的发布标识()
        {
            const string currentReleaseId = "release.task020.1";

            Assert.That(SceneBundleRuntimeLoader.IsExpectedCatalogReleaseId(currentReleaseId, currentReleaseId), Is.True);
            Assert.That(SceneBundleRuntimeLoader.IsExpectedCatalogReleaseId(currentReleaseId, "release.task020.1-stale"), Is.False);
            Assert.That(SceneBundleRuntimeLoader.IsExpectedCatalogReleaseId(currentReleaseId, string.Empty), Is.False);
            Assert.That(SceneBundleRuntimeLoader.IsExpectedCatalogReleaseId(string.Empty, currentReleaseId), Is.False);
        }

        [Test]
        public void 桥接不再直接依赖燃气类型且声明受控场景切换能力()
        {
            string bridgePath = Path.Combine(Application.dataPath, "Scripts", "UnityIframeBridgeManager.cs");
            string browserBridgePath = Path.Combine(Application.dataPath, "Plugins", "WebGL", "Power3dUnityBridge.jslib");
            string bridgeSource = File.ReadAllText(bridgePath);
            string browserBridgeSource = File.ReadAllText(browserBridgePath);

            Assert.That(bridgeSource, Does.Not.Contain("PowerPlantProcessController"));
            Assert.That(bridgeSource, Does.Not.Contain("Destroy(gameObject);"));
            Assert.That(browserBridgeSource, Does.Contain("'setNodeVisualState'"));
            Assert.That(browserBridgeSource, Does.Contain("'setRouteFlow'"));
            Assert.That(browserBridgeSource, Does.Contain("'switchScene'"));
            Assert.That(browserBridgeSource, Does.Contain("'sceneLoadProgress'"));
            Assert.That(browserBridgeSource, Does.Contain("'sceneChanged'"));
        }

        private static List<BusinessSceneCatalogEntry> CreateCompleteTestEntries()
        {
            List<BusinessSceneCatalogEntry> entries = new List<BusinessSceneCatalogEntry>();
            IReadOnlyList<string> sceneIds = BusinessSceneCatalog.GetRequiredSceneIds();
            for (int index = 0; index < sceneIds.Count; index++)
            {
                string sceneId = sceneIds[index];
                entries.Add(new BusinessSceneCatalogEntry(
                    sceneId,
                    $"test-unity-key.{sceneId}",
                    $"Assets/Tests/Scenes/{sceneId}.unity",
                    BusinessSceneAvailability.Available,
                    BusinessSceneCapability.None));
            }
            return entries;
        }

        private sealed class FakeBusinessSceneController : IBusinessSceneController
        {
            public string SceneId { get; }
            public BusinessSceneCapability Capabilities { get; }

            public FakeBusinessSceneController(string sceneId, BusinessSceneCapability capabilities)
            {
                SceneId = sceneId;
                Capabilities = capabilities;
            }

            public IEnumerator InitializeAsync(BusinessSceneInitializationContext context, System.Action<BusinessSceneCommandResult> completed)
            {
                completed?.Invoke(BusinessSceneCommandResult.Completed("测试初始化完成。"));
                yield break;
            }

            public BusinessSceneCommandResult EnterProcessStep(string processId, string stepId, string unitId, bool isolate) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.EnterProcessStep);
            public BusinessSceneCommandResult FocusNode(string sceneNodeId, bool isolate) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.FocusNode);
            public BusinessSceneCommandResult ClearSelection() => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ClearSelection);
            public BusinessSceneCommandResult UpdateNodeVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.UpdateNodeVisualState);
            public BusinessSceneCommandResult ClearNodeVisualState(string sceneNodeId) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ClearNodeVisualState);
            public BusinessSceneCommandResult SetRouteFlow(string routeId, bool enabled, float speedMultiplier) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetRouteFlow);
            public BusinessSceneCommandResult SetNodeVisibility(string sceneNodeId, bool visible) => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.SetNodeVisibility);
            public BusinessSceneCommandResult ResetScene() => BusinessSceneCommandResult.Unsupported(BusinessSceneCapability.ResetScene);
            public BusinessSceneCommandResult ReleaseScene() => BusinessSceneCommandResult.Completed("测试释放完成。");
            public string GetStateDescription() => "test";
        }

        /// <summary>
        /// 专用夹具只声明初始化、聚焦和释放，不覆写前两项，用于验证基类不会掩盖漏实现。
        /// 它不引用用户业务对象，确保测试只覆盖统一接口边界。
        /// </summary>
        private sealed class DeclaredButUnimplementedController : BusinessSceneControllerBase
        {
            public override string SceneId => "coal-power";

            public override BusinessSceneCapability Capabilities =>
                BusinessSceneCapability.Initialize |
                BusinessSceneCapability.FocusNode |
                BusinessSceneCapability.Release;
        }
    }
}
