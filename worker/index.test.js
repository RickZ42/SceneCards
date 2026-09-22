import assert from "node:assert/strict";
import test from "node:test";
import worker, {
  decryptCapture,
  encryptCapture,
  normalizeCapture,
} from "./index.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");

function memoryKv() {
  const values = new Map();
  return {
    values,
    async put(key, value) {
      values.set(key, value);
    },
    async get(key) {
      return values.get(key) || null;
    },
    async list({ prefix }) {
      return {
        keys: [...values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
      };
    },
  };
}

function environment() {
  return {
    CAPTURES: memoryKv(),
    INBOX_KEY: "capture-key",
    INBOX_ENCRYPTION_KEY: encryptionKey,
    ALLOWED_ORIGINS: "https://rickz42.github.io,http://127.0.0.1:5173",
  };
}

test("capture content is encrypted before storage", async () => {
  const capture = normalizeCapture({ text: "plausible" }, "2026-09-22T08:00:00.000Z");
  const encrypted = await encryptCapture(capture, encryptionKey);
  assert.equal(encrypted.includes("plausible"), false);
  assert.deepEqual(await decryptCapture(encrypted, encryptionKey), capture);
});

test("sentences are preserved for later target selection", () => {
  const text = "The explanation sounded plausible, but the evidence did not support it.";
  const capture = normalizeCapture({ text }, "2026-09-22T08:00:00.000Z");
  assert.equal(capture.expression, text);
  assert.equal(capture.originalLine, text);
  assert.equal(capture.needsTarget, true);
});

test("the worker requires a bearer key and returns stored captures", async () => {
  const env = environment();
  const unauthorized = await worker.fetch(
    new Request("https://inbox.example/captures"),
    env,
  );
  assert.equal(unauthorized.status, 401);

  const headers = {
    Authorization: "Bearer capture-key",
    "Content-Type": "application/json",
    Origin: "https://rickz42.github.io",
  };
  const created = await worker.fetch(
    new Request("https://inbox.example/capture", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "plausible", id: "capture-12345678" }),
    }),
    env,
  );
  assert.equal(created.status, 201);
  assert.equal([...env.CAPTURES.values.values()][0].includes("plausible"), false);

  const listed = await worker.fetch(
    new Request("https://inbox.example/captures", { headers }),
    env,
  );
  assert.equal(listed.status, 200);
  const payload = await listed.json();
  assert.equal(payload.cards.length, 1);
  assert.equal(payload.cards[0].expression, "plausible");
});

test("browser reads are restricted to configured origins", async () => {
  const response = await worker.fetch(
    new Request("https://inbox.example/captures", {
      headers: {
        Authorization: "Bearer capture-key",
        Origin: "https://malicious.example",
      },
    }),
    environment(),
  );
  assert.equal(response.status, 403);
});
