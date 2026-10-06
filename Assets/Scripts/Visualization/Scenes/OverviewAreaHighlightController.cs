using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 首屏沙盘区域高亮控制器：外层六按钮（调度中心/发电/输变电/配电/用电/微电网）与轮询按钮的三维呈现入口。
    /// 调度中心一次性播放飞线动画并在自身与全部子物体动画结束后自动隐藏，同时调度中心围栏按其他围栏
    /// 一致的高亮逻辑改色、波动并点亮光晕，切换区域时随活动清单一并回滚；
    /// 其余五个区域把组内每座围栏的共享 RailLight 材质按渲染器实例化后统一改色，
    /// 围栏亮度倍率在上下限之间持续波动，同时把围栏底面改为主题色并点亮光晕粒子。
    /// 全部围栏共用同一材质资产，切换区域或恢复默认时必须先回滚上一个区域为场景默认共享材质，
    /// 防止跨组串色；重复点击同一区域保持激活（幂等），调度中心则重播飞线并重新应用围栏高亮。
    /// 轮询开启后按按钮栏顺序循环激活六个区域，每个区域停留固定间隔；再次开启前先停止并恢复默认，
    /// 轮询期间手动激活任意区域或恢复默认都视为接管控制，轮询随之终止。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class OverviewAreaHighlightController : MonoBehaviour
    {
        public const string DispatchCenterAreaId = "dispatch-center";
        public const string GenerationAreaId = "generation";
        public const string TransmissionAreaId = "transmission";
        public const string DistributionAreaId = "distribution";
        public const string ConsumptionAreaId = "consumption";
        public const string MicrogridAreaId = "microgrid";

        /// <summary>RailLight 材质的主题色属性与亮度倍率属性，材质缺少任一属性视为不兼容。</summary>
        public const string MainColorProperty = "_mainColor";
        public const string BrightnessProperty = "_Brightness";

        /// <summary>外层六按钮对应的区域标识，顺序与按钮栏一致。</summary>
        public static readonly string[] AllAreaIds =
        {
            DispatchCenterAreaId, GenerationAreaId, TransmissionAreaId,
            DistributionAreaId, ConsumptionAreaId, MicrogridAreaId,
        };

        /// <summary>带围栏组的五个区域标识；调度中心围栏单独绑定，随飞线一起激活。</summary>
        public static readonly string[] FenceAreaIds =
        {
            GenerationAreaId, TransmissionAreaId, DistributionAreaId, ConsumptionAreaId, MicrogridAreaId,
        };

        [Tooltip("调度中心飞线根物体：激活后播放其自身与子物体的全部动画，播完自动隐藏。")]
        [SerializeField] private GameObject _dispatchFlightObject;
        [Tooltip("调度中心围栏 Transform：点击调度中心时随飞线一并按其他围栏逻辑高亮（围栏网格 + 底面 + 光晕）。")]
        [SerializeField] private Transform _dispatchCenterFence;
        [Tooltip("发电组 Transform：直属子物体为各电站围栏（围栏网格 + 第1子物体底面 + 第2子物体光晕）。")]
        [SerializeField] private Transform _generationGroup;
        [Tooltip("输变电组 Transform，结构与发电组一致。")]
        [SerializeField] private Transform _transmissionGroup;
        [Tooltip("配电组 Transform，结构与发电组一致。")]
        [SerializeField] private Transform _distributionGroup;
        [Tooltip("用电组 Transform，结构与发电组一致。")]
        [SerializeField] private Transform _consumptionGroup;
        [Tooltip("微电网组 Transform，结构与发电组一致。")]
        [SerializeField] private Transform _microgridGroup;

        [Tooltip("围栏与底面高亮统一使用的主题色（#5DDDD8）。")]
        [SerializeField] private Color _highlightColor = new Color(0.36471f, 0.86667f, 0.84706f, 1f);
        [Tooltip("围栏亮度倍率波动下限。")]
        [SerializeField] private float _minimumBrightness = 1f;
        [Tooltip("围栏亮度倍率波动上限。")]
        [SerializeField] private float _maximumBrightness = 3.5f;
        [Tooltip("一次亮度波动周期（秒）。")]
        [SerializeField] private float _pulsePeriodSeconds = 2f;
        [Tooltip("轮询模式下每个区域的停留时长（秒），循环按按钮栏顺序切换。")]
        [SerializeField] private float _pollIntervalSeconds = 3f;

        /// <summary>围栏结构与材质的运行时快照：记录初始共享材质与光晕初始显隐，恢复时逐项回滚。</summary>
        private sealed class FenceRecord
        {
            public Renderer FenceRenderer;
            public Material[] OriginalFenceMaterials;
            public Renderer BaseRenderer;
            public Material[] OriginalBaseMaterials;
            public GameObject HaloObject;
            public bool HaloInitiallyActive;
        }

        private readonly Dictionary<string, List<FenceRecord>> _fencesByAreaId =
            new Dictionary<string, List<FenceRecord>>(StringComparer.Ordinal);
        private readonly List<FenceRecord> _activeFences = new List<FenceRecord>();
        // 按渲染器实例化的材质由本控制器负责销毁，恢复共享材质后必须清理，防止运行时材质泄漏。
        private readonly List<Material> _activeInstances = new List<Material>();
        // 只有围栏材质参与亮度波动；底面保持自身亮度不变。
        private readonly List<Material> _pulsingMaterials = new List<Material>();
        private Animation[] _flightAnimations = Array.Empty<Animation>();
        // 调度中心围栏的运行时快照：随飞线一起激活，切换或恢复时进入统一回滚清单。
        private FenceRecord _dispatchFenceRecord;
        // 配置校验结果缓存：激活失败时直接引用，验证面板也可展示全部问题项。
        private readonly List<string> _configurationProblems = new List<string>();

        private Coroutine _pulseRoutine;
        private Coroutine _flightRoutine;
        private Coroutine _pollRoutine;
        private string _activeAreaId = string.Empty;
        private bool _flightPlaying;
        private bool _initialized;
        private bool _pollingActive;
        // 轮询当前停留的区域与下一次切换时刻，仅供状态展示与诊断，不参与切换判定。
        private string _pollCurrentAreaId = string.Empty;
        private float _pollNextSwitchTime;

        public string ActiveAreaId => _activeAreaId ?? string.Empty;
        public bool IsDispatchFlightPlaying => _flightPlaying;
        public int ActiveFenceCount => _activeFences.Count;
        public bool IsPollingActive => _pollingActive;
        public string PollingCurrentAreaId => _pollCurrentAreaId ?? string.Empty;
        /// <summary>距离下一次轮询切换的剩余秒数；未开启轮询时恒为 0。</summary>
        public float PollingSecondsUntilNextSwitch =>
            _pollingActive ? Mathf.Max(0f, _pollNextSwitchTime - Time.time) : 0f;

        /// <summary>外层按钮使用的稳定区域显示名；未知标识原样返回，供面板与命令消息复用。</summary>
        public static string GetAreaDisplayName(string areaId)
        {
            switch (areaId)
            {
                case DispatchCenterAreaId: return "调度中心";
                case GenerationAreaId: return "发电";
                case TransmissionAreaId: return "输变电";
                case DistributionAreaId: return "配电";
                case ConsumptionAreaId: return "用电";
                case MicrogridAreaId: return "微电网";
                default: return areaId;
            }
        }

        public static bool IsFenceArea(string areaId)
        {
            return Array.IndexOf(FenceAreaIds, areaId) >= 0;
        }

        /// <summary>
        /// 激活一个区域。调度中心播放飞线动画（播完自动隐藏，重复点击重播）；
        /// 围栏组实例化材质改色并驱动亮度波动，重复点击保持激活。
        /// 切换区域时前一个区域先回滚为默认共享材质，光晕恢复初始显隐。
        /// 轮询运行期间手动激活任意区域视为接管控制，轮询循环随之终止。
        /// </summary>
        public BusinessSceneCommandResult ActivateArea(string areaId)
        {
            return ActivateAreaInternal(areaId, stopPolling: true);
        }

        private BusinessSceneCommandResult ActivateAreaInternal(string areaId, bool stopPolling)
        {
            if (string.IsNullOrWhiteSpace(areaId))
            {
                return BusinessSceneCommandResult.Failed("overview-area-invalid", "区域标识为空。");
            }
            if (!EnsureInitialized())
            {
                return BusinessSceneCommandResult.Failed(
                    "overview-area-config-invalid",
                    $"区域高亮配置未通过校验（{_configurationProblems.Count} 项问题），首个问题：{_configurationProblems[0]}");
            }
            if (stopPolling && _pollingActive)
            {
                // 手动接管只终止循环与轮询状态；当前视觉交给后续切换或幂等逻辑统一处理。
                StopPollingLoop();
            }
            if (string.Equals(areaId, DispatchCenterAreaId, StringComparison.Ordinal))
            {
                return PlayDispatchFlight();
            }
            if (!IsFenceArea(areaId))
            {
                return BusinessSceneCommandResult.Failed(
                    "overview-area-unknown",
                    $"未知总览区域标识：{areaId}。");
            }
            if (string.Equals(_activeAreaId, areaId, StringComparison.Ordinal))
            {
                return BusinessSceneCommandResult.Completed(
                    $"区域 {GetAreaDisplayName(areaId)} 已处于高亮状态，本次点击保持激活。");
            }

            RestoreActiveArea();
            List<FenceRecord> fences = _fencesByAreaId[areaId];
            for (int index = 0; index < fences.Count; index++)
            {
                ApplyHighlight(fences[index]);
            }
            // 活动清单必须与本次高亮的围栏一致，切换或恢复时才能逐座回滚共享材质与光晕显隐。
            _activeFences.AddRange(fences);
            _activeAreaId = areaId;
            StartPulse();
            return BusinessSceneCommandResult.Completed(
                $"区域 {GetAreaDisplayName(areaId)} 已高亮 {fences.Count} 座围栏，亮度倍率在 {_minimumBrightness:0.##} 至 {_maximumBrightness:0.##} 间波动。");
        }

        /// <summary>
        /// 轮询开关：开启后立即从调度中心起播，按按钮栏顺序每 _pollIntervalSeconds 秒切换一次并循环；
        /// 关闭时终止循环并把区域视觉恢复默认。重复开启保持当前循环，重复关闭为空操作。
        /// </summary>
        public BusinessSceneCommandResult SetPolling(bool enabled)
        {
            if (!enabled)
            {
                return StopPolling();
            }
            if (!EnsureInitialized())
            {
                return BusinessSceneCommandResult.Failed(
                    "overview-area-config-invalid",
                    $"区域高亮配置未通过校验（{_configurationProblems.Count} 项问题），首个问题：{_configurationProblems[0]}");
            }
            if (_pollingActive)
            {
                return BusinessSceneCommandResult.Completed("轮询已在运行，本次点击保持当前循环。");
            }

            _pollingActive = true;
            if (_pollRoutine != null)
            {
                StopCoroutine(_pollRoutine);
            }
            _pollRoutine = StartCoroutine(PollAreas());
            return BusinessSceneCommandResult.Completed(
                $"区域轮询已开始，按按钮顺序每 {_pollIntervalSeconds:0.#} 秒切换一次，共 {AllAreaIds.Length} 个区域循环。");
        }

        private BusinessSceneCommandResult StopPolling()
        {
            if (!_pollingActive)
            {
                return BusinessSceneCommandResult.Completed("轮询未在运行。");
            }

            StopPollingLoop();
            RestoreActiveArea();
            StopFlight();
            return BusinessSceneCommandResult.Completed("轮询已停止，区域高亮已恢复默认共享材质。");
        }

        /// <summary>只终止轮询协程与轮询状态，不改任何区域视觉；由调用方决定后续恢复。</summary>
        private void StopPollingLoop()
        {
            _pollingActive = false;
            if (_pollRoutine != null)
            {
                StopCoroutine(_pollRoutine);
                _pollRoutine = null;
            }
            _pollCurrentAreaId = string.Empty;
        }

        private IEnumerator PollAreas()
        {
            int index = 0;
            while (_pollingActive)
            {
                string areaId = AllAreaIds[index];
                _pollCurrentAreaId = areaId;
                _pollNextSwitchTime = Time.time + _pollIntervalSeconds;
                // 轮询内部切换不能触发手动接管分支，否则循环会在第一站自我终止。
                ActivateAreaInternal(areaId, stopPolling: false);
                yield return new WaitForSeconds(_pollIntervalSeconds);
                index = (index + 1) % AllAreaIds.Length;
            }
        }

        /// <summary>
        /// 恢复默认：回滚当前高亮围栏组的共享材质与光晕显隐，并停止仍在播放的飞线。
        /// 轮询运行期间调用视为接管控制，轮询循环随之终止。
        /// </summary>
        public BusinessSceneCommandResult Deactivate()
        {
            bool wasPolling = _pollingActive;
            StopPollingLoop();
            bool hadFenceHighlight = _activeFences.Count > 0;
            bool hadFlight = _flightPlaying;
            RestoreActiveArea();
            StopFlight();
            if (!hadFenceHighlight && !hadFlight && !wasPolling)
            {
                return BusinessSceneCommandResult.Completed("当前没有需要恢复的区域高亮。");
            }
            return BusinessSceneCommandResult.Completed(wasPolling
                ? "轮询已停止，区域高亮已恢复默认共享材质。"
                : "已恢复区域高亮为默认共享材质并停止飞线动画。");
        }

        /// <summary>不进入播放状态的静态配置校验：绑定缺失、围栏结构漂移与材质属性不兼容都会形成问题项。</summary>
        public IReadOnlyList<string> CollectConfigurationProblems()
        {
            var problems = new List<string>();
            CollectConfigurationProblems(problems);
            return problems;
        }

        public string GetStateDescription()
        {
            if (!_initialized)
            {
                return "not-initialized";
            }

            string pollState = _pollingActive ? "on:" + _pollCurrentAreaId : "off";
            return $"ready;active={ActiveAreaId};fences={_activeFences.Count};flight={IsDispatchFlightPlaying};poll={pollState}";
        }

        private void OnDisable()
        {
            // 场景卸载或组件被禁用时不能遗留实例材质、活动飞线或轮询循环；对象可能已被销毁，逐项空引用防护。
            StopPollingLoop();
            RestoreActiveArea();
            StopFlight();
        }

        private BusinessSceneCommandResult PlayDispatchFlight()
        {
            // 切换区域：其余组材质先恢复默认；重复点击视为飞线重播，围栏同帧重新应用保持高亮。
            RestoreActiveArea();
            StopFlight();
            if (_dispatchFlightObject == null)
            {
                return BusinessSceneCommandResult.Failed(
                    "overview-flight-missing",
                    "调度中心飞线对象不可用。");
            }
            if (_dispatchFenceRecord != null)
            {
                ApplyHighlight(_dispatchFenceRecord);
                _activeFences.Add(_dispatchFenceRecord);
                _activeAreaId = DispatchCenterAreaId;
                StartPulse();
            }
            _flightRoutine = StartCoroutine(PlayFlightOnce());
            return BusinessSceneCommandResult.Completed(
                "调度中心飞线动画已开始播放（播完自动隐藏），调度中心围栏已同步高亮。");
        }

        private IEnumerator PlayFlightOnce()
        {
            GameObject flight = _dispatchFlightObject;
            // 先关再开保证动画从头播放，不依赖 playAutomatically 的隐式行为。
            flight.SetActive(false);
            flight.SetActive(true);
            for (int index = 0; index < _flightAnimations.Length; index++)
            {
                _flightAnimations[index].Stop();
                _flightAnimations[index].Play();
            }

            _flightPlaying = true;
            while (true)
            {
                bool anyPlaying = false;
                for (int index = 0; index < _flightAnimations.Length; index++)
                {
                    if (_flightAnimations[index] != null && _flightAnimations[index].isPlaying)
                    {
                        anyPlaying = true;
                        break;
                    }
                }
                if (!anyPlaying)
                {
                    break;
                }
                yield return null;
            }

            flight.SetActive(false);
            _flightPlaying = false;
            _flightRoutine = null;
        }

        private void StopFlight()
        {
            if (_flightRoutine != null)
            {
                StopCoroutine(_flightRoutine);
                _flightRoutine = null;
            }
            if (_dispatchFlightObject != null && _dispatchFlightObject.activeSelf)
            {
                _dispatchFlightObject.SetActive(false);
            }
            _flightPlaying = false;
        }

        private void ApplyHighlight(FenceRecord fence)
        {
            if (fence.FenceRenderer != null)
            {
                CreateHighlightedInstances(fence.FenceRenderer, fence.OriginalFenceMaterials, pulse: true);
            }
            if (fence.BaseRenderer != null)
            {
                // 底面只改主题色，亮度保持材质自身默认值，不参与波动。
                CreateHighlightedInstances(fence.BaseRenderer, fence.OriginalBaseMaterials, pulse: false);
            }
            if (fence.HaloObject != null)
            {
                fence.HaloObject.SetActive(true);
            }
        }

        /// <summary>按渲染器实例化材质并改为主题色；实例登记到销毁清单，围栏实例另进入波动清单。</summary>
        private Material[] CreateHighlightedInstances(Renderer renderer, Material[] originals, bool pulse)
        {
            var instances = new Material[originals.Length];
            for (int index = 0; index < originals.Length; index++)
            {
                Material original = originals[index];
                if (original == null)
                {
                    continue;
                }

                Material instance = Instantiate(original);
                instance.SetColor(MainColorProperty, _highlightColor);
                instances[index] = instance;
                _activeInstances.Add(instance);
                if (pulse)
                {
                    _pulsingMaterials.Add(instance);
                }
            }
            renderer.sharedMaterials = instances;
            return instances;
        }

        private void StartPulse()
        {
            if (_pulseRoutine != null)
            {
                StopCoroutine(_pulseRoutine);
            }
            _pulseRoutine = StartCoroutine(PulseBrightness());
        }

        private IEnumerator PulseBrightness()
        {
            float period = Mathf.Max(0.01f, _pulsePeriodSeconds);
            while (true)
            {
                // 余弦相位从下限起波，波形在 _minimumBrightness 与 _maximumBrightness 之间平滑往返。
                float phase = 2f * Mathf.PI * Time.time / period;
                float wave = 0.5f - 0.5f * Mathf.Cos(phase);
                float brightness = Mathf.Lerp(_minimumBrightness, _maximumBrightness, wave);
                for (int index = 0; index < _pulsingMaterials.Count; index++)
                {
                    Material material = _pulsingMaterials[index];
                    if (material != null)
                    {
                        material.SetFloat(BrightnessProperty, brightness);
                    }
                }
                yield return null;
            }
        }

        /// <summary>回滚当前高亮区域：恢复初始共享材质、销毁实例、光晕回到初始显隐；无活动区域时为空操作。</summary>
        private void RestoreActiveArea()
        {
            if (_pulseRoutine != null)
            {
                StopCoroutine(_pulseRoutine);
                _pulseRoutine = null;
            }
            for (int index = 0; index < _activeFences.Count; index++)
            {
                FenceRecord fence = _activeFences[index];
                if (fence.FenceRenderer != null)
                {
                    fence.FenceRenderer.sharedMaterials = fence.OriginalFenceMaterials;
                }
                if (fence.BaseRenderer != null)
                {
                    fence.BaseRenderer.sharedMaterials = fence.OriginalBaseMaterials;
                }
                if (fence.HaloObject != null)
                {
                    fence.HaloObject.SetActive(fence.HaloInitiallyActive);
                }
            }
            _activeFences.Clear();
            _pulsingMaterials.Clear();
            DestroyActiveInstances();
            _activeAreaId = string.Empty;
        }

        private void DestroyActiveInstances()
        {
            for (int index = 0; index < _activeInstances.Count; index++)
            {
                Material instance = _activeInstances[index];
                if (instance == null)
                {
                    continue;
                }
                if (Application.isPlaying)
                {
                    Destroy(instance);
                }
                else
                {
                    DestroyImmediate(instance);
                }
            }
            _activeInstances.Clear();
        }

        private bool EnsureInitialized()
        {
            if (_initialized)
            {
                return true;
            }

            _configurationProblems.Clear();
            CollectConfigurationProblems(_configurationProblems);
            if (_configurationProblems.Count > 0)
            {
                return false;
            }

            foreach (string areaId in FenceAreaIds)
            {
                var fences = new List<FenceRecord>();
                Transform group = GetGroupTransform(areaId);
                for (int index = 0; index < group.childCount; index++)
                {
                    fences.Add(CreateFenceRecord(group.GetChild(index)));
                }
                _fencesByAreaId.Add(areaId, fences);
            }
            _dispatchFenceRecord = CreateFenceRecord(_dispatchCenterFence);
            _flightAnimations = _dispatchFlightObject.GetComponentsInChildren<Animation>(true);
            _initialized = true;
            return true;
        }

        /// <summary>按围栏层级结构（围栏网格 + 第1子物体底面 + 第2子物体光晕）构建运行时快照。</summary>
        private static FenceRecord CreateFenceRecord(Transform fenceTransform)
        {
            MeshRenderer fenceRenderer = fenceTransform.GetComponent<MeshRenderer>();
            MeshRenderer baseRenderer = fenceTransform.GetChild(0).GetComponent<MeshRenderer>();
            GameObject haloObject = fenceTransform.GetChild(1).gameObject;
            return new FenceRecord
            {
                FenceRenderer = fenceRenderer,
                OriginalFenceMaterials = fenceRenderer.sharedMaterials,
                BaseRenderer = baseRenderer,
                OriginalBaseMaterials = baseRenderer.sharedMaterials,
                HaloObject = haloObject,
                HaloInitiallyActive = haloObject.activeSelf,
            };
        }

        private Transform GetGroupTransform(string areaId)
        {
            switch (areaId)
            {
                case GenerationAreaId: return _generationGroup;
                case TransmissionAreaId: return _transmissionGroup;
                case DistributionAreaId: return _distributionGroup;
                case ConsumptionAreaId: return _consumptionGroup;
                case MicrogridAreaId: return _microgridGroup;
                default: return null;
            }
        }

        private void CollectConfigurationProblems(List<string> problems)
        {
            foreach (string areaId in FenceAreaIds)
            {
                string areaName = GetAreaDisplayName(areaId);
                Transform group = GetGroupTransform(areaId);
                if (group == null)
                {
                    problems.Add($"区域 {areaName}（{areaId}）未绑定围栏组 Transform。");
                    continue;
                }
                if (group.childCount == 0)
                {
                    problems.Add($"区域 {areaName} 围栏组没有任何围栏子物体。");
                    continue;
                }

                for (int index = 0; index < group.childCount; index++)
                {
                    ValidateFenceShape(group.GetChild(index), areaName, problems);
                }
            }

            string dispatchAreaName = GetAreaDisplayName(DispatchCenterAreaId);
            if (_dispatchCenterFence == null)
            {
                problems.Add($"区域 {dispatchAreaName} 未绑定调度中心围栏 Transform。");
            }
            else
            {
                ValidateFenceShape(_dispatchCenterFence, dispatchAreaName, problems);
            }

            if (_dispatchFlightObject == null)
            {
                problems.Add("未绑定调度中心飞线对象。");
            }
            else
            {
                Animation[] animations = _dispatchFlightObject.GetComponentsInChildren<Animation>(true);
                if (animations.Length == 0)
                {
                    problems.Add("调度中心飞线对象及其子物体没有任何 Animation 组件。");
                }
                for (int index = 0; index < animations.Length; index++)
                {
                    if (animations[index].clip == null)
                    {
                        problems.Add($"调度中心飞线的 Animation（{animations[index].name}）缺少默认动画剪辑。");
                    }
                }
            }

            if (_minimumBrightness > _maximumBrightness)
            {
                problems.Add($"亮度波动下限（{_minimumBrightness}）大于上限（{_maximumBrightness}）。");
            }
            if (_pulsePeriodSeconds <= 0f)
            {
                problems.Add($"亮度波动周期必须为正数，当前为 {_pulsePeriodSeconds}。");
            }
            if (_pollIntervalSeconds <= 0f)
            {
                problems.Add($"轮询切换间隔必须为正数，当前为 {_pollIntervalSeconds}。");
            }
        }

        /// <summary>围栏必须满足固定层级结构且材质具备高亮属性；任何漂移都以问题项形式登记。</summary>
        private void ValidateFenceShape(Transform fenceTransform, string areaName, List<string> problems)
        {
            string fenceName = fenceTransform.name;
            MeshRenderer fenceRenderer = fenceTransform.GetComponent<MeshRenderer>();
            if (fenceRenderer == null)
            {
                problems.Add($"区域 {areaName} 的围栏 {fenceName} 缺少围栏网格渲染器。");
                return;
            }
            TryValidateHighlightMaterial(fenceRenderer, $"{fenceName} 围栏", problems);
            if (fenceTransform.childCount < 2)
            {
                problems.Add($"区域 {areaName} 的围栏 {fenceName} 缺少底面或光晕子物体。");
                return;
            }

            MeshRenderer baseRenderer = fenceTransform.GetChild(0).GetComponent<MeshRenderer>();
            if (baseRenderer == null)
            {
                problems.Add($"区域 {areaName} 的围栏 {fenceName} 第一个子物体（底面）缺少网格渲染器。");
            }
            else
            {
                TryValidateHighlightMaterial(baseRenderer, $"{fenceName} 底面", problems);
            }
            if (fenceTransform.GetChild(1).GetComponent<ParticleSystem>() == null)
            {
                problems.Add($"区域 {areaName} 的围栏 {fenceName} 第二个子物体（光晕）缺少粒子系统。");
            }
        }

        /// <summary>高亮只改 RailLight 的 _mainColor 与 _Brightness；材质缺失或属性不兼容都提前登记为问题。</summary>
        private bool TryValidateHighlightMaterial(Renderer renderer, string targetName, List<string> problems)
        {
            Material[] materials = renderer.sharedMaterials;
            for (int index = 0; index < materials.Length; index++)
            {
                Material material = materials[index];
                if (material == null)
                {
                    problems.Add($"{targetName} 的第 {index} 个材质为空。");
                    continue;
                }
                if (!material.HasProperty(MainColorProperty) || !material.HasProperty(BrightnessProperty))
                {
                    problems.Add($"{targetName} 的材质 {material.name}（{material.shader.name}）缺少 {MainColorProperty}/{BrightnessProperty} 属性，无法参与区域高亮。");
                }
            }
            return true;
        }
    }
}
