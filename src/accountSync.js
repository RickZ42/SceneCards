export const ACCOUNT_ENDPOINT = import.meta.env?.VITE_ACCOUNT_ENDPOINT || "https://scenecards-mobile-inbox.scene-cards.workers.dev";
export const ACCOUNT_SESSION_KEY = "scenecards.account-session.v1";
const SCHEDULE_FIELDS = ["dueAt", "intervalDays", "ease", "repetitions", "lapses", "lastReviewedAt", "reviewQueueOrder"];

export function emptyPrivateStore() {
  return { cards: [], reviews: [], installedSeeds: [], dismissedCaptureIds: [], processedCaptureRevisions: {}, deletedCards: {} };
}

export function accountCacheKey(id) { return `scenecards.account.${id}.encrypted.v1`; }

export function loadAccountSession(storage = localStorage) {
  try {
    const session = JSON.parse(storage.getItem(ACCOUNT_SESSION_KEY));
    if (!session || typeof session.id !== "string" || typeof session.code !== "string" || session.code.length < 24 || session.endpoint !== ACCOUNT_ENDPOINT) return null;
    return session;
  } catch { return null; }
}

function headers(code) { return { Authorization: `Bearer ${code}`, "Content-Type": "application/json" }; }

async function request(endpoint, path, options = {}) {
  const result = await fetch(`${endpoint}${path}`, { cache: "no-store", signal: AbortSignal.timeout(20_000), ...options });
  const body = await result.json();
  if (!result.ok) throw new Error(body.error || `同步失败（${result.status}）`);
  return body;
}

export async function signInAccount(code, endpoint = ACCOUNT_ENDPOINT) {
  const result = await request(endpoint, "/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim() }) });
  return { ...result.account, code: result.code, endpoint, joined: Boolean(result.joined) };
}

export async function createAccountInvite(session, name) {
  return request(session.endpoint, "/invites", { method: "POST", headers: headers(session.code), body: JSON.stringify({ name }) });
}

function bytesToBase64(bytes) {
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(text);
}

function base64ToBytes(text) { return Uint8Array.from(atob(text), (character) => character.charCodeAt(0)); }

async function keyFor(session) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(session.code), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("SceneCards private vault v1"), info: new TextEncoder().encode(session.id) }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptPrivateStore(store, session) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(session.id) }, await keyFor(session), new TextEncoder().encode(JSON.stringify(store)));
  return { version: 1, encryption: "AES-256-GCM", iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(ciphertext)) };
}

export async function decryptPrivateStore(document, session) {
  if (document?.version !== 1 || document.encryption !== "AES-256-GCM") throw new Error("无法读取这个账户的加密词库");
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(document.iv), additionalData: new TextEncoder().encode(session.id) }, await keyFor(session), base64ToBytes(document.ciphertext));
    const store = JSON.parse(new TextDecoder().decode(plaintext));
    if (!Array.isArray(store.cards) || !Array.isArray(store.reviews)) throw new Error("Invalid collection");
    return { ...emptyPrivateStore(), ...store };
  } catch { throw new Error("访问码与这个词库不匹配，未覆盖任何数据"); }
}

export async function loadAccountCache(session, storage = localStorage) {
  const value = storage.getItem(accountCacheKey(session.id));
  return value ? decryptPrivateStore(JSON.parse(value), session) : emptyPrivateStore();
}

function compare(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function newerCard(left, right) {
  const difference = compare(left.contentUpdatedAt || left.updatedAt || left.createdAt, right.contentUpdatedAt || right.updatedAt || right.createdAt);
  return difference > 0 || (difference === 0 && JSON.stringify(left).localeCompare(JSON.stringify(right)) > 0) ? left : right;
}

export function mergePrivateStores(local, remote) {
  const deletedCards = { ...(remote.deletedCards || {}) };
  for (const [id, at] of Object.entries(local.deletedCards || {})) if (compare(at, deletedCards[id]) > 0) deletedCards[id] = at;
  const reviewsById = new Map();
  for (const review of [...(remote.reviews || []), ...(local.reviews || [])]) {
    if (review.id && review.cardId && review.at && ["again", "good", "easy"].includes(review.rating)) reviewsById.set(review.id, review);
  }
  const reviews = [...reviewsById.values()].sort((a, b) => compare(a.at, b.at) || compare(a.id, b.id));
  const latest = new Map();
  for (const review of reviews) latest.set(review.cardId, review);
  const remoteCards = new Map((remote.cards || []).map((card) => [card.id, card]));
  const localCards = new Map((local.cards || []).map((card) => [card.id, card]));
  const ids = new Set([...remoteCards.keys(), ...localCards.keys()]);
  const cards = [];
  for (const id of ids) {
    const left = localCards.get(id), right = remoteCards.get(id);
    const content = !left ? right : !right ? left : newerCard(left, right);
    if (deletedCards[id] && compare(content.restoredAt, deletedCards[id]) <= 0) continue;
    let schedule = content;
    if (left && right) {
      const difference = compare(left.lastReviewedAt, right.lastReviewedAt);
      if (difference !== 0) schedule = difference > 0 ? left : right;
      else {
        const recent = latest.get(id);
        const leftHasReview = (local.reviews || []).some((review) => review.id === recent?.id);
        const rightHasReview = (remote.reviews || []).some((review) => review.id === recent?.id);
        schedule = leftHasReview !== rightHasReview ? (leftHasReview ? left : right) : newerCard(left, right);
      }
    }
    const merged = { ...content };
    for (const field of SCHEDULE_FIELDS) {
      if (Object.hasOwn(schedule, field)) merged[field] = schedule[field];
      else delete merged[field];
    }
    cards.push(merged);
  }
  cards.sort((a, b) => compare(b.createdAt, a.createdAt) || compare(a.id, b.id));
  const activeIds = new Set(cards.map((card) => card.id));
  const processed = { ...(remote.processedCaptureRevisions || {}) };
  for (const [id, revision] of Object.entries(local.processedCaptureRevisions || {})) processed[id] = Math.max(revision, processed[id] || 0);
  return {
    ...emptyPrivateStore(), cards, reviews: reviews.filter((review) => activeIds.has(review.cardId)), deletedCards,
    installedSeeds: [...new Set([...(remote.installedSeeds || []), ...(local.installedSeeds || [])])].sort(),
    dismissedCaptureIds: [...new Set([...(remote.dismissedCaptureIds || []), ...(local.dismissedCaptureIds || [])])].sort(),
    processedCaptureRevisions: processed,
  };
}

export async function syncPrivateStore(session, getLocalStore) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const remote = await request(session.endpoint, "/vault", { headers: headers(session.code) });
    const remoteStore = remote.document ? await decryptPrivateStore(remote.document, session) : emptyPrivateStore();
    const merged = mergePrivateStores(getLocalStore(), remoteStore);
    if (remote.document && JSON.stringify(merged) === JSON.stringify(mergePrivateStores(remoteStore, emptyPrivateStore()))) return merged;
    const document = await encryptPrivateStore(merged, session);
    const result = await fetch(`${session.endpoint}/vault`, { method: "PUT", headers: headers(session.code), body: JSON.stringify({ baseRevision: remote.revision, document }), signal: AbortSignal.timeout(20_000) });
    if (result.status === 409) continue;
    if (!result.ok) {
      const body = await result.json();
      throw new Error(body.error || `同步失败（${result.status}）`);
    }
    return merged;
  }
  throw new Error("另一台设备正在同步，将稍后重试");
}
