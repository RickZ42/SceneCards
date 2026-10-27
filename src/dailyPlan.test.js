import assert from "node:assert/strict";
import test from "node:test";
import { createDailyPlan } from "./dailyPlan.js";
import { mergePrivateStores, emptyPrivateStore } from "./accountSync.js";
import { moveCardToReviewQueueEnd } from "./reviewQueue.js";

const now = new Date(2026, 9, 5, 12);
const iso = (day, hour = 8) => new Date(2026, 9, day, hour).toISOString();
const cards = (count) => Array.from({ length: count }, (_, index) => ({ id: `word-${index + 1}`, expression: `word-${index + 1}`, dueAt: new Date(new Date(iso(4)).getTime() + index).toISOString(), intervalDays: 0 }));
const review = (id, at = now.toISOString()) => ({ id: `review-${id}`, cardId: id, at, rating: "good" });

test("95 due words keep the first 30 and distribute the rest across later calendar days without changing schedules", () => {
  const source = cards(95);
  const original = structuredClone(source);
  const plan = createDailyPlan(source, [], now);
  assert.deepEqual(plan.queue.map((card) => card.id), source.slice(0, 30).map((card) => card.id));
  assert.equal(plan.deferredCount, 65);
  assert.deepEqual(plan.futureDays.map((day) => day.count), [30, 30, 5]);
  assert.deepEqual(plan.futureDays.map((day) => day.date), ["2026-10-06", "2026-10-07", "2026-10-08"]);
  assert.deepEqual(source, original);
});

test("completed words consume today's allowance so reviewing one does not admit word 31", () => {
  const source = cards(60);
  source[0].dueAt = iso(6);
  const plan = createDailyPlan(source, [review("word-1")], now);
  assert.equal(plan.reviewedCount, 1);
  assert.equal(plan.queue.length, 29);
  assert.equal(plan.queue.at(-1).id, "word-30");
  assert.equal(plan.queuedIds.has("word-31"), false);
});

test("forgotten words remain in today's queue at the end and repeated attempts consume one slot", () => {
  const source = cards(60);
  source[0] = moveCardToReviewQueueEnd(source[0], source.slice(0, 30), now);
  const first = review("word-1");
  const plan = createDailyPlan(source, [first, { ...first, id: "repeat", rating: "again" }], now);
  assert.equal(plan.reviewedCount, 1);
  assert.equal(plan.queue.length, 30);
  assert.equal(plan.queue[0].id, "word-2");
  assert.equal(plan.queue.at(-1).id, "word-1");
  assert.equal(plan.queuedIds.has("word-31"), false);
});

test("refreshing after 30 different words leaves today complete; the allowance resets the next day", () => {
  const source = cards(95);
  const reviews = source.slice(0, 30).map((card) => review(card.id));
  for (const card of source.slice(0, 30)) card.dueAt = iso(6);
  assert.equal(createDailyPlan(source, reviews, now).queue.length, 0);
  assert.equal(createDailyPlan(source, reviews, new Date(2026, 9, 6, 12)).queue[0].id, "word-1");
  assert.equal(createDailyPlan(source, reviews, new Date(2026, 9, 6, 12)).queue.length, 30);
});

test("due words studied yesterday take priority over an older unstudied backlog", () => {
  const source = cards(60);
  source[40].dueAt = iso(5);
  const reviews = [review("word-41", iso(4))];
  const original = structuredClone({ source, reviews });
  const plan = createDailyPlan(source, reviews, now);
  assert.deepEqual(plan.queue.map((card) => card.id), ["word-41", ...source.slice(0, 29).map((card) => card.id)]);
  assert.equal(plan.queuedIds.has("word-30"), false);
  assert.equal(plan.deferredCount, 30);
  assert.deepEqual({ source, reviews }, original);
});

test("imported and lapsed words remain learned even without review events or successful repetitions", () => {
  const source = cards(40);
  source[31].lastReviewedAt = iso(3);
  source[32].lapses = 1;
  source[33].intervalDays = 3;
  source[34].repetitions = 1;
  source[35].lastReviewedAt = "invalid";
  const plan = createDailyPlan(source, [], now);
  assert.deepEqual(plan.queue.slice(0, 4).map((card) => card.id), ["word-32", "word-33", "word-34", "word-35"]);
  assert.equal(plan.queuedIds.has("word-36"), false);
  assert.equal(plan.queue.length, 30);
});

test("more than 30 due learned words defer new words and preserve due order within the learned group", () => {
  const source = cards(70);
  for (const card of source.slice(35)) card.lastReviewedAt = iso(3);
  const plan = createDailyPlan(source, [], now);
  assert.deepEqual(plan.queue.map((card) => card.id), source.slice(35, 65).map((card) => card.id));
  assert.equal(plan.futureDays[0].count, 30);
});

test("a forgotten learned word stays behind today's remaining new words, including after repeated attempts", () => {
  const source = cards(60);
  source[40].lastReviewedAt = iso(4);
  source[40].dueAt = iso(5);
  const firstPlan = createDailyPlan(source, [], now);
  assert.equal(firstPlan.queue[0].id, "word-41");
  source[40] = moveCardToReviewQueueEnd(source[40], firstPlan.queue, now);
  const first = { ...review("word-41"), rating: "again" };
  let plan = createDailyPlan(source, [first], now);
  assert.equal(plan.queue[0].id, "word-1");
  assert.equal(plan.queue.at(-1).id, "word-41");
  assert.equal(plan.queuedIds.has("word-30"), false);
  const later = new Date(now.getTime() + 60_000);
  source[40] = moveCardToReviewQueueEnd(source[40], plan.queue, later);
  plan = createDailyPlan(source, [first, { ...first, id: "repeat", at: later.toISOString() }], later);
  assert.equal(plan.reviewedCount, 1);
  assert.equal(plan.queue.length, 30);
  assert.equal(plan.queue.at(-1).id, "word-41");
});

