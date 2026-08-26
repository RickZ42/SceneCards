const GITHUB_API_VERSION = "2026-03-10";

export const REVIEW_SYNC_REPOSITORY = "RickZ42/SceneCards";
export const REVIEW_SYNC_BRANCH = "review-sync";
export const REVIEW_SYNC_PATH = "review-state-v2.enc.json";

const REVIEW_STATE_FIELDS = [
  "dueAt",
  "intervalDays",
  "ease",
  "repetitions",
  "lapses",
  "lastReviewedAt",
  "reviewQueueOrder",
];

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function compareReviews(a, b) {
  return compareText(a.at, b.at) || compareText(a.id, b.id);
}

function latestReviewForCard(reviews, cardId) {
  return (reviews || [])
    .filter((review) => review.cardId === cardId)
    .sort(compareReviews)
    .at(-1);
}

function normalizeReview(review) {
  if (!review?.id || !review?.cardId || !review?.at) return null;
  if (!["again", "good", "easy"].includes(review.rating)) return null;
  return {
    id: String(review.id),
    cardId: String(review.cardId),
    rating: review.rating,
    at: String(review.at),
  };
}

function cardStateFromCard(card, reviews, { includeUnreviewed = false } = {}) {
  if (!card?.id || !card.dueAt || (!includeUnreviewed && !card.lastReviewedAt)) return null;
  const latestReview = latestReviewForCard(reviews, card.id);
  const state = {
    cardId: card.id,
    lastReviewId: latestReview?.id || "",
  };
  for (const field of REVIEW_STATE_FIELDS) {
    if (field === "reviewQueueOrder") {
      state[field] = Number.isFinite(card[field]) ? card[field] : null;
    } else {
      state[field] = card[field] ?? null;
    }
  }
  return state;
}

function normalizeCardState(state) {
  if (!state?.cardId || !state.dueAt) return null;
  const normalized = {
    cardId: String(state.cardId),
    lastReviewId: String(state.lastReviewId || ""),
  };
  for (const field of REVIEW_STATE_FIELDS) {
    normalized[field] = field === "reviewQueueOrder" && !Number.isFinite(state[field])
      ? null
      : state[field] ?? null;
  }
  return normalized;
}

function compareCardStates(a, b) {
  return (
    compareText(a?.lastReviewedAt, b?.lastReviewedAt) ||
    compareText(a?.lastReviewId, b?.lastReviewId) ||
    compareText(JSON.stringify(a), JSON.stringify(b))
  );
}

function documentTimestamp(cardStates, reviews) {
  return [
    ...Object.values(cardStates).map((state) => state.lastReviewedAt),
    ...reviews.map((review) => review.at),
  ]
    .filter(Boolean)
    .sort(compareText)
    .at(-1) || null;
}

function normalizeDocument(document) {
  const reviewsById = new Map();
  for (const rawReview of document?.reviews || []) {
    const review = normalizeReview(rawReview);
    if (review) reviewsById.set(review.id, review);
  }
  const reviews = [...reviewsById.values()].sort(compareReviews);

  const cardStates = {};
  for (const rawState of Object.values(document?.cardStates || {})) {
    const state = normalizeCardState(rawState);
    if (state) cardStates[state.cardId] = state;
  }

  const orderedCardStates = Object.fromEntries(
    Object.entries(cardStates).sort(([a], [b]) => compareText(a, b)),
  );
  return {
    version: 2,
    resetId: typeof document?.resetId === "string" ? document.resetId : "",
    resetAt: typeof document?.resetAt === "string" ? document.resetAt : "",
    updatedAt: documentTimestamp(orderedCardStates, reviews),
    cardStates: orderedCardStates,
    reviews,
  };
}

export function createReviewDocument(
  store,
  { includeUnreviewed = false, resetId = "", resetAt = "" } = {},
) {
  const reviews = (store?.reviews || []).map(normalizeReview).filter(Boolean);
  const cardStates = {};
  for (const card of store?.cards || []) {
    const state = cardStateFromCard(card, reviews, { includeUnreviewed });
    if (state) cardStates[state.cardId] = state;
  }
  return normalizeDocument({ cardStates, reviews, resetId, resetAt });
}

export function mergeReviewDocuments(localDocument, remoteDocument) {
  const local = normalizeDocument(localDocument);
  const remote = normalizeDocument(remoteDocument);
  const reviewsById = new Map(remote.reviews.map((review) => [review.id, review]));
  for (const review of local.reviews) reviewsById.set(review.id, review);

  const cardIds = new Set([
    ...Object.keys(remote.cardStates),
    ...Object.keys(local.cardStates),
  ]);
  const cardStates = {};
  for (const cardId of cardIds) {
    const localState = local.cardStates[cardId];
    const remoteState = remote.cardStates[cardId];
    if (!localState) cardStates[cardId] = remoteState;
    else if (!remoteState) cardStates[cardId] = localState;
    else cardStates[cardId] = compareCardStates(localState, remoteState) >= 0
      ? localState
      : remoteState;
  }

  const resetSource = compareText(local.resetAt, remote.resetAt) >= 0 ? local : remote;
  return normalizeDocument({
    cardStates,
    reviews: [...reviewsById.values()],
    resetId: resetSource.resetId,
    resetAt: resetSource.resetAt,
  });
}

function schedulingFromState(state) {
  return Object.fromEntries(
    REVIEW_STATE_FIELDS.map((field) => [
      field,
      field === "reviewQueueOrder" && state[field] === null
        ? undefined
        : state[field],
    ]),
  );
}

