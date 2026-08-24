export function compareReviewQueueCards(a, b) {
  return (
    new Date(a.dueAt) - new Date(b.dueAt) ||
    (a.reviewQueueOrder || 0) - (b.reviewQueueOrder || 0)
  );
}

export function moveCardToReviewQueueEnd(card, dueCards, reviewNow) {
  const lastQueueOrder = Math.max(
    0,
    ...(dueCards || []).map((item) => item.reviewQueueOrder || 0),
  );
  return {
    ...card,
    dueAt: new Date(reviewNow).toISOString(),
    reviewQueueOrder: lastQueueOrder + 1,
  };
}