test("future forecasts prioritise learned words only once their due calendar day arrives", () => {
  const source = cards(91);
  source[90].lastReviewedAt = iso(3);
  source[90].dueAt = iso(7, 16);
  const plan = createDailyPlan(source, [], now);
  assert.equal(plan.scheduledAt.get("word-31"), iso(6, 0));
  assert.equal(plan.scheduledAt.get("word-60"), iso(6, 0));
  assert.equal(plan.scheduledAt.get("word-91"), iso(7, 16));
  assert.equal(plan.scheduledAt.get("word-89"), iso(7, 0));
  assert.equal(plan.scheduledAt.get("word-90"), iso(8, 0));
  assert.deepEqual(plan.futureDays.map((day) => day.count), [30, 30, 1]);
});

test("later-today learned words take priority for remaining forecast slots without being pulled into the current queue", () => {
  const source = cards(45);
  for (const card of source.slice(5)) card.dueAt = iso(5, 16);
  source[44].lastReviewedAt = iso(3);
  source[44].dueAt = iso(5, 18);
  const plan = createDailyPlan(source, [], now);
  assert.equal(plan.queue.length, 5);
  assert.equal(plan.queuedIds.has("word-45"), false);
  assert.equal(plan.scheduledAt.get("word-45"), iso(5, 18));
  assert.equal(plan.scheduledAt.get("word-29"), iso(5, 16));
  assert.equal(plan.scheduledAt.get("word-30"), iso(6, 0));
});

test("new words cannot consume slots reserved for learned words due later today", () => {
  const source = cards(60);
  source[40].lastReviewedAt = iso(4, 18);
  source[40].dueAt = iso(5, 18);
  let plan = createDailyPlan(source, [], now);
  assert.equal(plan.queue.length, 29);
  assert.equal(plan.queuedIds.has("word-41"), false);
  assert.equal(plan.queuedIds.has("word-30"), false);
  assert.equal(plan.scheduledAt.get("word-41"), iso(5, 18));
  const reviews = source.slice(0, 29).map((card) => review(card.id));
  for (const card of source.slice(0, 29)) card.dueAt = iso(6);
  plan = createDailyPlan(source, reviews, now);
  assert.equal(plan.queue.length, 0);
  assert.equal(plan.scheduledAt.get("word-41"), iso(5, 18));
  plan = createDailyPlan(source, reviews, new Date(iso(5, 18)));
  assert.deepEqual(plan.queue.map((card) => card.id), ["word-41"]);
  assert.equal(plan.reviewedCount, 29);
});

test("imported last-reviewed timestamps count even when individual review events are absent", () => {
  const source = cards(40);
  for (const card of source.slice(0, 30)) { card.lastReviewedAt = now.toISOString(); card.dueAt = iso(6); }
  const plan = createDailyPlan(source, [], now);
  assert.equal(plan.reviewedCount, 30);
  assert.equal(plan.queue.length, 0);
  assert.equal(plan.deferredCount, 10);
});

test("later-today cards keep available slots, while future due dates are never pulled forward", () => {
  const source = cards(45);
  for (const card of source.slice(5)) card.dueAt = iso(5, 16);
  const plan = createDailyPlan(source, [], now);
  assert.equal(plan.queue.length, 5);
  assert.equal(plan.scheduledAt.get("word-30"), iso(5, 16));
  assert.equal(plan.futureDays[0].count, 15);
  const future = createDailyPlan([{ id: "later", dueAt: iso(20) }], [], now);
  assert.equal(future.queue.length, 0);
  assert.equal(future.scheduledAt.get("later"), iso(20));
});

test("account-synchronised review history gives both devices the same remaining daily allowance", () => {
  const source = cards(60);
  const computer = { ...emptyPrivateStore(), cards: source, reviews: source.slice(0, 17).map((card) => review(card.id)) };
  const phone = { ...emptyPrivateStore(), cards: source, reviews: source.slice(17, 30).map((card) => review(card.id)) };
  for (const card of source.slice(0, 30)) { card.dueAt = iso(6); card.lastReviewedAt = now.toISOString(); }
  const left = createDailyPlan(mergePrivateStores(computer, phone).cards, mergePrivateStores(computer, phone).reviews, now);
  const right = createDailyPlan(mergePrivateStores(phone, computer).cards, mergePrivateStores(phone, computer).reviews, now);
  assert.equal(left.queue.length, 0);
  assert.equal(right.queue.length, 0);
  assert.equal(left.reviewedCount, 30);
  assert.deepEqual(left.futureDays, right.futureDays);
});

test("calendar-day rollover handles a daylight-saving change rather than adding fixed 24-hour periods", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/London";
  try {
    const plan = createDailyPlan(cards(95), [], new Date(2026, 9, 24, 12));
    assert.deepEqual(plan.futureDays.map((day) => day.date), ["2026-10-25", "2026-10-26", "2026-10-27"]);
    assert.equal(new Date(plan.futureDays[1].at) - new Date(plan.futureDays[0].at), 25 * 60 * 60 * 1000);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
