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
    // Keep historical hard ratings even though the current review UI no longer offers that button.
    if (review.id && review.cardId && review.at && ["again", "hard", "good", "easy"].includes(review.rating)) reviewsById.set(review.id, review);
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

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJson(value[key])]));
  }
  return value;
}

function sameValue(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

export function readDesktopBackup(value) {
  if (value?.app !== "SceneCards" || value.version !== 1 || !Array.isArray(value.cards) || !value.cards.length || !Array.isArray(value.reviews)) {
    throw new Error("请选择 SceneCards 下载的完整词库备份");
  }
  const ids = new Set();
  for (const card of value.cards) {
    if (typeof card.id !== "string" || !card.id || ids.has(card.id) || typeof card.expression !== "string") throw new Error("备份包含无效或重复的卡片身份");
    ids.add(card.id);
  }
  const reviewIds = new Set();
  for (const review of value.reviews) {
    if (typeof review.id !== "string" || !review.id || reviewIds.has(review.id) || !ids.has(review.cardId) || !Number.isFinite(Date.parse(review.at)) || !["again", "hard", "good", "easy"].includes(review.rating)) {
      throw new Error("备份包含无效或重复的复习记录");
    }
    reviewIds.add(review.id);
  }
  const store = emptyPrivateStore();
  for (const key of Object.keys(store)) if (Object.hasOwn(value, key)) {
    const valid = Array.isArray(store[key]) ? Array.isArray(value[key]) : value[key] && typeof value[key] === "object" && !Array.isArray(value[key]);
    if (!valid) throw new Error("备份的词库元数据格式无效");
    store[key] = value[key];
  }
  return store;
}

export function desktopConflictIds(local, remote) {
  const cards = new Map(mergePrivateStores(local, remote).cards.map(card => [card.id, card]));
  return local.cards.filter(card => !sameValue(card, cards.get(card.id))).map(card => card.id).sort();
}

export function mergeApprovedDesktopStore(local, remote, { approvedConflictIds, now = new Date().toISOString() } = {}) {
  if (!Array.isArray(approvedConflictIds)) throw new Error("请先核对需要采用电脑版本的卡片");
  const localCards = new Map(local.cards.map(card => [card.id, card]));
  const localReviews = new Map(local.reviews.map(review => [review.id, review]));
  for (const review of remote.reviews || []) {
    if (localCards.has(review.cardId) && !sameValue(review, localReviews.get(review.id))) {
      throw new Error("账户出现电脑备份之外的复习记录，已停止迁入；请先核对新进度");
    }
  }
  for (const card of remote.cards || []) {
    if (localCards.has(card.id) && compare(card.lastReviewedAt, localCards.get(card.id).lastReviewedAt) > 0) {
      throw new Error("账户出现更新的复习进度，已停止迁入；请先核对");
    }
  }
  const merged = mergePrivateStores(local, remote);
  const mergedCards = new Map(merged.cards.map(card => [card.id, card]));
  const changed = new Set(desktopConflictIds(local, remote));
  const approved = new Set(approvedConflictIds);
  if ([...changed].some(id => !approved.has(id))) throw new Error("账户出现新的卡片冲突，已停止迁入；请重新核对");
  const prepared = local.cards.map(card => {
    if (!mergedCards.has(card.id)) throw new Error("账户存在卡片删除冲突，未恢复或重建任何卡片");
    if (!changed.has(card.id)) return card;
    // Stamp the approved content choice so a stale phone cache cannot win it back.
    const dates = [now, ...[card, mergedCards.get(card.id)].flatMap(item => [item.contentUpdatedAt, item.updatedAt, item.createdAt])].map(Date.parse).filter(Number.isFinite);
    const updatedAt = new Date(Math.max(...dates) + 1).toISOString();
    return { ...card, contentUpdatedAt: updatedAt, updatedAt };
  });
  const preparedById = new Map(prepared.map(card => [card.id, card]));
  merged.cards = merged.cards.map(card => preparedById.get(card.id) || card).sort((a, b) => compare(b.createdAt, a.createdAt) || compare(a.id, b.id));
  assertLocalCollectionPreserved({ ...local, cards: prepared }, merged);
  const finalCards = new Map(merged.cards.map(card => [card.id, card]));
  const finalReviews = new Map(merged.reviews.map(review => [review.id, review]));
  if ((remote.cards || []).some(card => !localCards.has(card.id) && !sameValue(card, finalCards.get(card.id))) ||
      (remote.reviews || []).some(review => !sameValue(review, finalReviews.get(review.id)))) {
    throw new Error("无法完整保留账户额外条目，已停止迁入");
  }
  return merged;
}

function assertLocalCollectionPreserved(local, merged) {
  const cards = new Map(merged.cards.map(card => [card.id, card]));
  const reviews = new Map(merged.reviews.map(review => [review.id, review]));
  const changed = local.cards.filter(card => !sameValue(card, cards.get(card.id)));
  if (changed.length || local.reviews.some(review => !sameValue(review, reviews.get(review.id)))) {
    throw new Error("云端记录与电脑词库存在冲突，未连接或覆盖任何进度。请先核对两端记录。");
  }
}

// The explicit desktop migration must not let an older or conflicting cloud copy replace local work.
export async function migrateLocalCollection(session, local, options = {}) {
  if (!session.owner) throw new Error("只有现有收件账户可以连接这份电脑词库");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const remote = await request(session.endpoint, "/vault", { headers: headers(session.code) });
    const cloudStore = remote.document ? await decryptPrivateStore(remote.document, session) : emptyPrivateStore();
    const remoteStore = options.currentStore ? mergePrivateStores(options.currentStore, cloudStore) : cloudStore;
    const remoteReviews = new Map(remoteStore.reviews.map(review => [review.id, review]));
    if (cloudStore.reviews.some(review => !sameValue(review, remoteReviews.get(review.id)))) throw new Error("账户复习记录存在冲突，已停止迁入");
    const merged = options.preferLocal
      ? mergeApprovedDesktopStore(local, remoteStore, options)
      : mergePrivateStores(local, remoteStore);
    if (!options.preferLocal) assertLocalCollectionPreserved(local, merged);
    const document = await encryptPrivateStore(merged, session);
    if (options.canWrite && !options.canWrite()) throw new Error("当前账户已改变，已停止迁入");
    const result = await fetch(`${session.endpoint}/vault`, {
      method: "PUT", headers: headers(session.code),
      body: JSON.stringify({ baseRevision: remote.revision, document }),
      signal: AbortSignal.timeout(20_000),
    });
    if (result.status === 409) continue;
    if (!result.ok) {
      const body = await result.json();
      throw new Error(body.error || `连接失败（${result.status}），电脑进度未改动`);
    }
    return merged;
  }
  throw new Error("其他设备正在更新词库，尚未完成连接；电脑进度未改动");
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
