import assert from "node:assert/strict";
import test from "node:test";
import { accountCacheKey, decryptPrivateStore, emptyPrivateStore, encryptPrivateStore, loadAccountCache, mergePrivateStores, syncPrivateStore } from "./accountSync.js";

const alice = { id: "alice", code: "sc1_" + "a".repeat(43), endpoint: "https://test.example" };
const bob = { ...alice, id: "bob", code: "sc1_" + "b".repeat(43) };
function store(card, reviews = []) { return { ...emptyPrivateStore(), cards: [card], reviews }; }

test("encrypted collections and offline caches cannot be opened by another account", async () => {
  const source = store({ id: "a", expression: "private-example", meaning: "private meaning" });
  const encrypted = await encryptPrivateStore(source, alice);
  assert.equal(JSON.stringify(encrypted).includes("private-example"), false);
  assert.deepEqual(await decryptPrivateStore(encrypted, alice), source);
  await assert.rejects(() => decryptPrivateStore(encrypted, bob));
  await assert.rejects(() => decryptPrivateStore(encrypted, { ...alice, id: "wrong-id" }));
  const storage = { getItem: (key) => key === accountCacheKey(alice.id) ? JSON.stringify(encrypted) : null };
  assert.deepEqual(await loadAccountCache(bob, storage), emptyPrivateStore());
  assert.deepEqual(await loadAccountCache(alice, storage), source);
});

test("content edits and review progress merge independently without losing queue position", () => {
  const base = { id: "word", createdAt: "2026-10-01T08:00:00Z", contentUpdatedAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T08:00:00Z", meaning: "old", personalExample: "old sentence", lastReviewedAt: null, dueAt: "2026-10-01T08:00:00Z" };
  const computer = store({ ...base, meaning: "manual meaning", personalExample: "A useful example.", memoryHook: "unique cue", contentUpdatedAt: "2026-10-03T08:00:00Z", updatedAt: "2026-10-03T08:00:00Z" });
  const phone = store({ ...base, updatedAt: "2026-10-04T08:00:00Z", lastReviewedAt: "2026-10-04T08:00:00Z", dueAt: "2026-10-05T08:00:00Z", repetitions: 4, reviewQueueOrder: 99 }, [{ id: "r1", cardId: "word", at: "2026-10-04T08:00:00Z", rating: "good" }]);
  const merged = mergePrivateStores(computer, phone);
  assert.equal(merged.cards[0].meaning, "manual meaning");
  assert.equal(merged.cards[0].memoryHook, "unique cue");
  assert.equal(merged.cards[0].dueAt, phone.cards[0].dueAt);
  assert.equal(merged.cards[0].reviewQueueOrder, 99);
  assert.deepEqual(merged.reviews, phone.reviews);
  assert.deepEqual(mergePrivateStores(phone, computer), merged);
});

test("offline deleted cards stay deleted while other cards and review history are preserved", () => {
  const local = { ...emptyPrivateStore(), deletedCards: { removed: "2026-10-04T09:00:00Z" }, dismissedCaptureIds: ["capture-old"] };
  const remote = { ...emptyPrivateStore(), cards: [{ id: "removed", updatedAt: "2026-10-04T10:00:00Z" }, { id: "kept", dueAt: "2026-10-08T08:00:00Z" }], reviews: [{ id: "r1", cardId: "kept", at: "2026-10-04T08:00:00Z", rating: "easy" }] };
  const merged = mergePrivateStores(local, remote);
  assert.deepEqual(merged.cards.map((card) => card.id), ["kept"]);
  assert.deepEqual(merged.reviews, remote.reviews);
  assert.deepEqual(merged.dismissedCaptureIds, ["capture-old"]);
  const restored = store({ id: "removed", restoredAt: "2026-10-05T08:00:00Z" });
  assert.equal(mergePrivateStores(restored, merged).cards.length, 2);
});

test("sync retries a stale revision, preserves simultaneous local edits, and avoids unchanged writes", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let local = store({ id: "a", expression: "first", createdAt: "2026-10-01T08:00:00Z" });
  let remote = { revision: 0, document: null };
  let putCount = 0;
  globalThis.fetch = async (url, options) => {
    if (options.method !== "PUT") return new Response(JSON.stringify(remote));
    putCount++;
    if (putCount === 1) {
      local = { ...local, cards: [...local.cards, { id: "b", expression: "new during sync", createdAt: "2026-10-04T08:00:00Z" }] };
      remote = { revision: 1, document: await encryptPrivateStore(store({ id: "c", expression: "other device", createdAt: "2026-10-03T08:00:00Z" }), alice) };
      return new Response("{}", { status: 409 });
    }
    const body = JSON.parse(options.body);
    assert.equal(body.baseRevision, remote.revision);
    remote = { revision: remote.revision + 1, document: body.document };
    return new Response(JSON.stringify(remote));
  };
  const merged = await syncPrivateStore(alice, () => local);
  assert.deepEqual(new Set(merged.cards.map((card) => card.id)), new Set(["a", "b", "c"]));
  assert.equal(putCount, 2);
  local = merged;
  await syncPrivateStore(alice, () => local);
  assert.equal(putCount, 2);
});
