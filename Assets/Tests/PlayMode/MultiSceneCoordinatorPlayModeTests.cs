using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;
using WebDLPro.Unity.SceneRuntime;

namespace WebDLPro.Unity.Tests
{
    /// <summary>
    /// 以正式 Bootstrap、燃气和空业务场景执行多场景协调器的播放模式验证。
    /// 测试不为八个空场景伪造控制器或资源：它们必须初始化失败、被卸载，
    /// 然后由协调器恢复此前已成功进入的燃气场景。
    /// </summary>
    public sealed class MultiSceneCoordinatorPlayModeTests
    {
        private const string BootstrapScenePath = "Assets/Scenes/Bootstrap.unity";
        private const string GasPowerScenePath = "Assets/Scenes/Business/GasPower.unity";
        private const string CoalPowerScenePath = "Assets/Scenes/Business/CoalPower.unity";
        private const float MaximumWaitSeconds = 15f;
        private const float PollIntervalSeconds = 0.02f;

        private MultiSceneCoordinator _coordinator;
        // 桥接脚本位于默认程序集；播放模式测试程序集只引用独立运行时程序集，故以受限反射验证真实组件，
        // 不为测试反向破坏生产程序集边界，也不读取场景层级、资源路径或私有业务状态。
        private MonoBehaviour _bridgeManager;
        private readonly List<string> _bridgeOutboundLogs = new List<string>();
        private bool _bridgeLogSubscribed;

        /// <summary>
        /// 验证真实成功路径、失败恢复和单活动场景约束。
        /// 燃气场景由正式组合适配器初始化；燃煤空场景由占位控制器返回内容未交付，
        /// 结果必须保留原始请求标识、报告结构化失败并恢复到燃气场景。
        /// </summary>
        [UnityTest]
        public IEnumerator 燃气成功加载后空场景失败会恢复燃气且不保留隐藏业务场景()
        {
            yield return LoadBootstrap();
            SceneSwitchResult gasResult = default;
            bool gasCompleted = false;
            _coordinator.SceneSwitchCompleted += result =>
            {
                if (result.TransitionId == "transition.playmode.gas")
                {
                    gasResult = result;
                    gasCompleted = true;
                }
            };

            Assert.That(_coordinator.RequestSwitchScene("gas-power", "transition.playmode.gas"), Is.True);
            yield return WaitForCompletion(() => gasCompleted, "燃气场景加载未在帧预算内结束。");
            Assert.That(gasResult.Success, Is.True, gasResult.Message);
            Assert.That(_coordinator.State, Is.EqualTo(MultiSceneCoordinatorState.Ready));
            Assert.That(_coordinator.ActiveSceneId, Is.EqualTo("gas-power"));
            Assert.That(CountLoadedBusinessScenes(), Is.EqualTo(1));
            Assert.That(SceneManager.GetSceneByPath(GasPowerScenePath).isLoaded, Is.True);
            string initialSceneActivationId = _coordinator.ActiveSceneActivationId;

            SceneSwitchResult coalResult = default;
            bool coalCompleted = false;
            _coordinator.SceneSwitchCompleted += result =>
            {
                if (result.TransitionId == "transition.playmode.coal")
                {
                    coalResult = result;
                    coalCompleted = true;
                }
            };

            Assert.That(_coordinator.RequestSwitchScene("coal-power", "transition.playmode.coal"), Is.True);
            yield return WaitForCompletion(() => coalCompleted, "空业务场景失败恢复未在帧预算内结束。");
            Assert.That(coalResult.Success, Is.False);
            Assert.That(coalResult.ErrorCode, Is.EqualTo("scene-content-unavailable"));
            Assert.That(coalResult.Recovered, Is.True);
            Assert.That(coalResult.RestoredSceneId, Is.EqualTo("gas-power"));
            Assert.That(coalResult.RestoredSceneActivationId, Is.Not.Empty, "恢复结果必须携带新物理场景实例标识。\n");
            Assert.That(coalResult.RestoredSceneActivationId, Is.Not.EqualTo(initialSceneActivationId), "恢复不得继续暴露已卸载燃气实例的旧标识。\n");
            Assert.That(coalResult.RestoredSceneActivationId, Is.EqualTo(_coordinator.ActiveSceneActivationId), "恢复结果必须与协调器当前活动实例一致。\n");
            Assert.That(_coordinator.State, Is.EqualTo(MultiSceneCoordinatorState.Ready));
            Assert.That(_coordinator.ActiveSceneId, Is.EqualTo("gas-power"));
            Assert.That(SceneManager.GetSceneByPath(GasPowerScenePath).isLoaded, Is.True);
            Assert.That(SceneManager.GetSceneByPath(CoalPowerScenePath).isLoaded, Is.False);
            Assert.That(CountLoadedBusinessScenes(), Is.EqualTo(1));
        }

        /// <summary>
        /// 在旧请求已经进入卸载或加载阶段后发出最新请求，验证协调器层面的事务取代。
        /// 旧请求必须只产生 command-superseded，不能在异步操作收尾后把空燃煤场景提交为活动场景；
        /// 最新燃气请求则必须以自身 transitionId 成功完成。更底层的迟到令牌失效由编辑模式事务门测试覆盖。
        /// </summary>
        [UnityTest]
        public IEnumerator 加载中的旧事务不能在最新请求后改写活动场景()
        {
            yield return LoadBootstrap();
            yield return LoadGasPower("transition.playmode.initial-gas");

            SceneSwitchResult supersededResult = default;
            bool supersededCompleted = false;
            SceneSwitchResult latestResult = default;
            bool latestCompleted = false;
            _coordinator.SceneSwitchCompleted += result =>
            {
                if (result.TransitionId == "transition.playmode.superseded-coal")
                {
                    supersededResult = result;
                    supersededCompleted = true;
                }
                if (result.TransitionId == "transition.playmode.latest-gas")
                {
                    latestResult = result;
                    latestCompleted = true;
                }
            };

            Assert.That(_coordinator.RequestSwitchScene("coal-power", "transition.playmode.superseded-coal"), Is.True);
            yield return WaitForCompletion(
                () => _coordinator.State == MultiSceneCoordinatorState.Unloading ||
                      _coordinator.State == MultiSceneCoordinatorState.Loading ||
                      _coordinator.State == MultiSceneCoordinatorState.Initializing,
                "旧事务未进入可取代的异步阶段。");
            Assert.That(_coordinator.RequestSwitchScene("gas-power", "transition.playmode.latest-gas"), Is.True);

            yield return WaitForCompletion(() => supersededCompleted && latestCompleted, "快速切换未在时限内返回两项结果。");
            Assert.That(supersededResult.Success, Is.False);
            Assert.That(supersededResult.ErrorCode, Is.EqualTo("command-superseded"));
            Assert.That(latestResult.Success, Is.True, latestResult.Message);
            Assert.That(latestResult.TransitionId, Is.EqualTo("transition.playmode.latest-gas"));
            Assert.That(_coordinator.State, Is.EqualTo(MultiSceneCoordinatorState.Ready));
            Assert.That(_coordinator.ActiveSceneId, Is.EqualTo("gas-power"));
            Assert.That(SceneManager.GetSceneByPath(CoalPowerScenePath).isLoaded, Is.False);
            Assert.That(CountLoadedBusinessScenes(), Is.EqualTo(1));
        }

