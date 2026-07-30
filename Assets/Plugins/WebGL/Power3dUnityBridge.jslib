/**
 * Unity WebGL 浏览器桥接层。
 * 该文件由 Unity 构建系统合并到 WebGL 输出中：它校验父页面来源，将合法消息转给 C#，
 * 再将 C# 生成的 JSON 消息以精确 targetOrigin 回传给 iframe 父页面。
 */
mergeInto(LibraryManager.library, {
  Power3dUnityBridge_Initialize: function (gameObjectNamePointer, instanceIdPointer) {
    var gameObjectName = UTF8ToString(gameObjectNamePointer);
    var instanceId = UTF8ToString(instanceIdPointer);
    var query = new URLSearchParams(window.location.search);
    var parentOrigin = query.get('parentOrigin');

    // 仅保存合法 http/https 来源。独立打开 WebGL 页面时 parentOrigin 为空，此时禁用通信而非使用通配符。
    try {
      if (!parentOrigin || !/^https?:$/.test(new URL(parentOrigin).protocol)) {
        console.warn('[Power3dUnityBridge] 缺少有效父页面来源，已禁用 iframe 通信。');
        return;
      }
    } catch (error) {
      console.warn('[Power3dUnityBridge] 父页面来源格式无效，已禁用 iframe 通信。', error);
      return;
    }

    window.Power3dUnityBridge = { gameObjectName: gameObjectName, instanceId: instanceId, parentOrigin: parentOrigin };
    window.addEventListener('message', function (event) {
      var bridge = window.Power3dUnityBridge;
      var data = event.data;
      // 来源、父窗口、通道、版本和实例标识全部匹配后，才将消息交给 Unity。
      if (!bridge || event.origin !== bridge.parentOrigin || event.source !== window.parent || !data || data.channel !== 'power3d-unity' || data.version !== 1 || data.instanceId !== bridge.instanceId || typeof data.type !== 'string') {
        return;
      }
      SendMessage(bridge.gameObjectName, 'ReceiveFromParent', JSON.stringify(data));
    });

    // ready 只在监听器完成注册后发送，避免父页面立即发送 init 时发生竞态丢失。
    window.parent.postMessage({
      channel: 'power3d-unity', version: 1, instanceId: instanceId,
      messageId: Date.now() + '-ready', type: 'ready',
      payload: { runtime: 'unity-webgl', capabilities: ['init', 'test-command', 'resize', 'object-click'] },
      timestamp: Date.now()
    }, parentOrigin);
  },

  Power3dUnityBridge_SendToParent: function (messageJsonPointer) {
    var bridge = window.Power3dUnityBridge;
    if (!bridge || !bridge.parentOrigin || window.parent === window) {
      return;
    }
    try {
      window.parent.postMessage(JSON.parse(UTF8ToString(messageJsonPointer)), bridge.parentOrigin);
    } catch (error) {
      console.error('[Power3dUnityBridge] 无法向父页面发送消息。', error);
    }
  }
});
