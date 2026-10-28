const DAY_MS = 24 * 60 * 60 * 1000;

export function scheduleCard(card, rating, at = new Date()) {
  if (!["again", "good", "easy"].includes(rating)) throw new Error("Unsupported review rating");
  const now = new Date(at);
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid review time");
  let repetitions = card.repetitions || 0;
  let intervalDays = card.intervalDays || 0;
  let ease = card.ease || 2.5;
  let lapses = card.lapses || 0;
  let dueAt;

  if (rating === "again") {
    repetitions = 0;
    intervalDays = 0;
    ease = Math.max(1.3, ease - 0.2);
    lapses += 1;
    dueAt = now;
  } else if (rating === "good") {
    repetitions += 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 3;
    else intervalDays = Math.max(4, Math.round(intervalDays * ease));
    dueAt = new Date(now.getTime() + intervalDays * DAY_MS);
  } else {
    repetitions += 1;
    ease = Math.min(3.2, ease + 0.15);
    intervalDays = repetitions === 1
      ? 4
      : Math.max(7, Math.round((intervalDays || 3) * ease * 1.25));
    dueAt = new Date(now.getTime() + intervalDays * DAY_MS);
  }

  return {
    ...card,
    repetitions,
    contentUpdatedAt: card.contentUpdatedAt || card.updatedAt || card.createdAt,
    intervalDays,
    ease,
    lapses,
    dueAt: dueAt.toISOString(),
    lastReviewedAt: now.toISOString(),
    scheduleUpdatedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
