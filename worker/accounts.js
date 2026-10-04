const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const CHUNK_LENGTH = 1024 * 1024;

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

export async function readBody(request, limit = 16_384) {
  if (Number(request.headers.get("Content-Length")) > limit) throw new Error("Request is too large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("A JSON body is required");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Request is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function codeHash(code) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomCode(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${prefix}${btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}

export function accountObject(env, id) {
  return env.ACCOUNT_DATA.get(env.ACCOUNT_DATA.idFromName(id));
}

async function directory(env, path, body) {
  return accountObject(env, "directory").fetch(new Request(`https://account.internal${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
}

export async function accountIdentity(request, env) {
  const code = (request.headers.get("Authorization") || "").replace(/^Bearer /, "");
  if (env.INBOX_KEY && code === env.INBOX_KEY) return { id: "owner", name: "Rick", owner: true };
  if (!env.ACCOUNT_DATA || !/^sc1_[A-Za-z0-9_-]{43}$/.test(code)) return null;
  const result = await directory(env, "/identity", { hash: await codeHash(code) });
  if (!result.ok) return null;
  return result.json();
}

export async function handleAccountRoute(request, env, identity) {
  const path = new URL(request.url).pathname;
  if (!env.ACCOUNT_DATA) return response({ error: "Private accounts are not configured" }, 503);
  if (path === "/session" && request.method === "POST") {
    const body = await readBody(request);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (env.INBOX_KEY && code === env.INBOX_KEY) return response({ account: { id: "owner", name: "Rick", owner: true }, code });
    if (/^sc1_[A-Za-z0-9_-]{43}$/.test(code)) {
      const result = await directory(env, "/identity", { hash: await codeHash(code) });
      return result.ok ? response({ account: await result.json(), code }) : response({ error: "访问码无效" }, 401);
    }
    if (/^invite1_[A-Za-z0-9_-]{43}$/.test(code)) {
      const privateCode = randomCode("sc1_");
      const result = await directory(env, "/redeem", { hash: await codeHash(code), privateHash: await codeHash(privateCode), id: crypto.randomUUID() });
      return result.ok ? response({ account: await result.json(), code: privateCode, joined: true }) : result;
    }
    return response({ error: "请输入有效的邀请码或私人访问码" }, 401);
  }
  if (!identity) return response({ error: "Unauthorized" }, 401);
  if (path === "/account" && request.method === "GET") return response({ account: identity });
  if (path === "/invites" && request.method === "POST") {
    if (!identity.owner) return response({ error: "Only the owner can invite people" }, 403);
    const body = await readBody(request);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
    if (!name) return response({ error: "请输入账户名称" }, 400);
    const code = randomCode("invite1_");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = await directory(env, "/invite", { hash: await codeHash(code), name, expiresAt });
    return result.ok ? response({ code, name, expiresAt }, 201) : result;
  }
  if (path === "/vault") {
    if (request.method === "GET") return accountObject(env, identity.id).fetch(new Request("https://account.internal/vault"));
    if (request.method === "PUT") {
      const body = await readBody(request, MAX_DOCUMENT_BYTES);
      const document = body.document;
      if (!Number.isSafeInteger(body.baseRevision) || body.baseRevision < 0 ||
          document?.version !== 1 || document.encryption !== "AES-256-GCM" ||
          typeof document.iv !== "string" || !/^[A-Za-z0-9+/]{16}$/.test(document.iv) ||
          typeof document.ciphertext !== "string" || document.ciphertext.length < 24 ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(document.ciphertext)) {
        return response({ error: "Invalid encrypted collection" }, 400);
      }
      return accountObject(env, identity.id).fetch(new Request("https://account.internal/vault", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }));
    }
  }
  return response({ error: "Not found" }, 404);
}

// One durable object per account provides atomic revisions; credentials live in a separate directory.
export class AccountData {
  constructor(ctx) { this.storage = ctx.storage; }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/vault" && request.method === "GET") {
      return this.storage.transaction(async (transaction) => {
        const current = await transaction.get("vault");
        if (!current) return response({ revision: 0, document: null });
        if (current.document) return response(current);
        const parts = await Promise.all(Array.from({ length: current.chunks }, (_, index) => transaction.get(`vault-chunk:${index}`)));
        if (parts.some((part) => typeof part !== "string")) throw new Error("Incomplete encrypted collection");
        return response({ revision: current.revision, document: { ...current.header, ciphertext: parts.join("") } });
      });
    }
    if (path === "/vault" && request.method === "PUT") {
      const body = await request.json();
      return this.storage.transaction(async (transaction) => {
        const current = await transaction.get("vault") || { revision: 0 };
        if (current.revision !== body.baseRevision) return response({ error: "Conflict" }, 409);
        const { ciphertext, ...header } = body.document;
        const chunks = Math.ceil(ciphertext.length / CHUNK_LENGTH);
        for (let index = 0; index < chunks; index++) await transaction.put(`vault-chunk:${index}`, ciphertext.slice(index * CHUNK_LENGTH, (index + 1) * CHUNK_LENGTH));
        for (let index = chunks; index < (current.chunks || 0); index++) await transaction.delete(`vault-chunk:${index}`);
        await transaction.put("vault", { revision: current.revision + 1, header, chunks });
        return response({ revision: current.revision + 1 });
      });
    }
    if (path === "/identity") {
      const { hash } = await request.json();
      const account = await this.storage.get(`identity:${hash}`);
      return account ? response(account) : response({ error: "Unauthorized" }, 401);
    }
    if (path === "/invite") {
      const body = await request.json();
      const invitations = await this.storage.list({ prefix: "invite:" });
      const expired = [...invitations].filter(([, value]) => Date.parse(value.expiresAt) <= Date.now()).map(([key]) => key);
      if (expired.length) await this.storage.delete(expired);
      if (invitations.size - expired.length >= 100) return response({ error: "Too many pending invitations" }, 429);
      await this.storage.put(`invite:${body.hash}`, { name: body.name, expiresAt: body.expiresAt });
      return response({ ok: true }, 201);
    }
    if (path === "/redeem") {
      const body = await request.json();
      return this.storage.transaction(async (transaction) => {
        const key = `invite:${body.hash}`;
        const invitation = await transaction.get(key);
        if (!invitation || Date.parse(invitation.expiresAt) <= Date.now()) return response({ error: "邀请码已使用或过期，请申请新的邀请码" }, 401);
        const account = { id: body.id, name: invitation.name, owner: false };
        await transaction.put(`identity:${body.privateHash}`, account);
        await transaction.delete(key);
        return response(account);
      });
    }
    if (path === "/capture" && request.method === "POST") {
      const body = await request.json();
      const captures = await this.storage.list({ prefix: "capture:" });
      const expired = [...captures].filter(([, value]) => value.expiresAt <= Date.now()).map(([key]) => key);
      if (expired.length) await this.storage.delete(expired);
      if (captures.size - expired.length >= 2000 && !captures.has(`capture:${body.id}`)) return response({ error: "Inbox is full" }, 409);
      await this.storage.put(`capture:${body.id}`, { payload: body.payload, expiresAt: Date.now() + RETENTION_MS });
      return response({ ok: true, id: body.id }, 201);
    }
    if (path === "/captures" && request.method === "GET") {
      const values = await this.storage.list({ prefix: "capture:" });
      return response({ payloads: [...values.values()].filter((value) => value.expiresAt > Date.now()).map((value) => value.payload) });
    }
    return response({ error: "Not found" }, 404);
  }
}
