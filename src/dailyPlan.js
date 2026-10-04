import { compareReviewQueueCards } from "./reviewQueue.js";

export const DAILY_WORD_LIMIT = 30;

function dateKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function nextDay(value) {
  const date = new Date(value);
  date.setDate(date.getDate() + 1);
  return date;
}

export function createDailyPlan(cards, reviews, now = Date.now()) {
  const today = dateKey(now);
  const sorted = [...cards].filter((card) => Number.isFinite(new Date(card.dueAt).getTime())).sort(compareReviewQueueCards);
  const reviewedIds = new Set((reviews || []).filter((review) => dateKey(review.at) === today).map((review) => review.cardId));
  for (const card of sorted) {
    if (card.lastReviewedAt && dateKey(card.lastReviewedAt) === today) reviewedIds.add(card.id);
  }
  const due = sorted.filter((card) => new Date(card.dueAt).getTime() <= new Date(now).getTime());
  const available = Math.max(0, DAILY_WORD_LIMIT - reviewedIds.size);
  const newCards = due.filter((card) => !reviewedIds.has(card.id)).slice(0, available);
  const admittedIds = new Set(newCards.map((card) => card.id));
  // Repeated attempts use the same daily slot, even after moving a forgotten word to the queue's end.
  const queue = due.filter((card) => reviewedIds.has(card.id) || admittedIds.has(card.id)).slice(0, DAILY_WORD_LIMIT);
  const queuedIds = new Set(queue.map((card) => card.id));
  const scheduledAt = new Map(queue.map((card) => [card.id, card.dueAt]));
  const futureDays = [];
  let laterTodaySlots = available - newCards.length;
  let day = nextDay(startOfDay(now));
  let dayCount = 0;

  for (const card of sorted) {
    if (queuedIds.has(card.id)) continue;
    const dueDay = startOfDay(card.dueAt);
    if (dateKey(dueDay) === today && new Date(card.dueAt) > new Date(now) && (reviewedIds.has(card.id) || laterTodaySlots > 0)) {
      scheduledAt.set(card.id, card.dueAt);
      if (!reviewedIds.has(card.id)) laterTodaySlots--;
      continue;
    }
    if (dueDay > day) { day = dueDay; dayCount = 0; }
    if (dayCount === DAILY_WORD_LIMIT) { day = nextDay(day); dayCount = 0; }
    const at = new Date(Math.max(day.getTime(), new Date(card.dueAt).getTime())).toISOString();
    scheduledAt.set(card.id, at);
    const key = dateKey(day);
    if (futureDays.at(-1)?.date !== key) futureDays.push({ date: key, at: day.toISOString(), count: 0 });
    futureDays.at(-1).count++;
    dayCount++;
  }

  return { queue, queuedIds, scheduledAt, futureDays, reviewedCount: reviewedIds.size, deferredCount: due.length - queue.length, limit: DAILY_WORD_LIMIT };
}
