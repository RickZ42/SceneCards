import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(rootDir, "dist");
const dataDir = path.join(rootDir, "data");
const inboxPath = path.join(dataDir, "bob-inbox.json");
const host = "127.0.0.1";
const port = Number(process.env.PORT || 5173);
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

async function handleApi(request, response, pathname) {
  if (!isAllowedBrowserRequest(request)) {
    sendJson(response, 403, { error: "This local API only accepts SceneCards requests." });
    return;
  }

  if (request.method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true, app: "SceneCards" });
    return;
  }

  if (request.method === "GET" && pathname === "/api/inbox") {
    sendJson(response, 200, { cards: await readInbox() });
    return;
  }

  if (request.method === "POST" && pathname === "/api/cards") {
    const body = await readJsonBody(request);
    const expression = cleanText(body.expression, 400);
    if (!expression) {
      sendJson(response, 400, { error: "expression is required" });
      return;
    }

    const incoming = {
      id: randomUUID(),
      expression,
      meaning: cleanText(body.meaning, 4000),
      originalLine: cleanText(body.originalLine, 6000),
      source: cleanText(body.source, 200) || "Bob",
      tags: Array.isArray(body.tags)
        ? body.tags.map((tag) => cleanText(tag, 60)).filter(Boolean).slice(0, 12)
        : ["Bob"],
      createdAt: new Date().toISOString(),
    };

    const result = await mutateInbox((cards) => {
      const duplicate = cards.find(
        (card) =>
          normalize(card.expression) === normalize(incoming.expression) &&
          normalize(card.originalLine || "") === normalize(incoming.originalLine),
      );
      if (duplicate) return { cards, value: { card: duplicate, duplicate: true } };
      return { cards: [...cards, incoming], value: { card: incoming, duplicate: false } };
    });

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
      await handleApi(request, response, url.pathname);
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
