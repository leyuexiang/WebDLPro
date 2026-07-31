using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;

/// <summary>
/// 为燃气电厂场景提供稳定、可重复的 WebGL 构建入口。
/// 可从命令行通过 PowerPlantWebGlBuild.BuildHighlightFlowWebGl 调用，
/// 避免手动修改 Build Settings 时遗漏当前场景。
/// </summary>
public static class PowerPlantWebGlBuild
{
    public const string HighlightFlowOutputPath = "Builds/WebGL-HighlightFlow-Skybox";

    [MenuItem("Tools/Power Plant/WebGL/Build Highlight Flow WebGL")]
    public static void BuildHighlightFlowWebGl()
    {
        string[] scenes = EditorBuildSettings.scenes
            .Where(scene => scene.enabled && !string.IsNullOrWhiteSpace(scene.path))
            .Select(scene => scene.path)
            .ToArray();

        if (scenes.Length == 0)
        {
            throw new BuildFailedException("没有启用的构建场景，无法创建 WebGL 包。");
        }

        string absoluteOutputPath = Path.GetFullPath(HighlightFlowOutputPath);
        Directory.CreateDirectory(absoluteOutputPath);

        BuildPlayerOptions options = new BuildPlayerOptions
        {
            scenes = scenes,
            locationPathName = HighlightFlowOutputPath,
            target = BuildTarget.WebGL,
            options = BuildOptions.Development | BuildOptions.StrictMode
        };

        BuildReport report = BuildPipeline.BuildPlayer(options);
        if (report.summary.result != BuildResult.Succeeded)
        {
            throw new BuildFailedException(
                $"WebGL 构建失败：{report.summary.result}，共 {report.summary.totalErrors} 个错误、{report.summary.totalWarnings} 个警告。详情见 Editor.log。");
        }

        Console.WriteLine(
            $"WebGL 构建成功：{absoluteOutputPath}；大小 {report.summary.totalSize / (1024f * 1024f):F1} MB；耗时 {report.summary.totalTime}。");
    }
}
