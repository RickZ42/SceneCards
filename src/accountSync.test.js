import assert from "node:assert/strict";
import test from "node:test";
import { accountCacheKey, decryptPrivateStore, desktopConflictIds, emptyPrivateStore, encryptPrivateStore, loadAccountCache, mergeApprovedDesktopStore, mergePrivateStores, migrateLocalCollection, readDesktopBackup, syncPrivateStore } from "./accountSync.js";
import { scheduleCard } from "./reviewSchedule.js";

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

test("private sync retains legacy hard review events without changing card schedules", async context => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const card = { id: "legacy", expression: "example", dueAt: "2026-10-29T08:00:00Z", intervalDays: 2, ease: 2.3, repetitions: 4, lapses: 1, lastReviewedAt: "2026-10-27T08:00:00Z", reviewQueueOrder: 7 };
  const review = { id: "old-hard", cardId: card.id, at: "2026-10-27T08:00:00Z", rating: "hard" };
  const local = store(card, [review]);
  assert.deepEqual(mergePrivateStores(local, emptyPrivateStore()), local);
  const owner = { ...alice, owner: true };
  let uploaded;
  globalThis.fetch = async (url, options) => {
    if (options.method !== "PUT") return Response.json({ revision: 0, document: null });
    uploaded = await decryptPrivateStore(JSON.parse(options.body).document, owner);
    return Response.json({ revision: 1 });
  };
  assert.deepEqual(await migrateLocalCollection(owner, local), local);
  assert.deepEqual(uploaded, local);
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

test("explicit owner migration encrypts all local cards and progress without modifying the source", async context => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const owner = { ...alice, owner: true };
  const local = store({ id: "phrase", practiceType: "expression", meaning: "manual meaning", dueAt: "2026-10-28T08:00:00Z", lastReviewedAt: "2026-10-27T08:00:00Z", repetitions: 2 }, [{ id: "r1", cardId: "phrase", at: "2026-10-27T08:00:00Z", rating: "good" }]);
  const before = structuredClone(local);
  let uploaded;
  globalThis.fetch = async (url, options) => {
    if (options.method !== "PUT") return Response.json({ revision: 0, document: null });
    const body = JSON.parse(options.body);
    assert.equal(body.baseRevision, 0);
    assert.equal(body.document.encryption, "AES-256-GCM");
    assert(!options.body.includes("manual meaning"));
    uploaded = await decryptPrivateStore(body.document, owner);
    return Response.json({ revision: 1 });
  };
  const migrated = await migrateLocalCollection(owner, local);
  assert.deepEqual(migrated, local);
  assert.deepEqual(uploaded, local);
  assert.deepEqual(local, before);
});

for (const conflict of [
  { meaning: "different cloud content", contentUpdatedAt: "2026-10-28T08:00:00Z" },
  { lastReviewedAt: "2026-10-28T08:00:00Z", dueAt: "2026-11-10T08:00:00Z" },
]) {
  test(`desktop migration refuses a conflicting cloud copy before any write: ${Object.keys(conflict)[0]}`, async context => {
    const originalFetch = globalThis.fetch;
    context.after(() => { globalThis.fetch = originalFetch; });
    const owner = { ...alice, owner: true };
    const local = store({ id: "a", meaning: "computer meaning", contentUpdatedAt: "2026-10-27T08:00:00Z", lastReviewedAt: "2026-10-27T08:00:00Z", dueAt: "2026-10-29T08:00:00Z" });
    const before = structuredClone(local);
    const document = await encryptPrivateStore(store({ ...local.cards[0], ...conflict }), owner);
    let writes = 0;
    globalThis.fetch = async (url, options) => {
      if (options.method === "PUT") { writes++; return Response.json({ revision: 5 }); }
      return Response.json({ revision: 4, document });
    };
    await assert.rejects(() => migrateLocalCollection(owner, local), /冲突/);
    assert.equal(writes, 0);
    assert.deepEqual(local, before);
  });
}

