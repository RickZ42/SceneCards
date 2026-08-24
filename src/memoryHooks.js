export const MEMORY_REVIEW_THRESHOLD = 3;

const WORD_CLUES = {
  boomerang:
    "画面联想：回旋镖飞出去又回来，所以作动词时表示行动产生反效果，最后影响发起者。",
  deliberately:
    "词族联想：deliberate 可以表示深思熟虑；deliberately 就是经过考虑后故意地去做。",
  directive:
    "词族联想：directive 里有 direct（指导、指向）；它不是普通建议，而是直接下达、要求执行的指令。",
  exploit:
    "对比联想：exploit 比 use 更强调借助机会、机制或弱点，让自己获益。",
  initiative:
    "词族联想：initiate 是开始；initiative 就是不用等别人推动，自己先迈出第一步。",
  plausible:
    "对比联想：possible 是有可能发生；plausible 是听起来合情合理，让人愿意相信。",
  repetition:
    "词族联想：repeat 是重复；repetition 就是重复这一动作，或再次出现的事物。",
};

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

function getWordClue(expression) {
  const key = String(expression || "").trim().toLocaleLowerCase();
  if (WORD_CLUES[key]) return WORD_CLUES[key];

  if (/^[a-z][a-z'-]+ly$/i.test(key) && !/(early|friendly|likely|lovely)$/i.test(key)) {
    return "词形提示：-ly 常把一个词变成副词。先找它修饰的动作，再问“这个动作是怎样发生的？”";
  }
  if (/^[a-z][a-z'-]+(tion|sion)$/i.test(key)) {
    return "词形提示：-tion / -sion 常表示一个动作、过程或结果；先回想它背后的动作。";
  }
  if (/^[a-z][a-z'-]+less$/i.test(key)) {
    return "词形提示：-less 常表示“没有、缺少”；先抓住前半部分，再想象把它拿走。";
  }
  if (/^[a-z][a-z'-]+able$/i.test(key)) {
    return "词形提示：-able 常表示“能够……的”或“适合……的”；把它还原成一种能力来想。";
  }
  return "";
}

export function createAutomaticMemoryHook(card) {
  const expression = compactText(card?.expression, 36);
  const meaning = asSentenceFragment(compactText(card?.meaning, 76));
  const scene = asSentenceFragment(
    compactText(card?.exampleMeaning || card?.sceneContext || card?.personalExample, 88),
  );
  if (!expression || (!meaning && !scene)) return "";

  const parts = [];
  const wordClue = getWordClue(expression);
  if (wordClue) parts.push(wordClue);
  if (meaning) parts.push(`核心只抓这一点：${meaning}。`);
  if (scene && scene !== meaning) {
    parts.push(`画面：${scene}。把 ${expression} 当作这个画面的英文标签。`);
  } else if (meaning) {
    parts.push(`把 ${expression} 和这个含义绑在同一个画面里。`);
  }
  return parts.join(" ");
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
