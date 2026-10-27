import assert from "node:assert/strict";
import test from "node:test";
import { createDailyPlan } from "./dailyPlan.js";
import { createPracticeTracks, isExpressionPracticeCard, normalizePracticeExpression } from "./practiceTracks.js";
import { emptyPrivateStore, mergePrivateStores } from "./accountSync.js";
import { moveCardToReviewQueueEnd } from "./reviewQueue.js";

const now = new Date(2026, 9, 27, 12);
const dueAt = new Date(2026, 9, 26, 8).toISOString();
const tomorrow = new Date(2026, 9, 28, 8).toISOString();
const makeCards = (count, practiceType = "vocabulary") => Array.from({ length: count }, (_, index) => ({
  id: `${practiceType}-${index}`, expression: `${practiceType} ${index}`, practiceType,
  status: "active", dueAt, intervalDays: 0, repetitions: 0, ease: 2.5, lapses: 0,
}));
const review = card => ({ id: `review-${card.id}`, cardId: card.id, at: now.toISOString(), rating: "good" });

test("legacy cards remain vocabulary; tags do not silently migrate existing words", () => {
  assert.equal(isExpressionPracticeCard({ expression: "phrase", tags: ["生活口语"] }), false);
  assert.equal(isExpressionPracticeCard({ practiceType: "expression" }), true);
  const card = { id: "old", expression: "old", dueAt, tags: ["生活口语"] };
  const tracks = createPracticeTracks([card], [], now);
  assert.equal(tracks.words[0], card);
  assert.equal(tracks.expressions.length, 0);
});

test("30 words and 10 expressions receive independent queues and forecasts without mutation", () => {
  const words = makeCards(65), expressions = makeCards(25, "expression");
  const cards = [...words, ...expressions];
  const before = structuredClone(cards);
  const tracks = createPracticeTracks(cards, [], now);
  assert.deepEqual(tracks.wordPlan, createDailyPlan(words, [], now));
  assert.equal(tracks.wordPlan.queue.length, 30);
  assert.equal(tracks.expressionPlan.queue.length, 10);
  assert.deepEqual(tracks.wordPlan.futureDays.map(day => day.count), [30, 5]);
  assert.deepEqual(tracks.expressionPlan.futureDays.map(day => day.count), [10, 5]);
  assert.deepEqual(cards, before);
});

test("completing all ten expressions does not consume a vocabulary slot", () => {
  const words = makeCards(40), expressions = makeCards(15, "expression");
  const reviews = expressions.slice(0, 10).map(review);
  expressions.slice(0, 10).forEach(card => { card.dueAt = tomorrow; card.lastReviewedAt = now.toISOString(); });
  const tracks = createPracticeTracks([...words, ...expressions], reviews, now);
  assert.equal(tracks.expressionPlan.reviewedCount, 10);
  assert.equal(tracks.expressionPlan.queue.length, 0);
  assert.equal(tracks.wordPlan.reviewedCount, 0);
  assert.deepEqual(tracks.wordPlan, createDailyPlan(words, [], now));
});

test("finishing thirty words leaves all ten expression slots available", () => {
  const words = makeCards(40), expressions = makeCards(15, "expression");
  const reviews = words.slice(0, 30).map(review);
  words.slice(0, 30).forEach(card => { card.dueAt = tomorrow; });
  const tracks = createPracticeTracks([...words, ...expressions], reviews, now);
  assert.equal(tracks.wordPlan.reviewedCount, 30);
  assert.equal(tracks.wordPlan.queue.length, 0);
  assert.equal(tracks.expressionPlan.reviewedCount, 0);
  assert.equal(tracks.expressionPlan.queue.length, 10);
});

test("forgotten expressions move only inside the expression queue and repeated attempts share a slot", () => {
  const words = makeCards(35), expressions = makeCards(12, "expression");
  const initial = createPracticeTracks([...words, ...expressions], [], now);
  expressions[0] = moveCardToReviewQueueEnd(expressions[0], initial.expressionPlan.queue, now);
  const first = { ...review(expressions[0]), rating: "again" };
  const tracks = createPracticeTracks([...words, ...expressions], [first, { ...first, id: "repeat" }], now);
  assert.equal(tracks.expressionPlan.reviewedCount, 1);
  assert.equal(tracks.expressionPlan.queue.at(-1).id, expressions[0].id);
  assert.equal(tracks.expressionPlan.queue.length, 10);
  assert.deepEqual(tracks.wordPlan, initial.wordPlan);
});

test("backup round-trips and private merges retain track identity and independent progress", () => {
  const words = makeCards(35), expressions = makeCards(12, "expression");
  expressions[0].dueAt = tomorrow;
  expressions[0].lastReviewedAt = now.toISOString();
  const store = { ...emptyPrivateStore(), cards: [...words, ...expressions], reviews: [review(expressions[0])] };
  const restored = JSON.parse(JSON.stringify(store));
  const merged = mergePrivateStores(restored, emptyPrivateStore());
  const tracks = createPracticeTracks(merged.cards, merged.reviews, now);
  assert.equal(tracks.expressions.length, 12);
  assert.equal(tracks.expressionPlan.reviewedCount, 1);
  assert.equal(tracks.wordPlan.reviewedCount, 0);
  assert.deepEqual(merged.reviews, store.reviews);
  for (const card of store.cards) assert.deepEqual(merged.cards.find(other => other.id === card.id), card);
});

test("drafts and unrecognised review IDs cannot change either allowance", () => {
  const cards = [...makeCards(35), ...makeCards(12, "expression"), { id: "draft", status: "draft", dueAt, practiceType: "expression" }];
  const tracks = createPracticeTracks(cards, [review({ id: "draft" }), review({ id: "missing" })], now);
  assert.equal(tracks.expressions.length, 12);
  assert.equal(tracks.wordPlan.reviewedCount, 0);
  assert.equal(tracks.expressionPlan.reviewedCount, 0);
});

test("expression duplicate keys ignore formatting but preserve meaning-bearing punctuation", () => {
  assert.equal(normalizePracticeExpression("  Thanks,  that’s really helpful! "), normalizePracticeExpression("thanks, that's really helpful."));
  assert.equal(normalizePracticeExpression("How do I get there?"), normalizePracticeExpression("HOW DO I GET THERE"));
  assert.notEqual(normalizePracticeExpression("Let's eat, Grandma"), normalizePracticeExpression("Let's eat Grandma"));
});

test("invalid limits cannot create an endless daily forecast", () => {
  for (const limit of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => createDailyPlan(makeCards(2), [], now, limit), RangeError);
});
