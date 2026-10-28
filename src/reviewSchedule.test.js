import assert from "node:assert/strict";
import test from "node:test";
import { scheduleCard } from "./reviewSchedule.js";

const at = "2026-10-28T09:00:00.000Z";

test("good retains the existing first, second and later interval rules", () => {
  assert.equal(scheduleCard({}, "good", at).intervalDays, 1);
  assert.equal(scheduleCard({ repetitions: 1, intervalDays: 1 }, "good", at).intervalDays, 3);
  const later = scheduleCard({ repetitions: 5, intervalDays: 21, ease: 2.7 }, "good", at);
  assert.equal(later.repetitions, 6);
  assert.equal(later.intervalDays, 57);
  assert.equal(later.dueAt, "2026-12-24T09:00:00.000Z");
});

test("easy retains the existing interval and ease bounds", () => {
  assert.equal(scheduleCard({}, "easy", at).intervalDays, 4);
  const later = scheduleCard({ repetitions: 3, intervalDays: 20, ease: 3.15 }, "easy", at);
  assert.equal(later.ease, 3.2);
  assert.equal(later.intervalDays, 80);
});

test("again retains lapse history and only resets the existing learning step", () => {
  const card = { id: "a", meaning: "manual", repetitions: 5, intervalDays: 20, ease: 1.4, lapses: 3 };
  const next = scheduleCard(card, "again", at);
  assert.equal(next.repetitions, 0);
  assert.equal(next.intervalDays, 0);
  assert.equal(next.ease, 1.3);
  assert.equal(next.lapses, 4);
  assert.equal(next.dueAt, at);
  assert.equal(next.meaning, card.meaning);
  assert.equal(card.repetitions, 5);
});

test("review timestamps are reproducible without replacing content versions", () => {
  const next = scheduleCard({ contentUpdatedAt: "2026-10-01T08:00:00Z" }, "good", at);
  assert.equal(next.lastReviewedAt, at);
  assert.equal(next.scheduleUpdatedAt, at);
  assert.equal(next.updatedAt, at);
  assert.equal(next.contentUpdatedAt, "2026-10-01T08:00:00Z");
  assert.throws(() => scheduleCard({}, "hard", at), /Unsupported/);
  assert.throws(() => scheduleCard({}, "good", "invalid"), /Invalid/);
});