        /// <summary>
        /// 通过真实 Bootstrap 中常驻的桥接管理器依次请求九项正式目录场景。
        /// 燃气场景应成功完成；其余空场景按既有占位约束失败并恢复燃气。无论成功或失败，
        /// 桥接实例、浏览器初始化次数和协调器订阅数均必须保持唯一；释放后不允许再产生对象选择回调。
        /// </summary>
        [UnityTest]
        public IEnumerator 常驻桥接跨九场景请求保持单实例单订阅且释放后无回调()
        {
            yield return LoadBootstrap();
            _bridgeManager = FindBridgeManager();
            Assert.That(_bridgeManager, Is.Not.Null, "Bootstrap 未创建常驻 Unity 桥接管理器。");
            Assert.That(GetBridgeIntProperty("BrowserBridgeInitializationCount"), Is.EqualTo(1));
            Assert.That(GetBridgeIntProperty("SceneCoordinatorSubscriptionCount"), Is.EqualTo(1));

            SubscribeBridgeOutboundLogs();
            // 九项目录的声明顺序不承担加载前置条件；先请求已确认交付的燃气场景建立可恢复基线，
            // 再逐一验证其余目录项。仍只发送九次请求，也不按文件名或场景对象名称推断业务身份。
            List<string> sceneIds = new List<string>(BusinessSceneCatalog.GetRequiredSceneIds());
            int gasPowerIndex = sceneIds.IndexOf("gas-power");
            Assert.That(gasPowerIndex, Is.GreaterThanOrEqualTo(0), "正式九场景目录必须包含已交付的燃气发电场景。");
            sceneIds.RemoveAt(gasPowerIndex);
            sceneIds.Insert(0, "gas-power");
            for (int index = 0; index < sceneIds.Count; index++)
            {
                string sceneId = sceneIds[index];
                string transitionId = $"transition.bridge.lifecycle.{sceneId}";
                string requestId = $"request.bridge.lifecycle.{sceneId}";
                InvokeBridgeMethod("ReceiveFromParent", CreateSceneSwitchMessage(sceneId, transitionId, requestId));

                yield return WaitForCompletion(
                    () => HasTerminalNotice(requestId, transitionId),
                    $"桥接场景请求 {sceneId} 未在时限内返回结构化终态。");

                if (sceneId == "gas-power")
                {
                    Assert.That(HasNotice("sceneChanged", requestId, transitionId), Is.True, "燃气场景必须经桥接回传 sceneChanged。");
                }
                else
                {
                    Assert.That(HasNotice("commandResult", requestId, transitionId), Is.True, "空场景失败必须经桥接回传 commandResult。");
                    Assert.That(
                        HasBridgeLogFragmentForRequest(requestId, $"\"sceneActivationId\":\"{_coordinator.ActiveSceneActivationId}\""),
                        Is.True,
                        "目标失败且燃气自动恢复后，桥接失败回执必须透传恢复出的新物理场景标识。");
                }

                Assert.That(CountBridgeManagers(), Is.EqualTo(1));
                Assert.That(GetBridgeIntProperty("BrowserBridgeInitializationCount"), Is.EqualTo(1));
                Assert.That(GetBridgeIntProperty("SceneCoordinatorSubscriptionCount"), Is.EqualTo(1));
                Assert.That(GetBridgeObjectProperty("CurrentSceneController"), Is.SameAs(_coordinator.ActiveController));
                Assert.That(_coordinator.ActiveSceneId, Is.EqualTo("gas-power"));
                Assert.That(CountLoadedBusinessScenes(), Is.EqualTo(1));
                Assert.That(
                    CountRuntimeContextMaterials(),
                    Is.EqualTo(0),
                    $"场景请求 {sceneId} 完成后仍残留上一轮运行时半透明材质。");

                // 每轮都在当前燃气场景创建一组真实运行时材质，下一轮切换必须在卸载前主动清理。
                // 这样九次请求验证的是实际资源生命周期，而不是仅统计协调器或场景实例数量。
                BusinessSceneCommandResult fadeResult = _coordinator.ActiveController.SetNodeVisibility("gas-turbine", false);
                Assert.That(fadeResult.Success, Is.True, fadeResult.Message);
                Assert.That(CountRuntimeContextMaterials(), Is.GreaterThan(0), "测试前置条件失败：未创建运行时半透明材质。");
            }

            InvokeBridgeMethod("ReceiveFromParent", CreateDisposeMessage("request.bridge.dispose.first"));
            yield return null;
            Assert.That(HasNotice("disposed", "request.bridge.dispose.first", string.Empty), Is.True);
            Assert.That(GetBridgeIntProperty("SceneCoordinatorSubscriptionCount"), Is.EqualTo(0));
            Assert.That(GetBridgeObjectProperty("CurrentSceneController"), Is.Null);
            Assert.That(CountRuntimeContextMaterials(), Is.EqualTo(0), "整体释放后不得残留燃气场景运行时半透明材质。");
            Assert.That(CountCoordinatorEventSubscribers(_coordinator), Is.EqualTo(0), "整体释放后协调器不得继续持有任何事件订阅者。");

            int logCountAfterDispose = _bridgeOutboundLogs.Count;
            InvokeBridgeMethod("ReportObjectSelected", "node.gas-turbine.01", "释放后不得上报");
            yield return null;
            Assert.That(_bridgeOutboundLogs, Has.Count.EqualTo(logCountAfterDispose), "释放后的对象回调不得再次穿透桥接。");

            InvokeBridgeMethod("ReceiveFromParent", CreateDisposeMessage("request.bridge.dispose.repeat"));
            Assert.That(HasNotice("disposed", "request.bridge.dispose.repeat", string.Empty), Is.True);
            Assert.That(GetBridgeIntProperty("SceneCoordinatorSubscriptionCount"), Is.EqualTo(0));
        }

