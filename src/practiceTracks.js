import { createDailyPlan } from "./dailyPlan.js";

export const DAILY_EXPRESSION_LIMIT = 10;

export function isExpressionPracticeCard(card) {
  return card.practiceType === "expression";
}

export function normalizePracticeExpression(value) {
  return String(value || "").normalize("NFKC").replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"').trim().replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "").toLowerCase();
}

export function createPracticeTracks(cards, reviews, now = Date.now()) {
  const active = cards.filter(card => card.status !== "draft");
  const words = active.filter(card => !isExpressionPracticeCard(card));
  const expressions = active.filter(isExpressionPracticeCard);
  const wordIds = new Set(words.map(card => card.id));
  const expressionIds = new Set(expressions.map(card => card.id));
  const wordReviews = reviews.filter(review => wordIds.has(review.cardId));
  const expressionReviews = reviews.filter(review => expressionIds.has(review.cardId));
  return {
    words, expressions, wordReviews, expressionReviews,
    wordPlan: createDailyPlan(words, wordReviews, now),
    expressionPlan: createDailyPlan(expressions, expressionReviews, now, DAILY_EXPRESSION_LIMIT),
  };
}
