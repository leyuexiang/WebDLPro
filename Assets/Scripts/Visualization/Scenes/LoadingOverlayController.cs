using UnityEngine;

namespace WebDLPro.Unity.SceneRuntime
{
    /// <summary>
    /// 启动场景中的轻量加载反馈状态。当前只保存有限标量，后续可由正式界面或浏览器桥订阅；
    /// 不持有场景资源、异步句柄或无界日志，也不在每帧拼接文本。
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class LoadingOverlayController : MonoBehaviour
    {
        public bool IsVisible { get; private set; }
        public float Progress { get; private set; }
        public string StageCode { get; private set; } = string.Empty;
        public string Message { get; private set; } = string.Empty;
        public bool HasError { get; private set; }

        public void Show(string stageCode, string message)
        {
            IsVisible = true;
            Progress = 0f;
            StageCode = stageCode ?? string.Empty;
            Message = message ?? string.Empty;
            HasError = false;
        }

        public void UpdateProgress(string stageCode, float progress, string message)
        {
            IsVisible = true;
            Progress = Mathf.Clamp01(progress);
            StageCode = stageCode ?? string.Empty;
            Message = message ?? string.Empty;
            HasError = false;
        }

        public void ShowError(string stageCode, string message)
        {
            IsVisible = true;
            StageCode = stageCode ?? string.Empty;
            Message = message ?? string.Empty;
            HasError = true;
        }

        public void Hide()
        {
            IsVisible = false;
            Progress = 0f;
            StageCode = string.Empty;
            Message = string.Empty;
            HasError = false;
        }
    }
}
