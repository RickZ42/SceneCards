import assert from "node:assert/strict";
import test from "node:test";
import worker from "./index.js";
import { AccountData } from "./accounts.js";
import { encryptPrivateStore } from "../src/accountSync.js";

function namespace() {
  const objects = new Map();
  return {
    objects,
    idFromName: (name) => name,
    get(id) {
      if (!objects.has(id)) {
        const values = new Map();
        let pending = Promise.resolve();
        const storage = {
          get: async (key) => values.get(key),
          put: async (key, value) => {
            if (JSON.stringify(value).length >= 2 * 1024 * 1024) throw new Error("Storage value exceeds SQLite limit");
            values.set(key, structuredClone(value));
          },
          delete: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); },
          list: async ({ prefix }) => new Map([...values].filter(([key]) => key.startsWith(prefix))),
          transaction(callback) {
            const result = pending.then(() => callback(storage));
            pending = result.catch(() => {});
            return result;
          },
        };
        objects.set(id, new AccountData({ storage }));
      }
      return objects.get(id);
    },
  };
}

function environment() {
  const values = new Map();
  return {
    ACCOUNT_DATA: namespace(), INBOX_KEY: "owner-test-code-with-32-characters",
    INBOX_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    ALLOWED_ORIGINS: "https://rickz42.github.io",
    CAPTURES: { put: async (key, value) => values.set(key, value), get: async (key) => values.get(key), list: async ({ prefix }) => ({ keys: [...values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) },
  };
}

async function call(env, path, code, method = "GET", body) {
  return worker.fetch(new Request(`https://accounts.example${path}`, { method, headers: { Origin: "https://rickz42.github.io", ...(code ? { Authorization: `Bearer ${code}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
}

async function join(env, name) {
  const invite = await (await call(env, "/invites", env.INBOX_KEY, "POST", { name })).json();
  const result = await (await call(env, "/session", null, "POST", { code: invite.code })).json();
  return { ...result.account, code: result.code, endpoint: "https://accounts.example", invite: invite.code };
}

test("invitations are owner-only, single use, and create empty independent accounts", async () => {
  const env = environment();
  const a = await join(env, "Alice");
  const b = await join(env, "Bob");
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.code, a.invite);
  assert.equal((await call(env, "/session", null, "POST", { code: a.invite })).status, 401);
  assert.equal((await call(env, "/invites", a.code, "POST", { name: "Eve" })).status, 403);
  assert.equal((await call(env, "/account", "invalid")).status, 401);
  assert.deepEqual(await (await call(env, "/vault", b.code)).json(), { revision: 0, document: null });
  assert.equal((await (await call(env, "/session", null, "POST", { code: a.code })).json()).account.id, a.id);
});

test("vault routes select the authenticated account and reject concurrent stale writes", async () => {
  const env = environment();
  const a = await join(env, "Alice"), b = await join(env, "Bob");
  const document = await encryptPrivateStore({ cards: [{ id: "alice-card", expression: "private-word" }], reviews: [] }, a);
  const writes = await Promise.all([
    call(env, "/vault", a.code, "PUT", { baseRevision: 0, document, userId: b.id }),
    call(env, "/vault", a.code, "PUT", { baseRevision: 0, document }),
  ]);
  assert.deepEqual(writes.map((result) => result.status).sort(), [200, 409]);
  assert.equal((await (await call(env, `/vault?userId=${a.id}`, b.code)).json()).document, null);
  assert.equal((await (await call(env, "/vault", a.code)).json()).revision, 1);
  assert.equal((await call(env, "/vault", a.code, "PUT", { baseRevision: 1, document: { version: 1, iv: "bad", ciphertext: "plaintext" } })).status, 400);
});

test("Shortcut captures remain isolated from other users and the legacy owner's inbox", async () => {
  const env = environment();
  const a = await join(env, "Alice"), b = await join(env, "Bob");
  assert.equal((await call(env, "/capture", a.code, "POST", { text: "plausible", id: "capture-alice-123", userId: b.id })).status, 201);
  assert.equal((await call(env, "/capture", env.INBOX_KEY, "POST", { text: "deliberately", id: "capture-owner-123" })).status, 201);
  const own = await (await call(env, "/captures", a.code)).json();
  assert.deepEqual(own.cards.map((card) => card.expression), ["plausible"]);
  assert.deepEqual((await (await call(env, "/captures", b.code)).json()).cards, []);
  assert.deepEqual((await (await call(env, "/captures", env.INBOX_KEY)).json()).cards.map((card) => card.expression), ["deliberately"]);
});

test("private routes enforce origin and body size checks", async () => {
  const env = environment();
  const response = await worker.fetch(new Request("https://accounts.example/session", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ code: env.INBOX_KEY }) }), env);
  assert.equal(response.status, 403);
  assert.equal((await call(env, "/session", null, "POST", { code: "x".repeat(20_000) })).status, 400);
});

test("large encrypted collections are stored in atomic chunks below the per-value size limit", async () => {
  const env = environment();
  const account = await join(env, "Large library");
  const document = { version: 1, encryption: "AES-256-GCM", iv: "A".repeat(16), ciphertext: "A".repeat(3 * 1024 * 1024) };
  assert.equal((await call(env, "/vault", account.code, "PUT", { baseRevision: 0, document })).status, 200);
  assert.deepEqual((await (await call(env, "/vault", account.code)).json()).document, document);
  const smaller = { ...document, ciphertext: "A".repeat(100) };
  assert.equal((await call(env, "/vault", account.code, "PUT", { baseRevision: 1, document: smaller })).status, 200);
  assert.deepEqual((await (await call(env, "/vault", account.code)).json()).document, smaller);
});