export function applyReviewDocument(store, document) {
  const merged = mergeReviewDocuments(createReviewDocument(store), document);
  const cards = (store?.cards || []).map((card) => {
    const state = merged.cardStates[card.id];
    if (!state) return card;
    const localState = cardStateFromCard(card, store.reviews || []);
    if (localState && compareCardStates(localState, state) > 0) return card;

    return { ...card, ...schedulingFromState(state) };
  });
  return { ...store, cards, reviews: merged.reviews };
}

export function replaceReviewDocument(store, document) {
  const authoritative = normalizeDocument(document);
  const cards = (store?.cards || []).map((card) => {
    const state = authoritative.cardStates[card.id];
    if (state) return { ...card, ...schedulingFromState(state) };
    return {
      ...card,
      dueAt: card.createdAt || new Date().toISOString(),
      intervalDays: 0,
      ease: 2.5,
      repetitions: 0,
      lapses: 0,
      lastReviewedAt: null,
      reviewQueueOrder: undefined,
    };
  });
  return { ...store, cards, reviews: authoritative.reviews };
}

export function reviewDocumentFingerprint(document) {
  return JSON.stringify(normalizeDocument(document));
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value.replace(/\s+/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveEncryptionKey(passphrase, salt, iterations) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("当前浏览器不支持安全的进度加密");
  }
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptDocument(document, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 210000;
  const key = await deriveEncryptionKey(passphrase, salt, iterations);
  const plaintext = new TextEncoder().encode(reviewDocumentFingerprint(document));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    version: 1,
    encryption: "PBKDF2-SHA256/AES-256-GCM",
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptDocument(payload, passphrase) {
  try {
    if (payload?.version !== 1 || !payload.salt || !payload.iv || !payload.ciphertext) {
      throw new Error("Unsupported encrypted review state");
    }
    const salt = base64ToBytes(payload.salt);
    const iv = base64ToBytes(payload.iv);
    const key = await deriveEncryptionKey(passphrase, salt, payload.iterations || 210000);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      base64ToBytes(payload.ciphertext),
    );
    return normalizeDocument(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch (error) {
    if (error.message === "当前浏览器不支持安全的进度加密") throw error;
    throw new Error("同步密码不正确，无法读取 GitHub 上的复习进度");
  }
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

function githubContentsUrl() {
  return `https://api.github.com/repos/${REVIEW_SYNC_REPOSITORY}/contents/${REVIEW_SYNC_PATH}`;
}

async function readRemoteDocument(token, passphrase) {
  const response = await fetch(
    `${githubContentsUrl()}?ref=${encodeURIComponent(REVIEW_SYNC_BRANCH)}`,
    { headers: githubHeaders(token), cache: "no-store" },
  );
  if (response.status === 404) return { document: null, sha: null };
  if (response.status === 401) throw new Error("GitHub 令牌无效或已经过期");
  if (!response.ok) throw new Error(`读取 GitHub 复习进度失败（${response.status}）`);

  const file = await response.json();
  const encrypted = JSON.parse(new TextDecoder().decode(base64ToBytes(file.content)));
  return { document: await decryptDocument(encrypted, passphrase), sha: file.sha };
}

async function writeRemoteDocument(document, sha, token, passphrase) {
  const encrypted = await encryptDocument(document, passphrase);
  const content = bytesToBase64(
    new TextEncoder().encode(`${JSON.stringify(encrypted, null, 2)}\n`),
  );
  const body = {
    message: "Sync SceneCards review progress",
    content,
    branch: REVIEW_SYNC_BRANCH,
  };
  if (sha) body.sha = sha;

  const response = await fetch(githubContentsUrl(), {
    method: "PUT",
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 401) throw new Error("GitHub 令牌无效或已经过期");
  if (response.status === 403) {
    throw new Error("令牌需要 SceneCards 仓库的 Contents 读写权限");
  }
  if (response.status === 409 || response.status === 422) return false;
  if (!response.ok) throw new Error(`写入 GitHub 复习进度失败（${response.status}）`);
  return true;
}

export async function syncReviewProgress({
  store,
  token,
  passphrase,
  acceptedResetId = "",
}) {
  const localDocument = createReviewDocument(store);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remote = await readRemoteDocument(token, passphrase);
    if (
      remote.document?.resetId &&
      remote.document.resetId !== acceptedResetId
    ) {
      return {
        document: remote.document,
        pushed: false,
        replaceLocal: true,
        resetId: remote.document.resetId,
      };
    }
    const merged = mergeReviewDocuments(localDocument, remote.document);
    if (
      remote.document &&
      reviewDocumentFingerprint(merged) === reviewDocumentFingerprint(remote.document)
    ) {
      return {
        document: merged,
        pushed: false,
        replaceLocal: false,
        resetId: merged.resetId,
      };
    }
    if (await writeRemoteDocument(merged, remote.sha, token, passphrase)) {
      return {
        document: merged,
        pushed: true,
        replaceLocal: false,
        resetId: merged.resetId,
      };
    }
  }
  throw new Error("复习进度发生同步冲突，请稍后再试");
}

export async function overwriteRemoteReviewProgress({ store, token, passphrase }) {
  const resetAt = new Date().toISOString();
  const resetId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `reset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const document = createReviewDocument(store, {
    includeUnreviewed: true,
    resetId,
    resetAt,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remote = await readRemoteDocument(token, passphrase);
    if (await writeRemoteDocument(document, remote.sha, token, passphrase)) {
      return { document, resetId };
    }
  }
  throw new Error("覆盖云端进度时发生冲突，请稍后再试");
}
