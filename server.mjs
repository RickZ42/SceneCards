import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(rootDir, "dist");
const dataDir = process.env.SCENECARDS_DATA_DIR || path.join(rootDir, "data");
const inboxPath = path.join(dataDir, "bob-inbox.json");
const favoriteCursorPath = path.join(dataDir, "bob-favorite-cursor.json");
const bobDatabasePath = process.env.BOB_DATABASE_PATH || path.join(
  homedir(),
  "Library/Containers/com.hezongyidev.Bob/Data/Documents/bob-core.sqlite",
);
const host = "127.0.0.1";
const port = Number(process.env.PORT || 5173);
const execFileAsync = promisify(execFile);
const allowedOrigins = new Set([
  `http://${host}:${port}`,
  `http://localhost:${port}`,
]);

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
    meaning: cleanText(body.meaning, 4000),
    originalLine: cleanText(body.originalLine, 6000),
    sceneContext: cleanText(body.sceneContext, 4000),
    personalExample: cleanText(body.personalExample, 4000),
    memoryHook: cleanText(body.memoryHook, 2000),
    source: cleanText(body.source, 200) || "Bob",
    tags: Array.isArray(body.tags)
      ? body.tags.map((tag) => cleanText(tag, 60)).filter(Boolean).slice(0, 12)
      : ["Bob"],
    needsEditing: Boolean(body.needsEditing),
    minimumClientSchema: Number.isInteger(body.minimumClientSchema)
      ? body.minimumClientSchema
      : 1,
    createdAt: new Date().toISOString(),
  };

  return mutateInbox((cards) => {
    const duplicate = cards.find(
      (card) =>
        normalize(card.expression) === normalize(incoming.expression) &&
        normalize(card.originalLine || "") === normalize(incoming.originalLine),
    );
    if (duplicate) return { cards, value: { card: duplicate, duplicate: true } };
    return { cards: [...cards, incoming], value: { card: incoming, duplicate: false } };
  });
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
    exampleSentence: "",
    exampleMeaning: "",
    meaningFromDictionary: false,
  };

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
        const phonetic = phonetics.find((item) => cleanText(item?.value, 300));
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
      }

      if (!details.exampleSentence || !details.exampleMeaning) {
        const additions = Array.isArray(result.toDict?.additions)
          ? result.toDict.additions
          : [];
        const examples = additions
          .filter((addition) => /^例句\d*$/.test(addition?.name || ""))
          .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

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
            details.exampleSentence = cleanText(englishLine, 6000);
            details.exampleMeaning = cleanText(translatedLine, 4000);
            break;
          }
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
        const details = extractFavoriteDetails(row);
        const readyForReview = Boolean(
          details.meaning && details.exampleSentence && details.exampleMeaning,
        );
        await enqueueCard({
          expression,
          pronunciation: details.pronunciation,
          meaning: details.meaning,
          originalLine: details.exampleSentence,
          sceneContext: details.exampleMeaning
            ? `例句含义：${details.exampleMeaning}`
            : "",
          memoryHook: readyForReview
            ? `把 ${expression} 和这句例句一起回忆，不要只背一个中文释义。`
            : "",
          source: "Bob 收藏",
          tags: ["Bob", "favorite"],
          needsEditing: !readyForReview,
          minimumClientSchema: 2,
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

function isAllowedBrowserRequest(request) {
  const origin = request.headers.origin;
  return !origin || allowedOrigins.has(origin);
}

async function handleApi(request, response, url) {
  const { pathname } = url;
  if (!isAllowedBrowserRequest(request)) {
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

  if (request.method === "GET" && pathname === "/api/inbox") {
    const clientSchema = Number(url.searchParams.get("schema") || 1);
    const cards = (await readInbox()).filter(
      (card) => (card.minimumClientSchema || 1) <= clientSchema,
    );
    sendJson(response, 200, { cards });
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
    const removed = await mutateInbox((cards) => {
      const remaining = cards.filter((card) => !ids.has(card.id));
      return { cards: remaining, value: cards.length - remaining.length };
    });
    sendJson(response, 200, { ok: true, removed });
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