        /// <summary>
        /// 验证三维对象选择的上行字段固定为 sceneNodeId（三维节点标识）。
        /// 该用例只检查桥接序列化边界，不从对象名称、二维拓扑配置或坐标推导任何映射；
        /// 前端对设备和二维节点的精确反查由任务-037的原子清单协调器负责。
        /// </summary>
        [UnityTest]
        public IEnumerator 三维对象选择只回传显式三维节点标识()
        {
            yield return LoadBootstrap();
            yield return LoadGasPower("transition.playmode.object-selection");
            _bridgeManager = FindBridgeManager();
            Assert.That(_bridgeManager, Is.Not.Null, "Bootstrap 未创建常驻 Unity 桥接管理器。");
            SubscribeBridgeOutboundLogs();

            int previousLogCount = _bridgeOutboundLogs.Count;
            InvokeBridgeMethod("ReportObjectSelected", "gas-turbine", "测试燃气轮机对象");
            yield return null;

            Assert.That(_bridgeOutboundLogs.Count, Is.EqualTo(previousLogCount + 1), "对象选择必须产生且只产生一条上行桥接事件。");
            string outboundLog = _bridgeOutboundLogs[_bridgeOutboundLogs.Count - 1];
            Assert.That(outboundLog, Does.Contain("\"type\":\"objectSelected\""));
            Assert.That(outboundLog, Does.Contain("\"sceneId\":\"gas-power\""));
            Assert.That(outboundLog, Does.Contain("\"sceneNodeId\":\"gas-turbine\""));
            Assert.That(_coordinator.ActiveSceneActivationId, Does.StartWith("scene-activation-"), "真实场景提交必须生成可区分的物理实例标识。");
            Assert.That(outboundLog, Does.Contain($"\"sceneActivationId\":\"{_coordinator.ActiveSceneActivationId}\""));
            // 回归保护：二维 nodeId（拓扑节点标识）即使值碰巧相同，也不得由 Unity 上行事件写入。
            Assert.That(outboundLog, Does.Not.Contain("\"nodeId\":"), "对象选择专用负载不得包含二维节点字段，即使其值为空。");
            Assert.That(outboundLog, Does.Not.Contain("\"nodeName\":"), "对象名称属于 Unity 内部展示文本，不得进入内层选择协议。");
            Assert.That(outboundLog, Does.Not.Contain("\"forceReload\":"), "场景切换命令字段不得混入对象选择事件。");
        }

        /// <summary>
        /// 超时补偿即使回到同一业务场景，也必须卸载并重建物理场景实例。
        /// 该断言锁定桥接字段、协调器快速路径和场景激活标识三层语义，防止只恢复网页状态而保留旧动作副作用。
        /// </summary>
        [UnityTest]
        public IEnumerator 强制同场景切换会生成新的物理场景激活标识()
        {
            yield return LoadBootstrap();
            _bridgeManager = FindBridgeManager();
            Assert.That(_bridgeManager, Is.Not.Null, "Bootstrap 未创建常驻 Unity 桥接管理器。");
            SubscribeBridgeOutboundLogs();

            const string initialTransitionId = "transition.bridge.force-reload.initial";
            const string initialRequestId = "request.bridge.force-reload.initial";
            InvokeBridgeMethod("ReceiveFromParent", CreateSceneSwitchMessage("gas-power", initialTransitionId, initialRequestId));
            yield return WaitForCompletion(
                () => HasNotice("sceneChanged", initialRequestId, initialTransitionId),
                "初始燃气场景未在强制重载验证前完成加载。");
            string initialActivationId = _coordinator.ActiveSceneActivationId;
            IBusinessSceneController initialController = _coordinator.ActiveController;

            const string recoveryTransitionId = "transition.bridge.force-reload.recovery";
            const string recoveryRequestId = "request.bridge.force-reload.recovery";
            InvokeBridgeMethod("ReceiveFromParent", CreateSceneSwitchMessage("gas-power", recoveryTransitionId, recoveryRequestId, true));
            yield return WaitForCompletion(
                () => HasNotice("sceneChanged", recoveryRequestId, recoveryTransitionId),
                "同场景强制重载未返回完成事件。");

            Assert.That(_coordinator.ActiveSceneActivationId, Is.Not.EqualTo(initialActivationId), "强制恢复不得复用旧物理场景激活标识。");
            Assert.That(_coordinator.ActiveController, Is.Not.SameAs(initialController), "强制恢复必须重新创建业务场景控制器。");
            Assert.That(CountLoadedBusinessScenes(), Is.EqualTo(1), "强制恢复完成后只能保留一个活动业务场景。");
        }

