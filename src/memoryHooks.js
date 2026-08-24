import { getCuratedMemoryHook } from "./curatedMemoryHooks.js";

export const MEMORY_REVIEW_THRESHOLD = 3;

function compactText(value, maxLength) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/[，,；;：:\s]+$/u, "")}……`;
}

function asSentenceFragment(value) {
  return value.replace(/[。.!?！？]+$/u, "");
}

function getMorphologyClue(expression) {
  const key = String(expression || "").trim().toLocaleLowerCase();
  if (/^[a-z][a-z'-]+ly$/i.test(key) && !/(early|friendly|likely|lovely)$/i.test(key)) {
    return "先把 -ly 暂时拿掉，找到它修饰的动作，再恢复成‘以这种方式做’。";
  }
  if (/^[a-z][a-z'-]+(tion|sion)$/i.test(key)) {
    return "-tion / -sion 常把动作变成过程或结果；先寻找它背后的动词。";
  }
  if (/^[a-z][a-z'-]+less$/i.test(key)) {
    return "-less 通常表示缺少前半部分；想象把那样东西从场景中拿走。";
  }
  if (/^[a-z][a-z'-]+able$/i.test(key)) {
    return "-able 通常表示‘能够……的’；先把它还原成对应动作。";
  }
  return "";
}

function expressionSeed(expression) {
  return [...expression].reduce(
    (seed, character) => (seed * 31 + character.codePointAt(0)) >>> 0,
    0,
  );
}

function createFallbackMemoryHook(expression, meaning, scene) {
  const morphology = getMorphologyClue(expression);
  if (morphology) {
    return `词形路线：${morphology} 然后放回这个场景检验：${scene || meaning}。`;
  }

  if (/\s/.test(expression)) {
    return `整块提取：不要逐词翻译 ${expression}。先回想“${scene || meaning}”，再一次说出完整短语。`;
  }

  const strategies = [
    () => `一秒镜头：${scene || meaning}。画面出现时，只给它贴一个英文标签：${expression}。`,
    () => `反向测试：遮住英文，只看“${meaning || scene}”，先说出 ${expression}，再用例句检查。`,
    () => `动作定格：把“${scene || meaning}”停在最关键的一帧；这一帧的口令就是 ${expression}。`,
    () => `单义入口：这次只用“${meaning || scene}”唤回 ${expression}，其他义项留到真正遇见时再扩展。`,
  ];
  return strategies[expressionSeed(expression) % strategies.length]();
}

export function createAutomaticMemoryHook(card) {
  const expression = compactText(card?.expression, 36);
  const meaning = asSentenceFragment(compactText(card?.meaning, 76));
  const scene = asSentenceFragment(
    compactText(card?.exampleMeaning || card?.sceneContext || card?.personalExample, 88),
  );
  if (!expression || (!meaning && !scene)) return "";

  const curated = getCuratedMemoryHook(expression);
  if (curated) return curated;
  return createFallbackMemoryHook(expression, meaning, scene);
}

export function enrichCardsWithAutomaticMemoryHooks(
  cards,
  reviews,
  threshold = MEMORY_REVIEW_THRESHOLD,
) {
  const reviewCounts = new Map();
  for (const review of reviews || []) {
    if (!review?.cardId) continue;
    reviewCounts.set(review.cardId, (reviewCounts.get(review.cardId) || 0) + 1);
  }

  return (cards || []).map((card) => {
    if ((card.memoryHook || "").trim()) return card;
    const reviewCount = reviewCounts.get(card.id) || 0;
    if (reviewCount < threshold) return card;
    const memoryHook = createAutomaticMemoryHook(card);
    if (!memoryHook) return card;
    return {
      ...card,
      memoryHook,
      memoryHookSource: "automatic",
      memoryHookReviewCount: reviewCount,
    };
  });
}