test("migration rechecks a changed cloud revision and never overwrites a new conflict", async context => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const owner = { ...alice, owner: true };
  const local = store({ id: "a", meaning: "computer", contentUpdatedAt: "2026-10-27T08:00:00Z" });
  const changed = await encryptPrivateStore(store({ ...local.cards[0], meaning: "new cloud edit", contentUpdatedAt: "2026-10-28T08:00:00Z" }), owner);
  let writes = 0;
  globalThis.fetch = async (url, options) => {
    if (options.method === "PUT") { writes++; return Response.json({}, { status: 409 }); }
    return Response.json(writes ? { revision: 1, document: changed } : { revision: 0, document: null });
  };
  await assert.rejects(() => migrateLocalCollection(owner, local), /冲突/);
  assert.equal(writes, 1);
});

test("ordinary account cache loading never reads another device's legacy collection", async () => {
  const keys = [];
  const storage = { getItem(key) { keys.push(key); return null; } };
  assert.deepEqual(await loadAccountCache(alice, storage), emptyPrivateStore());
  assert.deepEqual(keys, [accountCacheKey(alice.id)]);
});

test("desktop backup validation retains complete card fields and historical hard events", () => {
  const source = store({ id: "a", expression: "word", practiceType: "expression", customSchedule: { stability: 3 } }, [{ id: "r", cardId: "a", rating: "hard", at: "2026-10-27T08:00:00Z" }]);
  const backup = { app: "SceneCards", version: 1, exportedAt: "2026-10-27T09:00:00Z", ...source };
  assert.deepEqual(readDesktopBackup(backup), source);
  assert.throws(() => readDesktopBackup({ ...backup, cards: [...source.cards, ...source.cards] }), /重复/);
  assert.throws(() => readDesktopBackup({ ...backup, reviews: [...source.reviews, ...source.reviews] }), /重复/);
  assert.throws(() => readDesktopBackup({ ...backup, deletedCards: null }), /元数据/);
  assert.throws(() => readDesktopBackup({ entries: source.cards }), /完整词库/);
});

test("approved desktop merge preserves schedules, history, expression track and every cloud extra", () => {
  const local = { ...store({ id: "a", expression: "desktop phrase", practiceType: "expression", meaning: "manual meaning", contentUpdatedAt: "2026-10-27T08:00:00Z", updatedAt: "2026-10-27T08:00:00Z", dueAt: "2026-11-01T08:00:00Z", intervalDays: 5, ease: 2.7, repetitions: 8, lapses: 2, lastReviewedAt: "2026-10-27T08:00:00Z", reviewQueueOrder: 77, fsrs: { stability: 4 } }, [{ id: "r", cardId: "a", at: "2026-10-27T08:00:00Z", rating: "hard" }]), installedSeeds: ["seed"] };
  const remote = { ...emptyPrivateStore(), cards: [{ ...local.cards[0], meaning: "machine meaning", status: "draft", updatedAt: "2026-10-28T08:00:00Z", contentUpdatedAt: "2026-10-28T08:00:00Z", lastReviewedAt: null, repetitions: 0 }, { id: "extra", expression: "new cloud item", status: "draft", dueAt: "2026-11-04T08:00:00Z" }], reviews: [{ id: "extra-review", cardId: "extra", at: "2026-10-28T08:00:00Z", rating: "easy" }] };
  const before = structuredClone({ local, remote });
  assert.deepEqual(desktopConflictIds(local, remote), ["a"]);
  const merged = mergeApprovedDesktopStore(local, remote, { approvedConflictIds: ["a"], now: "2026-10-28T09:00:00Z" });
  const selected = merged.cards.find(card => card.id === "a");
  const { updatedAt, contentUpdatedAt, ...content } = selected;
  const { updatedAt: oldUpdated, contentUpdatedAt: oldContentUpdated, ...original } = local.cards[0];
  assert.deepEqual(content, original);
  assert(updatedAt > remote.cards[0].contentUpdatedAt);
  assert.equal(updatedAt, contentUpdatedAt);
  assert.deepEqual(merged.cards.find(card => card.id === "extra"), remote.cards[1]);
  assert.deepEqual(new Map(merged.reviews.map(review => [review.id, review])), new Map([...local.reviews, ...remote.reviews].map(review => [review.id, review])));
  assert.deepEqual(mergePrivateStores(merged, remote), merged);
  assert.deepEqual({ local, remote }, before);
});

