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
    /// 以正式 Bootstrap、燃气、燃煤和空业务场景执行多场景协调器的播放模式验证。
    /// 测试不为七个空场景伪造控制器或资源：它们必须初始化失败、被卸载，
    /// 然后由协调器恢复此前已成功进入的稳定发电场景。
    /// </summary>
    public sealed class MultiSceneCoordinatorPlayModeTests
    {
        private const string BootstrapScenePath = "Assets/Scenes/Bootstrap.unity";
        private const string OverviewScenePath = "Assets/Scenes/Overview/Overview.unity";
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
        /// 测试运行期间关闭 Bootstrap 本地自动进入总览辅助器，确保各用例仍完全控制自己的场景事务。
        /// 普通用户从 Bootstrap 点击播放时不设置该门禁，辅助器会按设计进入总览。
        /// </summary>
        [SetUp]
        public void 抑制Bootstrap本地自动跳转()
        {
            BootstrapOverviewAutoEnterTest.SuppressForAutomatedTests = true;
        }

        /// <summary>
        /// 验证燃煤真实成功路径、失败恢复和单活动场景约束。
        /// 燃气和燃煤场景均由正式组合适配器初始化；空场景由占位控制器返回内容未交付，
        /// 失败结果必须保留原始请求标识、报告结构化失败并恢复到燃煤场景。
        /// </summary>
        [UnityTest]
        public IEnumerator 燃气成功加载后燃煤成功且空场景失败会恢复燃煤()
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
            yield return WaitForCompletion(() => coalCompleted, "燃煤场景加载未在帧预算内结束。");
            Assert.That(coalResult.Success, Is.True, coalResult.Message);
            Assert.That(coalResult.SceneId, Is.EqualTo("coal-power"));
            Assert.That(_coordinator.State, Is.EqualTo(MultiSceneCoordinatorState.Ready));
            Assert.That(_coordinator.ActiveSceneId, Is.EqualTo("coal-power"));
            Assert.That(SceneManager.GetSceneByPath(GasPowerScenePath).isLoaded, Is.False);
            Assert.That(SceneManager.GetSceneByPath(CoalPowerScenePath).isLoaded, Is.True);
            Assert.That(CountLoadedBusinessScenes(), Is.EqualTo(1));
            string coalSceneActivationId = _coordinator.ActiveSceneActivationId;
            Assert.That(coalSceneActivationId, Is.Not.EqualTo(initialSceneActivationId));

            SceneSwitchResult unavailableResult = default;
            bool unavailableCompleted = false;
            _coordinator.SceneSwitchCompleted += result =>
            {
                if (result.TransitionId == "transition.playmode.coal-recovery")
                {
                    unavailableResult = result;
                    unavailableCompleted = true;
                }
            };

            Assert.That(_coordinator.RequestSwitchScene("wind-power", "transition.playmode.coal-recovery"), Is.True);
            yield return WaitForCompletion(() => unavailableCompleted, "空场景失败恢复未在帧预算内结束。");
            Assert.That(unavailableResult.Success, Is.False);
            Assert.That(unavailableResult.ErrorCode, Is.EqualTo("scene-content-unavailable"));
            Assert.That(unavailableResult.Recovered, Is.True);
            Assert.That(unavailableResult.RestoredSceneId, Is.EqualTo("coal-power"));
            Assert.That(unavailableResult.RestoredSceneActivationId, Is.Not.Empty, "恢复结果必须携带新物理场景实例标识。\n");
            Assert.That(unavailableResult.RestoredSceneActivationId, Is.Not.EqualTo(coalSceneActivationId), "恢复结果不得继续暴露已卸载燃煤实例的旧标识。\n");
            Assert.That(unavailableResult.RestoredSceneActivationId, Is.EqualTo(_coordinator.ActiveSceneActivationId), "恢复结果必须与协调器当前活动实例一致。\n");
            Assert.That(_coordinator.State, Is.EqualTo(MultiSceneCoordinatorState.Ready));
            Assert.That(_coordinator.ActiveSceneId, Is.EqualTo("coal-power"));
            Assert.That(SceneManager.GetSceneByPath(CoalPowerScenePath).isLoaded, Is.True);
            Assert.That(SceneManager.GetSceneByPath("Assets/Scenes/Business/WindPower.unity").isLoaded, Is.False);
            Assert.That(CountLoadedBusinessScenes(), Is.EqualTo(1));
        }

        /// <summary>
        /// Bootstrap 只初始化常驻服务，不得自行选择沙盘或业务场景。
        /// Overview 和后续业务场景都必须由平台 switchScene 命令驱动，并返回可关联的 sceneChanged。
        /// </summary>
        [UnityTest]
        public IEnumerator 启动场景保持空闲直到平台命令进入总览再切换燃煤()
        {
            yield return LoadBootstrap();
            yield return null;
            yield return null;

            Assert.That(_coordinator.State, Is.EqualTo(MultiSceneCoordinatorState.Idle));
            Assert.That(_coordinator.ActiveSceneId, Is.Empty);
            Assert.That(SceneManager.GetSceneByPath(OverviewScenePath).isLoaded, Is.False);
            Assert.That(CountLoadedBusinessScenes(), Is.EqualTo(0));

            _bridgeManager = FindBridgeManager();
            Assert.That(_bridgeManager, Is.Not.Null, "Bootstrap 未创建常驻 Unity 桥接管理器。");
            SubscribeBridgeOutboundLogs();

            const string overviewRequestId = "request.bridge.bootstrap.overview";
            const string overviewTransitionId = "transition.bridge.bootstrap.overview";
            InvokeBridgeMethod(
                "ReceiveFromParent",
                CreateSceneSwitchMessage(OverviewSceneCatalog.OverviewSceneId, overviewTransitionId, overviewRequestId));
            yield return WaitForCompletion(
                () => HasNotice("sceneChanged", overviewRequestId, overviewTransitionId),
                "平台总览场景命令未在帧预算内完成。");

            Assert.That(_coordinator.State, Is.EqualTo(MultiSceneCoordinatorState.Ready));
            Assert.That(_coordinator.ActiveSceneId, Is.EqualTo(OverviewSceneCatalog.OverviewSceneId));
            Assert.That(SceneManager.GetSceneByPath(OverviewScenePath).isLoaded, Is.True);
            Assert.That(CountLoadedBusinessScenes(), Is.EqualTo(0));

            const string coalRequestId = "request.bridge.overview.coal";
            const string coalTransitionId = "transition.bridge.overview.coal";
            InvokeBridgeMethod(
                "ReceiveFromParent",
                CreateSceneSwitchMessage("coal-power", coalTransitionId, coalRequestId));
            yield return WaitForCompletion(
                () => HasNotice("sceneChanged", coalRequestId, coalTransitionId),
                "平台燃煤场景命令未在帧预算内完成。");

            Assert.That(_coordinator.ActiveSceneId, Is.EqualTo("coal-power"));
            Assert.That(SceneManager.GetSceneByPath(OverviewScenePath).isLoaded, Is.False);
            Assert.That(CountLoadedBusinessScenes(), Is.EqualTo(1));
        }
        /// <summary>
        /// 初始化确认属于 requestId（原始请求标识）关联消息，不能携带空的 sceneActivationId（物理场景激活标识）。
        /// 此用例直接经过真实桥接公开入口和 JsonUtility（Unity 内置 JSON 序列化工具），
        /// 防止通用负载新增可选字段后又被自动序列化为前端协议不允许的空字符串。
        /// </summary>
        [UnityTest]
        public IEnumerator 初始化确认只发送协议允许的最小字段()
        {
            yield return LoadBootstrap();
            _bridgeManager = FindBridgeManager();
            Assert.That(_bridgeManager, Is.Not.Null, "Bootstrap 未创建常驻 Unity 桥接管理器。");
            SubscribeBridgeOutboundLogs();

            const string requestId = "request.bridge.init.minimal-payload";
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("init", "{}", requestId));
            yield return WaitForCompletion(
                () => HasNotice("ack", requestId, string.Empty),
                "初始化确认未在时限内回传。");

            string acknowledgementLog = _bridgeOutboundLogs[_bridgeOutboundLogs.Count - 1];
            Assert.That(acknowledgementLog, Does.Contain("\"type\":\"ack\""));
            Assert.That(acknowledgementLog, Does.Contain($"\"requestId\":\"{requestId}\""));
            Assert.That(acknowledgementLog, Does.Not.Contain("\"sceneActivationId\":"), "初始化确认不得携带空或无关的物理场景激活标识。");
        }

        /// <summary>
        /// 场景切换的 ack（接收确认）必须先于协调器首个加载进度和最终完成事件。
        /// 协调器允许同步发出进度，若桥接器晚于它发送确认，前端就会因尚未登记等待状态而拒绝合法进度；
        /// 同时断言确认不携带空 sceneActivationId，避免与初始化确认出现同一序列化回归。
        /// </summary>
        [UnityTest]
        public IEnumerator 场景切换确认先于加载进度且不携带空恢复标识()
        {
            yield return LoadBootstrap();
            _bridgeManager = FindBridgeManager();
            Assert.That(_bridgeManager, Is.Not.Null, "Bootstrap 未创建常驻 Unity 桥接管理器。");
            SubscribeBridgeOutboundLogs();

            const string requestId = "request.bridge.switch.ack-before-progress";
            const string transitionId = "transition.bridge.switch.ack-before-progress";
            InvokeBridgeMethod("ReceiveFromParent", CreateSceneSwitchMessage("gas-power", transitionId, requestId));
            yield return WaitForCompletion(
                () => HasNotice("sceneChanged", requestId, transitionId),
                "燃气场景切换未在时限内完成。");

            int acknowledgementIndex = FindBridgeNoticeIndex("ack", requestId);
            int completionIndex = FindBridgeNoticeIndex("sceneChanged", requestId);
            Assert.That(acknowledgementIndex, Is.GreaterThanOrEqualTo(0), "场景切换必须先回传接收确认。");
            Assert.That(completionIndex, Is.GreaterThan(acknowledgementIndex), "场景完成事件不能早于接收确认。");
            Assert.That(_bridgeOutboundLogs[acknowledgementIndex], Does.Not.Contain("\"sceneActivationId\":"), "场景接收确认不得携带空恢复标识。");
        }

        /// <summary>
        /// 在旧请求已经进入卸载或加载阶段后发出最新请求，验证协调器层面的事务取代。
        /// 旧请求必须只产生 command-superseded，不能在异步操作收尾后把尚未完成的目标场景提交为活动场景；
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
        /// 燃气和燃煤场景应成功完成；其余空场景按既有占位约束失败并恢复最近一次稳定发电场景。无论成功或失败，
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
            // 再逐一验证其余目录项。燃煤成功后，空场景失败会恢复燃煤；仍只发送九次请求，
            // 也不按文件名或场景对象名称推断业务身份。
            List<string> sceneIds = new List<string>(BusinessSceneCatalog.GetRequiredSceneIds());
            int gasPowerIndex = sceneIds.IndexOf("gas-power");
            Assert.That(gasPowerIndex, Is.GreaterThanOrEqualTo(0), "正式九场景目录必须包含已交付的燃气发电场景。");
            sceneIds.RemoveAt(gasPowerIndex);
            sceneIds.Insert(0, "gas-power");
            string stableSceneId = "gas-power";
            for (int index = 0; index < sceneIds.Count; index++)
            {
                string sceneId = sceneIds[index];
                string transitionId = $"transition.bridge.lifecycle.{sceneId}";
                string requestId = $"request.bridge.lifecycle.{sceneId}";
                InvokeBridgeMethod("ReceiveFromParent", CreateSceneSwitchMessage(sceneId, transitionId, requestId));

                yield return WaitForCompletion(
                    () => HasTerminalNotice(requestId, transitionId),
                    $"桥接场景请求 {sceneId} 未在时限内返回结构化终态。");

                bool isConfiguredPowerPlant = sceneId == "gas-power" || sceneId == "coal-power";
                if (isConfiguredPowerPlant)
                {
                    Assert.That(HasNotice("sceneChanged", requestId, transitionId), Is.True, "已配置发电场景必须经桥接回传 sceneChanged。");
                    stableSceneId = sceneId;
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
                Assert.That(_coordinator.ActiveSceneId, Is.EqualTo(stableSceneId));
                Assert.That(CountLoadedBusinessScenes(), Is.EqualTo(1));
                // 当前已提交场景的总览本身可能合法持有运行时半透明材质，不能用全局数量误判为上一场景泄漏。
                // 这里只统计未被任何活动渲染器引用的运行时材质；它们才是释放后遗留的孤儿材质。
                Assert.That(
                    CountOrphanRuntimeContextMaterials(),
                    Is.EqualTo(0),
                    $"场景请求 {sceneId} 完成后仍残留未被活动渲染器引用的运行时半透明材质。");

                // 每轮都在当前已配置发电场景创建一组真实运行时材质，下一轮切换必须在卸载前主动清理。
                // 这样九次请求验证的是实际资源生命周期，而不是仅统计协调器或场景实例数量。
                string fadeNodeId = stableSceneId == "coal-power" ? "node.coal-boiler" : "gas-turbine";
                BusinessSceneCommandResult fadeResult = _coordinator.ActiveController.SetNodeVisibility(fadeNodeId, false);
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
        /// 本用例使用正式场景中显式登记的燃机、余热锅炉和蒸汽轮机验证四态与清除都实际到达模型登记器；
        /// 路径能力仍未交付，格式错误、未登记状态节点和未知流程则必须保留可供前端关联的稳定错误码。
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

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("setNodeVisualState", "{\"sceneNodeId\":\"gas-turbine\",\"visualState\":\"alarm\",\"snapshotSequence\":1,\"statusUpdatedAt\":\"2026-08-08T10:00:00.000Z\",\"sourceRevision\":0}", "request.bridge.actions.visual-gas-turbine"));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", "request.bridge.actions.visual-gas-turbine", string.Empty),
                "燃气轮机四态命令未返回结果。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.actions.visual-gas-turbine", "\"success\":true"), Is.True);

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("setNodeVisualState", "{\"sceneNodeId\":\"hrsg\",\"visualState\":\"fault\",\"snapshotSequence\":1,\"statusUpdatedAt\":\"2026-08-08T10:00:00.000Z\",\"sourceRevision\":0}", "request.bridge.actions.visual-hrsg"));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", "request.bridge.actions.visual-hrsg", string.Empty),
                "余热锅炉四态命令未返回结果。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.actions.visual-hrsg", "\"success\":true"), Is.True);

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("setNodeVisualState", "{\"sceneNodeId\":\"steam-turbine\",\"visualState\":\"offline\",\"snapshotSequence\":1,\"statusUpdatedAt\":\"2026-08-08T10:00:00.000Z\",\"sourceRevision\":0}", "request.bridge.actions.visual-steam-turbine"));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", "request.bridge.actions.visual-steam-turbine", string.Empty),
                "蒸汽轮机四态命令未返回结果。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.actions.visual-steam-turbine", "\"success\":true"), Is.True);

            // 清除与设置共用同一节点的本地快照序号。第二个序号证明真实模型能撤销动态颜色，
            // 既不把设备缺失伪装成正常，也不依赖场景卸载才能恢复基础材质。
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("clearNodeVisualState", "{\"sceneNodeId\":\"gas-turbine\",\"snapshotSequence\":2}", "request.bridge.actions.visual-gas-turbine-clear"));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", "request.bridge.actions.visual-gas-turbine-clear", string.Empty),
                "燃气轮机四态清除命令未返回结果。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.actions.visual-gas-turbine-clear", "\"success\":true"), Is.True);

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("setNodeVisualState", "{\"sceneNodeId\":\"generator\",\"visualState\":\"normal\",\"snapshotSequence\":1,\"statusUpdatedAt\":\"2026-08-08T10:00:00.000Z\",\"sourceRevision\":0}", "request.bridge.actions.visual-unmapped"));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", "request.bridge.actions.visual-unmapped", string.Empty),
                "未映射的发电机节点未返回结果。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.actions.visual-unmapped", "\"errorCode\":\"invalid-node\""), Is.True);

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
            // clearSelection（清除选择）必须作为独立命令到达活动控制器；
            // 空载荷不能被误分派为 resetScene（场景重置），否则会改变流程、显隐和镜头上下文。
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "clearSelection",
                "{}",
                "request.bridge.full-capability.clear-selection"));
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "setNodeVisualState",
                "{\"sceneNodeId\":\"scene-node.test\",\"visualState\":\"alarm\",\"snapshotSequence\":1,\"statusUpdatedAt\":\"2026-08-08T10:00:00.000Z\",\"sourceRevision\":0}",
                "request.bridge.full-capability.state"));
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "clearNodeVisualState",
                "{\"sceneNodeId\":\"scene-node.test\",\"snapshotSequence\":2}",
                "request.bridge.full-capability.state-clear"));
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
                "{\"sceneNodeId\":\"scene-node.missing\",\"visualState\":\"fault\",\"snapshotSequence\":2,\"statusUpdatedAt\":\"2026-08-08T10:00:01.000Z\",\"sourceRevision\":2}",
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
            Assert.That(controller.ClearSelectionCalls, Is.EqualTo(1));
            Assert.That(controller.VisualStateCalls, Is.EqualTo(1));
            Assert.That(controller.ClearVisualStateCalls, Is.EqualTo(1));
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
                "request.bridge.full-capability.clear-selection",
                "request.bridge.full-capability.state",
                "request.bridge.full-capability.state-clear",
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
        /// 浏览器可能因旧状态回执丢失而重发原命令；桥接必须只用壳内快照序号阻止旧状态覆盖新状态。
        /// 平台时间和来源修订可以倒退，只要本地序号更大仍必须应用；同序号重试和小序号迟到应幂等忽略。
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

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "setNodeVisualState",
                "{\"sceneNodeId\":\"scene-node.test\",\"visualState\":\"alarm\",\"snapshotSequence\":4,\"statusUpdatedAt\":\"2026-08-08T10:00:01.000Z\",\"sourceRevision\":100}",
                "request.bridge.state.sequence-four"));
            const string newestPayload = "{\"sceneNodeId\":\"scene-node.test\",\"visualState\":\"fault\",\"snapshotSequence\":5,\"statusUpdatedAt\":\"2026-08-07T10:00:01.000Z\",\"sourceRevision\":1}";
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("setNodeVisualState", newestPayload, "request.bridge.state.sequence-five"));
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("setNodeVisualState", newestPayload, "request.bridge.state.sequence-five-retry"));
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "setNodeVisualState",
                "{\"sceneNodeId\":\"scene-node.test\",\"visualState\":\"alarm\",\"snapshotSequence\":4,\"statusUpdatedAt\":\"2026-08-09T10:00:01.000Z\",\"sourceRevision\":999}",
                "request.bridge.state.sequence-four-stale"));
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "clearNodeVisualState",
                "{\"sceneNodeId\":\"scene-node.test\",\"snapshotSequence\":6}",
                "request.bridge.state.sequence-six-clear"));
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "setNodeVisualState",
                "{\"sceneNodeId\":\"scene-node.test\",\"visualState\":\"alarm\",\"snapshotSequence\":5,\"statusUpdatedAt\":\"2026-08-10T10:00:01.000Z\",\"sourceRevision\":1000}",
                "request.bridge.state.sequence-five-after-clear"));
            yield return null;

            Assert.That(controller.VisualStateCalls, Is.EqualTo(2), "更大本地序号必须执行；同序号重试和较小序号迟到不得再次调用控制器。");
            Assert.That(controller.ClearVisualStateCalls, Is.EqualTo(1), "清除必须真实到达控制器，随后较小序号设置不得让旧动态颜色复活。");
            Assert.That(controller.LastVisualState, Is.EqualTo(BusinessSceneNodeVisualState.Fault), "更大的平台时间或修订不得让较小本地序号覆盖最新故障状态。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.state.sequence-four", "\"success\":true"), Is.True);
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.state.sequence-five", "\"success\":true"), Is.True);
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.state.sequence-five-retry", "\"success\":true"), Is.True);
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.state.sequence-four-stale", "\"success\":true"), Is.True);
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.state.sequence-six-clear", "\"success\":true"), Is.True);
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.state.sequence-five-after-clear", "\"success\":true"), Is.True);
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

            // gas-turbine 已迁移为独立第三层关键环节，只能由 enterProcessDetail 进入，
            // 不得再作为旧 enterProcessStep 流程步骤下发；其状态视觉、独立播放控制及返回链路
            // 由本文件“燃气轮机第三层状态视觉与独立播放命令完全解耦”专项用例覆盖。
            // gas-network 尚无独立场景节点登记，必须明确拒绝，不能为满足测试而借用进气或总览节点。
            string[] publishedStepIds = { "overview", "inlet-duct", "hrsg", "steam-turbine", "generator", "grid-output" };
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
        /// 通过正式启动场景、统一桥接和燃煤真实控制器验证完整业务链。
        /// 用例只使用燃煤场景属性面板中显式登记的流程与三维节点标识，依次覆盖流程步骤、选择描边、
        /// 选择清除、上下文半透明、五个一对一设备节点的四态、复位和未交付路径能力，避免只验证“场景能加载”却遗漏核心交互。
        /// </summary>
        [UnityTest]
        public IEnumerator 燃煤真实场景通过桥接完成流程节点四态显隐与复位()
        {
            yield return LoadBootstrap();
            _bridgeManager = FindBridgeManager();
            Assert.That(_bridgeManager, Is.Not.Null, "Bootstrap 未创建常驻 Unity 桥接管理器。");
            SubscribeBridgeOutboundLogs();

            const string sceneRequestId = "request.bridge.coal-actions.scene";
            const string sceneTransitionId = "transition.bridge.coal-actions.scene";
            InvokeBridgeMethod("ReceiveFromParent", CreateSceneSwitchMessage("coal-power", sceneTransitionId, sceneRequestId));
            yield return WaitForCompletion(
                () => HasNotice("sceneChanged", sceneRequestId, sceneTransitionId),
                "燃煤场景未在业务功能验证前完成加载。");

            Assert.That(_coordinator.ActiveSceneId, Is.EqualTo("coal-power"));
            Assert.That(_coordinator.ActiveController, Is.Not.Null);
            Assert.That(SceneManager.GetSceneByPath(CoalPowerScenePath).isLoaded, Is.True);
            Assert.That(CountLoadedBusinessScenes(), Is.EqualTo(1));

            // 燃煤总览会按正式配置将非核心模型显示为半透明上下文，因此初始态本身允许持有有限运行时材质。
            // 后续复位应回到这个稳定基线，而不是错误断言为零；这样仍能准确发现聚焦、显隐或四态操作泄漏的新材质。
            int initialOverviewContextMaterialCount = CountRuntimeContextMaterials();

            // 四个步骤逐一经过正式桥接分派。每步使用独立请求标识，防止前一步成功日志掩盖后一步失败。
            string[] stepIds = { "overview", "combustion", "water-steam-cycle", "power-output" };
            for (int stepIndex = 0; stepIndex < stepIds.Length; stepIndex++)
            {
                string stepId = stepIds[stepIndex];
                string requestId = $"request.bridge.coal-actions.step.{stepId}";
                string payload = $"{{\"processId\":\"coal-power-generation\",\"stepId\":\"{stepId}\",\"unitId\":\"all\",\"isolate\":true}}";
                InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("enterProcessStep", payload, requestId));
                yield return WaitForCompletion(
                    () => HasNotice("commandResult", requestId, string.Empty),
                    $"燃煤流程步骤 {stepId} 未返回命令结果。");
                Assert.That(HasBridgeLogFragmentForRequest(requestId, "\"success\":true"), Is.True, $"燃煤流程步骤 {stepId} 未成功执行。");
            }
            Assert.That(_coordinator.ActiveController.GetStateDescription(), Does.Contain("step=power-output"));

            // 上述循环及断言必须保留 power-output 的执行覆盖；锅炉只属于 combustion 步骤的新白名单，
            // 因此聚焦前需再次通过正式桥接切回 combustion，避免测试依赖旧版“跨步骤任意聚焦”的宽松行为。
            const string combustionBeforeFocusRequestId = "request.bridge.coal-actions.step.combustion-before-focus";
            const string combustionBeforeFocusPayload = "{\"processId\":\"coal-power-generation\",\"stepId\":\"combustion\",\"unitId\":\"all\",\"isolate\":true}";
            InvokeBridgeMethod(
                "ReceiveFromParent",
                CreateBridgeCommandMessage("enterProcessStep", combustionBeforeFocusPayload, combustionBeforeFocusRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", combustionBeforeFocusRequestId, string.Empty),
                "燃煤锅炉聚焦前切回燃烧步骤未返回命令结果。");
            Assert.That(
                HasBridgeLogFragmentForRequest(combustionBeforeFocusRequestId, "\"success\":true"),
                Is.True,
                "燃煤锅炉聚焦前未成功切回允许该节点的燃烧步骤。");
            Assert.That(_coordinator.ActiveController.GetStateDescription(), Does.Contain("step=combustion"));

            const string focusRequestId = "request.bridge.coal-actions.focus";
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "focusNode",
                "{\"sceneNodeId\":\"node.coal-boiler\",\"selectionId\":\"selection.bridge.coal-actions.boiler\",\"isolate\":true}",
                focusRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", focusRequestId, string.Empty),
                "燃煤锅炉聚焦未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest(focusRequestId, "\"success\":true"), Is.True);

            const string clearSelectionRequestId = "request.bridge.coal-actions.clear-selection";
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("clearSelection", "{}", clearSelectionRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", clearSelectionRequestId, string.Empty),
                "燃煤选择清除未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest(clearSelectionRequestId, "\"success\":true"), Is.True);

            // 半透明命令必须实际创建运行时上下文材质；恢复显示后应立即释放，不能等待场景卸载才清理。
            const string fadeRequestId = "request.bridge.coal-actions.visibility.fade";
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "setNodeVisibility",
                "{\"sceneNodeId\":\"node.coal-boiler\",\"enabled\":false}",
                fadeRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", fadeRequestId, string.Empty),
                "燃煤锅炉半透明命令未返回结果。");
            Assert.That(HasBridgeLogFragmentForRequest(fadeRequestId, "\"success\":true"), Is.True);
            int materialCountAfterFade = CountRuntimeContextMaterials();
            Assert.That(materialCountAfterFade, Is.GreaterThan(0), "燃煤显隐命令未作用到真实模型材质。");

            const string showRequestId = "request.bridge.coal-actions.visibility.show";
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "setNodeVisibility",
                "{\"sceneNodeId\":\"node.coal-boiler\",\"enabled\":true}",
                showRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", showRequestId, string.Empty),
                "燃煤锅炉恢复显示命令未返回结果。");
            Assert.That(HasBridgeLogFragmentForRequest(showRequestId, "\"success\":true"), Is.True);
            Assert.That(CountRuntimeContextMaterials(), Is.LessThan(materialCountAfterFade), "燃煤锅炉恢复显示后未释放该节点的运行时上下文材质。");

            // 五个一图元一模型节点分别应用固定四态，再以更大的本地快照序号清除，验证映射和撤销路径均可用。
            string[] visualNodeIds =
            {
                "node.coal-feeder",
                "node.coal-boiler",
                "node.coal-steam-turbine",
                "node.coal-generator",
                "node.coal-precipitator"
            };
            string[] visualStates = { "alarm", "fault", "offline", "alarm", "fault" };
            for (int nodeIndex = 0; nodeIndex < visualNodeIds.Length; nodeIndex++)
            {
                string nodeId = visualNodeIds[nodeIndex];
                string stateRequestId = $"request.bridge.coal-actions.visual.{nodeIndex}";
                string statePayload = $"{{\"sceneNodeId\":\"{nodeId}\",\"visualState\":\"{visualStates[nodeIndex]}\",\"snapshotSequence\":1,\"statusUpdatedAt\":\"2026-08-08T10:00:00.000Z\",\"sourceRevision\":0}}";
                InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("setNodeVisualState", statePayload, stateRequestId));
                yield return WaitForCompletion(
                    () => HasNotice("commandResult", stateRequestId, string.Empty),
                    $"燃煤四态节点 {nodeId} 未返回设置结果。");
                Assert.That(HasBridgeLogFragmentForRequest(stateRequestId, "\"success\":true"), Is.True, $"燃煤四态节点 {nodeId} 未成功应用状态。");

                string clearStateRequestId = $"request.bridge.coal-actions.visual-clear.{nodeIndex}";
                string clearStatePayload = $"{{\"sceneNodeId\":\"{nodeId}\",\"snapshotSequence\":2}}";
                InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("clearNodeVisualState", clearStatePayload, clearStateRequestId));
                yield return WaitForCompletion(
                    () => HasNotice("commandResult", clearStateRequestId, string.Empty),
                    $"燃煤四态节点 {nodeId} 未返回清除结果。");
                Assert.That(HasBridgeLogFragmentForRequest(clearStateRequestId, "\"success\":true"), Is.True, $"燃煤四态节点 {nodeId} 未成功清除状态。");
            }

            // 燃煤三维路径尚未交付，路径命令应稳定拒绝而不是伪造成功。
            const string routeRequestId = "request.bridge.coal-actions.route-unsupported";
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage(
                "setRouteFlow",
                "{\"routeId\":\"route.coal.not-registered\",\"enabled\":true}",
                routeRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", routeRequestId, string.Empty),
                "燃煤未交付路径能力未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest(routeRequestId, "\"errorCode\":\"capability-unsupported\""), Is.True);

            const string resetRequestId = "request.bridge.coal-actions.reset";
            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("resetScene", "{}", resetRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", resetRequestId, string.Empty),
                "燃煤场景复位未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest(resetRequestId, "\"success\":true"), Is.True);
            Assert.That(_coordinator.ActiveController.GetStateDescription(), Does.Contain("process=coal-power-generation"));
            Assert.That(_coordinator.ActiveController.GetStateDescription(), Does.Contain("step=overview"));
            Assert.That(
                CountRuntimeContextMaterials(),
                Is.EqualTo(initialOverviewContextMaterialCount),
                "燃煤场景复位后未恢复初始总览的上下文材质基线。");
        }

        /// <summary>
        /// 使用正式 Bootstrap、燃气场景和第二版桥接命令验证第三层完整运行链路。
        /// 故障状态先于模型加载写入缓存，但只影响视觉；独立播放命令负责停止和恢复旋转、粒子与气流，
        /// 退出仍恢复二层业务根节点和进入前镜头并销毁独立实例。
        /// </summary>
        [UnityTest]
        public IEnumerator 燃气轮机第三层状态视觉与独立播放命令完全解耦()
        {
            yield return LoadBootstrap();
            yield return LoadGasPower("transition.playmode.process-detail.gas");
            _bridgeManager = FindBridgeManager();
            Assert.That(_bridgeManager, Is.Not.Null, "Bootstrap 未创建常驻 Unity 桥接管理器。");
            SubscribeBridgeOutboundLogs();

            Scene gasScene = SceneManager.GetSceneByPath(GasPowerScenePath);
            Assert.That(gasScene.IsValid() && gasScene.isLoaded, Is.True);
            GameObject[] gasRoots = gasScene.GetRootGameObjects();
            GameObject businessRoot = System.Array.Find(gasRoots, root => root.name == "场景");
            GameObject cameraRoot = System.Array.Find(gasRoots, root => root.name == "Main Camera");
            Assert.That(businessRoot, Is.Not.Null);
            Assert.That(cameraRoot, Is.Not.Null);
            Vector3 returnCameraPosition = cameraRoot.transform.position;
            Quaternion returnCameraRotation = cameraRoot.transform.rotation;

            const string faultRequestId = "request.bridge.process-detail.prefault";
            InvokeBridgeMethod(
                "ReceiveFromParent",
                CreateBridgeCommandMessage(
                    "setNodeVisualState",
                    "{\"sceneNodeId\":\"gas-turbine\",\"visualState\":\"fault\",\"snapshotSequence\":1,\"statusUpdatedAt\":\"2026-08-30T10:00:00.000Z\",\"sourceRevision\":1}",
                    faultRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", faultRequestId, string.Empty),
                "燃气轮机预置故障状态未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest(faultRequestId, "\"success\":true"), Is.True);

            const string prepareRequestId = "request.bridge.process-detail.prepare";
            const string enterTransitionId = "transition.bridge.process-detail.enter";
            InvokeBridgeMethod(
                "ReceiveFromParent",
                CreateBridgeCommandMessage(
                    "prepareProcessDetail",
                    "{\"sceneId\":\"gas-power\",\"processId\":\"gas-power-generation\",\"stepId\":\"gas-turbine\",\"processDetailId\":\"process-detail.gas-power.gas-turbine\",\"transitionId\":\"transition.bridge.process-detail.enter\"}",
                    prepareRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", prepareRequestId, enterTransitionId),
                "燃气轮机第三层准备未在时限内完成。");
            Assert.That(HasBridgeLogFragmentForRequest(prepareRequestId, "\"success\":true"), Is.True);

            ProcessDetailDeviceBinding binding = FindProcessDetailBinding(gasScene);
            Assert.That(binding, Is.Not.Null, "准备成功后缺少隐藏的燃气轮机候选实例。");
            Assert.That(binding.gameObject.activeInHierarchy, Is.False, "准备阶段不得提前显示关键环节模型。");
            Assert.That(businessRoot.activeSelf, Is.True, "准备阶段必须保持二层业务资源活动。");
            Assert.That(Vector3.Distance(cameraRoot.transform.position, returnCameraPosition), Is.LessThan(0.01f));
            Assert.That(Quaternion.Angle(cameraRoot.transform.rotation, returnCameraRotation), Is.LessThan(0.05f));

            // 布局准备失败时网页可取消候选；取消不得移动相机、阻断二层交互或影响稳定视图。
            const string abortRequestId = "request.bridge.process-detail.abort";
            InvokeBridgeMethod(
                "ReceiveFromParent",
                CreateBridgeCommandMessage(
                    "abortProcessDetail",
                    "{\"sceneId\":\"gas-power\",\"processDetailId\":\"process-detail.gas-power.gas-turbine\",\"transitionId\":\"transition.bridge.process-detail.enter\"}",
                    abortRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", abortRequestId, enterTransitionId),
                "关键环节取消准备未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest(abortRequestId, "\"success\":true"), Is.True);
            yield return WaitForCompletion(
                () => FindProcessDetailBinding(gasScene) == null,
                "取消准备后候选实例未释放。");
            Assert.That(Vector3.Distance(cameraRoot.transform.position, returnCameraPosition), Is.LessThan(0.01f));

            const string retryPrepareRequestId = "request.bridge.process-detail.prepare.retry";
            InvokeBridgeMethod(
                "ReceiveFromParent",
                CreateBridgeCommandMessage(
                    "prepareProcessDetail",
                    "{\"sceneId\":\"gas-power\",\"processId\":\"gas-power-generation\",\"stepId\":\"gas-turbine\",\"processDetailId\":\"process-detail.gas-power.gas-turbine\",\"transitionId\":\"transition.bridge.process-detail.enter\"}",
                    retryPrepareRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", retryPrepareRequestId, enterTransitionId),
                "取消后的关键环节重新准备未完成。");
            binding = FindProcessDetailBinding(gasScene);
            Assert.That(binding, Is.Not.Null);
            Assert.That(binding.gameObject.activeInHierarchy, Is.False);

            const string commitRequestId = "request.bridge.process-detail.commit";
            InvokeBridgeMethod(
                "ReceiveFromParent",
                CreateBridgeCommandMessage(
                    "commitProcessDetail",
                    "{\"sceneId\":\"gas-power\",\"processDetailId\":\"process-detail.gas-power.gas-turbine\",\"transitionId\":\"transition.bridge.process-detail.enter\"}",
                    commitRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", commitRequestId, enterTransitionId),
                "燃气轮机第三层提交未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest(commitRequestId, "\"success\":true"), Is.True);
            Assert.That(binding.gameObject.activeInHierarchy, Is.True);
            Assert.That(businessRoot.activeSelf, Is.True, "第三层活动期间二层业务资源必须保持活动。");
            MonoBehaviour processController = FindBehaviourInScene(gasScene, "PowerPlantProcessController");
            Assert.That(processController, Is.Not.Null);
            Assert.That(processController.enabled, Is.True, "第三层不得停用二层控制器及其状态更新。");
            PropertyInfo interactionsBlockedProperty = processController.GetType().GetProperty("InteractionsBlocked");
            Assert.That(interactionsBlockedProperty, Is.Not.Null);
            Assert.That(interactionsBlockedProperty.GetValue(processController), Is.EqualTo(true), "第三层提交后必须只阻断二层本地点击交互。");
            AssertProcessDetailPlaybackAllowed(binding.gameObject, true);

            // 同场景直接切换通过第二个准备事务替换活动实例，不返回二层、不恢复业务相机。
            ProcessDetailDeviceBinding previousBinding = binding;
            const string switchTransitionId = "transition.bridge.process-detail.direct-switch";
            const string switchPrepareRequestId = "request.bridge.process-detail.direct-switch.prepare";
            InvokeBridgeMethod(
                "ReceiveFromParent",
                CreateBridgeCommandMessage(
                    "prepareProcessDetail",
                    "{\"sceneId\":\"gas-power\",\"processId\":\"gas-power-generation\",\"stepId\":\"gas-turbine\",\"processDetailId\":\"process-detail.gas-power.gas-turbine\",\"transitionId\":\"transition.bridge.process-detail.direct-switch\"}",
                    switchPrepareRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", switchPrepareRequestId, switchTransitionId),
                "同场景关键环节切换准备未完成。");
            Assert.That(previousBinding.gameObject.activeInHierarchy, Is.True, "新候选准备期间旧活动环节必须继续显示。");

            const string switchCommitRequestId = "request.bridge.process-detail.direct-switch.commit";
            InvokeBridgeMethod(
                "ReceiveFromParent",
                CreateBridgeCommandMessage(
                    "commitProcessDetail",
                    "{\"sceneId\":\"gas-power\",\"processDetailId\":\"process-detail.gas-power.gas-turbine\",\"transitionId\":\"transition.bridge.process-detail.direct-switch\"}",
                    switchCommitRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", switchCommitRequestId, switchTransitionId),
                "同场景关键环节直接提交未完成。");
            yield return null;
            binding = FindProcessDetailBinding(gasScene);
            Assert.That(binding, Is.Not.Null);
            Assert.That(binding, Is.Not.SameAs(previousBinding), "直接切换必须提交新候选并释放旧实例。");
            Assert.That(binding.gameObject.activeInHierarchy, Is.True);
            Assert.That(businessRoot.activeSelf, Is.True);

            const string stopRequestId = "request.bridge.process-detail.stop";
            InvokeBridgeMethod(
                "ReceiveFromParent",
                CreateBridgeCommandMessage(
                    "setProcessDetailPlayback",
                    "{\"sceneId\":\"gas-power\",\"processDetailId\":\"process-detail.gas-power.gas-turbine\",\"playing\":false}",
                    stopRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", stopRequestId, string.Empty),
                "燃气轮机独立停止命令未返回结果。");
            Assert.That(HasBridgeLogFragmentForRequest(stopRequestId, "\"success\":true"), Is.True);
            AssertProcessDetailPlaybackAllowed(binding.gameObject, false);
            ParticleSystem[] particles = binding.GetComponentsInChildren<ParticleSystem>(true);
            for (int particleIndex = 0; particleIndex < particles.Length; particleIndex++)
            {
                Assert.That(particles[particleIndex].isPlaying, Is.False, $"独立停止后粒子仍在播放：{particles[particleIndex].name}");
                Assert.That(particles[particleIndex].particleCount, Is.EqualTo(0), $"独立停止后粒子未清空：{particles[particleIndex].name}");
            }

            yield return WaitForCompletion(
                () => Vector3.Distance(cameraRoot.transform.position, binding.CameraPose.position) < 0.01f &&
                      Quaternion.Angle(cameraRoot.transform.rotation, binding.CameraPose.rotation) < 0.05f,
                "第三层相机未移动到显式观察位。");

            // 第三层期间必须由 Unity 侧再做一次硬隔离，不能仅依赖网页遮罩：即使旧命令迟到、
            // 被重放或直接从桥接注入，也不得触发二层的流程过滤、聚焦描边、选择清除、显隐或复位。
            // 这些命令被拒绝后，独立模型、当前播放许可和显式相机位都必须保持不变。
            string[] blockedCommandTypes =
            {
                "enterProcessStep",
                "focusNode",
                "clearSelection",
                "setNodeVisibility",
                "resetScene"
            };
            string[] blockedPayloads =
            {
                "{\"processId\":\"gas-power-generation\",\"stepId\":\"inlet-duct\",\"unitId\":\"1\",\"isolate\":true}",
                "{\"sceneNodeId\":\"gas-turbine\",\"isolate\":true,\"selectionId\":\"selection.process-detail.blocked\"}",
                "{}",
                "{\"sceneNodeId\":\"gas-turbine\",\"enabled\":false}",
                "{}"
            };
            for (int commandIndex = 0; commandIndex < blockedCommandTypes.Length; commandIndex++)
            {
                string commandType = blockedCommandTypes[commandIndex];
                string requestId = $"request.bridge.process-detail.blocked.{commandType}";
                InvokeBridgeMethod(
                    "ReceiveFromParent",
                    CreateBridgeCommandMessage(commandType, blockedPayloads[commandIndex], requestId));
                yield return WaitForCompletion(
                    () => HasNotice("commandResult", requestId, string.Empty),
                    $"第三层旧命令 {commandType} 未返回结构化拒绝结果。");
                Assert.That(
                    HasBridgeLogFragmentForRequest(requestId, "\"errorCode\":\"process-detail-interaction-blocked\""),
                    Is.True,
                    $"第三层旧命令 {commandType} 未被隔离门拒绝。");
            }
            Assert.That(binding.gameObject.activeInHierarchy, Is.True, "旧二层命令不得卸载或隐藏第三层独立模型。");
            Assert.That(
                Vector3.Distance(cameraRoot.transform.position, binding.CameraPose.position) < 0.01f &&
                Quaternion.Angle(cameraRoot.transform.rotation, binding.CameraPose.rotation) < 0.05f,
                Is.True,
                "旧二层命令被拒绝后不得改写第三层显式相机位。");

            const string normalRequestId = "request.bridge.process-detail.normal";
            InvokeBridgeMethod(
                "ReceiveFromParent",
                CreateBridgeCommandMessage(
                    "setNodeVisualState",
                    "{\"sceneNodeId\":\"gas-turbine\",\"visualState\":\"normal\",\"snapshotSequence\":2,\"statusUpdatedAt\":\"2026-08-30T10:00:01.000Z\",\"sourceRevision\":2}",
                    normalRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", normalRequestId, string.Empty),
                "燃气轮机故障解除未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest(normalRequestId, "\"success\":true"), Is.True);
            AssertProcessDetailPlaybackAllowed(binding.gameObject, false);

            const string playRequestId = "request.bridge.process-detail.play";
            InvokeBridgeMethod(
                "ReceiveFromParent",
                CreateBridgeCommandMessage(
                    "setProcessDetailPlayback",
                    "{\"sceneId\":\"gas-power\",\"processDetailId\":\"process-detail.gas-power.gas-turbine\",\"playing\":true}",
                    playRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", playRequestId, string.Empty),
                "燃气轮机独立播放命令未返回结果。");
            Assert.That(HasBridgeLogFragmentForRequest(playRequestId, "\"success\":true"), Is.True);
            AssertProcessDetailPlaybackAllowed(binding.gameObject, true);

            const string exitRequestId = "request.bridge.process-detail.exit";
            InvokeBridgeMethod(
                "ReceiveFromParent",
                CreateBridgeCommandMessage(
                    "exitProcessDetail",
                    "{\"sceneId\":\"gas-power\",\"processDetailId\":\"process-detail.gas-power.gas-turbine\",\"transitionId\":\"transition.bridge.process-detail.exit\"}",
                    exitRequestId));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", exitRequestId, "transition.bridge.process-detail.exit"),
                "燃气轮机第三层退出未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest(exitRequestId, "\"success\":true"), Is.True);
            yield return WaitForCompletion(
                () => FindProcessDetailBinding(gasScene) == null &&
                      Vector3.Distance(cameraRoot.transform.position, returnCameraPosition) < 0.01f &&
                      Quaternion.Angle(cameraRoot.transform.rotation, returnCameraRotation) < 0.05f,
                "退出后未销毁第三层实例或恢复进入前业务镜头。");
            Assert.That(businessRoot.activeSelf, Is.True, "退出后燃气二层业务资源必须继续保持活动。");
            Assert.That(interactionsBlockedProperty.GetValue(processController), Is.EqualTo(false), "退出后必须恢复二层本地点击交互。");
        }

        /// <summary>
        /// 每个播放模式用例结束后都显式释放常驻根对象和附加业务场景。
        /// 卸载按场景路径逐项执行且限制为当前任务创建的九个目录路径，避免误动测试框架或用户场景。
        /// </summary>
        [UnityTearDown]
        public IEnumerator 释放常驻协调器和测试加载的业务场景()
        {
            BootstrapOverviewAutoEnterTest.SuppressForAutomatedTests = false;
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
                BusinessSceneCapability.ClearSelection |
                BusinessSceneCapability.UpdateNodeVisualState |
                BusinessSceneCapability.ClearNodeVisualState |
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
            public int ClearSelectionCalls { get; private set; }
            public int VisualStateCalls { get; private set; }
            public int ClearVisualStateCalls { get; private set; }
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

            public BusinessSceneCommandResult ClearSelection()
            {
                ClearSelectionCalls++;
                return BusinessSceneCommandResult.Completed("清除选择命令已记录。");
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

            public BusinessSceneCommandResult ClearNodeVisualState(string sceneNodeId)
            {
                if (!string.Equals(sceneNodeId, "scene-node.test", System.StringComparison.Ordinal))
                {
                    return BusinessSceneCommandResult.Failed("invalid-node", $"未知三维节点：{sceneNodeId}");
                }

                ClearVisualStateCalls++;
                return BusinessSceneCommandResult.Completed("节点动态状态清除命令已记录。");
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

        /// <summary>在指定场景内按精确类型名查找默认程序集组件，避免测试程序集建立反向编译依赖。</summary>
        private static MonoBehaviour FindBehaviourInScene(Scene scene, string typeName)
        {
            if (!scene.IsValid() || !scene.isLoaded)
            {
                return null;
            }
            GameObject[] roots = scene.GetRootGameObjects();
            for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
            {
                MonoBehaviour[] behaviours = roots[rootIndex].GetComponentsInChildren<MonoBehaviour>(true);
                for (int behaviourIndex = 0; behaviourIndex < behaviours.Length; behaviourIndex++)
                {
                    MonoBehaviour behaviour = behaviours[behaviourIndex];
                    if (behaviour != null && behaviour.GetType().Name == typeName)
                    {
                        return behaviour;
                    }
                }
            }
            return null;
        }

        /// <summary>在指定已加载场景内查找唯一的第三层包装绑定器，不使用全局名称查询。</summary>
        private static ProcessDetailDeviceBinding FindProcessDetailBinding(Scene scene)
        {
            if (!scene.IsValid() || !scene.isLoaded)
            {
                return null;
            }

            GameObject[] roots = scene.GetRootGameObjects();
            for (int rootIndex = 0; rootIndex < roots.Length; rootIndex++)
            {
                ProcessDetailDeviceBinding binding = roots[rootIndex].GetComponentInChildren<ProcessDetailDeviceBinding>(true);
                if (binding != null)
                {
                    return binding;
                }
            }
            return null;
        }

        /// <summary>读取三个具体控制器的受控播放许可，确保适配器同时覆盖旋转、粒子和气流体积。</summary>
        private static void AssertProcessDetailPlaybackAllowed(GameObject detailRoot, bool expected)
        {
            string[] controllerTypeNames =
            {
                "WaiKeHeBingAnimationController",
                "WaiKeHeBingGasFlowEffectController",
                "WaiKeHeBingGasVolumeController"
            };
            MonoBehaviour[] behaviours = detailRoot.GetComponentsInChildren<MonoBehaviour>(true);
            for (int typeIndex = 0; typeIndex < controllerTypeNames.Length; typeIndex++)
            {
                MonoBehaviour resolved = null;
                for (int behaviourIndex = 0; behaviourIndex < behaviours.Length; behaviourIndex++)
                {
                    MonoBehaviour behaviour = behaviours[behaviourIndex];
                    if (behaviour != null && behaviour.GetType().Name == controllerTypeNames[typeIndex])
                    {
                        resolved = behaviour;
                        break;
                    }
                }

                Assert.That(resolved, Is.Not.Null, $"第三层实例缺少动态控制器：{controllerTypeNames[typeIndex]}");
                FieldInfo playbackAllowed = resolved.GetType().GetField(
                    "_playbackAllowed",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                Assert.That(playbackAllowed, Is.Not.Null, $"动态控制器缺少播放许可字段：{controllerTypeNames[typeIndex]}");
                Assert.That(playbackAllowed.GetValue(resolved), Is.EqualTo(expected));
            }
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
        /// 仅在测试进程中统计控制器按固定后缀创建的临时材质。
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
        /// 统计没有被当前活动渲染器材质槽引用的运行时上下文材质。
        /// 总览模型可以合法保留上下文材质，所以生命周期断言必须排除当前场景仍在使用的材质，
        /// 只把真正脱离渲染器引用的对象视为跨场景释放泄漏。
        /// </summary>
        private static int CountOrphanRuntimeContextMaterials()
        {
            Material[] materials = Resources.FindObjectsOfTypeAll<Material>();
            HashSet<Material> referencedMaterials = new HashSet<Material>();
            Renderer[] renderers = Object.FindObjectsByType<Renderer>(FindObjectsSortMode.None);
            for (int rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
            {
                Renderer renderer = renderers[rendererIndex];
                if (renderer == null)
                {
                    continue;
                }

                Material[] sharedMaterials = renderer.sharedMaterials;
                for (int materialIndex = 0; materialIndex < sharedMaterials.Length; materialIndex++)
                {
                    Material material = sharedMaterials[materialIndex];
                    if (material != null && material.name.EndsWith(" (Runtime Context)", System.StringComparison.Ordinal))
                    {
                        referencedMaterials.Add(material);
                    }
                }
            }

            int orphanCount = 0;
            for (int materialIndex = 0; materialIndex < materials.Length; materialIndex++)
            {
                Material material = materials[materialIndex];
                if (material != null && material.name.EndsWith(" (Runtime Context)", System.StringComparison.Ordinal) &&
                    !referencedMaterials.Contains(material))
                {
                    orphanCount++;
                }
            }

            return orphanCount;
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
            return $"{{\"channel\":\"power3d-unity\",\"version\":{WebGlProtocolContract.ProtocolVersion},\"instanceId\":\"local-demo-001\",\"messageId\":\"{requestId}\",\"type\":\"switchScene\",\"payload\":{{\"sceneId\":\"{sceneId}\",\"transitionId\":\"{transitionId}\",\"sceneMappingVersion\":\"unpublished\",\"forceReload\":{forceReloadJson}}},\"timestamp\":1}}";
        }

        /// <summary>构造幂等释放命令；重复释放仍应得到 disposed 回执，但不能重新订阅或恢复场景回调。</summary>
        private static string CreateDisposeMessage(string requestId)
        {
            return $"{{\"channel\":\"power3d-unity\",\"version\":{WebGlProtocolContract.ProtocolVersion},\"instanceId\":\"local-demo-001\",\"messageId\":\"{requestId}\",\"type\":\"dispose\",\"payload\":{{}},\"timestamp\":1}}";
        }

        /// <summary>构造当前桥接白名单内的最小动作命令；测试负载为固定 JSON，不接受或拼接外部输入。</summary>
        private static string CreateBridgeCommandMessage(string commandType, string payloadJson, string requestId)
        {
            return $"{{\"channel\":\"power3d-unity\",\"version\":{WebGlProtocolContract.ProtocolVersion},\"instanceId\":\"local-demo-001\",\"messageId\":\"{requestId}\",\"type\":\"{commandType}\",\"payload\":{payloadJson},\"timestamp\":1}}";
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

        /// <summary>
        /// 在固定容量的桥接日志中查找指定事件和原请求标识的位置。
        /// 仅测试消息先后顺序，不解析任意业务载荷、模型名称或场景层级，因此不会把日志断言变成隐式映射来源。
        /// </summary>
        private int FindBridgeNoticeIndex(string type, string requestId)
        {
            string typeFragment = $"\"type\":\"{type}\"";
            string requestFragment = $"\"requestId\":\"{requestId}\"";
            for (int index = 0; index < _bridgeOutboundLogs.Count; index++)
            {
                string log = _bridgeOutboundLogs[index];
                if (log.Contains(typeFragment) && log.Contains(requestFragment))
                {
                    return index;
                }
            }
            return -1;
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
