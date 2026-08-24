import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(rootDir, "dist");
const dataDir = process.env.SCENECARDS_DATA_DIR || path.join(rootDir, "data");
const inboxPath = path.join(dataDir, "bob-inbox.json");
const favoriteCursorPath = path.join(dataDir, "bob-favorite-cursor.json");
const deletedCapturesPath = path.join(dataDir, "deleted-captures.json");
const speechDir = path.join(dataDir, "speech-cache");
const bobDatabasePath = process.env.BOB_DATABASE_PATH || path.join(
  homedir(),
  "Library/Containers/com.hezongyidev.Bob/Data/Documents/bob-core.sqlite",
);
const host = process.env.SCENECARDS_HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5173);
const lanAccessToken = cleanText(process.env.SCENECARDS_LAN_TOKEN, 200);
const execFileAsync = promisify(execFile);
const allowedOrigins = new Set([
  `http://127.0.0.1:${port}`,
  `http://localhost:${port}`,
]);
const cefrLevels = new Set(["A1", "A2", "B1", "B2", "C1", "C2"]);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

let inboxMutation = Promise.resolve();
let favoritePolling = false;
const speechJobs = new Map();
const favoriteWatcher = {
  state: "starting",
  lastFavoriteId: null,
  error: null,
};

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readFileWithRetry(filePath, options) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await readFile(filePath, options);
    } catch (error) {
      const isTemporaryReadFailure = error.code === "EAGAIN" || error.errno === -11;
      if (!isTemporaryReadFailure || attempt === 3) throw error;
      await delay(25 * (attempt + 1));
    }
  }
  throw new Error(`Could not read ${filePath}`);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanDifficulty(value) {
  const level = cleanText(value, 2).toUpperCase();
  return cefrLevels.has(level) ? level : "";
}