test("already identical desktop cards are not retimestamped", () => {
  const local = store({ id: "a", expression: "unchanged", updatedAt: "2026-10-27T08:00:00Z" });
  assert.deepEqual(mergeApprovedDesktopStore(local, local, { approvedConflictIds: [] }), local);
});

test("desktop preference refuses new phone history, edited events, newer schedules and unapproved conflicts", () => {
  const local = store({ id: "a", expression: "desktop", contentUpdatedAt: "2026-10-27T08:00:00Z", lastReviewedAt: "2026-10-27T08:00:00Z" }, [{ id: "r", cardId: "a", at: "2026-10-27T08:00:00Z", rating: "good" }]);
  const options = { approvedConflictIds: ["a"] };
  assert.throws(() => mergeApprovedDesktopStore(local, store(local.cards[0], [{ id: "new", cardId: "a", at: "2026-10-28T08:00:00Z", rating: "easy" }]), options), /备份之外/);
  assert.throws(() => mergeApprovedDesktopStore(local, store(local.cards[0], [{ ...local.reviews[0], rating: "hard" }]), options), /同一复习记录/);
  assert.throws(() => mergeApprovedDesktopStore(local, store({ ...local.cards[0], lastReviewedAt: "2026-10-28T08:00:00Z" }), options), /更新的复习/);
  assert.throws(() => mergeApprovedDesktopStore(local, store({ ...local.cards[0], expression: "cloud", contentUpdatedAt: "2026-10-28T08:00:00Z" }), { approvedConflictIds: [] }), /新的卡片冲突/);
  assert.throws(() => mergeApprovedDesktopStore(local, local), /先核对/);
});

test("desktop preference does not undo cloud deletions or delete cloud-only items", () => {
  const local = store({ id: "a", expression: "word" });
  assert.throws(() => mergeApprovedDesktopStore(local, { ...emptyPrivateStore(), deletedCards: { a: "2026-10-28T08:00:00Z" } }, { approvedConflictIds: ["a"] }), /删除冲突/);
  assert.throws(() => mergeApprovedDesktopStore({ ...local, deletedCards: { extra: "2026-10-28T08:00:00Z" } }, store({ id: "extra", expression: "extra" }), { approvedConflictIds: [] }), /额外条目/);
});

test("approved migration rechecks a stale cloud revision and stops on new review activity", async context => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const owner = { ...alice, owner: true };
  const local = store({ id: "a", expression: "desktop", contentUpdatedAt: "2026-10-27T08:00:00Z" });
  const changed = await encryptPrivateStore(store({ id: "a", expression: "cloud" }, [{ id: "new", cardId: "a", at: "2026-10-28T08:00:00Z", rating: "good" }]), owner);
  let puts = 0;
  globalThis.fetch = async (url, options) => {
    if (options.method === "PUT") { puts++; return Response.json({}, { status: 409 }); }
    return Response.json(puts ? { revision: 1, document: changed } : { revision: 0, document: null });
  };
  await assert.rejects(() => migrateLocalCollection(owner, local, { preferLocal: true, approvedConflictIds: [] }), /备份之外/);
  assert.equal(puts, 1);
});

test("approved migration includes unsent device extras and encrypts the selected desktop content", async context => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const owner = { ...alice, owner: true }, local = store({ id: "a", expression: "desktop", contentUpdatedAt: "2026-10-27T08:00:00Z" });
  const cloud = store({ id: "a", expression: "cloud", contentUpdatedAt: "2026-10-28T08:00:00Z" });
  const currentStore = { ...cloud, cards: [...cloud.cards, { id: "extra", expression: "unsent extra" }] };
  const document = await encryptPrivateStore(cloud, owner);
  let uploaded;
  globalThis.fetch = async (url, options) => {
    if (options.method !== "PUT") return Response.json({ revision: 3, document });
    const body = JSON.parse(options.body);
    assert.equal(body.baseRevision, 3);
    assert(!options.body.includes("desktop"));
    uploaded = await decryptPrivateStore(body.document, owner);
    return Response.json({ revision: 4 });
  };
  const migrated = await migrateLocalCollection(owner, local, { preferLocal: true, currentStore, approvedConflictIds: ["a"] });
  assert.deepEqual(uploaded, migrated);
  assert.equal(migrated.cards.find(card => card.id === "a").expression, "desktop");
  assert.deepEqual(migrated.cards.find(card => card.id === "extra"), currentStore.cards[1]);
});

