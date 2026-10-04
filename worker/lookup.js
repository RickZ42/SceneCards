const DICTIONARY_URL = "https://freedictionaryapi.com/api/v1/entries/en/";
const TRANSLATION_URL = "https://api.mymemory.translated.net/get";
const MAX_DEFINITION_BYTES = 500;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function getJson(url, fetcher) {
  const response = await fetcher(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`查词服务暂时不可用（${new URL(url).hostname}: ${response.status}），请稍后重试。没有保存任何卡片。`);
  return response.json();
}

export async function defineWord(input, fetcher = fetch) {
  const word = text(input).replace(/[’]/g, "'");
  if (!word || word.length > 80 || !/^[a-z]+(?:[-' ][a-z]+){0,3}$/i.test(word)) {
    throw new Error("请只选择一个英文单词或简短词组，再运行快捷指令。没有保存任何卡片。");
  }

  const payload = await getJson(`${DICTIONARY_URL}${encodeURIComponent(word.toLowerCase())}`, fetcher);
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const senses = [];
  for (const entry of entries) {
    if (entry.language?.code !== "en") continue;
    const definition = (entry.senses || []).find((item) => {
      const value = text(item.definition);
      const obsolete = (item.tags || []).some((tag) => /obsolete|archaic/i.test(tag));
      return value && !obsolete && new TextEncoder().encode(value).length <= MAX_DEFINITION_BYTES;
    });
    if (!definition || senses.some((sense) => sense.partOfSpeech === entry.partOfSpeech)) continue;
    senses.push({ partOfSpeech: text(entry.partOfSpeech), english: text(definition.definition) });
    if (senses.length === 1) break;
  }
  if (!senses.length) throw new Error("没有找到可用的英文释义。请检查拼写；没有保存任何卡片。");

  const pronunciation = entries.flatMap((entry) => entry.pronunciations || [])
    .filter((item) => item.type === "ipa").map((item) => text(item.text)).find(Boolean) || "";
  const url = new URL(TRANSLATION_URL);
  url.searchParams.set("q", senses[0].english);
  url.searchParams.set("langpair", "en|zh-CN");
  return { expression: word, pronunciation, ...senses[0], translationUrl: url.href };
}

export function completeDefinition(definition, translation) {
  const word = text(definition?.expression);
  const english = text(definition?.english);
  if (!word || word.length > 80 || !/^[a-z]+(?:[-' ][a-z]+){0,3}$/i.test(word) ||
      !english || new TextEncoder().encode(english).length > MAX_DEFINITION_BYTES) {
    throw new Error("英文释义不完整，没有保存卡片。请重新查词。");
  }
  const chinese = text(translation?.responseData?.translatedText);
  if (Number(translation?.responseStatus) !== 200 || translation?.quotaFinished ||
      chinese.length > 4000 || !/[\u3400-\u9fff]/u.test(chinese) ||
      /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(chinese)) {
    throw new Error("暂时无法取得中文意思（可能达到查词限额）。请稍后重试；没有保存任何卡片。");
  }
  const pronunciation = text(definition?.pronunciation).slice(0, 200);
  const meaning = `${text(definition?.partOfSpeech).slice(0, 80)}\nEnglish: ${english}\n中文：${chinese}`;
  const source = `FreeDictionaryAPI.com / Wiktionary (CC BY-SA 4.0) https://en.wiktionary.org/wiki/${encodeURIComponent(word.toLowerCase())}; 中文: MyMemory`;
  return {
    expression: word,
    pronunciation,
    meaning,
    source,
    preview: `English: ${english}\n\n中文：${chinese}`,
  };
}

export async function lookupWord(input, fetcher = fetch) {
  const definition = await defineWord(input, fetcher);
  return completeDefinition(definition, await getJson(definition.translationUrl, fetcher));
}