async function removeIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function ensureSpeechFile(text) {
  const cacheKey = createHash("sha256")
    .update(`Daniel|165|${text}`)
    .digest("hex");
  const audioPath = path.join(speechDir, `${cacheKey}.wav`);

  try {
    if ((await stat(audioPath)).isFile()) return audioPath;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (speechJobs.has(cacheKey)) return speechJobs.get(cacheKey);

  const job = (async () => {
    await mkdir(speechDir, { recursive: true });
    const temporaryBase = path.join(speechDir, `${cacheKey}.${randomUUID()}`);
    const textPath = `${temporaryBase}.txt`;
    const temporaryAudioPath = `${temporaryBase}.wav`;
    try {
      await writeFile(textPath, text, "utf8");
      await execFileAsync(
        "/usr/bin/say",
        [
          "-v",
          "Daniel",
          "-r",
          "165",
          "--file-format=WAVE",
          "--data-format=LEI16@22050",
          "-f",
          textPath,
          "-o",
          temporaryAudioPath,
        ],
        { timeout: 20_000, maxBuffer: 1024 * 1024 },
      );
      await rename(temporaryAudioPath, audioPath);
      return audioPath;
    } finally {
      await Promise.all([
        removeIfPresent(textPath),
        removeIfPresent(temporaryAudioPath),
      ]);
    }
  })();

  speechJobs.set(cacheKey, job);
  try {
    return await job;
  } finally {
    speechJobs.delete(cacheKey);
  }
}

function partCategory(value) {
  const part = cleanText(value, 80).toLowerCase();
  if (/^(?:v|verb)\b|动词|^动$/.test(part)) return "verb";
  if (/^(?:n|noun)\b|名词|^名$/.test(part)) return "noun";
  if (/^(?:adj|adjective)\b|形容词|^形$/.test(part)) return "adjective";
  if (/^(?:adv|adverb)\b|副词|^副$/.test(part)) return "adverb";
  return "";
}

function normalize(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function readInbox() {
  try {
    const value = JSON.parse(await readFileWithRetry(inboxPath, "utf8"));
    return Array.isArray(value.cards) ? value.cards : [];
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return [];
    throw error;
  }
}

async function readDeletedCaptureIds() {
  try {
    const value = JSON.parse(await readFileWithRetry(deletedCapturesPath, "utf8"));
    return Array.isArray(value.ids) ? value.ids.filter((id) => typeof id === "string") : [];
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return [];
    throw error;
  }
}

async function writeInbox(cards) {
  await mkdir(dataDir, { recursive: true });
  const temporaryPath = `${inboxPath}.${randomUUID()}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify({ version: 1, cards }, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, inboxPath);
}

function mutateInbox(change) {
  const operation = inboxMutation.then(async () => {
    const cards = await readInbox();
    const result = change(cards);
    await writeInbox(result.cards);
    return result.value;
  });
  inboxMutation = operation.catch(() => {});
  return operation;
}

async function enqueueCard(body) {
  const expression = cleanText(body.expression, 400);
  if (!expression) throw new Error("expression is required");

  const incoming = {
    id: randomUUID(),
    expression,
    pronunciation: cleanText(body.pronunciation, 300),
    difficulty: cleanDifficulty(body.difficulty),
    meaning: cleanText(body.meaning, 4000),
    originalLine: cleanText(body.originalLine, 6000),
    sceneContext: cleanText(body.sceneContext, 4000),
    personalExample: cleanText(body.personalExample, 4000),
    exampleMeaning: cleanText(body.exampleMeaning, 4000),
    memoryHook: cleanText(body.memoryHook, 2000),
    source: cleanText(body.source, 200) || "Bob",
    tags: Array.isArray(body.tags)
      ? body.tags.map((tag) => cleanText(tag, 60)).filter(Boolean).slice(0, 12)
      : ["Bob"],
    needsTarget: Boolean(body.needsTarget),
    needsEditing: Boolean(body.needsEditing),
    minimumClientSchema: Number.isInteger(body.minimumClientSchema)
      ? body.minimumClientSchema
      : 1,
    contentRevision: Number.isInteger(body.contentRevision) ? body.contentRevision : 1,
    createdAt: new Date().toISOString(),
  };

  return mutateInbox((cards) => {
    const duplicate = cards.find(
      (card) =>
        normalize(card.expression) === normalize(incoming.expression) &&
        normalize(card.originalLine || "") === normalize(incoming.originalLine),
    );
    return {
      cards: [...cards, incoming],
      value: { card: incoming, duplicate: Boolean(duplicate) },
    };
  });
}

function scoreExample(sentence, expression) {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  const normalizedSentence = normalize(sentence);
  const normalizedExpression = normalize(expression);
  let score = 0;

  if (normalizedExpression && normalizedSentence.includes(normalizedExpression)) score += 8;
  if (words.length >= 8 && words.length <= 22) score += 5;
  else if (words.length >= 5 && words.length <= 28) score += 2;
  if (/\b(because|but|when|after|before|so|while|although|instead|until)\b/i.test(sentence)) {
    score += 2;
  }
  if (/\b(someone|something|thing|things)\b/i.test(sentence)) score -= 2;
  if (/^(he|she|it|they|this|that)\b/i.test(sentence) && words.length < 9) score -= 2;
  if (/[!?]$/.test(sentence)) score += 1;
  return score;
}

function looksLikeSentence(value) {
  const text = cleanText(value, 6000);
  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= 6 || (words.length >= 3 && /[.!?]["')\]]?$/.test(text));
}

function looksLikeEnglishTerm(value) {
  const text = cleanText(value, 400);
  const words = text.split(/\s+/).filter(Boolean);
  return (
    words.length > 0 &&
    words.length <= 3 &&
    /^[A-Za-z][A-Za-z' -]*$/.test(text)
  );
}

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlText(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseCambridgeEntry(html, expression) {
  const entry = {
    meaning: "",
    pronunciation: "",
    difficulty: "",
    exampleSentence: "",
    exampleMeaning: "",
    exampleReady: false,
    meaningFromDictionary: false,
  };

  const description = html.match(
    /<meta\s+name=["']description["']\s+content=(["'])([\s\S]*?)\1/i,
  )?.[2];
  if (description) {
    const text = decodeHtml(description);
    const meaning = text.match(/\btranslate:\s*(.+?)\.\s+Learn more\b/i)?.[1];
    if (meaning) {
      entry.meaning = cleanText(meaning, 4000);
      entry.meaningFromDictionary = true;
    }
  }

  const ipa = html.match(/<span class=["'][^"']*\bipa\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
  if (ipa) entry.pronunciation = cleanText(htmlText(ipa), 300);

  entry.difficulty = cleanDifficulty(
    html.match(/<span class=["'][^"']*\bepp-xref\b[^"']*["'][^>]*>\s*([ABC][12])\s*<\/span>/i)?.[1],
  );

  const exampleCandidates = [];
  const examplePattern = /<div class=["'][^"']*\bexamp\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  for (const match of html.matchAll(examplePattern)) {
    const block = match[1];
    const sentenceHtml = block.match(
      /<span class=["'][^"']*\beg\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    )?.[1];
    const meaningHtml = block.match(
      /<span class=["'][^"']*\btrans\b[^"']*["'][^>]*lang=["']zh-Hans["'][^>]*>([\s\S]*?)<\/span>/i,
    )?.[1];
    if (!sentenceHtml || !meaningHtml) continue;
    const sentence = cleanText(htmlText(sentenceHtml), 6000);
    const meaning = cleanText(htmlText(meaningHtml), 4000);
    if (sentence && meaning) {
      exampleCandidates.push({
        sentence,
        meaning,
        score: scoreExample(sentence, expression),
      });
    }
  }

  const bestExample = exampleCandidates.sort((a, b) => b.score - a.score)[0];
  if (bestExample) {
    entry.exampleSentence = bestExample.sentence;
    entry.exampleMeaning = bestExample.meaning;
    entry.exampleReady = bestExample.score >= 13;
  }
  return entry;
}

async function fetchCambridgeEntry(expression) {
  if (!looksLikeEnglishTerm(expression)) return null;
  const slug = encodeURIComponent(expression.trim().replace(/\s+/g, "-"));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  timeout.unref();
  try {
    const response = await fetch(
      `https://dictionary.cambridge.org/dictionary/english-chinese-simplified/${slug}`,
      {
        headers: { "User-Agent": "SceneCards/0.1 (local vocabulary tool)" },
        redirect: "follow",
        signal: controller.signal,
      },
    );
    if (!response.ok) return null;
    const entry = parseCambridgeEntry(await response.text(), expression);
    return entry.meaning ? entry : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchEnglishTranslation(expression) {
  if (!looksLikeEnglishTerm(expression)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  timeout.unref();
  try {
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.search = new URLSearchParams({
      client: "gtx",
      sl: "en",
      tl: "zh-CN",
      dt: "t",
      q: expression,
    });
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json();
    const meaning = Array.isArray(body?.[0])
      ? body[0]
          .map((segment) => cleanText(segment?.[0], 1000))
          .filter(Boolean)
          .join("")
      : "";
    if (!meaning || normalize(meaning) === normalize(expression)) return null;
    return {
      meaning: cleanText(meaning, 4000),
      pronunciation: "",
      difficulty: "",
      exampleSentence: "",
      exampleMeaning: "",
      exampleReady: false,
      meaningFromDictionary: false,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchEnglishFallback(expression) {
  return (
    (await fetchCambridgeEntry(expression)) ||
    (await fetchEnglishTranslation(expression))
  );
}

async function queryBobDatabase(sql) {
  const { stdout } = await execFileAsync(
    "/usr/bin/sqlite3",
    ["-readonly", "-json", bobDatabasePath, ".timeout 1000", sql],
    { maxBuffer: 5 * 1024 * 1024 },
  );
  return stdout.trim() ? JSON.parse(stdout) : [];
}

function extractFavoriteDetails(row) {
  const details = {
    meaning: "",
    pronunciation: "",
    difficulty: "",
    exampleSentence: "",
    exampleMeaning: "",
    exampleReady: false,
    meaningFromDictionary: false,
    preferredPart: "",
  };

  const exampleCandidates = [];

  for (let index = 0; index < 12; index += 1) {
    const rawTuple = row[`resultTuple${index}`];
    if (!rawTuple) continue;

    try {
      const tuple = JSON.parse(rawTuple);
      if (tuple.overview?.identifier === "com.rick.scenecards") continue;
      const result = tuple.result;
      if (!result || typeof result !== "object") continue;

      if (!details.pronunciation) {
        const phonetics = Array.isArray(result.toDict?.phonetics)
          ? result.toDict.phonetics
          : [];
        const phonetic = phonetics.find((item) => {
          const value = cleanText(item?.value, 300);
          return value && value !== "发音";
        });
        if (phonetic) details.pronunciation = cleanText(phonetic.value, 300);
      }

      const parts = Array.isArray(result.toDict?.parts) ? result.toDict.parts : [];
      const dictionaryMeaning = parts
        .map((part) => {
          const means = Array.isArray(part.means) ? part.means.filter(Boolean) : [];
          if (!means.length) return "";
          return `${part.part ? `${part.part} ` : ""}${means.join("；")}`;
        })
        .filter(Boolean)
        .join("\n");
      if (dictionaryMeaning && !details.meaningFromDictionary) {
        details.meaning = cleanText(dictionaryMeaning, 4000);
        details.meaningFromDictionary = true;
        details.preferredPart = cleanText(
          parts.find((part) => Array.isArray(part.means) && part.means.some(Boolean))?.part,
          80,
        );
      }

      const additions = Array.isArray(result.toDict?.additions)
        ? result.toDict.additions
        : [];
      const examples = additions
        .filter((addition) => /^例句\d*$/.test(addition?.name || ""))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

      if (!details.difficulty) {
        const levelCandidates = additions
          .map((addition) => ({
            level: cleanDifficulty(cleanText(addition?.value, 4000).match(/^([ABC][12])\b/)?.[1]),
            category: partCategory(addition?.name),
          }))
          .filter((candidate) => candidate.level);
        const preferredCategory = partCategory(details.preferredPart);
        details.difficulty = (
          levelCandidates.find((candidate) => candidate.category === preferredCategory) ||
          levelCandidates[0] ||
          {}
        ).level || "";
      }

      for (const example of examples) {
        if (typeof example.value !== "string") continue;
        const lines = example.value
          .split(/\r?\n|\\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const englishLine = lines.find(
          (line) => /[A-Za-z]/.test(line) && !/[\u3400-\u9fff]/.test(line),
        );
        const translatedLine = lines.find((line) => /[\u3400-\u9fff]/.test(line));
        if (englishLine && translatedLine) {
          exampleCandidates.push({
            sentence: cleanText(englishLine, 6000),
            meaning: cleanText(translatedLine, 4000),
            score: scoreExample(englishLine, row.queryText || ""),
          });
        }
      }

      const paragraphs = Array.isArray(result.toParagraphs)
        ? result.toParagraphs.filter((paragraph) => typeof paragraph === "string")
        : [];
      const translatedText = paragraphs.join("\n").trim();
      if (!details.meaning && translatedText) {
        details.meaning = cleanText(translatedText, 4000);
      }
    } catch {
      // A broken result from one service should not hide other valid translations.
    }
  }
  const bestExample = exampleCandidates.sort((a, b) => b.score - a.score)[0];
  if (bestExample) {
    details.exampleSentence = bestExample.sentence;
    details.exampleMeaning = bestExample.meaning;
    details.exampleReady = bestExample.score >= 13;
  }
  return details;
}

async function readFavoriteCursor() {
  try {
    const value = JSON.parse(await readFileWithRetry(favoriteCursorPath, "utf8"));
    return Number.isInteger(value.lastFavoriteId) ? value.lastFavoriteId : null;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeFavoriteCursor(lastFavoriteId) {
  await mkdir(dataDir, { recursive: true });
  const temporaryPath = `${favoriteCursorPath}.${randomUUID()}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify({ version: 1, lastFavoriteId }, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, favoriteCursorPath);
}

async function pollBobFavorites() {
  if (favoritePolling) return;
  favoritePolling = true;

  try {
    if (favoriteWatcher.lastFavoriteId === null) {
      const savedCursor = await readFavoriteCursor();
      if (savedCursor !== null) {
        favoriteWatcher.lastFavoriteId = savedCursor;
      } else {
        const rows = await queryBobDatabase(
          "SELECT COALESCE(MAX(localId), 0) AS localId FROM translate_translate_favorite;",
        );
        favoriteWatcher.lastFavoriteId = Number(rows[0]?.localId || 0);
        await writeFavoriteCursor(favoriteWatcher.lastFavoriteId);
      }
      favoriteWatcher.state = "ready";
      favoriteWatcher.error = null;
      return;
    }

    const tupleColumns = Array.from(
      { length: 12 },
      (_, index) => `resultTuple${index}`,
    ).join(", ");
    const rows = await queryBobDatabase(
      `SELECT localId, queryText, ${tupleColumns} ` +
        "FROM translate_translate_favorite " +
        `WHERE localId > ${favoriteWatcher.lastFavoriteId} ORDER BY localId ASC;`,
    );

    for (const row of rows) {
      const expression = cleanText(row.queryText, 400);
      if (expression) {
        let details = extractFavoriteDetails(row);
        if (!details.meaning && !looksLikeSentence(expression)) {
          const fallback = await fetchEnglishFallback(expression);
          if (fallback) details = fallback;
        }
        const needsTarget = looksLikeSentence(expression);
        const readyForReview = Boolean(
          !needsTarget &&
            details.meaning &&
            details.exampleSentence &&
            details.exampleMeaning &&
            details.exampleReady,
        );
        await enqueueCard({
          expression,
          pronunciation: details.pronunciation,
          difficulty: details.difficulty,
          meaning: needsTarget ? "" : details.meaning,
          originalLine: needsTarget ? expression : "",
          sceneContext: needsTarget ? details.meaning : "",
          personalExample: needsTarget ? "" : details.exampleSentence,
          exampleMeaning: needsTarget ? "" : details.exampleMeaning,
          source: "Bob 收藏",
          tags: ["Bob", "favorite"],
          needsTarget,
          needsEditing: needsTarget || !readyForReview,
          minimumClientSchema: 3,
        });
      }
      favoriteWatcher.lastFavoriteId = Number(row.localId);
      await writeFavoriteCursor(favoriteWatcher.lastFavoriteId);
    }

    favoriteWatcher.state = "ready";
    favoriteWatcher.error = null;
  } catch (error) {
    favoriteWatcher.state = "unavailable";
    favoriteWatcher.error = error.message;
  } finally {
    favoritePolling = false;
  }
}

function startBobFavoriteWatcher() {
  pollBobFavorites();
  const interval = setInterval(pollBobFavorites, 3_000);
  interval.unref();
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function hasAccessCookie(request) {
  return (request.headers.cookie || "")
    .split(";")
    .map((cookie) => cookie.trim())
    .some((cookie) => cookie === `scenecards_access=${lanAccessToken}`);
}

function authorizeRequest(request, response, url) {
  if (isLoopbackRequest(request)) return true;
  if (!lanAccessToken) return false;
  if (hasAccessCookie(request)) return true;
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    url.searchParams.get("access") === lanAccessToken
  ) {
    url.searchParams.delete("access");
    const location = `${url.pathname}${url.search}` || "/";
    response.writeHead(302, {
      Location: location,
      "Set-Cookie": `scenecards_access=${lanAccessToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
      "Cache-Control": "no-store",
    });
    response.end();
    return "handled";
  }
  return false;
}

function isAllowedBrowserRequest(request, url) {
  const origin = request.headers.origin;
  const requestOrigin = `${url.protocol}//${request.headers.host}`;
  return !origin || allowedOrigins.has(origin) || origin === requestOrigin;
}

async function handleApi(request, response, url) {
  const { pathname } = url;
  if (!isAllowedBrowserRequest(request, url)) {
    sendJson(response, 403, { error: "This local API only accepts SceneCards requests." });
    return;
  }

  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      app: "SceneCards",
      bobFavorites: {
        state: favoriteWatcher.state,
        lastFavoriteId: favoriteWatcher.lastFavoriteId,
      },
    });
    return;
  }

  if ((request.method === "GET" || request.method === "HEAD") && pathname === "/api/speech") {
    const text = cleanText(url.searchParams.get("text"), 1000);
    if (!text) {
      sendJson(response, 400, { error: "text is required" });
      return;
    }
    const audioPath = await ensureSpeechFile(text);
    const audio = await readFileWithRetry(audioPath);
    response.writeHead(200, {
      "Content-Type": "audio/wav",
      "Content-Length": audio.length,
      "Cache-Control": "private, max-age=31536000, immutable",
    });
    response.end(request.method === "HEAD" ? undefined : audio);
    return;
  }

  if (request.method === "GET" && pathname === "/api/inbox") {
    const clientSchema = Number(url.searchParams.get("schema") || 1);
    const [inboxCards, deletedCaptureIds] = await Promise.all([
      readInbox(),
      readDeletedCaptureIds(),
    ]);
    const cards = inboxCards.filter(
      (card) => (card.minimumClientSchema || 1) <= clientSchema,
    );
    sendJson(response, 200, { cards, deletedCaptureIds });
    return;
  }

  if (request.method === "POST" && pathname === "/api/cards") {
    const body = await readJsonBody(request);
    if (!cleanText(body.expression, 400)) {
      sendJson(response, 400, { error: "expression is required" });
      return;
    }
    const result = await enqueueCard(body);

    sendJson(response, result.duplicate ? 200 : 201, { ok: true, ...result });
    return;
  }

  if (request.method === "POST" && pathname === "/api/inbox/ack") {
    const body = await readJsonBody(request);
    const ids = new Set(Array.isArray(body.ids) ? body.ids : []);
    const acknowledged = (await readInbox()).filter((card) => ids.has(card.id)).length;
    sendJson(response, 200, { ok: true, acknowledged });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function serveStatic(response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  let filePath = path.resolve(distDir, relativePath);
  if (!filePath.startsWith(`${distDir}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }

  try {
    if (!(await stat(filePath)).isFile()) throw new Error("Not a file");
  } catch {
    filePath = path.join(distDir, "index.html");
  }

  const body = await readFileWithRetry(filePath);
  response.writeHead(200, {
    "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    "Cache-Control": path.basename(filePath) === "index.html"
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
    const authorization = authorizeRequest(request, response, url);
    if (authorization === "handled") return;
    if (!authorization) {
      if (url.pathname.startsWith("/api/")) {
        sendJson(response, 403, { error: "This device needs a private SceneCards access link." });
      } else {
        response.writeHead(403, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end("This device needs a private SceneCards access link.");
      }
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(response, url.pathname);
    } else {
      response.writeHead(405).end();
    }
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "SceneCards could not process this request." });
  }
});

server.listen(port, host, () => {
  console.log(`SceneCards is running at http://${host}:${port}/`);
});

startBobFavoriteWatcher();