test("migration does not upload after the active account changes", async context => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let puts = 0;
  globalThis.fetch = async (url, options) => {
    if (options.method === "PUT") puts++;
    return Response.json({ revision: 0, document: null });
  };
  await assert.rejects(() => migrateLocalCollection({ ...alice, owner: true }, store({ id: "a", expression: "word" }), { canWrite: () => false }), /账户已改变/);
  assert.equal(puts, 0);
});

test("approved replay uses desktop progress and preserves both histories without synthetic events", () => {
  const card = { id: "a", expression: "word", meaning: "manual", contentUpdatedAt: "2026-10-01T08:00:00Z", repetitions: 5, intervalDays: 21, ease: 2.7, lapses: 2, lastReviewedAt: "2026-10-27T08:00:00.000Z" };
  const old = { id: "old", cardId: "a", at: "2026-10-27T08:00:00.000Z", rating: "hard" };
  const recent = { id: "new", cardId: "a", at: "2026-10-28T08:00:00.000Z", rating: "good" };
  const local = store(card, [old]);
  const remote = store({ ...scheduleCard({ ...card, repetitions: 0, intervalDays: 0 }, "good", recent.at), scheduleUpdatedAt: undefined }, [recent]);
  const original = structuredClone({ local, remote });
  assert.deepEqual(desktopConflictIds(local, remote), []);
  const merged = mergeApprovedDesktopStore(local, remote, { approvedConflictIds: [], replayNewReviews: true, now: "2026-10-28T09:00:00.000Z" });
  assert.equal(merged.cards[0].repetitions, 6);
  assert.equal(merged.cards[0].intervalDays, 57);
  assert.equal(merged.cards[0].lapses, 2);
  assert.equal(merged.cards[0].lastReviewedAt, recent.at);
  assert.equal(merged.cards[0].meaning, card.meaning);
  assert.deepEqual(merged.reviews, [old, recent]);
  assert.deepEqual(mergePrivateStores(merged, remote), merged);
  assert.deepEqual({ local, remote }, original);
  const repeated = mergeApprovedDesktopStore(local, merged, { approvedConflictIds: ["a"], replayNewReviews: true });
  assert.equal(repeated.cards[0].repetitions, 6);
  assert.deepEqual(repeated.reviews, merged.reviews);
});

test("replay processes events in time order and retains again queue positions", () => {
  const card = { id: "a", expression: "word", contentUpdatedAt: "2026-10-01T08:00:00Z", repetitions: 4, intervalDays: 21, ease: 2.7, lapses: 2, lastReviewedAt: "2026-10-27T08:00:00Z" };
  const first = { id: "one", cardId: "a", at: "2026-10-28T08:00:00.000Z", rating: "again" };
  const second = { id: "two", cardId: "a", at: "2026-10-28T08:01:00.000Z", rating: "good" };
  const local = store(card);
  const remote = store({ ...card, lastReviewedAt: "2026-10-28T08:00:59.999Z", reviewQueueOrder: undefined }, [second, first]);
  const merged = mergeApprovedDesktopStore(local, remote, { approvedConflictIds: [], replayNewReviews: true });
  assert.equal(merged.cards[0].repetitions, 1);
  assert.equal(merged.cards[0].intervalDays, 1);
  assert.equal(merged.cards[0].ease, 2.5);
  assert.equal(merged.cards[0].lapses, 3);
  assert.equal(Object.hasOwn(merged.cards[0], "reviewQueueOrder"), false);
  const again = store({ ...card, lastReviewedAt: first.at, dueAt: "2026-10-28T07:59:00.000Z", reviewQueueOrder: 11 }, [first]);
  const queued = mergeApprovedDesktopStore(local, again, { approvedConflictIds: [], replayNewReviews: true });
  assert.equal(queued.cards[0].reviewQueueOrder, 11);
  assert.equal(queued.cards[0].dueAt, again.cards[0].dueAt);
});

