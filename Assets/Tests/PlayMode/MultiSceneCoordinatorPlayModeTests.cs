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
                }

                Assert.That(CountBridgeManagers(), Is.EqualTo(1));
                Assert.That(GetBridgeIntProperty("BrowserBridgeInitializationCount"), Is.EqualTo(1));
                Assert.That(GetBridgeIntProperty("SceneCoordinatorSubscriptionCount"), Is.EqualTo(1));
                Assert.That(GetBridgeObjectProperty("CurrentSceneController"), Is.SameAs(_coordinator.ActiveController));
                Assert.That(_coordinator.ActiveSceneId, Is.EqualTo("gas-power"));
                Assert.That(CountLoadedBusinessScenes(), Is.EqualTo(1));
            }

            InvokeBridgeMethod("ReceiveFromParent", CreateDisposeMessage("request.bridge.dispose.first"));
            yield return null;
            Assert.That(HasNotice("disposed", "request.bridge.dispose.first", string.Empty), Is.True);
            Assert.That(GetBridgeIntProperty("SceneCoordinatorSubscriptionCount"), Is.EqualTo(0));
            Assert.That(GetBridgeObjectProperty("CurrentSceneController"), Is.Null);

            int logCountAfterDispose = _bridgeOutboundLogs.Count;
            InvokeBridgeMethod("ReportObjectSelected", "node.gas-turbine.01", "释放后不得上报");
            yield return null;
            Assert.That(_bridgeOutboundLogs, Has.Count.EqualTo(logCountAfterDispose), "释放后的对象回调不得再次穿透桥接。");

            InvokeBridgeMethod("ReceiveFromParent", CreateDisposeMessage("request.bridge.dispose.repeat"));
            Assert.That(HasNotice("disposed", "request.bridge.dispose.repeat", string.Empty), Is.True);
            Assert.That(GetBridgeIntProperty("SceneCoordinatorSubscriptionCount"), Is.EqualTo(0));
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

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("focusNode", "{\"sceneNodeId\":\"\",\"isolate\":true}", "request.bridge.actions.focus-invalid"));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", "request.bridge.actions.focus-invalid", string.Empty),
                "无效三维节点标识未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.actions.focus-invalid", "\"errorCode\":\"scene-node-payload-invalid\""), Is.True);

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("focusNode", "{\"sceneNodeId\":\"node.not-registered\",\"isolate\":true}", "request.bridge.actions.focus-missing"));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", "request.bridge.actions.focus-missing", string.Empty),
                "未知三维节点未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.actions.focus-missing", "\"errorCode\":\"invalid-node\""), Is.True);

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("enterProcessStep", "{\"processId\":\"process.not-registered\",\"stepId\":\"overview\",\"unitId\":\"all\",\"isolate\":true}", "request.bridge.actions.process-missing"));
            yield return WaitForCompletion(
                () => HasNotice("commandResult", "request.bridge.actions.process-missing", string.Empty),
                "未知流程未返回命令结果。");
            Assert.That(HasBridgeLogFragmentForRequest("request.bridge.actions.process-missing", "\"errorCode\":\"invalid-process-step\""), Is.True);

            InvokeBridgeMethod("ReceiveFromParent", CreateBridgeCommandMessage("setNodeVisualState", "{\"sceneNodeId\":\"gas-turbine\",\"visualState\":\"alarm\"}", "request.bridge.actions.visual-unsupported"));
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
        private static string CreateSceneSwitchMessage(string sceneId, string transitionId, string requestId)
        {
            return $"{{\"channel\":\"power3d-unity\",\"version\":1,\"instanceId\":\"local-demo-001\",\"messageId\":\"{requestId}\",\"type\":\"switchScene\",\"payload\":{{\"sceneId\":\"{sceneId}\",\"transitionId\":\"{transitionId}\",\"sceneMappingVersion\":\"unpublished\"}},\"timestamp\":1}}";
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
