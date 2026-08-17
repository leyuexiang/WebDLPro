/**
 * Unity WebGL 浏览器桥接层。
 * 该文件由 Unity 构建系统合并到 WebGL 输出中：它严格验证父页面来源与协议，
 * 再将已验证消息交给 C#；C# 的回传也只能使用登记的精确父页面来源。
 */
mergeInto(LibraryManager.library, {
  Power3dUnityBridge_Initialize: function (gameObjectNamePointer, instanceIdPointer) {
    var gameObjectName = UTF8ToString(gameObjectNamePointer);
    var instanceId = UTF8ToString(instanceIdPointer);
    /*
     * 正常路径由 C# 的 UnityIframeBridgeManager 在 Start 中调用本函数。
     * 个别 WebGL 播放器在首场景脚本生命周期未及时进入时，网页模板会在 unityInstance（网页图形实例）
     * 创建完成后以 BootstrapRuntime（启动运行时根对象）建立同构兜底桥接。这里必须优先复用该已登记桥接，
     * 否则两个 window.message（窗口消息）监听器会把同一命令投递两次，造成重复场景切换或重复回执。
     */
    if (window.Power3dUnityBridge && !window.Power3dUnityBridge.releaseRequested) {
      console.info('[Power3dUnityBridge] 已存在活动桥接，跳过重复初始化。');
      return;
    }
    // 仅记录固定阶段名称，不输出来源、查询参数或业务消息；浏览器回归可据此区分
    // “C# 未进入桥接调用”和“已进入但后续握手失败”两类故障。
    console.info('[Power3dUnityBridge] 已接收 Unity 桥接初始化调用。');
    var query = new URLSearchParams(window.location.search);
    var parentOrigin = query.get('parentOrigin');
    var runtimeKey = query.get('runtimeKey');
    var buildId = query.get('buildId');
    var sceneMappingVersion = query.get('sceneMappingVersion');
    var resourceDigest = query.get('resourceDigest');

    /**
     * 父页面来源必须是精确 HTTP(S) Origin，不能携带路径、查询、片段或用户信息。
     * 独立打开 WebGL 页面时 parentOrigin 为空，桥接会禁用通信而不会退化为通配符。
     */
    try {
      var parsedParentOrigin = new URL(parentOrigin);
      var isExactHttpOrigin =
        (parsedParentOrigin.protocol === 'http:' || parsedParentOrigin.protocol === 'https:') &&
        parsedParentOrigin.origin === parentOrigin;
      if (!isExactHttpOrigin || !runtimeKey || !buildId || !sceneMappingVersion || !resourceDigest) {
        console.warn('[Power3dUnityBridge] 缺少精确父页面来源或运行时元数据，已禁用 iframe 通信。');
        return;
      }
    } catch (error) {
      console.warn('[Power3dUnityBridge] 父页面来源格式无效，已禁用 iframe 通信。', error);
      return;
    }

    var commandCapabilities = [
      'init', 'resize', 'switchScene', 'enterProcessStep', 'resetScene', 'focusNode', 'clearSelection',
      'setNodeVisualState', 'clearNodeVisualState', 'setRouteFlow', 'setNodeVisibility', 'dispose'
    ];
    var eventCapabilities = ['ready', 'ack', 'commandResult', 'sceneLoadProgress', 'sceneChanged', 'objectSelected', 'disposed'];
    var isSupportedCommand = function (type) {
      return commandCapabilities.indexOf(type) !== -1;
    };

    /**
     * 入站监听器同时核验精确来源、父窗口、频道、协议版本、实例标识和命令白名单。
     * 校验失败的消息不记录 payload，也不会进入 Unity 场景逻辑。
     */
    var receiveFromParent = function (event) {
      var bridge = window.Power3dUnityBridge;
      var data = event.data;
      if (
        !bridge ||
        bridge.releaseRequested ||
        event.origin !== bridge.parentOrigin ||
        event.source !== window.parent ||
        !data ||
        data.channel !== 'power3d-unity' ||
        data.version !== 1 ||
        data.instanceId !== bridge.instanceId ||
        typeof data.messageId !== 'string' ||
        typeof data.timestamp !== 'number' ||
        !isSupportedCommand(data.type)
      ) {
        return;
      }
      SendMessage(bridge.gameObjectName, 'ReceiveFromParent', JSON.stringify(data));
    };

    window.Power3dUnityBridge = {
      gameObjectName: gameObjectName,
      instanceId: instanceId,
      parentOrigin: parentOrigin,
      receiveFromParent: receiveFromParent,
      releaseRequested: false
    };
    window.addEventListener('message', receiveFromParent);

    /**
     * ready 只在监听器完成注册后发送，且完整声明构建一致性字段与彼此独立的上下行能力。
     * 前端会按这些字段与只读运行时登记表逐项握手，不会通过已收到的事件推断可发命令。
     */
    window.parent.postMessage({
      channel: 'power3d-unity',
      version: 1,
      instanceId: instanceId,
      messageId: Date.now() + '-ready',
      type: 'ready',
      payload: {
        runtimeKey: runtimeKey,
        buildId: buildId,
        sceneMappingVersion: sceneMappingVersion,
        protocolVersion: 1,
        resourceDigest: resourceDigest,
        commandCapabilities: commandCapabilities,
        eventCapabilities: eventCapabilities
      },
      timestamp: Date.now()
    }, parentOrigin);
    // ready 已在监听器注册后发出。该受控阶段日志不包含实例、来源或载荷，
    // 仅用于验证 WebGL 构建中的浏览器桥已真实可用。
    console.info('[Power3dUnityBridge] 已注册监听并发送 ready。');
  },

  /**
   * C# 回传前再次验证固定协议、实例和事件白名单。这样即使场景脚本误传了未知类型，
   * 也不会从 Unity WebGL 页面发出不受契约约束的跨窗口消息。
   */
  Power3dUnityBridge_SendToParent: function (messageJsonPointer) {
    var bridge = window.Power3dUnityBridge;
    if (!bridge || bridge.releaseRequested || !bridge.parentOrigin || window.parent === window) {
      return;
    }
    try {
      var message = JSON.parse(UTF8ToString(messageJsonPointer));
      var eventCapabilities = ['ready', 'ack', 'commandResult', 'sceneLoadProgress', 'sceneChanged', 'objectSelected', 'disposed'];
      if (
        !message ||
        message.channel !== 'power3d-unity' ||
        message.version !== 1 ||
        message.instanceId !== bridge.instanceId ||
        eventCapabilities.indexOf(message.type) === -1
      ) {
        console.warn('[Power3dUnityBridge] 已拒绝不符合回传契约的 Unity 消息。');
        return;
      }
      window.parent.postMessage(message, bridge.parentOrigin);
    } catch (error) {
      console.error('[Power3dUnityBridge] 无法向父页面发送消息。', error);
    }
  },

  /**
   * C# 在发送 disposed 后调用此方法。方法本身可重复调用：首次调用移除监听器并异步执行 Quit，
   * 后续调用直接返回，避免重复释放产生未捕获异常或保留旧实例资源。
   */
  Power3dUnityBridge_Release: function () {
    var bridge = window.Power3dUnityBridge;
    if (!bridge || bridge.releaseRequested) {
      return;
    }

    bridge.releaseRequested = true;
    window.removeEventListener('message', bridge.receiveFromParent);
    window.setTimeout(function () {
      var unityInstance = window.unityInstance;
      if (!unityInstance || typeof unityInstance.Quit !== 'function') {
        return;
      }

      // 先清空全局引用，避免 pagehide 或重复 dispose 再次对同一实例调用 Quit。
      window.unityInstance = null;
      Promise.resolve(unityInstance.Quit())
        .catch(function (error) {
          console.warn('[Power3dUnityBridge] Unity 实例释放失败。', error);
        });
    }, 0);
  }
});
