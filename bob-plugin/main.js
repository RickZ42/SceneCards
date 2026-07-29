var DEFAULT_ENDPOINT = "http://127.0.0.1:5173/api/cards";

function supportLanguages() {
  return ["auto", "en", "zh-Hans", "zh-Hant"];
}

function finish(query, completion, value) {
  if (typeof query.onCompletion === "function") {
    query.onCompletion(value);
  } else {
    completion(value);
  }
}

function result(query, message) {
  return {
    result: {
      from: query.detectFrom || "en",
      to: query.detectTo || "zh-Hans",
      toParagraphs: [message],
    },
  };
}

function serviceError(message) {
  return {
    error: {
      type: "network",
      message: message,
      addition: "请先在这台 Mac 上启动 SceneCards。",
      troubleshootingLink: "http://127.0.0.1:5173/",
    },
  };
}

function parseCard(rawText) {
  var separator = ($option.separator || "||").trim() || "||";
  var pieces = rawText.split(separator).map(function (piece) {
    return piece.trim();
  });
  return {
    expression: pieces[0] || "",
    meaning: pieces[1] || "",
    originalLine: pieces.slice(2).join(" ").trim(),
  };
}

function translate(query, completion) {
  var rawText = String(query.originalText || query.text || "").trim();
  var captureMode = $option.captureMode || "favorite";
  var marker = ($option.marker || "+sc").trim() || "+sc";

  if (!rawText) {
    finish(query, completion, result(query, "没有可加入的内容。"));
    return;
  }

  if (captureMode !== "marker") {
    finish(
      query,
      completion,
      result(query, "普通翻译不会加入卡片。需要时请点 Bob 收藏按钮，或按 ⌘S。"),
    );
    return;
  }

  if (!rawText.endsWith(marker)) {
    finish(query, completion, result(query, "未加入：末尾没有 " + marker + " 标记。"));
    return;
  }
  rawText = rawText.slice(0, -marker.length).trim();

  var card = parseCard(rawText);
  if (!card.expression) {
    finish(query, completion, result(query, "未加入：英语表达不能为空。"));
    return;
  }

  $http.request({
    method: "POST",
    url: $option.endpoint || DEFAULT_ENDPOINT,
    header: { "Content-Type": "application/json" },
    body: {
      expression: card.expression,
      meaning: card.meaning,
      originalLine: card.originalLine,
      source: "Bob 手动标记",
      tags: ["Bob", "manual"],
    },
    timeout: 8,
    cancelSignal: query.cancelSignal,
    handler: function (response) {
      var statusCode = response.response && response.response.statusCode;
      if (response.error || !statusCode || statusCode < 200 || statusCode >= 300) {
        finish(query, completion, serviceError("无法连接 SceneCards 本机收件箱。"));
        return;
      }

      var duplicate = response.data && response.data.duplicate;
      var message = duplicate
        ? "已经在 SceneCards 收件箱中，不重复添加。"
        : card.meaning
          ? "已加入 SceneCards，打开后可以直接复习。"
          : "已加入 SceneCards 待整理，请补充这一幕里的含义。";
      finish(query, completion, result(query, message));
    },
  });
}

function pluginValidate(completion) {
  var endpoint = $option.endpoint || DEFAULT_ENDPOINT;
  var healthUrl = endpoint.replace(/\/api\/cards\/?$/, "/api/health");
  $http.request({
    method: "GET",
    url: healthUrl,
    timeout: 5,
    handler: function (response) {
      var statusCode = response.response && response.response.statusCode;
      if (!response.error && statusCode === 200 && response.data && response.data.ok) {
        completion({ result: true });
      } else {
        completion(serviceError("没有检测到正在运行的 SceneCards。"));
      }
    },
  });
}
