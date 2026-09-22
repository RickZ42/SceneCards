import assert from "node:assert/strict";
import test from "node:test";
import {
  createMobileCapture,
  fetchMobileCaptures,
  normalizeMobileInboxSettings,
  pushMobileCapture,
} from "./mobileInbox.js";

test("a selected word becomes a target expression", () => {
  const capture = createMobileCapture({ id: "capture-1", text: "plausible" });
  assert.equal(capture.expression, "plausible");
  assert.equal(capture.originalLine, "");
  assert.equal(capture.needsTarget, false);
  assert.equal(capture.needsEditing, true);
});

test("a selected sentence stays intact and waits for a target", () => {
  const line = "The explanation sounded plausible at first, but the evidence did not support it.";
  const capture = createMobileCapture({ id: "capture-2", text: line });
  assert.equal(capture.expression, line);
  assert.equal(capture.originalLine, line);
  assert.equal(capture.needsTarget, true);
});

test("an explicit target is retained inside a sentence", () => {
  const capture = createMobileCapture({
    id: "capture-3",
    text: "The explanation sounded plausible at first.",
    expression: "plausible",
  });
  assert.equal(capture.expression, "plausible");
  assert.equal(capture.needsTarget, false);
});

test("mobile inbox requests use the configured bearer key", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (options.method === "POST") return Response.json({ ok: true }, { status: 201 });
    return Response.json({ cards: [{ id: "capture-1" }] });
  };

  try {
    const settings = normalizeMobileInboxSettings({
      enabled: true,
      endpoint: "https://inbox.example.workers.dev/",
      key: "private-key",
    });
    await pushMobileCapture(settings, { id: "capture-1" });
    const captures = await fetchMobileCaptures(settings);
    assert.equal(captures.length, 1);
    assert.equal(requests[0].url, "https://inbox.example.workers.dev/capture");
    assert.equal(requests[0].options.headers.Authorization, "Bearer private-key");
    assert.equal(requests[1].url, "https://inbox.example.workers.dev/captures");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
