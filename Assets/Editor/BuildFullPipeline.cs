using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/// <summary>
/// 一键全流程构建：Unity WebGL 正式包 → 前端 local-test / standalone-formal 包 → 产物门禁。
/// Node.js 路径固定为 E:\nodejs（本机安装路径），启动子进程前自动注入 PATH 并清除 NODE_ENV。
/// Unity 构建与前端打包使用不同发布标识（同目录共存），前端包引用 Unity 包的发布标识。
/// </summary>
public static class BuildFullPipeline
{
    private const string NodeExePath = @"E:\nodejs\node.exe";
    private const string NodeDirPath = @"E:\nodejs";
    private const string FrontendRelativeRoot = "power-data-web";
    private const string FrontendScriptPath = "scripts/build-gas-power-smoke-release.mjs";
    private const string GateScriptPath = "scripts/validate-release-artifact.mjs";

    [MenuItem("Tools/WebDLPro/WebGL/构建测试包(全流程)")]
    public static void BuildTestPackage()
    {
        RunPipeline("local-test", 5523, includeSelfTest: true);
    }

    [MenuItem("Tools/WebDLPro/WebGL/构建正式包(全流程)")]
    public static void BuildFormalPackage()
    {
        RunPipeline("standalone-formal", 0, includeSelfTest: false);
    }

    private static void RunPipeline(string packageType, int port, bool includeSelfTest)
    {
        string projectRoot = Directory.GetParent(Application.dataPath).FullName;
        string timestamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");

        // ── 保存所有已打开场景 ──
        for (int i = 0; i < UnityEditor.SceneManagement.EditorSceneManager.sceneCount; i++)
        {
            var s = UnityEditor.SceneManagement.EditorSceneManager.GetSceneAt(i);
            if (s.isDirty) EditorSceneManager.SaveScene(s);
        }

        // ── 预检 ──
        var buildScenes = EditorBuildSettings.scenes;
        int expected = WebDLPro.Unity.SceneRuntime.BusinessSceneCatalog.GetRequiredSceneIds().Count + 2;
        if (buildScenes == null || buildScenes.Length != expected)
        {
            EditorUtility.DisplayDialog("预检失败", $"构建设置场景数 {buildScenes.Length} != {expected}。", "确定");
            return;
        }
        if (!File.Exists(NodeExePath))
        {
            EditorUtility.DisplayDialog("预检失败", $"未找到 Node.js：{NodeExePath}", "确定");
            return;
        }

        // ── 第 1 步：Unity WebGL 构建 ──
        string unityReleaseId = $"unity-{packageType}-{timestamp}";
        string unityReleaseDir = Path.Combine(projectRoot, "Builds", "Releases", unityReleaseId);
        if (Directory.Exists(unityReleaseDir))
        {
            EditorUtility.DisplayDialog("构建中止", $"Unity 发布目录已存在：{unityReleaseId}", "确定");
            return;
        }

        EditorUtility.DisplayProgressBar("全流程构建", $"[1/3] Unity WebGL 构建（{unityReleaseId}）…", 0.1f);
        string originalVersion = PlayerSettings.bundleVersion;
        try
        {
            PlayerSettings.bundleVersion = unityReleaseId;
            PowerPlantWebGlBuild.BuildProductionWebGl();
        }
        catch (Exception ex)
        {
            EditorUtility.ClearProgressBar();
            EditorUtility.DisplayDialog("Unity 构建失败", ex.Message, "确定");
            return;
        }
        finally
        {
            PlayerSettings.bundleVersion = originalVersion;
        }

        string unityMetadataPath = Path.Combine(unityReleaseDir, "unity", "webgl-protocol-capabilities.json");
        if (!File.Exists(unityMetadataPath))
        {
            EditorUtility.ClearProgressBar();
            EditorUtility.DisplayDialog("Unity 构建异常", "协议元数据缺失。请检查 Console。", "确定");
            return;
        }

        // ── 第 2 步：前端打包 ──
        string frontendReleaseId = $"{packageType}-{timestamp}";
        string frontendReleaseDir = Path.Combine(projectRoot, "Builds", "Releases", frontendReleaseId);
        if (Directory.Exists(frontendReleaseDir))
        {
            EditorUtility.ClearProgressBar();
            EditorUtility.DisplayDialog("构建中止", $"前端发布目录已存在：{frontendReleaseId}", "确定");
            return;
        }

        EditorUtility.DisplayProgressBar("全流程构建", "[2/3] 前端打包（typecheck + Vite 构建 + 资产复制）…", 0.5f);

        var arguments = new StringBuilder($"scripts/{FrontendScriptPath}")
            .Append($" --package-type {packageType}")
            .Append($" --release-id {frontendReleaseId}")
            .Append($" --unity-release-id {unityReleaseId}");
        if (port > 0) arguments.Append($" --port {port}");
        if (includeSelfTest) arguments.Append(" --include-self-test true");
        // 联调包与正式包禁用回环监听：0.0.0.0 让发布服务接收局域网请求；
        // 浏览器公开来源由运行时从当前服务地址派生（来源参数全部省略触发运行时同源模式）。
        if (packageType != "local-test") arguments.Append(" --listen-host 0.0.0.0");

        string frontendOutput = RunNodeProcess(
            projectRoot, FrontendScriptPath, arguments.ToString(),
            out int frontendExitCode);

        if (frontendExitCode != 0)
        {
            EditorUtility.ClearProgressBar();
            EditorUtility.DisplayDialog("前端打包失败",
                $"退出码 {frontendExitCode}。\n\n{Truncate(frontendOutput, 800)}", "确定");
            return;
        }

        // ── 第 3 步：产物门禁 ──
        EditorUtility.DisplayProgressBar("全流程构建", "[3/3] 产物门禁校验…", 0.9f);
        string gateScriptPath = Path.Combine(projectRoot, FrontendRelativeRoot, GateScriptPath);
        string gateArguments = $"--root \"{frontendReleaseDir}\"";
        string gateOutput = RunNodeProcess(
            projectRoot, Path.Combine(FrontendRelativeRoot, GateScriptPath), gateArguments,
            out int gateExit);

        EditorUtility.ClearProgressBar();

        if (gateExit != 0)
        {
            EditorUtility.DisplayDialog("产物门禁失败",
                $"退出码 {gateExit}。\n\n{Truncate(gateOutput, 800)}", "确定");
            return;
        }

        // ── 完成 ──
        string serveHint = $"cd {frontendReleaseDir}\nnode server.mjs";
        EditorUtility.DisplayDialog("全流程构建完成",
            $"发布标识：{frontendReleaseId}\n" +
            $"包目录：{frontendReleaseDir}\n" +
            $"Unity 构建标识：{unityReleaseId}\n" +
            $"启动方式：\n{serveCommand}", "确定");
    }

