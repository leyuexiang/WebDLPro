using UnityEditor;
using UnityEngine;

[CustomEditor(typeof(CoalPowerSteamEffectsController))]
public sealed class CoalPowerSteamEffectsControllerEditor : Editor
{
    public override void OnInspectorGUI()
    {
        DrawDefaultInspector();
        var controller = (CoalPowerSteamEffectsController)target;
        using (new EditorGUI.DisabledScope(!Application.isPlaying || !controller.isActiveAndEnabled))
        {
            if (GUILayout.Button("重播开阀过程")) controller.RestartFilling();
        }
        if (!Application.isPlaying)
            EditorGUILayout.HelpBox("进入播放模式后可重播：停留 → 阀芯抬升 → 气体充盈 → 出气。", MessageType.Info);
    }
}