test("replay refuses uncertain old records or schedules without matching events", () => {
  const local = store({ id: "a", expression: "word", lastReviewedAt: "2026-10-27T08:00:00Z" });
  const options = { approvedConflictIds: [], replayNewReviews: true };
  const oldEvent = { id: "old-unknown", cardId: "a", at: "2026-10-26T08:00:00Z", rating: "good" };
  assert.throws(() => mergeApprovedDesktopStore(local, store(local.cards[0], [oldEvent]), options), /无法可靠重算/);
  const event = { ...oldEvent, at: "2026-10-28T08:00:00Z" };
  assert.throws(() => mergeApprovedDesktopStore(local, store({ ...local.cards[0], lastReviewedAt: "2026-10-28T09:00:00Z" }, [event]), options), /无法对应/);
  assert.throws(() => mergeApprovedDesktopStore(local, store({ ...local.cards[0], lastReviewedAt: event.at }, [{ ...event, rating: "hard" }]), options), /无法可靠重算/);
});

test("corrected schedule versions survive newer content edits from a stale cache", () => {
  const base = { id: "a", expression: "word", lastReviewedAt: "2026-10-28T08:00:00Z", repetitions: 1, intervalDays: 1, contentUpdatedAt: "2026-10-28T08:00:00Z" };
  const fixed = store({ ...base, repetitions: 6, intervalDays: 57, scheduleUpdatedAt: "2026-10-28T09:00:00Z" });
  const edited = store({ ...base, meaning: "later manual edit", contentUpdatedAt: "2026-10-28T10:00:00Z" });
  const merged = mergePrivateStores(fixed, edited);
  assert.equal(merged.cards[0].meaning, "later manual edit");
  assert.equal(merged.cards[0].repetitions, 6);
  assert.equal(merged.cards[0].intervalDays, 57);
  assert.equal(merged.cards[0].scheduleUpdatedAt, fixed.cards[0].scheduleUpdatedAt);
  const next = store(scheduleCard(merged.cards[0], "good", "2026-10-29T08:00:00Z"));
  assert.deepEqual(mergePrivateStores(fixed, next), next);
});

test("approved replay retries concurrent review activity using the latest cloud revision", async context => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const owner = { ...alice, owner: true };
  const card = { id: "a", expression: "word", repetitions: 4, intervalDays: 10, ease: 2.5, contentUpdatedAt: "2026-10-01T08:00:00Z", lastReviewedAt: "2026-10-27T08:00:00Z" };
  const first = { id: "one", cardId: "a", at: "2026-10-28T08:00:00.000Z", rating: "good" };
  const second = { id: "two", cardId: "a", at: "2026-10-28T08:01:00.000Z", rating: "easy" };
  const cloud = [first, second].map((review, index) => store({ ...card, lastReviewedAt: review.at }, [first, second].slice(0, index + 1)));
  let puts = 0, uploaded;
  globalThis.fetch = async (url, options) => {
    if (options.method !== "PUT") return Response.json({ revision: puts, document: await encryptPrivateStore(cloud[Math.min(puts, 1)], owner) });
    puts++;
    if (puts === 1) return Response.json({}, { status: 409 });
    const body = JSON.parse(options.body);
    assert.equal(body.baseRevision, 1);
    uploaded = await decryptPrivateStore(body.document, owner);
    return Response.json({ revision: 2 });
  };
  const merged = await migrateLocalCollection(owner, store(card), { preferLocal: true, approvedConflictIds: [], replayNewReviews: true });
  assert.equal(puts, 2);
  assert.deepEqual(merged.reviews, [first, second]);
  assert.equal(merged.cards[0].repetitions, 6);
  assert.deepEqual(uploaded, merged);
});
