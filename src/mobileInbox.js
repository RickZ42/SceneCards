export const MOBILE_INBOX_SETTINGS_KEY = "scenecards.mobile-inbox.v1";

const MAX_CAPTURE_LENGTH = 6000;

function cleanText(value, maxLength = MAX_CAPTURE_LENGTH) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function looksLikeSentence(value) {
  const text = cleanText(value);
  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= 6 || (words.length >= 3 && /[.!?]["')\]]?$/.test(text));
}

export function normalizeMobileInboxSettings(value = {}) {
  return {
    enabled: Boolean(value.enabled),
    endpoint: cleanText(value.endpoint, 1000).replace(/\/$/, ""),
    key: cleanText(value.key, 500),
    lastSyncedAt: cleanText(value.lastSyncedAt, 100),
  };
}

export function createMobileCapture({
  id,
  text,
  expression = "",
  meaning = "",
  source = "iPhone 快速收词",
  createdAt = new Date().toISOString(),
}) {
  const selectedText = cleanText(text);
  const target = cleanText(expression, 400);
  const sentence = looksLikeSentence(selectedText);
  const needsTarget = sentence && !target;

  return {
    id,
    expression: target || selectedText,
    meaning: cleanText(meaning, 4000),
    originalLine: sentence ? selectedText : "",
    sceneContext: "",
    personalExample: "",
    exampleMeaning: "",
    memoryHook: "",
    source: cleanText(source, 200) || "iPhone 快速收词",
    tags: ["mobile", "capture"],
    needsTarget,
    needsEditing: true,
    minimumClientSchema: 3,
    contentRevision: 1,
    createdAt,
  };
}

function authHeaders(key) {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export async function pushMobileCapture(settings, capture) {
  const normalized = normalizeMobileInboxSettings(settings);
  if (!normalized.endpoint || !normalized.key) {
    throw new Error("请先设置手机收词同步");
  }
  const response = await fetch(`${normalized.endpoint}/capture`, {
    method: "POST",
    headers: authHeaders(normalized.key),
    body: JSON.stringify(capture),
  });
  if (response.status === 401) throw new Error("手机收件箱密钥不正确");
  if (!response.ok) throw new Error(`发送到手机收件箱失败（${response.status}）`);
  return response.json();
}

export async function fetchMobileCaptures(settings) {
  const normalized = normalizeMobileInboxSettings(settings);
  if (!normalized.endpoint || !normalized.key) return [];
  const response = await fetch(`${normalized.endpoint}/captures`, {
    headers: authHeaders(normalized.key),
    cache: "no-store",
  });
  if (response.status === 401) throw new Error("手机收件箱密钥不正确");
  if (!response.ok) throw new Error(`读取手机收件箱失败（${response.status}）`);
  const payload = await response.json();
  return Array.isArray(payload.cards) ? payload.cards : [];
}
