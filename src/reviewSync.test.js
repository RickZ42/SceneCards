import assert from "node:assert/strict";
import test from "node:test";

import {
  applyReviewDocument,
  createReviewDocument,
  mergeReviewDocuments,
  syncReviewProgress,
} from "./reviewSync.js";

function card(overrides = {}) {
  return {
    id: "card-1",
    expression: "nevertheless",
    meaning: "尽管如此",
    dueAt: "2026-08-27T08:00:00.000Z",
    intervalDays: 1,
    ease: 2.5,
    repetitions: 1,
    lapses: 0,
    lastReviewedAt: "2026-08-26T08:00:00.000Z",
    ...overrides,
  };
}

function review(id, at, rating = "good") {
  return { id, cardId: "card-1", rating, at };
}

test("review documents contain scheduling data but no card content", () => {
  const document = createReviewDocument({
    cards: [card()],
    reviews: [review("review-1", "2026-08-26T08:00:00.000Z")],
  });

  assert.equal(document.cardStates["card-1"].intervalDays, 1);
  assert.equal(document.cardStates["card-1"].lastReviewId, "review-1");
  assert.equal(JSON.stringify(document).includes("nevertheless"), false);
  assert.equal(JSON.stringify(document).includes("尽管如此"), false);
});

test("merging keeps both histories and the newest card schedule", () => {
  const local = createReviewDocument({
    cards: [card()],
    reviews: [review("review-1", "2026-08-26T08:00:00.000Z")],
  });
  const remote = createReviewDocument({
    cards: [card({
      dueAt: "2026-09-03T09:00:00.000Z",
      intervalDays: 7,
      repetitions: 2,
      lastReviewedAt: "2026-08-27T09:00:00.000Z",
    })],
    reviews: [review("review-2", "2026-08-27T09:00:00.000Z", "easy")],
  });

  const merged = mergeReviewDocuments(local, remote);
  assert.deepEqual(merged.reviews.map((item) => item.id), ["review-1", "review-2"]);
  assert.equal(merged.cardStates["card-1"].intervalDays, 7);
  assert.equal(merged.cardStates["card-1"].lastReviewId, "review-2");
});

test("applying remote progress preserves local card content and queue order", () => {
  const localStore = {
    cards: [card()],
    reviews: [review("review-1", "2026-08-26T08:00:00.000Z")],
  };
  const remote = createReviewDocument({
    cards: [card({
      expression: "remote content must not win",
      meaning: "remote meaning",
      dueAt: "2026-08-27T09:00:00.000Z",
      intervalDays: 0,
      repetitions: 0,
      lapses: 1,
      reviewQueueOrder: 42,
      lastReviewedAt: "2026-08-27T08:30:00.000Z",
    })],
    reviews: [review("review-2", "2026-08-27T08:30:00.000Z", "again")],
  });

  const applied = applyReviewDocument(localStore, remote);
  assert.equal(applied.cards[0].expression, "nevertheless");
  assert.equal(applied.cards[0].meaning, "尽管如此");
  assert.equal(applied.cards[0].reviewQueueOrder, 42);
  assert.equal(applied.cards[0].lapses, 1);
  assert.deepEqual(applied.reviews.map((item) => item.id), ["review-1", "review-2"]);
});

test("GitHub payload is encrypted and can be read back with the same password", async () => {
  const originalFetch = globalThis.fetch;
  let encryptedContent = "";
  let putCount = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (!options.method) {
      if (!encryptedContent) return new Response("", { status: 404 });
      return Response.json({ sha: "encrypted-sha", content: encryptedContent });
    }
    putCount += 1;
    encryptedContent = JSON.parse(options.body).content;
    return Response.json({ ok: true }, { status: 201 });
  };

  try {
    const store = {
      cards: [card()],
      reviews: [review("review-1", "2026-08-26T08:00:00.000Z")],
    };
    const first = await syncReviewProgress({
      store,
      token: "test-token",
      passphrase: "shared-test-password",
    });
    const encryptedJson = Buffer.from(encryptedContent, "base64").toString("utf8");
    assert.equal(first.pushed, true);
    assert.equal(putCount, 1);
    assert.equal(encryptedJson.includes("nevertheless"), false);
    assert.equal(encryptedJson.includes("card-1"), false);

    const second = await syncReviewProgress({
      store,
      token: "test-token",
      passphrase: "shared-test-password",
    });
    assert.equal(second.pushed, false);
    assert.equal(putCount, 1);
    assert.equal(second.document.cardStates["card-1"].intervalDays, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
