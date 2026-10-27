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

export function createDailyPlan(cards, reviews, now = Date.now(), limit = DAILY_WORD_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Daily limit must be a positive integer");
  const nowMs = new Date(now).getTime();
  const today = dateKey(now);
  const sorted = [...cards].filter((card) => Number.isFinite(new Date(card.dueAt).getTime())).sort(compareReviewQueueCards);
  const reviewedIds = new Set((reviews || []).filter((review) => dateKey(review.at) === today).map((review) => review.cardId));
  const learnedIds = new Set((reviews || []).filter((review) => review.at && new Date(review.at).getTime() <= nowMs).map((review) => review.cardId));
  for (const card of sorted) {
    if (card.lastReviewedAt && dateKey(card.lastReviewedAt) === today) reviewedIds.add(card.id);
    if ((card.lastReviewedAt && new Date(card.lastReviewedAt).getTime() <= nowMs) || card.repetitions > 0 || card.intervalDays > 0 || card.lapses > 0) {
      learnedIds.add(card.id);
    }
  }
  const comparePriority = (a, b) => Number(learnedIds.has(b.id)) - Number(learnedIds.has(a.id)) || compareReviewQueueCards(a, b);
  const due = sorted.filter((card) => new Date(card.dueAt).getTime() <= nowMs);
  const available = Math.max(0, limit - reviewedIds.size);
  const tomorrow = nextDay(startOfDay(now));
  const todayCards = sorted.filter((card) => new Date(card.dueAt) < tomorrow);
  // Reserve slots for learned words due later today, without reviewing them early.
  const admittedCards = todayCards.filter((card) => !reviewedIds.has(card.id)).sort(comparePriority).slice(0, available);
  // Repeated attempts use the same daily slot, even after moving a forgotten word to the queue's end.
  const queue = [...admittedCards.filter((card) => new Date(card.dueAt).getTime() <= nowMs), ...due.filter((card) => reviewedIds.has(card.id))].slice(0, limit);
  const queuedIds = new Set(queue.map((card) => card.id));
  const scheduledAt = new Map([...admittedCards, ...todayCards.filter((card) => reviewedIds.has(card.id))].map((card) => [card.id, card.dueAt]));
  const futureDays = [];

  let pending = sorted.filter((card) => !scheduledAt.has(card.id));
  let day = tomorrow;
  while (pending.length) {
    const firstDueDay = startOfDay(pending[0].dueAt);
    if (firstDueDay > day) day = firstDueDay;
    const followingDay = nextDay(day);
    // Apply review priority only among words due by this day, not across future due dates.
    const dailyCards = pending.filter((card) => new Date(card.dueAt) < followingDay).sort(comparePriority).slice(0, limit);
    const dailyIds = new Set(dailyCards.map((card) => card.id));
    for (const card of dailyCards) {
      scheduledAt.set(card.id, new Date(Math.max(day.getTime(), new Date(card.dueAt).getTime())).toISOString());
    }
    futureDays.push({ date: dateKey(day), at: day.toISOString(), count: dailyCards.length });
    pending = pending.filter((card) => !dailyIds.has(card.id));
    day = followingDay;
  }

  return { queue, queuedIds, scheduledAt, futureDays, reviewedCount: reviewedIds.size, deferredCount: due.length - queue.length, limit };
}