    private static string serveCommand = $"cd <包目录> && node server.mjs";

    private static string Truncate(string text, int maxLength)
    {
        return string.IsNullOrEmpty(text) || text.Length <= maxLength ? text : text.Substring(0, maxLength) + "…";
    }

    /// <summary>启动 Node 子进程执行脚本，注入 PATH 并清除 NODE_ENV，同步等待完成。</summary>
    private static string RunNodeProcess(
        string workingDirectory, string scriptPath, string arguments,
        out int exitCode)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = NodeExePath,
            Arguments = $"\"{scriptPath}\" {arguments}",
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };

        // 注入 PATH 使脚本内部调用的 npm.cmd 可被解析；清除 NODE_ENV 避免 npm 跳过 devDependencies。
        var env = startInfo.EnvironmentVariables;
        env["PATH"] = NodeDirPath + ";" + Environment.GetEnvironmentVariable("PATH");
        env.Remove("NODE_ENV");

        using var process = Process.Start(startInfo);
        var outputBuilder = new StringBuilder();
        process.OutputDataReceived += (_, args) => { if (!string.IsNullOrEmpty(args.Data)) outputBuilder.AppendLine(args.Data); };
        process.ErrorDataReceived += (_, args) => { if (!string.IsNullOrEmpty(args.Data)) outputBuilder.AppendLine(args.Data); };
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        process.WaitForExit(600_000);
        exitCode = process.ExitCode;
        return outputBuilder.ToString();
    }
}
