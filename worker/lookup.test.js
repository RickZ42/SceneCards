import assert from "node:assert/strict";
import test from "node:test";
import { completeDefinition, defineWord, lookupWord } from "./lookup.js";
import worker, { normalizeCapture } from "./index.js";

const dictionary = { entries: [{
  language: { code: "en" },
  pronunciations: [{ type: "ipa", text: "/plɔːzəbəl/" }],
  partOfSpeech: "adjective",
  senses: [{ definition: "Old meaning.", tags: ["obsolete"] }, { definition: "Seemingly reasonable or probable." }],
}] };
function lookupFetch(calls, translation = { responseStatus: 200, responseData: { translatedText: "看似合理或可能的。" } }) {
  return async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json(String(url).includes("freedictionaryapi.com") ? dictionary : translation);
  };
}

test("lookup returns paired English and Chinese without forwarding credentials", async () => {
  const calls = [];
  const result = await lookupWord(" plausible ", lookupFetch(calls));
  assert.equal(result.expression, "plausible");
  assert.match(result.meaning, /Seemingly reasonable/);
  assert.match(result.meaning, /看似合理/);
  assert.equal(result.preview, "English: Seemingly reasonable or probable.\n\n中文：看似合理或可能的。");
  assert.match(result.source, /Wiktionary/);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1].url).searchParams.get("q"), dictionary.entries[0].senses[1].definition);
  for (const call of calls) assert.deepEqual(call.options.headers, { Accept: "application/json" });
});

test("lookup rejects empty input, sentences, URLs and oversized input before making requests", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; };
  for (const input of ["", "This is a very long sentence.", "https://example.com", "a".repeat(81)]) {
    await assert.rejects(lookupWord(input, fetcher), /请只选择/);
  }
  assert.equal(calls, 0);
});

test("device-side translation prepares a public URL without a key and validates the response", async () => {
  const calls = [];
  const definition = await defineWord("plausible", lookupFetch(calls));
  assert.equal(calls.length, 1);
  const url = new URL(definition.translationUrl);
  assert.equal(url.origin, "https://api.mymemory.translated.net");
  assert.deepEqual([...url.searchParams.keys()], ["q", "langpair"]);
  assert.equal(url.searchParams.get("q"), definition.english);
  assert.match(completeDefinition(definition, {responseStatus:200,responseData:{translatedText:"看似合理的。"}}).meaning, /看似合理/);
  assert.throws(() => completeDefinition(definition, {responseStatus:429}), /无法取得中文/);
  assert.throws(() => completeDefinition({}, {}), /英文释义不完整/);
});

test("definition and preview composition routes do not write to the inbox", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", lookupFetch(calls));
  const env = { INBOX_KEY: "test-key", CAPTURES: { put() { throw new Error("Must not save previews"); } } };
  const request = (path, body) => new Request(`https://inbox.example/${path}`, {
    method:"POST", headers:{Authorization:"Bearer test-key","Content-Type":"application/json"}, body:JSON.stringify(body),
  });
  const definition = await (await worker.fetch(request("definition", {text:"plausible"}), env)).json();
  const response = await worker.fetch(request("lookup", {
    definition: JSON.stringify(definition),
    translation: JSON.stringify({responseStatus:200,responseData:{translatedText:"看似合理的。"}}),
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(calls.length, 1, "preview composition must not call the translator again");
});

test("lookup does not offer incomplete translations or quota messages for saving", async () => {
  for (const result of [
    { responseStatus: 429, responseData: { translatedText: "已达到限额" } },
    { responseStatus: 200, responseData: { translatedText: "NO QUERY SPECIFIED" } },
    { responseStatus: 200, quotaFinished: true, responseData: { translatedText: "额度已用完" } },
  ]) await assert.rejects(lookupWord("plausible", lookupFetch([], result)), /无法取得中文/);
  await assert.rejects(lookupWord("unknownword", async () => Response.json({ title: "No Definitions Found" })), /没有找到/);
  await assert.rejects(lookupWord("plausible", async () => new Response("unavailable", { status: 503 })), /暂时不可用/);
});

test("oversized dictionary definitions do not exceed the translator byte limit", async () => {
  let calls = 0;
  await assert.rejects(lookupWord("word", async () => {
    calls++;
    return Response.json({ entries: [{ language: { code: "en" }, senses: [{ definition: "é".repeat(251) }] }] });
  }), /没有找到/);
  assert.equal(calls, 1);
});

test("preview is authenticated and never writes to KV; confirmed save retains bilingual text and ID", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", lookupFetch(calls));
  const stored = new Map();
  const env = {
    INBOX_KEY: "test-key",
    INBOX_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    CAPTURES: { async put(key, value) { stored.set(key, value); } },
  };
  const request = (path, body, auth = true) => new Request(`https://inbox.example/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: "Bearer test-key" } : {}) },
    body: JSON.stringify(body),
  });
  assert.equal((await worker.fetch(request("lookup", { text: "plausible" }, false), env)).status, 401);
  assert.equal(calls.length, 0);
  const preview = await worker.fetch(request("lookup", { text: "plausible" }), env);
  const result = await preview.json();
  assert.equal(result.ok, true);
  assert.equal(stored.size, 0);
  const capture = normalizeCapture({ lookup: result });
  assert.deepEqual(normalizeCapture({ lookup: JSON.stringify(result) }), capture);
  assert.throws(() => normalizeCapture({ lookup: "invalid JSON" }), /格式不正确/);
  assert.equal(capture.meaning, result.meaning);
  assert.equal(capture.pronunciation, result.pronunciation);
  assert.equal(capture.id, result.id);
  assert.equal(capture.createdAt, result.createdAt);
  const saved = await worker.fetch(request("capture", { lookup: result }), env);
  assert.equal(saved.status, 201);
  assert.equal(stored.size, 1);
  await worker.fetch(request("capture", { lookup: result }), env);
  assert.equal(stored.size, 1, "retrying the same preview must not create a duplicate");
  for (const lookup of [{ ok: false }, { ok: true, expression: "word" }, null]) {
    assert.equal((await worker.fetch(request("capture", { lookup }), env)).status, 400);
  }
  assert.equal(stored.size, 1);
});