        /// <summary>
        /// 动作命令必须经真实桥接器进入当前燃气控制器，且只传递稳定业务标识。
        /// 本用例不伪造四态材质或路径对象：燃气尚未登记这两项能力时必须明确返回不支持，
        /// 而格式错误、未知节点和未知流程则分别保留可供前端关联的稳定错误码。
        /// </summary>
        [UnityTest]
        public IEnumerator 受控场景动作只转发稳定标识并返回明确结果()
        {
            yield return LoadBootstrap();
            _bridgeManager = FindBridgeManager();
            Assert.That(_bridgeManager, Is.Not.Null, "Bootstrap 未创建常驻 Unity 桥接管理器。");
            SubscribeBridgeOutboundLogs();

            InvokeBridgeMethod("ReceiveFromParent", CreateSceneSwitchMessage("gas-power", "transition.bridge.actions.gas", "request.bridge.actions.gas"));
            yield return WaitForCompletion(
                () => HasNotice("sceneChanged", "request.bridge.actions.gas", "transition.bridge.actions.gas"),
                "燃气场景未在动作协议验证前完成加载。");

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("focusNode", "{\"sceneNodeId\":\"\",\"selectionId\":\"selection.bridge.actions.invalid\",\"isolate\":true}", "request.bridge.actions.focus-invalid"));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", "request.bridge.actions.focus-invalid", string.Empty),
                "无效三维节点标识未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.actions.focus-invalid", "\"errorCode\":\"focus-payload-invalid\""), Is.True);

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("focusNode", "{\"sceneNodeId\":\"node.not-registered\",\"selectionId\":\"selection.bridge.actions.missing\",\"isolate\":true}", "request.bridge.actions.focus-missing"));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", "request.bridge.actions.focus-missing", string.Empty),
                "未知三维节点未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.actions.focus-missing", "\"errorCode\":\"invalid-node\""), Is.True);

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("enterProcessStep", "{\"processId\":\"process.not-registered\",\"stepId\":\"overview\",\"unitId\":\"all\",\"isolate\":true}", "request.bridge.actions.process-missing"));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", "request.bridge.actions.process-missing", string.Empty),
                "未知流程未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.actions.process-missing", "\"errorCode\":\"invalid-process-step\""), Is.True);

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("setNodeVisualState", "{\"sceneNodeId\":\"gas-turbine\",\"visualState\":\"alarm\",\"statusUpdatedAt\":\"2026-08-08T10:00:00.000Z\",\"hasSourceRevision\":false,\"sourceRevision\":0}", "request.bridge.actions.visual-unsupported"));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", "request.bridge.actions.visual-unsupported", string.Empty),
                "未登记四态能力未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.actions.visual-unsupported", "\"errorCode\":\"capability-unsupported\""), Is.True);

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("setRouteFlow", "{\"routeId\":\"route.not-registered\",\"enabled\":true}", "request.bridge.actions.route-unsupported"));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", "request.bridge.actions.route-unsupported", string.Empty),
                "未登记路径能力未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.actions.route-unsupported", "\"errorCode\":\"capability-unsupported\""), Is.True);

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("resetScene", "{}", "request.bridge.actions.reset"));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", "request.bridge.actions.reset", string.Empty),
                "燃气场景复位未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.actions.reset", "\"success\":true"), Is.True);
        }

        /// <summary>
        /// 使用只存在于测试程序集的全能力控制器验证统一桥接的正向分派。
        /// 该控制器不进入场景目录、资源包或正式映射；它只记录经过协议校验后的稳定标识和固定枚举，
        /// 从而证明流程、聚焦、四态、路径、显隐和复位均能到达当前活动控制器，而不是只验证“不支持”分支。
        /// </summary>
        [UnityTest]
        public IEnumerator 全能力测试控制器通过桥接接收受控场景动作()
        {
            yield return LoadBootstrap();
            _bridgeManager = FindBridgeManager();
            Assert.That(_bridgeManager, Is.Not.Null, "Bootstrap 未创建常驻 Unity 桥接管理器。");
            SubscribeBridgeOutboundLogs();

            RecordingBusinessSceneController controller = new RecordingBusinessSceneController();
            FieldInfo activeControllerField = typeof(MultiSceneCoordinator).GetField("_activeController", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.That(activeControllerField, Is.Not.Null, "多场景协调器缺少当前控制器字段，测试不能绕过正式活动控制器读取路径。");
            activeControllerField.SetValue(_coordinator, controller);

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "enterProcessStep",
                "{\"processId\":\"test-process\",\"stepId\":\"test-step\",\"unitId\":\"all\",\"isolate\":true}",
                "request.bridge.full-capability.process"));
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "focusNode",
                "{\"sceneNodeId\":\"scene-node.test\",\"selectionId\":\"selection.bridge.full-capability.focus\",\"isolate\":false}",
                "request.bridge.full-capability.focus"));
            // 模拟浏览器因回执丢失而使用新 messageId 重发同一选择；控制器只能收到第一次聚焦。
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "focusNode",
                "{\"sceneNodeId\":\"scene-node.test\",\"selectionId\":\"selection.bridge.full-capability.focus\",\"isolate\":false}",
                "request.bridge.full-capability.focus-retry"));
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "setNodeVisualState",
                "{\"sceneNodeId\":\"scene-node.test\",\"visualState\":\"alarm\",\"statusUpdatedAt\":\"2026-08-08T10:00:00.000Z\",\"hasSourceRevision\":false,\"sourceRevision\":0}",
                "request.bridge.full-capability.state"));
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "setRouteFlow",
                "{\"routeId\":\"route.test\",\"enabled\":true}",
                "request.bridge.full-capability.route"));
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "setNodeVisibility",
                "{\"sceneNodeId\":\"scene-node.test\",\"enabled\":false}",
                "request.bridge.full-capability.visibility"));
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "resetScene",
                "{}",
                "request.bridge.full-capability.reset"));
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "setNodeVisualState",
                "{\"sceneNodeId\":\"scene-node.missing\",\"visualState\":\"fault\",\"statusUpdatedAt\":\"2026-08-08T10:00:01.000Z\",\"hasSourceRevision\":true,\"sourceRevision\":2}",
                "request.bridge.full-capability.state-missing"));
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "setRouteFlow",
                "{\"routeId\":\"route.missing\",\"enabled\":false}",
                "request.bridge.full-capability.route-missing"));
            yield return null;

            Assert.That(controller.ProcessStepCalls, Is.EqualTo(1));
            Assert.That(controller.LastProcessId, Is.EqualTo("test-process"));
            Assert.That(controller.LastStepId, Is.EqualTo("test-step"));
            Assert.That(controller.LastUnitId, Is.EqualTo("all"));
            Assert.That(controller.LastProcessIsolate, Is.True);
            Assert.That(controller.FocusCalls, Is.EqualTo(1));
            Assert.That(controller.LastFocusedNodeId, Is.EqualTo("scene-node.test"));
            Assert.That(controller.LastFocusIsolate, Is.False);
            Assert.That(controller.VisualStateCalls, Is.EqualTo(1));
            Assert.That(controller.LastVisualStateNodeId, Is.EqualTo("scene-node.test"));
            Assert.That(controller.LastVisualState, Is.EqualTo(BusinessSceneNodeVisualState.Alarm));
            Assert.That(controller.RouteFlowCalls, Is.EqualTo(1));
            Assert.That(controller.LastRouteId, Is.EqualTo("route.test"));
            Assert.That(controller.LastRouteEnabled, Is.True);
            Assert.That(controller.LastRouteSpeedMultiplier, Is.EqualTo(1f));
            Assert.That(controller.VisibilityCalls, Is.EqualTo(1));
            Assert.That(controller.LastVisibilityNodeId, Is.EqualTo("scene-node.test"));
            Assert.That(controller.LastVisibility, Is.False);
            Assert.That(controller.ResetCalls, Is.EqualTo(1));
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.full-capability.state-missing", "\"errorCode\":\"invalid-node\""), Is.True);
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.full-capability.route-missing", "\"errorCode\":\"invalid-route\""), Is.True);

            string[] successfulRequestIds =
            {
                "request.bridge.full-capability.process",
                "request.bridge.full-capability.focus",
                "request.bridge.full-capability.focus-retry",
                "request.bridge.full-capability.state",
                "request.bridge.full-capability.route",
                "request.bridge.full-capability.visibility",
                "request.bridge.full-capability.reset"
            };
            for (int requestIndex = 0; requestIndex < successfulRequestIds.Length; requestIndex++)
            {
                string requestId = successfulRequestIds[requestIndex];
                Assert.That(HasNotice("commandResult", requestId, string.Empty), Is.True, $"桥接命令 {requestId} 未返回关联结果。");
                Assert.That(HasBridgeLogFragmentForRequest(requestId, "\"success\":true"), Is.True, $"桥接命令 {requestId} 未返回成功结果。");
            }
        }

        /// <summary>
        /// 浏览器可能在旧状态回执丢失后重发原命令；桥接必须以“来源时间＋可选修订号”阻止旧状态覆盖新状态。
        /// 相同时间的更高修订必须应用，而同修订重试和低修订迟到应直接成功且不重复触发材质更新。
        /// </summary>
        [UnityTest]
        public IEnumerator 设备状态迟到重试不能覆盖较新的四态结果()
        {
            yield return LoadBootstrap();
            _bridgeManager = FindBridgeManager();
            Assert.That(_bridgeManager, Is.Not.Null, "Bootstrap 未创建常驻 Unity 桥接管理器。");
            SubscribeBridgeOutboundLogs();

            RecordingBusinessSceneController controller = new RecordingBusinessSceneController();
            FieldInfo activeControllerField = typeof(MultiSceneCoordinator).GetField("_activeController", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.That(activeControllerField, Is.Not.Null, "多场景协调器缺少当前控制器字段，测试不能绕过正式活动控制器读取路径。");
            activeControllerField.SetValue(_coordinator, controller);

            const string repeatedTimestamp = "2026-08-08T10:00:01.000Z";
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "setNodeVisualState",
                $"{{\"sceneNodeId\":\"scene-node.test\",\"visualState\":\"alarm\",\"statusUpdatedAt\":\"{repeatedTimestamp}\",\"hasSourceRevision\":true,\"sourceRevision\":4}}",
                "request.bridge.state.revision-four"));
            const string newestPayload = "{\"sceneNodeId\":\"scene-node.test\",\"visualState\":\"fault\",\"statusUpdatedAt\":\"2026-08-08T10:00:01.000Z\",\"hasSourceRevision\":true,\"sourceRevision\":5}";
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("setNodeVisualState", newestPayload, "request.bridge.state.revision-five"));
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("setNodeVisualState", newestPayload, "request.bridge.state.revision-five-retry"));
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "setNodeVisualState",
                $"{{\"sceneNodeId\":\"scene-node.test\",\"visualState\":\"alarm\",\"statusUpdatedAt\":\"{repeatedTimestamp}\",\"hasSourceRevision\":true,\"sourceRevision\":4}}",
                "request.bridge.state.revision-four-stale"));
            yield return null;

            Assert.That(controller.VisualStateCalls, Is.EqualTo(2), "同时间更高修订必须执行一次；同修订重试和低修订迟到不得再次调用控制器。");
            Assert.That(controller.LastVisualState, Is.EqualTo(BusinessSceneNodeVisualState.Fault), "低修订状态不得覆盖较新的故障状态。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.state.revision-four", "\"success\":true"), Is.True);
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.state.revision-five", "\"success\":true"), Is.True);
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.state.revision-five-retry", "\"success\":true"), Is.True);
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.state.revision-four-stale", "\"success\":true"), Is.True);
        }

        /// <summary>
        /// 燃气流程的每个已发布步骤都必须解析到场景序列化登记的三维节点。
        /// 通过真实桥接器逐项下发单机组请求，防止流程代码拼接未登记节点后被镜头方法静默忽略，
        /// 同时不把步骤名称扩展为设备标识或二维拓扑映射。
        /// </summary>
        [UnityTest]
        public IEnumerator 燃气已发布流程步骤均使用已登记三维节点()
        {
            yield return LoadBootstrap();
            _bridgeManager = FindBridgeManager();
            Assert.That(_bridgeManager, Is.Not.Null, "Bootstrap 未创建常驻 Unity 桥接管理器。");
            SubscribeBridgeOutboundLogs();

            InvokeBridgeMethod("ReceiveFromParent", CreateSceneSwitchMessage("gas-power", "transition.bridge.process-node-registration", "request.bridge.process-node-registration.scene"));
            yield return WaitForCompletion(
                () => HasNotice("sceneChanged", "request.bridge.process-node-registration.scene", "transition.bridge.process-node-registration"),
                "燃气场景未在流程节点登记验证前完成加载。");

            // gas-network 尚无独立场景节点登记，必须明确拒绝，不能为满足测试而借用进气或总览节点。
            string[] publishedStepIds = { "overview", "inlet-duct", "gas-turbine", "hrsg", "steam-turbine", "generator", "grid-output" };
            for (int stepIndex = 0; stepIndex < publishedStepIds.Length; stepIndex++)
            {
                string stepId = publishedStepIds[stepIndex];
                string requestId = $"request.bridge.process-node-registration.{stepId}";
                string payload = $"{{\"processId\":\"gas-power-generation\",\"stepId\":\"{stepId}\",\"unitId\":\"1\",\"isolate\":true}}";
                InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("enterProcessStep", payload, requestId));
                yield return WaitForCompletion(
                    () => HasNotice("commandResult", requestId, string.Empty),
                    $"燃气流程步骤 {stepId} 未返回命令结果。");
                Assert.That(HasBridgeLogFragmentForRequest(requestId, "\"success\":true"), Is.True, $"燃气流程步骤 {stepId} 引用了未登记三维节点或未成功执行。");
            }

            const string gasNetworkRequestId = "request.bridge.process-node-registration.gas-network";
            const string gasNetworkPayload = "{\"processId\":\"gas-power-generation\",\"stepId\":\"gas-network\",\"unitId\":\"1\",\"isolate\":true}";
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("enterProcessStep", gasNetworkPayload, gasNetworkRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", gasNetworkRequestId, string.Empty),
                "未登记燃气管网步骤未返回明确拒绝结果。");
            Assert.That(HasBridgeLogFragmentForRequest(gasNetworkRequestId, "\"errorCode\":\"invalid-process-step\""), Is.True, "未登记燃气管网步骤不得伪造成功或聚焦到其他节点。");
        }

        /// <summary>
        /// 每个播放模式用例结束后都显式释放常驻根对象和附加业务场景。
        /// 卸载按场景路径逐项执行且限制为当前任务创建的九个目录路径，避免误动测试框架或用户场景。
        /// </summary>
        [UnityTearDown]
        public IEnumerator 释放常驻协调器和测试加载的业务场景()
        {
            if (_coordinator != null)
            {
                _coordinator.DisposeRuntime();
                Object.Destroy(_coordinator.gameObject);
                _coordinator = null;
                _bridgeManager = null;
            }

            // UnityIframeBridgeManager 会迁入 DontDestroyOnLoad 场景，单独销毁协调器不会自动移除它。
            // 测试用例已通过 Bootstrap 以单场景模式创建该桥接对象；在此处按精确类型名清理，
            // 防止前一个用例已释放的桥接器被下一用例复用并错误返回 runtime-releasing。
            DestroyTestBridgeManagers();
            UnsubscribeBridgeOutboundLogs();

            yield return null;
            string[] businessScenePaths =
            {
                "Assets/Scenes/Business/CoalPower.unity",
                GasPowerScenePath,
                "Assets/Scenes/Business/WindPower.unity",
                "Assets/Scenes/Business/SolarPower.unity",
                "Assets/Scenes/Business/Substation.unity",
                "Assets/Scenes/Business/Distribution.unity",
                "Assets/Scenes/Business/Consumption.unity",
                "Assets/Scenes/Business/Microgrid.unity",
                "Assets/Scenes/Business/Dispatch.unity"
            };
            for (int index = 0; index < businessScenePaths.Length; index++)
            {
                Scene scene = SceneManager.GetSceneByPath(businessScenePaths[index]);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                AsyncOperation unloadOperation = SceneManager.UnloadSceneAsync(scene);
                while (unloadOperation != null && !unloadOperation.isDone)
                {
                    yield return null;
                }
            }
        }

        /// <summary>
        /// 仅用于验证桥接分派的记录控制器。所有方法为常数时间赋值且不持有Unity对象、场景句柄或资源，
        /// 因此不会改变正式目录，也不会把测试标识泄漏到构建产物或运行时映射中。
        /// </summary>
        private sealed class RecordingBusinessSceneController : IBusinessSceneController
        {
            private const BusinessSceneCapability AllCapabilities =
                BusinessSceneCapability.Initialize |
                BusinessSceneCapability.EnterProcessStep |
                BusinessSceneCapability.FocusNode |
                BusinessSceneCapability.UpdateNodeVisualState |
                BusinessSceneCapability.SetRouteFlow |
                BusinessSceneCapability.ResetScene |
                BusinessSceneCapability.Release |
                BusinessSceneCapability.SetNodeVisibility;

            public string SceneId => "test-full-capability";
            public BusinessSceneCapability Capabilities => AllCapabilities;
            public int ProcessStepCalls { get; private set; }
            public string LastProcessId { get; private set; }
            public string LastStepId { get; private set; }
            public string LastUnitId { get; private set; }
            public bool LastProcessIsolate { get; private set; }
            public int FocusCalls { get; private set; }
            public string LastFocusedNodeId { get; private set; }
            public bool LastFocusIsolate { get; private set; }
            public int VisualStateCalls { get; private set; }
            public string LastVisualStateNodeId { get; private set; }
            public BusinessSceneNodeVisualState LastVisualState { get; private set; }
            public int RouteFlowCalls { get; private set; }
            public string LastRouteId { get; private set; }
            public bool LastRouteEnabled { get; private set; }
            public float LastRouteSpeedMultiplier { get; private set; }
            public int VisibilityCalls { get; private set; }
            public string LastVisibilityNodeId { get; private set; }
            public bool LastVisibility { get; private set; }
            public int ResetCalls { get; private set; }

            public IEnumerator InitializeAsync(BusinessSceneInitializationContext context, System.Action<BusinessSceneCommandResult> completed)
            {
                completed?.Invoke(BusinessSceneCommandResult.Completed("测试控制器初始化完成。"));
                yield break;
            }

            public BusinessSceneCommandResult EnterProcessStep(string processId, string stepId, string unitId, bool isolate)
            {
                ProcessStepCalls++;
                LastProcessId = processId;
                LastStepId = stepId;
                LastUnitId = unitId;
                LastProcessIsolate = isolate;
                return BusinessSceneCommandResult.Completed("流程命令已记录。");
            }

            public BusinessSceneCommandResult FocusNode(string sceneNodeId, bool isolate)
            {
                FocusCalls++;
                LastFocusedNodeId = sceneNodeId;
                LastFocusIsolate = isolate;
                return BusinessSceneCommandResult.Completed("聚焦命令已记录。");
            }

            public BusinessSceneCommandResult UpdateNodeVisualState(string sceneNodeId, BusinessSceneNodeVisualState visualState)
            {
                if (!string.Equals(sceneNodeId, "scene-node.test", System.StringComparison.Ordinal))
                {
                    return BusinessSceneCommandResult.Failed("invalid-node", $"未知三维节点：{sceneNodeId}");
                }

                VisualStateCalls++;
                // 状态命令使用独立字段记录节点标识，避免后续显隐命令覆盖后仍让断言误判为状态参数正确。
                LastVisualStateNodeId = sceneNodeId;
                LastVisualState = visualState;
                return BusinessSceneCommandResult.Completed("节点四态命令已记录。");
            }

            public BusinessSceneCommandResult SetRouteFlow(string routeId, bool enabled, float speedMultiplier)
            {
                if (!string.Equals(routeId, "route.test", System.StringComparison.Ordinal))
                {
                    return BusinessSceneCommandResult.Failed("invalid-route", $"未知路径：{routeId}");
                }

                RouteFlowCalls++;
                LastRouteId = routeId;
                LastRouteEnabled = enabled;
                LastRouteSpeedMultiplier = speedMultiplier;
                return BusinessSceneCommandResult.Completed("路径命令已记录。");
            }

            public BusinessSceneCommandResult SetNodeVisibility(string sceneNodeId, bool visible)
            {
                VisibilityCalls++;
                // 显隐命令单独记录目标节点，确保桥接层没有错误复用聚焦或状态命令的参数。
                LastVisibilityNodeId = sceneNodeId;
                LastVisibility = visible;
                return BusinessSceneCommandResult.Completed("显隐命令已记录。");
            }

            public BusinessSceneCommandResult ResetScene()
            {
                ResetCalls++;
                return BusinessSceneCommandResult.Completed("复位命令已记录。");
            }

            public BusinessSceneCommandResult ReleaseScene()
            {
                return BusinessSceneCommandResult.Completed("测试控制器已释放。");
            }

            public string GetStateDescription()
            {
                return "test-full-capability-ready";
            }
        }

        /// <summary>
        /// 使用正式启动场景而非运行时夹具，确保序列化目录引用、加载反馈和常驻协调器同时参与验证。
        /// 先检查单例为空，避免测试环境已有遗留常驻对象时误把其他用例的状态当作本用例结果。
        /// </summary>
        private IEnumerator LoadBootstrap()
        {
            Assert.That(MultiSceneCoordinator.Instance, Is.Null, "测试开始前不应存在其他多场景协调器实例。");
            AsyncOperation loadOperation = SceneManager.LoadSceneAsync(BootstrapScenePath, LoadSceneMode.Single);
            Assert.That(loadOperation, Is.Not.Null);
            while (!loadOperation.isDone)
            {
                yield return null;
            }

            _coordinator = Object.FindFirstObjectByType<MultiSceneCoordinator>();
            Assert.That(_coordinator, Is.Not.Null, "Bootstrap 未创建多场景协调器。");
            Assert.That(_coordinator.State, Is.Not.EqualTo(MultiSceneCoordinatorState.Failed));
        }

        /// <summary>默认程序集中的桥接器按精确类型名查找；测试只获得 MonoBehaviour 引用，不跨程序集编译依赖业务实现。</summary>
        private static MonoBehaviour FindBridgeManager()
        {
            MonoBehaviour[] behaviours = Object.FindObjectsByType<MonoBehaviour>(FindObjectsSortMode.None);
            for (int index = 0; index < behaviours.Length; index++)
            {
                MonoBehaviour behaviour = behaviours[index];
                if (behaviour != null && behaviour.GetType().Name == "UnityIframeBridgeManager")
                {
                    return behaviour;
                }
            }
            return null;
        }

        /// <summary>
        /// 仅释放当前播放模式测试运行中由 Bootstrap 创建的常驻桥接器。
        /// 生产运行时不调用此方法；通过类型名过滤避免测试程序集对桥接器实现建立编译期耦合。
        /// </summary>
        private static void DestroyTestBridgeManagers()
        {
            MonoBehaviour[] behaviours = Object.FindObjectsByType<MonoBehaviour>(FindObjectsSortMode.None);
            for (int behaviourIndex = 0; behaviourIndex < behaviours.Length; behaviourIndex++)
            {
                MonoBehaviour behaviour = behaviours[behaviourIndex];
                if (behaviour != null && behaviour.GetType().Name == "UnityIframeBridgeManager")
                {
                    Object.Destroy(behaviour.gameObject);
                }
            }
        }

        /// <summary>只统计精确桥接类型，证明业务场景中遗留组件不会在切换后形成第二个常驻实例。</summary>
        private static int CountBridgeManagers()
        {
            MonoBehaviour[] behaviours = Object.FindObjectsByType<MonoBehaviour>(FindObjectsSortMode.None);
            int count = 0;
            for (int index = 0; index < behaviours.Length; index++)
            {
                if (behaviours[index] != null && behaviours[index].GetType().Name == "UnityIframeBridgeManager")
                {
                    count++;
                }
            }
            return count;
        }

        /// <summary>
        /// 仅在测试进程中统计燃气控制器按固定后缀创建的临时材质，用于证明连续切换后资源不会累积。
        /// 生产代码不调用此全局查询，避免把对象扫描放入运行时切换或每帧路径。
        /// </summary>
        private static int CountRuntimeContextMaterials()
        {
            Material[] materials = Resources.FindObjectsOfTypeAll<Material>();
            int count = 0;
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                Material material = materials[materialIndex];
                if (material != null && material.name.EndsWith(" (Runtime Context)", System.StringComparison.Ordinal))
                {
                    count++;
                }
            }

            return count;
        }

        /// <summary>
        /// 读取协调器五个公开事件的私有委托字段并汇总订阅数量。
        /// 释放实现若漏清任意事件，测试都会失败，避免只验证桥接器自己的订阅标志。
        /// </summary>
        private static int CountCoordinatorEventSubscribers(MultiSceneCoordinator coordinator)
        {
            string[] eventFieldNames =
            {
                "StateChanged",
                "ActiveControllerChanged",
                "SceneLoadProgress",
                "SceneSwitchCompleted",
                "RuntimeDiagnosticsChanged"
            };
            int subscriberCount = 0;
            for (int fieldIndex = 0; fieldIndex < eventFieldNames.Length; fieldIndex++)
            {
                FieldInfo eventField = typeof(MultiSceneCoordinator).GetField(
                    eventFieldNames[fieldIndex],
                    BindingFlags.Instance | BindingFlags.NonPublic);
                Assert.That(eventField, Is.Not.Null, $"协调器缺少事件字段：{eventFieldNames[fieldIndex]}。");
                if (eventField.GetValue(coordinator) is System.Delegate eventDelegate)
                {
                    subscriberCount += eventDelegate.GetInvocationList().Length;
                }
            }

            return subscriberCount;
        }

        /// <summary>读取只读诊断属性；不存在或类型不匹配立即失败，避免反射测试静默掩盖接口回退。</summary>
        private int GetBridgeIntProperty(string propertyName)
        {
            PropertyInfo property = _bridgeManager.GetType().GetProperty(propertyName, BindingFlags.Instance | BindingFlags.Public);
            Assert.That(property, Is.Not.Null, $"桥接器缺少诊断属性：{propertyName}。");
            object value = property.GetValue(_bridgeManager);
            Assert.That(value, Is.TypeOf<int>());
            return (int)value;
        }

        /// <summary>读取当前控制器只读属性，仅比较对象引用，不读取控制器的私有状态或场景对象层级。</summary>
        private object GetBridgeObjectProperty(string propertyName)
        {
            PropertyInfo property = _bridgeManager.GetType().GetProperty(propertyName, BindingFlags.Instance | BindingFlags.Public);
            Assert.That(property, Is.Not.Null, $"桥接器缺少控制器属性：{propertyName}。");
            return property.GetValue(_bridgeManager);
        }

        /// <summary>调用公开桥接入口，模拟已通过 .jslib 来源过滤的入站消息；找不到方法时立即失败而非跳过验证。</summary>
        private void InvokeBridgeMethod(string methodName, params object[] arguments)
        {
            MethodInfo method = _bridgeManager.GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.Public);
            Assert.That(method, Is.Not.Null, $"桥接器缺少公开入口：{methodName}。");
            method.Invoke(_bridgeManager, arguments);
        }

        /// <summary>编辑器模式桥接把回传写入 Debug.Log；限定前缀后仅缓存本任务产生的消息，避免测试框架日志污染断言。</summary>
        private void SubscribeBridgeOutboundLogs()
        {
            if (_bridgeLogSubscribed)
            {
                return;
            }
            Application.logMessageReceived += HandleBridgeLog;
            _bridgeLogSubscribed = true;
        }

        /// <summary>测试结束后移除日志回调，防止常驻测试运行器将闭包保留到下一个播放模式用例。</summary>
        private void UnsubscribeBridgeOutboundLogs()
        {
            if (!_bridgeLogSubscribed)
            {
                return;
            }
            Application.logMessageReceived -= HandleBridgeLog;
            _bridgeLogSubscribed = false;
            _bridgeOutboundLogs.Clear();
        }

        /// <summary>只记录桥接模拟回传，容量固定避免异常循环日志使测试进程内存增长。</summary>
        private void HandleBridgeLog(string condition, string stackTrace, LogType type)
        {
            const string prefix = "[UnityIframeBridge] 模拟回传：";
            if (type != LogType.Log || string.IsNullOrEmpty(condition) || !condition.StartsWith(prefix, System.StringComparison.Ordinal))
            {
                return;
            }
            _bridgeOutboundLogs.Add(condition);
            if (_bridgeOutboundLogs.Count > 128)
            {
                _bridgeOutboundLogs.RemoveAt(0);
            }
        }

        /// <summary>构造最小合法场景切换信封，直接模拟已由 .jslib 完成来源过滤后的 Unity 入站消息。</summary>
        private static string CreateSceneSwitchMessage(string sceneId, string transitionId, string requestId, bool forceReload = false)
        {
            string forceReloadJson = forceReload ? "true" : "false";
            return $"{{\"channel\":\"power3d-unity\",\"version\":1,\"instanceId\":\"local-demo-001\",\"messageId\":\"{requestId}\",\"type\":\"switchScene\",\"payload\":{{\"sceneId\":\"{sceneId}\",\"transitionId\":\"{transitionId}\",\"sceneMappingVersion\":\"unpublished\",\"forceReload\":{forceReloadJson}}},\"timestamp\":1}}";
        }

        /// <summary>构造幂等释放命令；重复释放仍应得到 disposed 回执，但不能重新订阅或恢复场景回调。</summary>
        private static string CreateDisposeMessage(string requestId)
        {
            return $"{{\"channel\":\"power3d-unity\",\"version\":1,\"instanceId\":\"local-demo-001\",\"messageId\":\"{requestId}\",\"type\":\"dispose\",\"payload\":{{}},\"timestamp\":1}}";
        }

        /// <summary>构造当前桥接白名单内的最小动作命令；测试负载为固定 JSON，不接受或拼接外部输入。</summary>
        private static string CreateBridgeCommandMessage(string commandType, string payloadJson, string requestId)
        {
            return $"{{\"channel\":\"power3d-unity\",\"version\":1,\"instanceId\":\"local-demo-001\",\"messageId\":\"{requestId}\",\"type\":\"{commandType}\",\"payload\":{payloadJson},\"timestamp\":1}}";
        }

        /// <summary>终态只允许场景成功事件或结构化命令结果，进度与 ack 不能提前结束切换等待。</summary>
        private bool HasTerminalNotice(string requestId, string transitionId)
        {
            return HasNotice("sceneChanged", requestId, transitionId) ||
                   HasNotice("commandResult", requestId, transitionId);
        }

        /// <summary>只解析编辑器模式中桥接输出的最小 JSON 字段，避免测试依赖私有消息模型、场景层级或用户业务文案。</summary>
        private bool HasNotice(string type, string requestId, string transitionId)
        {
            string typeFragment = $"\"type\":\"{type}\"";
            string requestFragment = $"\"requestId\":\"{requestId}\"";
            string transitionFragment = string.IsNullOrEmpty(transitionId) ? string.Empty : $"\"transitionId\":\"{transitionId}\"";
            for (int index = 0; index < _bridgeOutboundLogs.Count; index++)
            {
                string log = _bridgeOutboundLogs[index];
                if (log.Contains(typeFragment) && log.Contains(requestFragment) &&
                    (string.IsNullOrEmpty(transitionFragment) || log.Contains(transitionFragment)))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>将错误码与原请求关联，避免前一条命令的同类错误掩盖后续命令的路由错误。</summary>
        private bool HasBridgeLogFragmentForRequest(string requestId, string fragment)
        {
            string requestFragment = $"\"requestId\":\"{requestId}\"";
            for (int index = 0; index < _bridgeOutboundLogs.Count; index++)
            {
                string log = _bridgeOutboundLogs[index];
                if (log.Contains(requestFragment) && log.Contains(fragment))
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// 按真实时间轮询特定请求完成，并通过固定秒数上限防止异步加载异常时测试无限挂起。
        /// 测试扩展可能解除帧节流，单纯 yield null 会在资源线程完成前快速消耗帧数；
        /// 使用短实时等待既允许 Unity 异步加载推进，也保持超时信息不泄漏场景层级。
        /// </summary>
        private static IEnumerator WaitForCompletion(System.Func<bool> completed, string timeoutMessage)
        {
            float deadline = Time.realtimeSinceStartup + MaximumWaitSeconds;
            while (Time.realtimeSinceStartup < deadline)
            {
                if (completed())
                {
                    yield break;
                }

                yield return new WaitForSecondsRealtime(PollIntervalSeconds);
            }

            Assert.Fail(timeoutMessage);
        }

        /// <summary>
        /// 初始燃气加载在多个播放模式用例中复用，避免重复复制订阅、等待与成功断言。
        /// 每个用例使用不同事务标识，确保结果关联检查不会被其他测试的历史事件混淆。
        /// </summary>
        private IEnumerator LoadGasPower(string transitionId)
        {
            SceneSwitchResult result = default;
            bool completed = false;
            _coordinator.SceneSwitchCompleted += received =>
            {
                if (received.TransitionId == transitionId)
                {
                    result = received;
                    completed = true;
                }
            };

            Assert.That(_coordinator.RequestSwitchScene("gas-power", transitionId), Is.True);
            yield return WaitForCompletion(() => completed, "初始燃气场景加载未在时限内结束。");
            Assert.That(result.Success, Is.True, result.Message);
            Assert.That(_coordinator.ActiveSceneId, Is.EqualTo("gas-power"));
        }

        /// <summary>
        /// 仅统计九场景正式目录中的已加载业务场景，用于断言不存在残留隐藏场景。
        /// 不统计 Bootstrap 或测试框架场景，避免把常驻启动壳误认为活动业务场景。
        /// </summary>
        private static int CountLoadedBusinessScenes()
        {
            string[] businessScenePaths =
            {
                CoalPowerScenePath,
                GasPowerScenePath,
                "Assets/Scenes/Business/WindPower.unity",
                "Assets/Scenes/Business/SolarPower.unity",
                "Assets/Scenes/Business/Substation.unity",
                "Assets/Scenes/Business/Distribution.unity",
                "Assets/Scenes/Business/Consumption.unity",
                "Assets/Scenes/Business/Microgrid.unity",
                "Assets/Scenes/Business/Dispatch.unity"
            };
            int loadedCount = 0;
            for (int index = 0; index < businessScenePaths.Length; index++)
            {
                Scene scene = SceneManager.GetSceneByPath(businessScenePaths[index]);
                if (scene.IsValid() && scene.isLoaded)
                {
                    loadedCount++;
                }
            }

            return loadedCount;
        }
    }
}
