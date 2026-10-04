import { completeDefinition, defineWord, lookupWord } from "./lookup.js";
import { accountIdentity, accountObject, codeHash, handleAccountRoute } from "./accounts.js";
export { AccountData } from "./accounts.js";

const CAPTURE_PREFIX = "capture:";
const RETENTION_SECONDS = 180 * 24 * 60 * 60;
const MAX_CAPTURE_LENGTH = 6000;

function cleanText(value, maxLength = MAX_CAPTURE_LENGTH) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function looksLikeSentence(value) {
  const text = cleanText(value);
  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= 6 || (words.length >= 3 && /[.!?]["')\]]?$/.test(text));
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function corsHeaders(request, env) {
  const origin = allowedOrigin(request, env);
  return origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        Vary: "Origin",
      }
    : {};
}

function base64ToBytes(value) {
  const binary = atob(String(value || "").replace(/\s+/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function encryptionKey(secret) {
  const bytes = base64ToBytes(secret);
  if (bytes.length !== 32) throw new Error("INBOX_ENCRYPTION_KEY must contain 32 bytes");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptCapture(capture, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const plaintext = new TextEncoder().encode(JSON.stringify(capture));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return JSON.stringify({
    version: 1,
    encryption: "AES-256-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  });
}

export async function decryptCapture(payload, secret) {
  const encrypted = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (encrypted?.version !== 1 || !encrypted.iv || !encrypted.ciphertext) {
    throw new Error("Unsupported capture payload");
  }
  const key = await encryptionKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(encrypted.iv) },
    key,
    base64ToBytes(encrypted.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export function normalizeCapture(body, now = new Date().toISOString()) {
  if (body?.lookup !== undefined) {
    // Shortcuts serializes a Dictionary magic variable in a Text field as JSON.
    if (typeof body.lookup === "string") {
      try {
        body = { lookup: JSON.parse(body.lookup.slice(0, 16000)) };
      } catch {
        throw new Error("查词结果格式不正确，没有保存卡片。请重新查词。");
      }
    }
    if (body.lookup?.ok !== true || !cleanText(body.lookup?.meaning) || !cleanText(body.lookup?.expression)) {
      throw new Error("查词结果不完整，没有保存卡片。请重新查词。");
    }
    body = body.lookup;
  }
  const sharedText = cleanText(body?.text || body?.originalLine || body?.expression);
  if (!sharedText) throw new Error("text is required");

  const explicitExpression = cleanText(body?.expression, 400);
  const sentence = looksLikeSentence(sharedText);
  const id = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(body?.id || "")
    ? body.id
    : crypto.randomUUID();

  return {
    id,
    expression: explicitExpression || sharedText,
    pronunciation: cleanText(body?.pronunciation, 200),
    difficulty: "",
    meaning: cleanText(body?.meaning, 4000),
    originalLine: sentence ? sharedText : cleanText(body?.originalLine),
    sceneContext: "",
    personalExample: "",
    exampleMeaning: "",
    memoryHook: "",
    source: cleanText(body?.source, 200) || "iPhone 分享",
    tags: ["mobile", "capture"],
    needsTarget: sentence && !explicitExpression,
    needsEditing: true,
    minimumClientSchema: 3,
    contentRevision: 1,
    createdAt: cleanText(body?.createdAt, 100) || now,
  };
}

async function allCaptures(env) {
  const cards = [];
  let cursor;
  do {
    const page = await env.CAPTURES.list({ prefix: CAPTURE_PREFIX, cursor, limit: 1000 });
    const captures = await Promise.all(
      page.keys.map(async ({ name }) => {
        const value = await env.CAPTURES.get(name);
        if (!value) return null;
        try {
          return await decryptCapture(value, env.INBOX_ENCRYPTION_KEY);
        } catch {
          return null;
        }
      }),
    );
    cards.push(...captures.filter(Boolean));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return cards.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const headers = corsHeaders(request, env);

  if (request.method === "OPTIONS") {
    if (allowedOrigin(request, env) === null) return json({ error: "Origin not allowed" }, 403);
    return new Response(null, { status: 204, headers });
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true, app: "SceneCards mobile inbox", privateAccounts: Boolean(env.ACCOUNT_DATA) }, 200, headers);
  }

  if (allowedOrigin(request, env) === null) {
    return json({ error: "Origin not allowed" }, 403, headers);
  }
  if (env.ACCOUNT_RATE_LIMIT) {
    const key = await codeHash(request.headers.get("Authorization") || request.headers.get("CF-Connecting-IP") || "anonymous");
    const { success } = await env.ACCOUNT_RATE_LIMIT.limit({ key });
    if (!success) return json({ error: "请求过于频繁，请稍后重试" }, 429, headers);
  }
  const identity = await accountIdentity(request, env);
  if (["/session", "/account", "/invites", "/vault"].includes(url.pathname)) {
    try {
      const result = await handleAccountRoute(request, env, identity);
      return new Response(result.body, { status: result.status, headers: { ...Object.fromEntries(result.headers), ...headers } });
    } catch {
      return json({ error: "请求格式不正确或超出大小限制" }, 400, headers);
    }
  }
  if (!identity) return json({ error: "Unauthorized" }, 401, headers);

  if (request.method === "POST" && ["/lookup", "/definition"].includes(url.pathname)) {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "请求格式不正确，没有保存卡片。" }, 400, headers);
    }
    try {
      // Device-side translation avoids pooling all users under a Worker IP quota.
      const parse = (value) => typeof value === "string" ? JSON.parse(value) : value;
      const result = url.pathname === "/definition"
        ? await defineWord(body?.text)
        : body?.definition !== undefined
          ? completeDefinition(parse(body.definition), parse(body.translation))
          : await lookupWord(body?.text);
      return json({ ok: true, ...result, id: crypto.randomUUID(), createdAt: new Date().toISOString() }, 200, headers);
    } catch (error) {
      const message = error?.name === "TimeoutError"
        ? "查词超时，请稍后重试。没有保存任何卡片。"
        : (error?.message || "查词失败，没有保存任何卡片。");
      return json({ ok: false, error: message }, 422, headers);
    }
  }

  if (request.method === "POST" && url.pathname === "/capture") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400, headers);
    }

    let capture;
    try {
      capture = normalizeCapture(body);
    } catch (error) {
      return json({ error: error.message }, 400, headers);
    }

    const key = `${CAPTURE_PREFIX}${capture.createdAt}:${capture.id}`;
    if (!identity.owner) {
      const result = await accountObject(env, identity.id).fetch(new Request("https://account.internal/capture", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: capture.id, payload: await encryptCapture(capture, env.INBOX_ENCRYPTION_KEY) }),
      }));
      return new Response(result.body, { status: result.status, headers: { ...Object.fromEntries(result.headers), ...headers } });
    }
    await env.CAPTURES.put(
      key,
      await encryptCapture(capture, env.INBOX_ENCRYPTION_KEY),
      { expirationTtl: RETENTION_SECONDS },
    );
    return json({ ok: true, id: capture.id }, 201, headers);
  }

  if (request.method === "GET" && url.pathname === "/captures") {
    if (!identity.owner) {
      const result = await accountObject(env, identity.id).fetch(new Request("https://account.internal/captures"));
      const { payloads } = await result.json();
      const cards = await Promise.all(payloads.map((payload) => decryptCapture(payload, env.INBOX_ENCRYPTION_KEY)));
      return json({ cards: cards.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))) }, 200, headers);
    }
    return json({ cards: await allCaptures(env) }, 200, headers);
  }

  return json({ error: "Not found" }, 404, headers);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
